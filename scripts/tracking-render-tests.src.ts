/* ─────────────────────────────────────────────────────────────────────────
 * tracking-render-tests — deterministic render tests for OrderTrackingService.
 *
 * Why this exists: several branches (Awaiting Collection, Delivery Attempted,
 * Partial Delivery, the hold-reason allowlist, the Cancelled filter, the
 * duplicate-consignment escalation) can only be observed live when a real order
 * happens to be sitting in that exact state. That is not a testing strategy.
 *
 * OrderTrackingService takes its resolver and MachShip client by constructor
 * injection, so every branch can be driven with synthetic payloads shaped like
 * the LIVE ones we captured (see machship-raw-*.local.json). No network, no
 * credentials, repeatable.
 *
 * Run:  node scripts/tracking-render-tests.mjs
 * Rebuild: npx esbuild scripts/tracking-render-tests.src.ts --bundle \
 *   --platform=node --format=esm --alias:@=. --outfile=scripts/tracking-render-tests.mjs
 * ───────────────────────────────────────────────────────────────────────── */
import { OrderTrackingService } from '@/lib/services/tracking/OrderTrackingService';
import type { FreightReferenceResolver, FreightReferenceResult } from '@/lib/services/freight/types';
import type { MachShipConsignment, MachShipLookupResult } from '@/lib/services/machship/types';
import { MachShipService } from '@/lib/services/machship/MachShipService';

const EMAIL = 'customer@example.com';
const RECENT = new Date(Date.now() - 3 * 864e5).toISOString();

function resolver(heldReason: string | null = null, verified = true): FreightReferenceResolver {
    return {
        provider: 'test',
        async resolve(): Promise<FreightReferenceResult> {
            return {
                outcome: 'matched',
                verified,
                verifyVia: 'dotwms',
                deliveryEmail: EMAIL,
                orders: [{
                    sysproReference: 'SO10000001',
                    bareReference: '10000001',
                    warehouseStatusRaw: 'Closed / Fulfilled',
                    warehouseStatusTranslated: 'Fulfilled',
                    heldReason,
                }],
                provider: 'test',
            };
        },
    };
}

/** A consignment shaped like the live ones. `items` cartons, each with a label. */
function consignment(statusName: string, items: number, id = 'W9DZ00000001'): MachShipConsignment {
    return {
        customerReference: '10000001',
        customerReference2: 'SO10000001',
        carrierConsignmentId: id,
        consignmentNumber: `MS${id}`,
        carrierName: 'StarTrack',
        status: { name: statusName },
        etaLocal: '2026-09-04T23:59:59',
        eta: '2026-09-04T23:59:59',
        despatchDateUtc: RECENT,
        toEmail: EMAIL,
        trackingPageAccessToken: 'TESTTOKEN',
        consignmentItems: Array.from({ length: items }, (_, i) => ({
            name: 'Generic Item',
            references: [`${id}EXP0000${i + 1}`],
        })),
        statusHistory: [],
    };
}

function machship(cons: MachShipConsignment[]): MachShipService {
    const svc = new MachShipService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).lookupByReferences = async (): Promise<MachShipLookupResult> => ({
        outcome: cons.length ? 'found' : 'not_found',
        consignments: cons,
        via: 'reference2',
        errors: [],
    });
    return svc;
}

interface Case {
    name: string;
    cons: MachShipConsignment[];
    held?: string | null;
    expectState: string;
    expectMessage: (m: string) => boolean;
    because: string;
}

const CASES: Case[] = [
    {
        name: 'Cancelled consignment is ignored (mirrors live order 10257041)',
        cons: [consignment('Cancelled', 1, 'W9DZ00047591'), consignment('Complete', 4, 'W9DZ00047592')],
        expectState: 'delivered',
        expectMessage: (m) => m.includes('All 4 boxes') && !m.includes('5 boxes'),
        because: 'the cancelled one has 1 carton; counting it would say 5',
    },
    {
        name: 'Two LIVE consignments escalate (mirrors live order 10265223)',
        cons: [consignment('Booked', 1, 'W9DZ00048114'), consignment('Picked Up', 1, 'W9DZ00048117')],
        expectState: 'multiple_consignments',
        expectMessage: (m) => m.includes('more than one delivery record'),
        because: 'never guess which consignment is real',
    },
    {
        name: 'Cancelled + Cancelled + one live = tracks normally',
        cons: [consignment('Cancelled', 2, 'A'), consignment('Cancelled', 3, 'B'), consignment('Complete', 2, 'C')],
        expectState: 'delivered',
        expectMessage: (m) => m.includes('All 2 boxes'),
        because: 'multiple dead consignments must not trip the duplicate rule',
    },
    {
        name: 'Awaiting Collection renders the collection line',
        cons: [consignment('Awaiting Collection', 1)],
        expectState: 'awaiting_collection',
        expectMessage: (m) => m.includes('post office or collection point') && !m.includes('being prepared'),
        because: 'this rendered as "being prepared for dispatch" before 24 Aug',
    },
    {
        name: 'Delivery Attempted renders the same collection line',
        cons: [consignment('Delivery Attempted', 1)],
        expectState: 'attempted',
        expectMessage: (m) => m.includes('post office or collection point') && !m.includes('try again'),
        because: 'Iri: H2G do not have carriers re-attempt',
    },
    {
        name: 'Collection line does NOT offer escalation up front',
        cons: [consignment('Awaiting Collection', 1)],
        expectState: 'awaiting_collection',
        expectMessage: (m) => !/pass (this )?to our team/i.test(m),
        because: 'Iri: only offer a handoff if the customer says they cannot collect',
    },
    {
        name: 'Partial Delivery renders the split line with a carton count',
        cons: [consignment('Partial Delivery', 3)],
        expectState: 'partly_delivered',
        expectMessage: (m) => m.includes('coming in 3 boxes') && m.includes('Some have already been delivered'),
        because: 'never observed live; this is the only way to verify it',
    },
    {
        name: 'Hold "Suspended in SYSPRO" IS surfaced',
        cons: [consignment('Booked', 1)],
        held: 'Suspended in SYSPRO',
        expectState: 'held',
        expectMessage: (m) => m.toLowerCase().includes('on hold'),
        because: 'Iri: this is the only genuine customer-facing hold',
    },
    {
        name: 'Hold "Hold For Release >250kg" is NOT surfaced',
        cons: [consignment('Complete', 1)],
        held: 'Hold For Release >250kg',
        expectState: 'delivered',
        expectMessage: (m) => !m.toLowerCase().includes('on hold'),
        because: 'internal workflow marker, irrelevant to the customer',
    },
    {
        name: 'Hold "SPECIAL PACKING REQUIRED. SEE SUPERVISOR" is NOT surfaced',
        cons: [consignment('Complete', 1)],
        held: 'SPECIAL PACKING REQUIRED. SEE SUPERVISOR',
        expectState: 'delivered',
        expectMessage: (m) => !m.toLowerCase().includes('on hold'),
        because: 'internal workflow marker, irrelevant to the customer',
    },
    {
        name: 'Hold matching is case-insensitive',
        cons: [consignment('Booked', 1)],
        held: 'suspended in syspro',
        expectState: 'held',
        expectMessage: (m) => m.toLowerCase().includes('on hold'),
        because: 'the WMS screen shows SYSPRO, Iri wrote Syspro',
    },
    {
        name: 'Single-carton delivered says no box count',
        cons: [consignment('Complete', 1)],
        expectState: 'delivered',
        expectMessage: (m) => m === 'Your order has been delivered.' || m.startsWith('Your order has been delivered.'),
        because: 'a one-box order should not say "All 1 boxes"',
    },
    {
        name: 'Unrecognised status never claims delivered',
        cons: [consignment('Something We Have Never Seen', 2)],
        expectState: 'unknown',
        expectMessage: (m) => !/delivered/i.test(m),
        because: 'the safe default must never over-claim',
    },
];

(async () => {
    let pass = 0;
    let fail = 0;
    for (const c of CASES) {
        const svc = new OrderTrackingService(resolver(c.held ?? null), machship(c.cons));
        const r = await svc.track('10000001', EMAIL);
        const stateOk = r.state === c.expectState;
        const msgOk = c.expectMessage(r.message);
        const ok = stateOk && msgOk;
        ok ? pass++ : fail++;
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
        if (!ok) {
            console.log(`        expected state=${c.expectState}, got=${r.state}`);
            console.log(`        message: ${r.message}`);
            console.log(`        why it matters: ${c.because}`);
        }
    }
    console.log(`\n${pass} passed, ${fail} failed, ${CASES.length} total`);
    process.exit(fail ? 1 : 0);
})();
