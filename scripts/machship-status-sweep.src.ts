/* ─────────────────────────────────────────────────────────────────────────
 * machship-status-sweep — two jobs, both preventative.
 *
 * 1. DRIFT CHECK. statusMap.ts was built from live data on 4 Aug 2026. By 24 Aug
 *    "Awaiting Collection" had appeared and was NOT mapped, so it fell through to
 *    the `await` keyword in the preparing fallback and told customers their parcel
 *    was still being prepared while it sat at a post office. This sweep reports any
 *    live status name that CONSIGNMENT_STATUS_MAP does not handle explicitly, so
 *    the next one is caught by us rather than by a customer.
 *
 * 2. FIND TEST ORDERS. Reports which orders are currently sitting in the states
 *    that are otherwise impossible to observe: Awaiting Collection, Delivery
 *    Attempted, Partial Delivery, Delayed, and any order with 2+ live consignments.
 *
 * Read-only. PII masked. Runs LOCALLY (sandbox blocks live.machship.com):
 *     node --env-file=.env.local scripts/machship-status-sweep.mjs [--days 10]
 *
 * Rebuild: npx esbuild scripts/machship-status-sweep.src.ts --bundle \
 *   --platform=node --format=esm --alias:@=. --outfile=scripts/machship-status-sweep.mjs
 * ───────────────────────────────────────────────────────────────────────── */
import { settings } from '@/lib/config/settings';
import { CONSIGNMENT_STATUS_MAP, classifyConsignmentStatus } from '@/lib/services/tracking/statusMap';

const BASE = settings.machship.baseUrl;
const TOKEN = settings.machship.token;
if (!TOKEN) { console.error('MACHSHIP_TOKEN not set.'); process.exit(1); }

const daysIdx = process.argv.indexOf('--days');
// MachShip rejects EXACTLY 10 days ("You cannot go back further than 10 days for
// this query"), so the usable ceiling is 9.
const DAYS = Math.min(9, Number(daysIdx >= 0 ? process.argv[daysIdx + 1] : 9) || 9);

const mask = (v: unknown): string => {
    if (typeof v !== 'string' || !v) return '(none)';
    if (v.includes('@')) { const [u, d] = v.split('@'); return `${u.slice(0, 2)}***@${d}`; }
    return v;
};

const INTERESTING = /awaiting collection|delivery attempted|partial|delayed|for collection|card left/i;
const DEAD = /cancel|delet|void/i;

interface Cons {
    status?: { name?: string };
    customerReference?: string;
    customerReference2?: string;
    consignmentNumber?: string;
    toEmail?: string | null;
    consignmentItems?: unknown[];
    [k: string]: unknown;
}

/** GET with query params — this is the shape machship-toemail-check.mjs proves works.
 *  An earlier POST-with-body version of this script returned 0 consignments silently. */
async function post(path: string, body: unknown) {
    const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { token: TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    let env: { object?: unknown } | null = null;
    try { env = JSON.parse(text); } catch { /* non-JSON */ }
    return Array.isArray(env?.object) ? (env!.object as Cons[]) : [];
}

async function get(path: string) {
    const res = await fetch(`${BASE}${path}`, {
        method: 'GET',
        headers: { token: TOKEN, 'Content-Type': 'application/json' },
    });
    const text = await res.text();
    let env: { object?: unknown; errors?: Array<{ errorMessage?: string }> } | null = null;
    try { env = JSON.parse(text); } catch { /* non-JSON */ }
    return { http: res.status, env };
}

(async () => {
    // ── Stage 1: the summary endpoint, for REFERENCES ONLY ───────────────────
    // This endpoint returns a LIGHTWEIGHT consignment: no status, no toEmail, no
    // items. Reading status from it reports "(none)" for everything and makes every
    // cancelled consignment look live. References are all it is good for.
    const fromDateUtc = new Date(Date.now() - DAYS * 864e5).toISOString().split('.')[0];
    const toDateUtc = new Date().toISOString().split('.')[0];
    const r = await get(
        `/apiv2/consignments/getRecentlyCreatedOrUpdatedConsignments` +
            `?fromDateUtc=${encodeURIComponent(fromDateUtc)}` +
            `&toDateUtc=${encodeURIComponent(toDateUtc)}` +
            `&retrieveSize=500&includeChildCompanies=true`,
    );
    const summary: Cons[] = Array.isArray(r.env?.object) ? (r.env!.object as Cons[]) : [];
    console.log(`Stage 1: ${summary.length} consignments over ${DAYS} days (http ${r.http}).`);
    if (!summary.length) { console.log('Nothing returned. Check MACHSHIP_TOKEN.'); return; }

    const refs = [...new Set(summary.map((c) => String(c.customerReference ?? '')).filter(Boolean))];
    console.log(`Stage 1: ${refs.length} distinct order references.\n`);

    // ── Stage 2: re-query through the PRODUCTION lookup for the real shape ────
    // Sample an EVEN SPREAD across the window, not the first N. The summary endpoint
    // returns newest first, so slicing the head samples only consignments raised in
    // the last few hours — they are all "Unmanifested" and tell you nothing about the
    // status vocabulary or about orders sitting in a late-lifecycle state.
    const SAMPLE = Math.min(refs.length, 120);
    const stride = Math.max(1, Math.floor(refs.length / SAMPLE));
    const picked = refs.filter((_, i) => i % stride === 0).slice(0, SAMPLE);
    console.log(`Stage 2: re-querying ${picked.length} references spread across the window (every ${stride}${stride === 1 ? 'st' : 'th'}) through returnConsignmentsByReference2...`);
    const full = new Map<string, Cons[]>();
    for (const ref of picked) {
        const cons = await post('/apiv2/consignments/returnConsignmentsByReference2', [`SO${ref}`]);
        if (cons.length) full.set(ref, cons);
    }
    const allCons = [...full.values()].flat();
    console.log(`Stage 2: ${allCons.length} consignments with full detail across ${full.size} orders.\n`);

    // ── 1. status vocabulary drift ───────────────────────────────────────────
    const seen = new Map<string, number>();
    for (const c of allCons) {
        const n = String(c.status?.name ?? '(none)');
        seen.set(n, (seen.get(n) ?? 0) + 1);
    }
    console.log('── Status names seen, and how we handle each ──');
    const unmapped: string[] = [];
    for (const [name, count] of [...seen.entries()].sort((a, b) => b[1] - a[1])) {
        const key = name.trim().toLowerCase();
        const explicit = Object.prototype.hasOwnProperty.call(CONSIGNMENT_STATUS_MAP, key);
        const bucket = classifyConsignmentStatus(name);
        const how = explicit ? 'mapped' : (bucket === 'unknown' ? 'UNMAPPED → unknown' : `fallback → ${bucket}`);
        // Cancelled/deleted are FILTERED OUT upstream in OrderTrackingService and never
        // reach classifyConsignmentStatus, so "unmapped" is correct and not a defect.
        const dead = DEAD.test(name);
        const note = dead ? 'filtered upstream (never rendered)' : how;
        if (!explicit && !dead && name !== '(none)') unmapped.push(`${name} (${how})`);
        console.log(`  ${String(count).padStart(4)}  ${name.padEnd(28)} ${(dead ? '—' : bucket).padEnd(20)} ${note}`);
    }
    console.log(unmapped.length
        ? `\n  ⚠ NOT explicitly mapped: ${unmapped.join(', ')}\n      A fallback match is a guess. Add these to CONSIGNMENT_STATUS_MAP.`
        : '\n  ✅ Every live status name is explicitly mapped.');

    // ── 2. orders in a hard-to-observe state ─────────────────────────────────
    console.log('\n── Orders currently in a hard-to-observe state (use these to test) ──');
    let found = 0;
    for (const [ref, cons] of full) {
        for (const c of cons) {
            if (!INTERESTING.test(String(c.status?.name ?? ''))) continue;
            found++;
            console.log(`  ${String(c.status?.name).padEnd(22)} order=${ref}  email=${mask(c.toEmail)}  cartons=${(c.consignmentItems ?? []).length}`);
        }
    }
    if (!found) console.log('  none right now');

    // ── 3. GENUINE duplicates: 2+ consignments after removing cancelled ──────
    console.log('\n── Orders with more than one LIVE consignment (the agent escalates these) ──');
    let dupes = 0;
    for (const [ref, cons] of full) {
        const live = cons.filter((c) => !DEAD.test(String(c.status?.name ?? '')));
        if (live.length < 2) continue;
        dupes++;
        console.log(`  order=${ref}  live=${live.length}  dead=${cons.length - live.length}  email=${mask(live[0].toEmail)}`);
        cons.forEach((c) => console.log(`      ${c.consignmentNumber} ${c.status?.name}${DEAD.test(String(c.status?.name ?? '')) ? '  (ignored)' : ''}`));
    }
    if (!dupes) console.log('  none right now');

    console.log('\nRead-only. Nothing written.');
})();
