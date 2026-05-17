#!/usr/bin/env node
/**
 * Zoho Desk KB probe — uses the same OAuth env vars as the app (.env.local).
 *
 * Prints: token health, org match, departments, KB categories per department,
 * and a small sample of articles (titles + ids) where the API allows.
 *
 * Usage (from repo root):
 *   npm run zoho:desk-kb-probe
 *
 * Optional env:
 *   ZOHO_ACCESS_TOKEN           — short-lived; probe uses it first, then refresh on 401 (app code ignores this)
 *   ZOHO_ACCOUNTS_HOST          — OAuth hostname only, e.g. accounts.zoho.com (see .env.example)
 *   ZOHO_DESK_HOST              — Desk REST hostname only, e.g. desk.zoho.com
 *   ZOHO_REDIRECT_URI           — Web-based OAuth clients: exact callback URL from Zoho API Console (required for some refreshes)
 *   ZOHO_PROBE_DEPARTMENT_ID    — only drill this department (saves API credits)
 *   ZOHO_PROBE_CATEGORY_ID      — list articles for this category only (within that dept)
 *   ZOHO_PROBE_MAX_DEPARTMENTS  — default 30 (when no ZOHO_PROBE_DEPARTMENT_ID)
 *   ZOHO_PROBE_MAX_CATEGORIES   — default 15 categories total across scanned depts
 *   ZOHO_PROBE_ARTICLES_PER_CAT — default 5
 *   ZOHO_PROBE_REFRESH_ONLY=1  — skip ZOHO_ACCESS_TOKEN; call refresh immediately (same result as removing access token while this is set)
 *   ZOHO_PROBE_VERBOSE_OAUTH=0 — set to 0 to hide the detailed OAuth failure dump (default: print full diagnostics on refresh failure)
 *   ZOHO_PROBE_IRI_DEPT_ID       — override default Systems Support department id for the IRI KB block
 *   ZOHO_PROBE_IRI_CATEGORY_ID  — override default KB category id from IRI’s Zoho One category URL
 *
 * Flags:
 *   --json   dump truncated JSON for a successful /articles response
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

function loadDotEnvFile(filePath) {
    if (!existsSync(filePath)) return;
    const text = readFileSync(filePath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = val;
    }
}

loadDotEnvFile(join(REPO_ROOT, '.env.local'));
loadDotEnvFile(join(REPO_ROOT, '.env'));

const dumpJson = process.argv.includes('--json');

const clientId = process.env.ZOHO_CLIENT_ID?.trim();
const clientSecret = process.env.ZOHO_CLIENT_SECRET?.trim();
const refreshToken = process.env.ZOHO_REFRESH_TOKEN?.trim();
/** Optional: use a short-lived token and skip refresh (expires ~1h). Falls back to refresh on 401. */
const accessTokenFromEnv = process.env.ZOHO_ACCESS_TOKEN?.trim();
const orgId = process.env.ZOHO_ORG_ID?.trim();
const datacenter = (process.env.ZOHO_DATACENTER || 'com.au').trim();
const accountsHost = (
    process.env.ZOHO_ACCOUNTS_HOST?.trim() || `accounts.zoho.${datacenter}`
).trim();
const deskApiHost = (process.env.ZOHO_DESK_HOST?.trim() || `desk.zoho.${datacenter}`).trim();
const oauthRedirectUri = process.env.ZOHO_REDIRECT_URI?.trim();

const probeDeptId = process.env.ZOHO_PROBE_DEPARTMENT_ID?.trim();
const probeCategoryId = process.env.ZOHO_PROBE_CATEGORY_ID?.trim();
const maxDepartments = Number(process.env.ZOHO_PROBE_MAX_DEPARTMENTS || 30);
const maxCategories = Number(process.env.ZOHO_PROBE_MAX_CATEGORIES || 15);
const articlesPerCat = Number(process.env.ZOHO_PROBE_ARTICLES_PER_CAT || 5);
const probeRefreshOnly = ['1', 'true', 'yes'].includes(
    String(process.env.ZOHO_PROBE_REFRESH_ONLY || '').toLowerCase(),
);
const verboseOAuthFailure = !['0', 'false', 'no'].includes(
    String(process.env.ZOHO_PROBE_VERBOSE_OAUTH ?? '1').toLowerCase(),
);

/** IRI “Systems Support” dedicated AI KB — ids from Zoho One KB URL (categoryId query param + matching department). */
const iriProbeDeptId = (
    process.env.ZOHO_PROBE_IRI_DEPT_ID?.trim() || '493989000054808139'
).trim();
const iriProbeCategoryId = (
    process.env.ZOHO_PROBE_IRI_CATEGORY_ID?.trim() || '493989000054766237'
).trim();
const zohoPortalId = process.env.ZOHO_PORTAL_ID?.trim();
const zohoPortalId2 = process.env.ZOHO_PORTAL_ID_2?.trim();

const tokenUrl = `https://${accountsHost}/oauth/v2/token`;
const baseUrl = `https://${deskApiHost}/api/v1`;

function requireEnv(name, value) {
    if (!value) {
        throw new Error(`Missing ${name}. Set it in .env.local (see .env.example).`);
    }
}

function buildRefreshParams(includeRedirect) {
    const params = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
    });
    if (includeRedirect && oauthRedirectUri) {
        params.set('redirect_uri', oauthRedirectUri);
    }
    return params;
}

async function postRefresh(params) {
    return fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
    });
}

function parseTokenResponse(bodyText) {
    try {
        return JSON.parse(bodyText);
    } catch {
        return null;
    }
}

/** Safe fingerprint for comparing tokens without printing full secrets. */
function tokenFingerprint(label, value) {
    if (!value) return `  ${label}: (empty)`;
    const len = value.length;
    const head = value.slice(0, 10);
    const tail = len > 14 ? value.slice(-6) : '';
    return `  ${label}: length=${len}  fingerprint="${head}…${tail}"`;
}

/**
 * Everything Zoho returned + what we sent (meta only) so you can see *why* refresh failed.
 */
function logOAuthRefreshFailureDetails(attemptLabel, res, bodyText, data, params) {
    if (!verboseOAuthFailure) {
        console.error('[ZOHO_PROBE_VERBOSE_OAUTH=0] Full OAuth diagnostics suppressed. Set ZOHO_PROBE_VERBOSE_OAUTH=1 to print request/response details.');
        return;
    }
    const sentRedirectUri = params.has('redirect_uri');
    console.error('');
    console.error('══════════════════════════════════════════════════════════════════');
    console.error(`  ZOHO OAUTH REFRESH FAILURE  (${attemptLabel})`);
    console.error('══════════════════════════════════════════════════════════════════');
    console.error(`  Request: POST ${tokenUrl}`);
    console.error('  Form fields sent: grant_type, client_id, client_secret, refresh_token'
        + (sentRedirectUri ? ', redirect_uri' : ''));
    console.error(tokenFingerprint('client_id', clientId));
    console.error(tokenFingerprint('client_secret', clientSecret));
    console.error(tokenFingerprint('refresh_token', refreshToken));
    console.error(`  ZOHO_REDIRECT_URI env: ${oauthRedirectUri ? `set, length=${oauthRedirectUri.length}` : 'not set'}`);
    console.error(`  ZOHO_ACCOUNTS_HOST → token host: ${accountsHost}`);
    console.error(`  ZOHO_DESK_HOST → Desk REST host: ${deskApiHost}`);
    console.error(`  ZOHO_ORG_ID (Desk header, not sent on token POST): ${orgId ?? '(unset)'}`);
    console.error('');
    console.error(`  Response HTTP: ${res.status} ${res.statusText}`);
    const interestingHeaders = ['content-type', 'www-authenticate', 'x-ratelimit', 'x-zoho'];
    for (const [k, v] of res.headers.entries()) {
        const low = k.toLowerCase();
        if (interestingHeaders.some((h) => low.includes(h))) {
            console.error(`  Response header ${k}: ${v}`);
        }
    }
    console.error('  Response body (raw):');
    console.error(bodyText.length > 2000 ? `${bodyText.slice(0, 2000)}\n  … (${bodyText.length} chars total)` : bodyText);
    if (data && typeof data === 'object') {
        console.error('  Parsed JSON fields:');
        for (const key of Object.keys(data)) {
            const val = data[key];
            if (key === 'access_token' && typeof val === 'string') {
                console.error(`    ${key}: (present, length ${val.length})`);
            } else {
                console.error(`    ${key}: ${typeof val === 'object' ? JSON.stringify(val) : val}`);
            }
        }
    }
    console.error('  → Conclusion: Zoho rejected this refresh_token for this client_id/secret pair.');
    console.error('    Fix: In api-console for THIS client (see client_id fingerprint), run Self Client (or web OAuth)');
    console.error('    generate code → POST token exchange → paste the NEW refresh_token into ZOHO_REFRESH_TOKEN.');
    console.error('══════════════════════════════════════════════════════════════════');
    console.error('');
}

async function refreshAccessToken() {
    requireEnv('ZOHO_CLIENT_ID', clientId);
    requireEnv('ZOHO_CLIENT_SECRET', clientSecret);
    requireEnv('ZOHO_REFRESH_TOKEN', refreshToken);

    let params = buildRefreshParams(true);
    let res = await postRefresh(params);
    let bodyText = await res.text();

    let data = parseTokenResponse(bodyText);
    const invalidCode = data?.error === 'invalid_code' || bodyText.includes('invalid_code');

    let didRedirectRetry = false;
    if (oauthRedirectUri && invalidCode) {
        console.warn('OAuth refresh returned invalid_code with ZOHO_REDIRECT_URI; retrying without redirect_uri…');
        logOAuthRefreshFailureDetails('attempt 1 (invalid_code while redirect_uri was sent)', res, bodyText, data, params);
        params = buildRefreshParams(false);
        didRedirectRetry = true;
        res = await postRefresh(params);
        bodyText = await res.text();
        data = parseTokenResponse(bodyText);
    }

    if (!res.ok) {
        console.error(`OAuth token refresh failed: HTTP ${res.status}`);
        logOAuthRefreshFailureDetails(
            didRedirectRetry ? 'attempt 2 (HTTP error after redirect retry)' : 'HTTP error',
            res,
            bodyText,
            data,
            params,
        );
        printOAuthHints(data?.error, bodyText);
        throw new Error('Zoho OAuth refresh failed');
    }
    if (!data) {
        console.error('OAuth response was not JSON');
        logOAuthRefreshFailureDetails(
            didRedirectRetry ? 'attempt 2 (unparseable body)' : 'unparseable body',
            res,
            bodyText,
            null,
            params,
        );
        throw new Error('Zoho OAuth refresh response not JSON');
    }
    if (data.error || !data.access_token) {
        console.error(`OAuth error in JSON: ${data.error ?? 'unknown'} — no access_token`);
        if (data.error_description) {
            console.error(`Zoho error_description: ${data.error_description}`);
        }
        logOAuthRefreshFailureDetails(
            didRedirectRetry ? 'attempt 2 (JSON error after redirect retry)' : 'attempt 1 (JSON error in body)',
            res,
            bodyText,
            data,
            params,
        );
        printOAuthHints(data.error, bodyText);
        throw new Error('Zoho OAuth refresh missing access_token');
    }
    return data.access_token;
}

function printOAuthHints(errorCode, bodyText) {
    if (bodyText.includes('invalid_client') || errorCode === 'invalid_client') {
        console.error('');
        console.error('Hint: invalid_client — wrong client_id/secret or wrong ZOHO_ACCOUNTS_HOST (try accounts.zoho.com).');
    }
    if (errorCode === 'invalid_code' || bodyText.includes('invalid_code')) {
        console.error('');
        console.error('What this means: Zoho refused the refresh. The probe script is fine; fix .env values or regenerate tokens.');
        console.error('');
        console.error('Fix list (most common first):');
        console.error('  1) ZOHO_REFRESH_TOKEN must be the long "refresh_token" from the token JSON — never the ?code= from the browser URL.');
        console.error('  2) Web-based client: ZOHO_REDIRECT_URI must match the Callback URL in API Console exactly (or leave unset if Self Client).');
        console.error('  3) Self Client (recommended for servers): create "Self Client" in api-console, generate code with scopes, exchange once, paste new refresh_token — no redirect_uri.');
        console.error('  4) Regenerate refresh token if it was copied wrong, revoked, or created under a different Zoho API client.');
        console.error('  5) If you changed ZOHO_CLIENT_ID / CLIENT_SECRET in .env but kept the same ZOHO_REFRESH_TOKEN — that will NOT work.');
        console.error('     The refresh_token is permanently bound to the client that issued it. Exchange a new grant for THIS client id.');
        console.error('');
        console.error('Tip: set ZOHO_PROBE_REFRESH_ONLY=1 and remove ZOHO_ACCESS_TOKEN to test refresh alone.');
    }
}

async function deskGet(accessToken, pathWithQuery) {
    const url = `${baseUrl}${pathWithQuery}`;
    const res = await fetch(url, {
        headers: {
            Authorization: `Zoho-oauthtoken ${accessToken}`,
            orgId: String(orgId),
        },
    });
    const text = await res.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = { _raw: text };
    }
    return { ok: res.ok, status: res.status, json, text };
}

/** Desk access token: env access token if set, else refresh. */
async function resolveDeskToken() {
    if (probeRefreshOnly) {
        return refreshAccessToken();
    }
    if (accessTokenFromEnv) {
        console.log('ZOHO_ACCESS_TOKEN is set; using it first. On 401, will try refresh_token if available.');
        return accessTokenFromEnv;
    }
    return refreshAccessToken();
}

function isDeskUnauthorized(result) {
    return (
        result.status === 401
        || result.json?.errorCode === 'INVALID_OAUTH'
        || result.json?.errorCode === 'UNAUTHORIZED'
    );
}

/**
 * Mutable token + GET with one retry via refresh when the env access token is stale.
 */
function createDeskSession() {
    let token = null;
    async function get(pathWithQuery) {
        if (!token) {
            token = await resolveDeskToken();
            if (probeRefreshOnly || !accessTokenFromEnv) {
                console.log('OAuth: access token from refresh OK.');
                console.log('');
            }
        }
        let result = await deskGet(token, pathWithQuery);
        if (
            isDeskUnauthorized(result)
            && accessTokenFromEnv
            && !probeRefreshOnly
            && refreshToken
            && clientId
            && clientSecret
        ) {
            console.log('Desk call unauthorized; refreshing via refresh_token…');
            token = await refreshAccessToken();
            result = await deskGet(token, pathWithQuery);
        }
        return result;
    }
    return { get };
}

function printDeskError(label, { status, json }) {
    const code = json?.errorCode ?? json?.error;
    const msg = json?.message ?? JSON.stringify(json);
    console.log(`  [FAIL] ${label}: HTTP ${status}${code ? ` (${code})` : ''} — ${msg}`);
}

/** Public Help Center portal API (no OAuth). Same surface as ZohoDeskClient.searchArticles. */
async function portalKbArticlesByCategory(portalId, categoryId, limit) {
    const u = new URL(`https://${deskApiHost}/portal/api/kbArticles`);
    u.searchParams.set('portalId', portalId);
    u.searchParams.set('categoryId', categoryId);
    u.searchParams.set('from', '1');
    u.searchParams.set('limit', String(limit));
    const res = await fetch(u.toString());
    const text = await res.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = { _raw: text };
    }
    return { ok: res.ok, status: res.status, json, text };
}

function printPortalError(label, { status, json }) {
    const code = json?.errorCode ?? json?.error;
    const msg = json?.message ?? JSON.stringify(json);
    console.log(`  [FAIL] ${label}: HTTP ${status}${code ? ` (${code})` : ''} — ${msg}`);
}

async function main() {
    requireEnv('ZOHO_ORG_ID', orgId);

    console.log('Zoho Desk KB probe');
    console.log(`  datacenter: ${datacenter}`);
    console.log(`  accounts host (OAuth): ${accountsHost}`);
    console.log(`  desk API host (REST): ${deskApiHost}`);
    console.log(`  orgId: ${orgId}`);
    console.log('');
    console.log('Probe options (effective — from .env.local / .env / current shell):');
    console.log(`  - ZOHO_PROBE_REFRESH_ONLY: ${probeRefreshOnly ? 'on (always uses refresh; ignores ZOHO_ACCESS_TOKEN)' : 'off'}`);
    console.log(`  - ZOHO_PROBE_VERBOSE_OAUTH: ${verboseOAuthFailure ? 'on' : 'off'}`);
    if (probeRefreshOnly) {
        console.log('    To turn off: remove ZOHO_PROBE_REFRESH_ONLY from .env.local, or run: Remove-Item Env:ZOHO_PROBE_REFRESH_ONLY');
    }
    console.log('');

    const desk = createDeskSession();

    const orgCheck = await desk.get(`/organizations/${encodeURIComponent(orgId)}`);
    if (!orgCheck.ok) {
        printDeskError('GET /organizations/{orgId}', orgCheck);
        console.log('\nIf you see OAUTH_ORG_MISMATCH, the refresh token is bound to a different Desk org than ZOHO_ORG_ID.');
    } else {
        const o = orgCheck.json;
        console.log('Organization (token scope check):');
        console.log(`  companyName: ${o?.companyName ?? '?'}`);
        console.log(`  portalName: ${o?.portalName ?? '?'}`);
        console.log(`  id: ${o?.id ?? '?'}`);
        console.log('');
    }

    const deptPath = `/departments?from=1&limit=${Math.min(200, maxDepartments)}&isEnabled=true`;
    const deptRes = await desk.get(deptPath);
    if (!deptRes.ok) {
        printDeskError('GET /departments', deptRes);
        console.log('\nLikely missing OAuth scope: Desk.basic.READ or Desk.settings.READ');
        throw new Error('GET /departments failed');
    }

    const departments = deptRes.json?.data ?? [];
    console.log(`Departments (enabled, showing up to ${maxDepartments}):`);
    for (const d of departments) {
        const portalName = d.nameInCustomerPortal ?? '';
        console.log(`  - id=${d.id} name="${d.name}" portal="${portalName}" visibleInHC=${d.isVisibleInCustomerPortal}`);
    }
    console.log('');

    // -------------------------------------------------------------------------
    // IRI — Systems Support “AI bot” KB (stakeholder link: Zoho One > Desk >
    // systems-support > Knowledge Base; categoryId in URL query string)
    // -------------------------------------------------------------------------
    console.log('--- IRI — Systems Support AI KB (category from stakeholder URL) ---');
    console.log(
        '  Defaults: departmentId=' +
            iriProbeDeptId +
            ', categoryId=' +
            iriProbeCategoryId +
            ' (override with ZOHO_PROBE_IRI_DEPT_ID / ZOHO_PROBE_IRI_CATEGORY_ID)',
    );

    const iriByCategoryOnly = `/articles?categoryId=${encodeURIComponent(iriProbeCategoryId)}&from=1&limit=15`;
    const iriArt = await desk.get(iriByCategoryOnly);
    if (!iriArt.ok) {
        printDeskError(`GET ${iriByCategoryOnly}`, iriArt);
        if (iriArt.json?.errorCode === 'SCOPE_MISMATCH' || iriArt.status === 403) {
            console.log(
                '  Fix: in Zoho API Console add scope Desk.articles.READ to this client, generate a new grant, exchange for a new refresh_token, update .env.local.',
            );
        }
    } else {
        const list = iriArt.json?.data ?? [];
        console.log(
            `  OAuth REST (${deskApiHost}/api/v1): ${list.length} article(s) for this category (first page, limit 15).`,
        );
        console.log(
            `  (departmentId=${iriProbeDeptId} is for human context only; Desk rejects departmentId+categoryId together on /articles.)`,
        );
        for (const a of list) {
            const title = a.title ?? a.question ?? '(no title)';
            const st = a.status ?? a.articleStatus ?? a.visibility ?? '';
            console.log(
                `    - id=${a.id} status=${st} title="${String(title).slice(0, 120)}${String(title).length > 120 ? '…' : ''}"`,
            );
        }
    }

    const portalIds = [...new Set([zohoPortalId, zohoPortalId2].filter(Boolean))];
    if (portalIds.length === 0) {
        console.log('  (Skipping public portal/api/kbArticles: no ZOHO_PORTAL_ID in env.)');
    } else {
        console.log('  Public portal API (no OAuth) — tries ZOHO_PORTAL_ID / ZOHO_PORTAL_ID_2 if set:');
        for (const pid of portalIds) {
            const label = `GET /portal/api/kbArticles?portalId=…&categoryId=${iriProbeCategoryId}`;
            const pub = await portalKbArticlesByCategory(pid, iriProbeCategoryId, 5);
            if (!pub.ok) {
                printPortalError(`${label} (portal …${String(pid).slice(-8)})`, pub);
            } else {
                const pdata = pub.json?.data ?? [];
                console.log(
                    `  OK portal …${String(pid).slice(-8)}: ${pdata.length} published article(s) (limit 5).`,
                );
                for (const a of pdata) {
                    const title = a.title ?? '(no title)';
                    console.log(
                        `    - id=${a.id} title="${String(title).slice(0, 100)}${String(title).length > 100 ? '…' : ''}"`,
                    );
                }
            }
        }
    }
    console.log('');

    let deptsToScan = departments;
    if (probeDeptId) {
        deptsToScan = departments.filter((d) => String(d.id) === probeDeptId);
        if (deptsToScan.length === 0) {
            console.warn(`ZOHO_PROBE_DEPARTMENT_ID=${probeDeptId} not in first page; trying kbCategories on that id anyway.`);
            deptsToScan = [{ id: probeDeptId, name: '(probe id only)' }];
        }
    } else {
        const systemMatch = departments.filter((d) => /system/i.test(String(d.name ?? '')));
        if (systemMatch.length > 0) {
            console.log('Auto-selected department(s) with "system" in name (set ZOHO_PROBE_DEPARTMENT_ID to override):');
            deptsToScan = systemMatch;
        }
    }

    let categoriesUsed = 0;

    for (const dept of deptsToScan) {
        const did = String(dept.id);
        console.log(`--- KB categories: department ${did} (${dept.name ?? ''}) ---`);

        const catRes = await desk.get(`/kbCategories?departmentId=${encodeURIComponent(did)}`);
        if (!catRes.ok) {
            printDeskError(`GET /kbCategories?departmentId=${did}`, catRes);
            continue;
        }

        const categories = catRes.json?.data ?? [];
        console.log(`  category count: ${categories.length}`);
        for (const c of categories) {
            console.log(`    - id=${c.id} name="${c.name ?? ''}"`);
        }

        for (const c of categories) {
            if (categoriesUsed >= maxCategories) {
                console.log(`  (stopped: ZOHO_PROBE_MAX_CATEGORIES=${maxCategories})`);
                break;
            }
            const cid = String(c.id);
            if (probeCategoryId && cid !== probeCategoryId) continue;

            const artQuery = `/articles?categoryId=${encodeURIComponent(cid)}&from=1&limit=${articlesPerCat}`;
            const artRes = await desk.get(artQuery);
            if (!artRes.ok) {
                printDeskError(`GET ${artQuery}`, artRes);
                categoriesUsed += 1;
                continue;
            }

            const articles = artRes.json?.data ?? [];
            if (dumpJson && articles.length) {
                console.log('  [debug] sample /articles JSON:', JSON.stringify(artRes.json, null, 2).slice(0, 4000));
            }
            console.log(`  Articles in "${c.name}" (${cid}): ${articles.length} (first page, limit ${articlesPerCat})`);
            for (const a of articles) {
                const title = a.title ?? a.question ?? '(no title)';
                const status = a.status ?? a.articleStatus ?? a.visibility ?? '';
                console.log(`      - id=${a.id} status=${status} title="${String(title).slice(0, 120)}${String(title).length > 120 ? '…' : ''}"`);
            }
            categoriesUsed += 1;
        }

        if (categoriesUsed >= maxCategories) break;
    }

    console.log('');
    console.log('Summary');
    console.log('  OAuth refresh + org + departments = working integration baseline.');
    console.log(
        '  If GET /kbCategories returns URL_NOT_FOUND (404), the v1 path may be unavailable for this org; list articles via GET /articles?categoryId=… (needs Desk.articles.READ) or public portal /kbArticles.',
    );
    console.log('  If /articles returns SCOPE_MISMATCH, add Desk.articles.READ and regenerate the refresh token.');
    console.log('  Public portal calls use ZOHO_PORTAL_ID*; they only return data when portalId matches that help center.');
}

main().catch((e) => {
    if (e instanceof Error) {
        console.error(`\nProbe failed: ${e.message}`);
    } else {
        console.error(e);
    }
    process.exitCode = 1;
});
