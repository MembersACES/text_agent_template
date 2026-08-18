/* ─────────────────────────────────────────────────────────────────────────
 * dotWMS 8-digit probe — does dotWMS return anything for an 8-digit Syspro key,
 * or only for the 6-digit BigCommerce order number? If it resolves 8-digit keys,
 * an 8-digit order that is NOT yet in MachShip (still packing) could still get an
 * "in queue" answer via dotWMS instead of dead-ending. This settles whether the
 * 8-digit pre-ship gap can be closed.
 *
 * Runs LOCALLY (the cloud sandbox blocks f.dotwms.com):
 *     node --env-file=.env.local scripts/dotwms-8digit-probe.mjs
 *
 * Reads the 8-digit examples from the gitignored scripts/freight-examples.local.json.
 * Read-only, PII masked, nothing committed.
 *
 * Rebuild from source (repo root):
 *   npx esbuild scripts/dotwms-8digit-probe.src.ts --bundle --platform=node \
 *     --format=esm --alias:@=. --outfile=scripts/dotwms-8digit-probe.mjs
 * ───────────────────────────────────────────────────────────────────────── */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { settings } from '@/lib/config/settings';

interface Example { label: string; order: string; email: string }

const D = settings.dotwms;

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

async function probeKey(email: string, key: string): Promise<boolean> {
    let res: Response;
    try { res = await fetch(urlFor(email, key)); } catch (e) { console.log(`    key "${key}" → transport error: ${e instanceof Error ? e.message : String(e)}`); return false; }
    const text = await res.text();
    let rows: Array<Record<string, unknown>> = [];
    try { const j = JSON.parse(text); rows = Array.isArray(j) ? j : [j]; } catch { /* XML error body */ }
    const usable = rows.filter((r) => r && r.PackSlipNumber);
    if (usable.length) {
        console.log(`    key "${key}" → HTTP ${res.status}, ${usable.length} row(s) — FOUND`);
        for (const r of usable) console.log(`        PackSlip=${r.PackSlipNumber}  JobStatus=${r.JobStatus}/${r.JobStatusTranslated}`);
        return true;
    }
    console.log(`    key "${key}" → HTTP ${res.status}, no JSON rows (${text.slice(0, 60).replace(/\s+/g, ' ')}…) — not found`);
    return false;
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
    if (!eights.length) { console.error('No 8-digit examples found in the input file.'); process.exit(1); }

    console.log(`Probing dotWMS with ${eights.length} 8-digit order(s) — raw digits and SO-prefixed.\n`);
    let anyFound = false;
    for (const e of eights) {
        const digits = String(e.order).trim().replace(/^SO/i, '');
        console.log(`Order ${digits}  (email ${mask(e.email)}):`);
        const forms = [...new Set([digits, `SO${digits}`])];
        for (const key of forms) {
            const found = await probeKey(e.email.trim(), key);
            anyFound = anyFound || found;
        }
        console.log('');
    }

    console.log('VERDICT:');
    if (anyFound) {
        console.log('  dotWMS DOES resolve an 8-digit Syspro key → an 8-digit order not-yet-in-MachShip could be given');
        console.log('  a pre-ship ("in queue") answer by routing 8-digit lookups through dotWMS. The gap can be closed.');
    } else {
        console.log('  dotWMS does NOT resolve 8-digit keys (all not-found) → 8-digit stays post-ship-only. An 8-digit');
        console.log('  order absent from MachShip cannot be statused. Confirms the limitation; needs an Iri/Morgan call.');
    }
}

main().catch((e) => { console.error('probe error:', e); process.exit(1); });
