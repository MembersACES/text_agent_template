/* ─────────────────────────────────────────────────────────────────────────
 * dotWMS SO-key email-ENFORCEMENT probe.
 *
 * Gates the "route 8-digit through dotWMS" refinement. Same rigour as the 6-digit
 * test: for a valid order queried by its 8-digit SO key,
 *   - correct email        → must be FOUND        (positive control)
 *   - well-formed WRONG email → must be NOTHING    (the enforcement test)
 *   - malformed email       → NOTHING             (control: rules out "it just
 *                                                   rejects bad input")
 * Only if dotWMS enforces the email on the SO key is it safe to route 8-digit
 * verification through dotWMS; otherwise keep the MachShip-toEmail path.
 *
 * Runs LOCALLY (sandbox blocks f.dotwms.com):
 *     node --env-file=.env.local scripts/dotwms-so-email-enforcement.mjs
 * Reads 8-digit examples from the gitignored scripts/freight-examples.local.json.
 * Read-only. Wrong emails are SYNTHETIC (no real customer data). PII masked.
 *
 * Rebuild: npx esbuild scripts/dotwms-so-email-enforcement.src.ts --bundle \
 *   --platform=node --format=esm --alias:@=. --outfile=scripts/dotwms-so-email-enforcement.mjs
 * ───────────────────────────────────────────────────────────────────────── */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { settings } from '@/lib/config/settings';

interface Example { label: string; order: string; email: string }

const D = settings.dotwms;
const WRONG_EMAIL = 'wrong-owner-test@gmail.com';   // well-formed, real domain, NOT the order's
const MALFORMED_EMAIL = 'not-a-valid-email';         // control: malformed

function mask(v: unknown): string {
    if (typeof v !== 'string' || !v.trim()) return '(empty)';
    if (v.includes('@')) { const [u, d] = v.split('@'); return `${u.slice(0, 2)}***@${d}`; }
    return v.length > 5 ? `${v.slice(0, 2)}***${v.slice(-3)}` : '***';
}

function fileArg(): string {
    const i = process.argv.indexOf('--file');
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : 'scripts/freight-examples.local.json';
}

function urlFor(email: string, key: string): string {
    const params = new URLSearchParams({
        InstanceCode: D.instanceCode,
        ExportFileType: D.exportFileType,
        APIKey: D.apiKey,
        DocumentFormat: 'JSON',
        DocumentKey: `${email}|${key}`,
    });
    return `${D.baseUrl}?${params.toString()}`;
}

async function query(email: string, key: string): Promise<{ status: number; found: boolean; detail: string }> {
    let res: Response;
    try { res = await fetch(urlFor(email, key)); } catch (e) { return { status: 0, found: false, detail: `transport error: ${e instanceof Error ? e.message : String(e)}` }; }
    const text = await res.text();
    let rows: Array<Record<string, unknown>> = [];
    try { const j = JSON.parse(text); rows = Array.isArray(j) ? j : [j]; } catch { /* XML */ }
    const usable = rows.filter((r) => r && r.PackSlipNumber);
    const detail = usable.length ? `${usable.length} row(s), PackSlip=${usable[0].PackSlipNumber}` : text.slice(0, 70).replace(/\s+/g, ' ');
    return { status: res.status, found: usable.length > 0, detail };
}

async function main() {
    if (!D.apiKey) { console.error('Missing DOTWMS_API_KEY. Run with --env-file=.env.local'); process.exit(1); }

    const path = fileArg();
    let examples: Example[];
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
        examples = Array.isArray(parsed?.examples) ? parsed.examples : [];
    } catch (e) {
        console.error(`Cannot read ${resolve(path)}: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
    }
    const eights = examples.filter((e) => /^(?:SO)?\d{8}$/i.test(String(e.order).trim()));
    if (!eights.length) { console.error('No 8-digit examples in the input file.'); process.exit(1); }

    console.log('dotWMS email-enforcement on the SO key (correct vs well-formed-wrong vs malformed):\n');
    let allEnforced = true;
    for (const e of eights) {
        const soKey = `SO${String(e.order).trim().replace(/^SO/i, '')}`;
        console.log(`Order ${soKey}:`);
        const correct = await query(e.email.trim(), soKey);
        const wrong = await query(WRONG_EMAIL, soKey);
        const malformed = await query(MALFORMED_EMAIL, soKey);
        console.log(`  correct  ${mask(e.email)} → HTTP ${correct.status}  ${correct.found ? 'FOUND' : 'nothing'}  (${correct.detail})`);
        console.log(`  wrong    ${WRONG_EMAIL} → HTTP ${wrong.status}  ${wrong.found ? 'FOUND ⚠️' : 'nothing'}  (${wrong.detail})`);
        console.log(`  control  ${MALFORMED_EMAIL} → HTTP ${malformed.status}  ${malformed.found ? 'FOUND ⚠️' : 'nothing'}  (${malformed.detail})`);
        const enforced = correct.found && !wrong.found;
        console.log(`  → ${enforced ? 'ENFORCED (correct found, wrong rejected)' : 'NOT ENFORCED for this order'}\n`);
        allEnforced = allEnforced && enforced;
    }

    console.log('VERDICT:');
    if (allEnforced) {
        console.log('  dotWMS ENFORCES the email on the SO key → SAFE to route 8-digit verification through dotWMS.');
        console.log('  Build the refinement: 8-digit → dotWMS with SO prefix (email-verified + job status), MachShip for tracking.');
    } else {
        console.log('  dotWMS does NOT enforce the email on the SO key (a wrong email returned the order, or the correct one');
        console.log('  did not) → DO NOT route verification through dotWMS. Keep the MachShip-toEmail path for 8-digit.');
    }
}

main().catch((e) => { console.error('probe error:', e); process.exitCode = 1; });
