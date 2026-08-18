/* ─────────────────────────────────────────────────────────────────────────
 * Local end-to-end freight chain harness — runs REAL example orders through the
 * REAL production chain (dotWMS resolver → MachShip → OrderTrackingService).
 *
 * Runs LOCALLY (the cloud sandbox egress blocks live.machship.com & dotWMS):
 *     node --env-file=.env.local scripts/freight-chain-harness.mjs
 *
 * Input (gitignored — REAL order#s + emails, never committed):
 *     scripts/freight-examples.local.json
 *   Copy scripts/freight-examples.example.json → scripts/freight-examples.local.json
 *   and fill in the 5 orders from the spreadsheet. Override path with --file <p>.
 *
 * Output masks customer PII (emails, tracking tokens). Nothing is written to the
 * repo; this is a read-only diagnostic.
 *
 * Rebuild this bundle from source (from repo root):
 *   npx esbuild scripts/freight-chain-harness.src.ts --bundle --platform=node \
 *     --format=esm --alias:@=. --outfile=scripts/freight-chain-harness.mjs
 * ───────────────────────────────────────────────────────────────────────── */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { settings } from '@/lib/config/settings';
import { DotWmsReferenceResolver } from '@/lib/services/freight/DotWmsReferenceResolver';
import { MachShipService } from '@/lib/services/machship/MachShipService';
import { OrderTrackingService } from '@/lib/services/tracking/OrderTrackingService';

interface Example { label: string; order: string; email: string }

function mask(v: unknown): string {
    if (typeof v !== 'string' || !v.trim()) return '(empty)';
    if (v.includes('@')) {
        const [u, d] = v.split('@');
        return `${u.slice(0, 2)}***@${d}`;
    }
    return v.length > 6 ? `${v.slice(0, 3)}***${v.slice(-2)}` : '***';
}

function fileArg(): string {
    const i = process.argv.indexOf('--file');
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : 'scripts/freight-examples.local.json';
}

async function main() {
    if (settings.machship.useFixture) {
        console.error('MACHSHIP_USE_FIXTURE is on — unset it for a live run.');
        process.exit(1);
    }
    if (!settings.dotwms.apiKey || !settings.machship.token) {
        console.error('Missing DOTWMS_API_KEY / MACHSHIP_TOKEN. Run with --env-file=.env.local');
        process.exit(1);
    }

    const path = fileArg();
    let examples: Example[];
    try {
        // Strip a leading UTF-8 BOM (Windows editors add one) before parsing.
        const parsed = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
        examples = Array.isArray(parsed?.examples) ? parsed.examples : [];
    } catch (e) {
        console.error(`Cannot read examples from ${path}: ${e instanceof Error ? e.message : String(e)}`);
        console.error('Copy scripts/freight-examples.example.json → scripts/freight-examples.local.json and fill it in.');
        process.exit(1);
    }
    if (!examples.length) {
        console.error(`No examples found in ${path}.`);
        process.exit(1);
    }

    // Fail loudly if the template placeholders were never filled in — otherwise
    // every lookup is a genuine "not found" and looks like a bug.
    const isPlaceholder = (v: string) => !v || /[<>]/.test(v) || /PASTE_/i.test(v);
    const unfilled = examples.filter((e) => isPlaceholder(String(e.order)) || isPlaceholder(String(e.email)));
    if (unfilled.length) {
        console.error(`\n✗ ${unfilled.length}/${examples.length} example(s) STILL CONTAIN TEMPLATE PLACEHOLDERS.`);
        console.error(`  File actually read: ${resolve(path)}`);
        console.error('  Edit THAT file — replace every <...> / PASTE_ value with the real order number + email — and re-run.');
        console.error('  Windows note: make sure it saved as ...local.json, NOT ...local.json.txt (Notepad hides the .txt).');
        process.exit(1);
    }
    console.log(`Reading examples from: ${resolve(path)}\n`);

    const resolver = new DotWmsReferenceResolver();
    const machship = new MachShipService();
    const tracking = new OrderTrackingService();

    for (const ex of examples) {
        console.log('\n' + '='.repeat(74));
        console.log(ex.label);
        console.log(`order ${ex.order}    email ${mask(ex.email)}`);
        console.log('='.repeat(74));

        // 1) dotWMS resolve — verification path + warehouse job status.
        const r = await resolver.resolve({ orderNumber: ex.order, email: ex.email });
        console.log(`[1] resolver: path=${r.verifyVia}  outcome=${r.outcome}  verified=${r.verified}`);
        for (const o of r.orders) {
            console.log(`    packslip ${o.sysproReference}  jobStatus=${o.warehouseStatusRaw ?? '-'} / ${o.warehouseStatusTranslated ?? '-'}  held=${o.heldReason ?? 'none'}`);
        }
        if (r.diagnostic) console.log(`    diag: ${r.diagnostic}`);

        // 2) MachShip raw lookup — split structure, date field, toEmail.
        if (r.orders.length) {
            const ms = await machship.lookupByReferences({
                sysproReferences: r.orders.map((o) => o.sysproReference),
                bareReferences: r.orders.map((o) => o.bareReference),
            });
            console.log(`[2] machship: via=${ms.via ?? '-'}  consignments=${ms.consignments.length}${ms.errors.length ? `  errors=${ms.errors.join('; ')}` : ''}`);
            let totalItems = 0;
            ms.consignments.forEach((c, i) => {
                const items = Array.isArray(c.consignmentItems) ? c.consignmentItems.length : 0;
                totalItems += items;
                const tok = c.trackingPageAccessToken ? '…' + String(c.trackingPageAccessToken).slice(-4) : '-';
                console.log(`    box ${i + 1}: cons=${c.carrierConsignmentId ?? '-'} status=${c.status?.name ?? '-'} eta=${c.etaLocal ?? c.eta ?? '-'} items=${items} toEmail=${mask(c.toEmail)} track=${tok}`);
                if (i === 0) {
                    const dateKeys = Object.keys(c).filter((k) => /date|eta|utc|created|manifest|dispatch/i.test(k));
                    console.log(`      date-ish fields: ${dateKeys.map((k) => `${k}=${String(c[k])}`).join('   ') || '(none)'}`);
                }
            });
            const n = ms.consignments.length;
            const structure = n > 1 ? 'SPLIT across SEPARATE consignments' : totalItems > 1 ? 'multiple items within ONE consignment' : n === 1 ? 'single consignment' : 'not in MachShip';
            console.log(`    STRUCTURE: consignments=${n}, totalItems=${totalItems} → ${structure}`);
        }

        // 3) The real rendered result (what the customer would see).
        const t = await tracking.track(ex.order, ex.email);
        console.log(`[3] tracking: state=${t.state}  verifiedVia=${t.verifiedVia ?? '-'}  boxes=${t.totalBoxes} delivered=${t.deliveredBoxes} items=${t.totalItems}  eta=${t.eta ?? '-'}`);
        if (t.diagnostic) console.log(`    diag: ${t.diagnostic}`);
        console.log('    --- rendered customer message ---');
        console.log(t.message.split('\n').map((l) => '    ' + l).join('\n'));
        console.log('    ---------------------------------');
    }

    console.log('\nDone. PII masked; this run is local and writes nothing to the repo.');
}

main().catch((e) => {
    console.error('harness error:', e);
    process.exit(1);
});
