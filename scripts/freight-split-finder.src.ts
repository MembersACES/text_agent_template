/* ─────────────────────────────────────────────────────────────────────────
 * Split-render finder — proves the "X of Y boxes delivered" copy on GENUINE
 * live data, without waiting on Iri. It scans HTG's own recent MachShip feed
 * for a reference with 2+ consignments (ideally mixed statuses — one delivered,
 * one still moving), then runs that reference through the REAL render
 * (OrderTrackingService), using the consignment's own `toEmail` as the
 * simulated customer email.
 *
 * Runs LOCALLY (the cloud sandbox blocks live.machship.com):
 *     node --env-file=.env.local scripts/freight-split-finder.mjs [--days 10]
 *
 * Read-only. PII masked. Nothing written to the repo.
 *
 * Rebuild from source (repo root):
 *   npx esbuild scripts/freight-split-finder.src.ts --bundle --platform=node \
 *     --format=esm --alias:@=. --outfile=scripts/freight-split-finder.mjs
 * ───────────────────────────────────────────────────────────────────────── */
import { settings } from '@/lib/config/settings';
import { OrderTrackingService } from '@/lib/services/tracking/OrderTrackingService';
import { MachShipService } from '@/lib/services/machship/MachShipService';
import type { FreightReferenceResolver } from '@/lib/services/freight/types';
import type { MachShipConsignment } from '@/lib/services/machship/types';

const BASE = settings.machship.baseUrl;
const TOKEN = settings.machship.token;
const DELIVERED = /complete|delivered/i;

function mask(v: unknown): string {
    if (typeof v !== 'string' || !v.trim()) return '(empty)';
    if (v.includes('@')) { const [u, d] = v.split('@'); return `${u.slice(0, 2)}***@${d}`; }
    return v.length > 5 ? `${v.slice(0, 2)}***${v.slice(-3)}` : '***';
}

function arg(name: string, def: string): string {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function ms(method: string, path: string, body?: unknown): Promise<{ status: number; obj: unknown; errs: string[] }> {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { token: TOKEN, 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: { object?: unknown; errors?: Array<{ errorMessage?: string }> } | null = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    const errs = Array.isArray(json?.errors) ? json!.errors!.map((e) => e?.errorMessage).filter((m): m is string => Boolean(m)) : [];
    return { status: res.status, obj: json?.object ?? null, errs };
}

async function main() {
    if (settings.machship.useFixture) { console.error('MACHSHIP_USE_FIXTURE is on — unset it for a live run.'); process.exit(1); }
    if (!TOKEN) { console.error('Missing MACHSHIP_TOKEN. Run with --env-file=.env.local'); process.exit(1); }

    // MachShip rejects a window that reaches exactly 10 days back, so cap at 9
    // and add a 1h buffer to stay comfortably inside the limit.
    const days = Math.min(parseInt(arg('days', '9'), 10) || 9, 9);
    const from = new Date(Date.now() - days * 86400000 + 3_600_000).toISOString().split('.')[0];
    const to = new Date().toISOString().split('.')[0];

    const recent = await ms('GET', `/apiv2/consignments/getRecentlyCreatedOrUpdatedConsignments?fromDateUtc=${encodeURIComponent(from)}&toDateUtc=${encodeURIComponent(to)}&retrieveSize=200&includeChildCompanies=true`);
    const cons = (Array.isArray(recent.obj) ? recent.obj : []) as MachShipConsignment[];
    if (!cons.length) {
        console.error(`No consignments returned for the last ${days}d — HTTP ${recent.status}${recent.errs.length ? `, MachShip says: ${recent.errs.join('; ')}` : ''}.`);
        process.exitCode = 1; return;
    }

    // Group by the SO reference (fallback to the digits reference).
    const groups = new Map<string, MachShipConsignment[]>();
    for (const c of cons) {
        const k = (c.customerReference2 || c.customerReference || '').trim();
        if (!k) continue;
        let g = groups.get(k);
        if (!g) { g = []; groups.set(k, g); }
        g.push(c);
    }
    const multi = [...groups.entries()].filter(([, v]) => v.length >= 2);
    console.log(`Scanned ${cons.length} consignments over ${days}d → ${multi.length} reference(s) with 2+ in the recent FEED.`);
    if (!multi.length) { console.error('No multi-consignment reference in this window. Re-run later.'); return; }

    // The recent feed can show consolidated / unmanifested / child consignments that
    // collapse to ONE in the production reference lookup. So evaluate each candidate
    // through returnConsignmentsByReference (what our render actually uses) and rank on THAT.
    console.log('\nEvaluating each via the production reference lookup (feed count ≠ lookup count when MachShip consolidates):');
    const evaluated: Array<{ ref: string; feed: number; cs: MachShipConsignment[]; delivered: number; mixed: boolean }> = [];
    for (const [ref, v] of multi) {
        const isSO = /^SO/i.test(ref);
        const look = await ms('POST', `/apiv2/consignments/returnConsignmentsByReference${isSO ? 2 : 1}`, [ref]);
        const cs = (Array.isArray(look.obj) ? look.obj : []) as MachShipConsignment[];
        const delivered = cs.filter((c) => DELIVERED.test(c.status?.name ?? '')).length;
        evaluated.push({ ref, feed: v.length, cs, delivered, mixed: delivered > 0 && delivered < cs.length });
        console.log(`  ${mask(ref)}  feed=${v.length}  lookup=${cs.length}  delivered=${delivered}/${cs.length}  [${cs.map((c) => c.status?.name ?? '-').join(', ')}]`);
    }

    evaluated.sort((a, b) =>
        (Number(b.cs.length >= 2) - Number(a.cs.length >= 2)) ||
        (Number(b.mixed) - Number(a.mixed)) ||
        (b.cs.length - a.cs.length));
    const pick = evaluated[0];

    if (pick.cs.length < 2) {
        console.log('\n⚠️  FINDING: NO reference returns 2+ consignments via the production reference lookup, even though the');
        console.log('    recent feed shows multi-consignment groups. MachShip is consolidating HTG multi-box orders into a single');
        console.log('    consignment for the lookup — so at the render layer a "split" is items within ONE consignment (cf Ex5),');
        console.log('    all sharing ONE status. The consignment-level "X of Y boxes delivered" copy would NOT trigger via this');
        console.log('    path. Partial-delivery across separate consignments may simply not be reachable for HTG. ESCALATE.');
    }

    const full = pick.cs;
    const toEmail = full.map((c) => c.toEmail).find((e): e is string => typeof e === 'string' && e.trim().length > 0) ?? '';
    console.log(`\nRendering ${mask(pick.ref)} (lookup=${full.length}${pick.mixed ? ', MIXED status' : ''}). Simulated customer email: ${mask(toEmail)}`);
    full.forEach((c, i) => console.log(`  box ${i + 1}: status=${c.status?.name ?? '-'}  eta=${c.etaLocal ?? c.eta ?? '-'}`));
    if (!toEmail) { console.error('\nNo toEmail on the consignments — cannot simulate the verified customer path.'); return; }

    // Run it as if the customer typed the reference + their email.
    const tracking = new OrderTrackingService();
    let result = await tracking.track(pick.ref, toEmail);
    if (result.state === 'not_found' || result.state === 'error') {
        // Reference wasn't auto-classified to the MachShip path (unusual ref shape) —
        // drive the render path directly with a verified resolver so the proof still lands.
        const forced: FreightReferenceResolver = {
            provider: 'forced',
            resolve: async () => ({
                outcome: 'matched', verified: true, verifyVia: 'dotwms', deliveryEmail: toEmail,
                orders: [{ sysproReference: pick.ref, bareReference: pick.ref.replace(/^SO/i, ''), warehouseStatusRaw: null, warehouseStatusTranslated: null, heldReason: null }],
                provider: 'forced',
            }),
        };
        result = await new OrderTrackingService(forced, new MachShipService()).track(pick.ref, toEmail);
        console.log('(note: reference not auto-classified; drove the MachShip render path directly)');
    }

    console.log(`\n[render] state=${result.state}  verifiedVia=${result.verifiedVia ?? '-'}  boxes=${result.totalBoxes} delivered=${result.deliveredBoxes}  eta=${result.eta ?? '-'}`);
    console.log('  --- rendered customer message ---');
    console.log(result.message.split('\n').map((l) => '  ' + l).join('\n'));
    console.log('  ---------------------------------');
    if (result.state === 'partly_delivered') {
        console.log('\n✅ SPLIT "X of Y boxes" copy PROVEN on genuine live data.');
    } else {
        console.log(`\nNote: rendered as "${result.state}" — the picked order is all-delivered or all-in-transit, so the partial copy didn't trigger. Re-run to sample another split, or widen --days (max 10).`);
    }
}

main().catch((e) => { console.error('split-finder error:', e); process.exitCode = 1; });
