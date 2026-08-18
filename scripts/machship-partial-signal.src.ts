/* ─────────────────────────────────────────────────────────────────────────
 * MachShip partial-delivery SIGNAL investigation (READ-ONLY, report only).
 *
 * The dominant multi-box shape for HTG is items-within-ONE-consignment (Ex5),
 * which share one status — so "some arrived, some coming" currently only fires
 * for genuine separate-consignment splits (a minority). This probe checks
 * whether MachShip exposes a per-consignment partial signal (statusIsPartial,
 * per-item status, statusHistory) that could let the render cover the
 * single-consignment partial case too.
 *
 * It does NOT change any copy logic — it dumps the relevant fields so we can
 * judge. Runs LOCALLY (sandbox blocks live hosts):
 *     node --env-file=.env.local scripts/machship-partial-signal.mjs
 * Reads the example orders from the gitignored local input. PII masked.
 *
 * Rebuild: npx esbuild scripts/machship-partial-signal.src.ts --bundle \
 *   --platform=node --format=esm --alias:@=. --outfile=scripts/machship-partial-signal.mjs
 * ───────────────────────────────────────────────────────────────────────── */
import { readFileSync } from 'node:fs';
import { settings } from '@/lib/config/settings';
import { DotWmsReferenceResolver } from '@/lib/services/freight/DotWmsReferenceResolver';

interface Example { label: string; order: string; email: string }

const BASE = settings.machship.baseUrl;
const TOKEN = settings.machship.token;

function mask(v: unknown): string {
    if (typeof v !== 'string' || !v.trim()) return String(v);
    if (v.includes('@')) { const [u, d] = v.split('@'); return `${u.slice(0, 2)}***@${d}`; }
    return v.length > 6 ? `${v.slice(0, 3)}***${v.slice(-2)}` : '***';
}

function fileArg(): string {
    const i = process.argv.indexOf('--file');
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : 'scripts/freight-examples.local.json';
}

async function ms(method: string, path: string, body?: unknown): Promise<{ status: number; obj: unknown }> {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { token: TOKEN, 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: { object?: unknown } | null = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: res.status, obj: json?.object ?? null };
}

/** Recursively find populated scalar keys matching a pattern → [{path, value}]. */
function findKeys(obj: unknown, pattern: RegExp, path = '', out: Array<{ path: string; value: unknown }> = [], depth = 0): Array<{ path: string; value: unknown }> {
    if (!obj || typeof obj !== 'object' || depth > 4) return out;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        const p = path ? `${path}.${k}` : k;
        if (pattern.test(k) && (v === null || typeof v !== 'object')) out.push({ path: p, value: v });
        else if (v && typeof v === 'object') {
            const next = Array.isArray(v) ? (v[0] ?? {}) : v;
            findKeys(next, pattern, Array.isArray(v) ? `${p}[0]` : p, out, depth + 1);
        }
    }
    return out;
}

const PARTIAL_RE = /partial|remaining|outstanding|fulfil|deliver|receiv|quantity|qty|scanned|pieces?/i;

async function main() {
    if (settings.machship.useFixture) { console.error('MACHSHIP_USE_FIXTURE is on — unset it for a live run.'); process.exit(1); }
    if (!TOKEN) { console.error('Missing MACHSHIP_TOKEN. Run with --env-file=.env.local'); process.exit(1); }

    const path = fileArg();
    let examples: Example[];
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
        examples = Array.isArray(parsed?.examples) ? parsed.examples : [];
    } catch (e) {
        console.error(`Cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
    }
    if (!examples.length) { console.error('No examples in input file.'); process.exit(1); }

    const resolver = new DotWmsReferenceResolver();
    let sawPartialFlag = false;

    for (const e of examples) {
        console.log('\n' + '='.repeat(72));
        console.log(`${e.label}  (order ${e.order})`);
        console.log('='.repeat(72));

        const r = await resolver.resolve({ orderNumber: e.order, email: e.email });
        if (!r.orders.length) { console.log(`  resolver: ${r.outcome} (${r.diagnostic ?? '-'}) — skipping`); continue; }
        const ref = r.orders[0].sysproReference;
        const isSO = /^SO/i.test(ref);
        const look = await ms('POST', `/apiv2/consignments/returnConsignmentsByReference${isSO ? 2 : 1}`, [ref]);
        const list = (Array.isArray(look.obj) ? look.obj : []) as Array<Record<string, unknown>>;
        if (!list.length) { console.log(`  MachShip: no consignment for ${mask(ref)} — skipping`); continue; }

        for (const summary of list) {
            const id = summary.id;
            // Full detail (richer than the reference-lookup summary).
            const det = id !== undefined ? (await ms('GET', `/apiv2/consignments/getConsignment?id=${encodeURIComponent(String(id))}`)).obj : null;
            const detail = (det && typeof det === 'object' ? det : summary) as Record<string, unknown>;

            const status = (detail.status as Record<string, unknown> | undefined)?.name ?? '-';
            const items = Array.isArray(detail.consignmentItems) ? (detail.consignmentItems as unknown[]) : [];
            const history = Array.isArray(detail.statusHistory) ? (detail.statusHistory as Array<Record<string, unknown>>) : [];

            console.log(`  consignment id=${id ?? '-'}  status=${status}  items=${items.length}  historyEvents=${history.length}`);

            // Direct partial flags at the top level.
            const partialFlags = Object.entries(detail).filter(([k, v]) => /partial/i.test(k) && (v === null || typeof v !== 'object'));
            if (partialFlags.length) {
                for (const [k, v] of partialFlags) { console.log(`    PARTIAL FLAG: ${k} = ${JSON.stringify(v)}`); if (v === true) sawPartialFlag = true; }
            } else {
                console.log('    no top-level *partial* field');
            }

            // Any delivery/quantity-ish scalar fields anywhere in the detail.
            const hits = findKeys(detail, PARTIAL_RE).filter((h) => !/email|contact|name|address|phone/i.test(h.path));
            const uniq = [...new Map(hits.map((h) => [h.path, h.value])).entries()].slice(0, 20);
            console.log(`    delivery/quantity-ish fields: ${uniq.length ? uniq.map(([p, v]) => `${p}=${JSON.stringify(v)}`).join('  ') : '(none)'}`);

            // First item's fields (hunting for per-item status / delivered flags).
            if (items.length) {
                const it0 = items[0] as Record<string, unknown>;
                const itemStatusKeys = Object.entries(it0).filter(([k]) => /status|deliver|receiv|quantity|qty|scanned/i.test(k));
                console.log(`    item[0] keys: ${Object.keys(it0).slice(0, 16).join(', ')}`);
                console.log(`    item[0] status/qty fields: ${itemStatusKeys.length ? itemStatusKeys.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('  ') : '(none)'}`);
            }

            // Status history event names (the delivery lifecycle).
            const historyNames = history.map((h) => String((h.consignmentTrackingStatus as Record<string, unknown> | undefined)?.name ?? (h.status as Record<string, unknown> | undefined)?.name ?? '?'));
            if (history.length) console.log(`    statusHistory: ${historyNames.join(' → ')}`);

            // PARTIAL SIGNAL: statusIsPartial=true on ANY history event, a "Partial
            // Delivery" event name, or the current status being partial.
            const anyPartialFlag = history.some((h) => h.statusIsPartial === true);
            const anyPartialName = historyNames.some((n) => /partial/i.test(n)) || /partial/i.test(String(status));
            if (anyPartialFlag || anyPartialName) {
                sawPartialFlag = true;
                console.log(`    ⟹ PARTIAL SIGNAL PRESENT: statusIsPartial=true on an event? ${anyPartialFlag}; "Partial Delivery" in status/history? ${anyPartialName}`);
            }
        }
    }

    console.log('\n' + '='.repeat(72));
    console.log('VERDICT — single-consignment partial signal:');
    if (sawPartialFlag) {
        console.log('  ✅ PRESENT. MachShip exposes partial delivery on a single consignment via a "Partial Delivery"');
        console.log('     status name and a per-event statusIsPartial boolean. The render COULD cover the');
        console.log('     items-in-one-consignment partial case by detecting the current status "Partial Delivery"');
        console.log('     (or the latest statusHistory event with statusIsPartial=true).');
        console.log('     NOTE: "Partial Delivery" does NOT match the current delivered-regex, so today it would render as');
        console.log('     plain "on its way" — understating it. Copy change recommended — CONFIRM before building.');
    } else {
        console.log('  ✗ Not seen in this sample. Re-run when an order is mid-partial, or treat as not representable.');
    }
    console.log('='.repeat(72));
}

main().catch((e) => { console.error('partial-signal probe error:', e); process.exitCode = 1; });
