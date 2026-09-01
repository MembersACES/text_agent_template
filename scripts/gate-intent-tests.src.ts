/* ─────────────────────────────────────────────────────────────────────────
 * gate-intent-tests — deterministic routing tests for OrderStatusGate.
 *
 * Companion to tracking-render-tests. That script proves the RENDER is right
 * once a lookup happens; this one proves the gate DECIDES to look up (or
 * deliberately stands down) for a given customer message, and that the alert
 * triggers fire exactly once on the right turn.
 *
 * Why it exists: the two gaps the 1 Sep live run left open.
 *   1. "Order 359633, email X" sent COLD (not as a reply to our own ask) got the
 *      legacy order-status-page deflection. It carried a valid order number and
 *      email and matched no tracking verb. It only passed on 18 Aug because it
 *      was sent as a reply, which made isOrderDetailsReply() true.
 *   2. wont_wait and collection_refused can only be observed live when a real
 *      order happens to be part-delivered or sitting at a post office. On 1 Sep
 *      the part-delivered order (10265537) completed mid-test, so wont_wait was
 *      never verified end to end at all.
 *
 * No network, no credentials, no email leaves the process: the tracking service
 * is constructor-injected with a fake resolver + fake MachShip, and the alert
 * service is constructed with a recording transport (so the REAL dedup and
 * hourly-cap logic still runs, only the send is captured).
 *
 * Run:  node --env-file=.env.local scripts/gate-intent-tests.mjs
 * Rebuild: npx esbuild scripts/gate-intent-tests.src.ts --bundle \
 *   --platform=node --format=esm --alias:@=. --outfile=scripts/gate-intent-tests.mjs
 * ───────────────────────────────────────────────────────────────────────── */
import { OrderStatusGate } from '@/lib/services/chat/OrderStatusGate';
import { OrderTrackingService } from '@/lib/services/tracking/OrderTrackingService';
import { InternalAlertService } from '@/lib/services/alerts/InternalAlertService';
import { MachShipService } from '@/lib/services/machship/MachShipService';
import { settings } from '@/lib/config/settings';
import type { ConversationMessage } from '@/lib/services/chat/ConversationHistoryService';
import type { FreightLookupInput, FreightReferenceResolver, FreightReferenceResult } from '@/lib/services/freight/types';
import type { MachShipConsignment, MachShipLookupResult } from '@/lib/services/machship/types';
import type { AlertMessage } from '@/lib/services/alerts/types';

const ORDER = '10000001';
const EMAIL = 'customer@example.com';
const RECENT = new Date(Date.now() - 3 * 864e5).toISOString();

// ── Fakes ────────────────────────────────────────────────────────────────────

function resolver(): FreightReferenceResolver {
    return {
        provider: 'test',
        async resolve(input: FreightLookupInput): Promise<FreightReferenceResult> {
            // Mirror the live rule: order + email must match or nothing comes back.
            const order = String(input.orderNumber ?? '');
            const email = String(input.email ?? '');
            if (order.replace(/\D/g, '') !== ORDER || email.trim().toLowerCase() !== EMAIL) {
                return { outcome: 'not_found', verified: false, verifyVia: 'none', deliveryEmail: null, orders: [], provider: 'test' };
            }
            return {
                outcome: 'matched',
                verified: true,
                verifyVia: 'dotwms',
                deliveryEmail: EMAIL,
                orders: [{
                    sysproReference: `SO${ORDER}`,
                    bareReference: ORDER,
                    warehouseStatusRaw: 'Closed / Fulfilled',
                    warehouseStatusTranslated: 'Fulfilled',
                    heldReason: null,
                }],
                provider: 'test',
            };
        },
    };
}

function consignment(statusName: string, items: number, id = 'W9DZ00000001'): MachShipConsignment {
    return {
        customerReference: ORDER,
        customerReference2: `SO${ORDER}`,
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

function trackingService(cons: MachShipConsignment[]): OrderTrackingService {
    const ms = new MachShipService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ms as any).lookupByReferences = async (): Promise<MachShipLookupResult> => ({
        outcome: cons.length ? 'found' : 'not_found',
        consignments: cons,
        via: 'reference2',
        errors: [],
    });
    return new OrderTrackingService(resolver(), ms);
}

/** Real alert service (real dedup + real hourly cap) with the send captured. */
function recordingAlerts(): { svc: InternalAlertService; sent: AlertMessage[] } {
    const sent: AlertMessage[] = [];
    const svc = new InternalAlertService({
        enabled: true,
        transport: {
            name: 'recording',
            async send(message: AlertMessage): Promise<void> {
                sent.push(message);
            },
        },
    });
    return { svc, sent };
}

// ── Harness ──────────────────────────────────────────────────────────────────

interface Turn {
    say: string;
    /** null = the gate must NOT handle this turn (falls through to KB/deflection). */
    expect: null | ((reply: string) => boolean);
    /** Alerts expected to have been sent CUMULATIVELY after this turn. */
    alertsAfter: number;
    /** If an alert fired on this turn, the trigger its reason line must carry. */
    reasonIncludes?: string;
    /** Reply to push into history when THIS gate stands down, standing in for the
     *  gate that would really have answered (e.g. ComplaintsResponseGate). */
    injectAssistant?: string;
}

interface Scenario {
    name: string;
    cons: MachShipConsignment[];
    turns: Turn[];
    because: string;
    conversationId?: string;
}

const DELIVERED = [consignment('Complete', 1)];
const PARTLY = [consignment('Partial Delivery', 4)];
const COLLECTION = [consignment('Awaiting Collection', 1)];
const NONE: MachShipConsignment[] = [];

const handled = (re: RegExp) => (m: string) => re.test(m);

const SCENARIOS: Scenario[] = [
    // ── The 1 Sep regression ────────────────────────────────────────────────
    {
        name: 'Bare details, cold, caps and stray spaces (live test F2, 1 Sep)',
        cons: DELIVERED,
        turns: [{ say: `Order ${ORDER}, email   CUSTOMER@EXAMPLE.COM`, expect: handled(/delivered/i), alertsAfter: 0 }],
        because: 'a customer who volunteers both details must not be sent to the order-status page',
    },
    {
        name: 'Bare details, no punctuation, no words at all',
        cons: DELIVERED,
        turns: [{ say: `${ORDER} ${EMAIL}`, expect: handled(/delivered/i), alertsAfter: 0 }],
        because: 'the shortest possible form of the same message',
    },
    {
        name: 'Bare details with greeting and thanks',
        cons: DELIVERED,
        turns: [{ say: `Hi, my order number is ${ORDER} and my email is ${EMAIL}. Thanks`, expect: handled(/delivered/i), alertsAfter: 0 }],
        because: 'politeness is still filler, not a second intent',
    },
    {
        name: 'Verb form still works (live test E3)',
        cons: DELIVERED,
        turns: [{ say: `Can you check order ${ORDER} for ${EMAIL}`, expect: handled(/delivered/i), alertsAfter: 0 }],
        because: 'the 18 Aug widening must not have been undone',
    },

    // ── Stand-downs: details present, but tracking is the wrong answer ───────
    {
        name: 'Damage complaint stands down (live test E1)',
        cons: DELIVERED,
        turns: [{ say: `My order ${ORDER} arrived damaged, email ${EMAIL}`, expect: null, alertsAfter: 0 }],
        because: 'ComplaintsResponseGate owns this; a delivery status buries the damage report',
    },
    {
        name: 'Missing item stands down (live test E2)',
        cons: DELIVERED,
        turns: [{ say: `There is a missing item in my order ${ORDER}, email ${EMAIL}`, expect: null, alertsAfter: 0 }],
        because: 'same, and the credit form carries the split-delivery reminder',
    },
    {
        name: 'Address change stands down',
        cons: DELIVERED,
        turns: [{ say: `Can you change the delivery address on order ${ORDER}, email ${EMAIL}`, expect: null, alertsAfter: 0 }],
        because: '"delivery address" matched the tracking verb and answered with a status instead',
    },
    {
        name: 'Cancel request stands down',
        cons: DELIVERED,
        turns: [{ say: `Please cancel order ${ORDER}, email ${EMAIL}`, expect: null, alertsAfter: 0 }],
        because: 'the customer wants something done to the order, not a status read on it',
    },
    {
        name: 'Tax invoice request stands down',
        cons: DELIVERED,
        turns: [{ say: `I need a tax invoice for order ${ORDER}, email ${EMAIL}`, expect: null, alertsAfter: 0 }],
        because: 'same',
    },

    // ── Stand-downs: no order details, not a tracking question ──────────────
    {
        name: 'Shipping policy is not hijacked (live test E4)',
        cons: DELIVERED,
        turns: [{ say: 'how much is shipping to 6000?', expect: null, alertsAfter: 0 }],
        because: 'a policy question must reach the KB',
    },
    {
        name: 'Stock availability is not hijacked (live test E6)',
        cons: DELIVERED,
        turns: [{ say: 'can you check if you have organic almonds in stock?', expect: null, alertsAfter: 0 }],
        because: '"check" is a tracking verb but there is no order here',
    },
    {
        name: 'Delivery-area question is not hijacked',
        cons: DELIVERED,
        turns: [{ say: 'do you deliver to WA?', expect: null, alertsAfter: 0 }],
        because: 'the widened verb list must not swallow delivery policy',
    },

    // ── Security ────────────────────────────────────────────────────────────
    {
        name: 'Wrong email reveals nothing (live test F1)',
        cons: DELIVERED,
        turns: [{ say: `Where is my order ${ORDER}? My email is wrong.person@gmail.com`, expect: (m) => !/delivered|StarTrack|boxes/i.test(m), alertsAfter: 0 }],
        because: 'the lookup must not be probeable by swapping the email',
    },
    {
        name: 'Details ask when only one half is given',
        cons: DELIVERED,
        turns: [{ say: `where's my order?`, expect: handled(/order number and the email/i), alertsAfter: 0 }],
        because: 'the ask is what makes the next turn a details reply',
    },

    {
        name: 'Bare details mid credit-claim are NOT hijacked into tracking',
        cons: DELIVERED,
        turns: [
            { say: `My order ${ORDER} arrived damaged, email ${EMAIL}`, expect: null, alertsAfter: 0,
              injectAssistant: 'You can submit a new credit or returns request using our official form: https://forms.zohopublic.com/admin2553/form/ReturnsCreditForm' },
            { say: `Order ${ORDER}, email ${EMAIL}`, expect: null, alertsAfter: 0 },
        ],
        because: 'the customer is supplying details for the claim, not asking where the parcel is',
    },
    {
        name: 'An explicit tracking question after the credit form IS still answered',
        cons: DELIVERED,
        turns: [
            { say: `My order ${ORDER} arrived damaged, email ${EMAIL}`, expect: null, alertsAfter: 0,
              injectAssistant: 'You can submit a new credit or returns request using our official form: https://forms.zohopublic.com/admin2553/form/ReturnsCreditForm' },
            { say: `Where is my order ${ORDER}? My email is ${EMAIL}`, expect: handled(/delivered/i), alertsAfter: 0 },
        ],
        because: 'the guard must narrow the bare-details path only, never the verb path',
    },

    // ── Alert sequences: not_found (live tests D1-D3) ───────────────────────
    {
        name: 'not_found: first attempt asks, second fires, third dedups (D1-D3)',
        cons: NONE,
        conversationId: 'conv-notfound',
        turns: [
            { say: 'Where is my order 999999? My email is nobody@example.com', expect: handled(/double-check the order number and the email/i), alertsAfter: 0 },
            { say: 'Where is my order 999999? My email is nobody@example.com', expect: handled(/flagged this with our customer service/i), alertsAfter: 1, reasonIncludes: 'not' },
            { say: 'Where is my order 999999? My email is nobody@example.com', expect: () => true, alertsAfter: 1 },
        ],
        because: 'one alert per genuine miss, never on the first try and never twice',
    },
    {
        name: 'not_found: changed details restart the cycle, no alert (D4)',
        cons: NONE,
        conversationId: 'conv-changed',
        turns: [
            { say: 'Where is my order 999999? My email is nobody1@example.com', expect: handled(/double-check/i), alertsAfter: 0 },
            { say: 'Sorry, order 999998, email nobody2@example.com', expect: () => true, alertsAfter: 0 },
        ],
        because: 'a typo the customer corrected is not an escalation',
    },

    // ── Alert sequences: wont_wait (live test D5, NEVER verified live) ──────
    {
        name: 'wont_wait: part-delivered then refusal fires exactly one CS alert (D5)',
        cons: PARTLY,
        conversationId: 'conv-wontwait',
        turns: [
            { say: `Where is my order ${ORDER}? My email is ${EMAIL}`, expect: handled(/prefer not to wait for the rest/i), alertsAfter: 0 },
            { say: "I don't want to wait for the rest, just refund it", expect: handled(/passed|flagged|team/i), alertsAfter: 1, reasonIncludes: 'wait' },
        ],
        because: 'the only trigger with no live order to test it against',
    },
    {
        name: 'wont_wait does not fire out of the blue',
        cons: DELIVERED,
        conversationId: 'conv-wontwait-cold',
        turns: [{ say: "I don't want to wait, just refund it", expect: null, alertsAfter: 0 }],
        because: 'with no part-delivered render behind it this belongs to the complaints gate',
    },
    {
        name: 'wont_wait marker does not hijack a status question about another order',
        cons: PARTLY,
        conversationId: 'conv-wontwait-other',
        turns: [
            { say: `Where is my order ${ORDER}? My email is ${EMAIL}`, expect: handled(/prefer not to wait/i), alertsAfter: 0 },
            { say: `Where is my order ${ORDER}? My email is ${EMAIL} - this is taking too long`, expect: handled(/boxes|delivered|way/i), alertsAfter: 0 },
        ],
        because: 'a fresh order+email is a new question, not a refusal to wait',
    },

    // ── Alert sequences: collection (live tests C3, D6, never runnable) ─────
    {
        name: 'collection: first answer does NOT escalate (C3, Iri 31 Aug)',
        cons: COLLECTION,
        conversationId: 'conv-collection',
        turns: [{ say: `Where is my order ${ORDER}? My email is ${EMAIL}`, expect: (m) => /post office or collection point/i.test(m) && !/passed this to our team/i.test(m), alertsAfter: 0 }],
        because: 'Iri was explicit that a parcel waiting for collection is not an escalation',
    },
    {
        name: 'collection_refused: only when the customer says they cannot collect (D6)',
        cons: COLLECTION,
        conversationId: 'conv-collection-refused',
        turns: [
            { say: `Where is my order ${ORDER}? My email is ${EMAIL}`, expect: handled(/post office or collection point/i), alertsAfter: 0 },
            { say: "I can't collect it, I have no transport", expect: handled(/passed this to our team/i), alertsAfter: 1, reasonIncludes: 'collect' },
        ],
        because: 'the second half of the rule Iri set',
    },

    // ── Alert sequence: duplicate consignments (live test C2) ───────────────
    {
        name: 'duplicate consignments escalate and alert (C2)',
        cons: [consignment('Booked', 1, 'W9DZ00048114'), consignment('Picked Up', 1, 'W9DZ00048117')],
        conversationId: 'conv-dupe',
        turns: [{ say: `Where is my order ${ORDER}? My email is ${EMAIL}`, expect: handled(/more than one delivery record/i), alertsAfter: 1, reasonIncludes: 'consignment' }],
        because: 'never guess which of two live consignments is the real one',
    },
    {
        name: 'cancelled consignment beside a live one does not escalate (C1)',
        cons: [consignment('Cancelled', 1, 'W9DZ00047591'), consignment('Complete', 4, 'W9DZ00047592')],
        conversationId: 'conv-cancelled',
        turns: [{ say: `Where is my order ${ORDER}? My email is ${EMAIL}`, expect: (m) => /All 4 boxes/.test(m) && !/more than one/i.test(m), alertsAfter: 0 }],
        because: 'a superseded consignment must be invisible, not a second one',
    },
];

// ── Run ──────────────────────────────────────────────────────────────────────

(async () => {
    if (!settings.freight.trackingEnabled) {
        console.error('ORDER_TRACKING_ENABLED is not true, so the gate returns null for everything.');
        console.error('Run with:  node --env-file=.env.local scripts/gate-intent-tests.mjs');
        process.exit(2);
    }

    let pass = 0;
    let fail = 0;

    for (const s of SCENARIOS) {
        const svc = trackingService(s.cons);
        const { svc: alerts, sent } = recordingAlerts();
        const history: ConversationMessage[] = [];
        let ok = true;
        const notes: string[] = [];

        for (let i = 0; i < s.turns.length; i++) {
            const t = s.turns[i];
            const before = sent.length;
            const reply = await OrderStatusGate.handleOrderTracking(
                t.say, history, svc, alerts, s.conversationId,
            );

            if (t.expect === null) {
                if (reply !== null) {
                    ok = false;
                    notes.push(`turn ${i + 1}: expected the gate to stand down, it answered: ${reply.slice(0, 120)}`);
                }
            } else if (reply === null) {
                ok = false;
                notes.push(`turn ${i + 1}: gate stood down but should have answered`);
            } else if (!t.expect(reply)) {
                ok = false;
                notes.push(`turn ${i + 1}: reply did not match: ${reply.slice(0, 160)}`);
            }

            if (sent.length !== t.alertsAfter) {
                ok = false;
                notes.push(`turn ${i + 1}: expected ${t.alertsAfter} alert(s) so far, got ${sent.length}`);
            }
            if (t.reasonIncludes && sent.length > before) {
                const body = sent[sent.length - 1].body ?? '';
                if (!new RegExp(t.reasonIncludes, 'i').test(body)) {
                    ok = false;
                    notes.push(`turn ${i + 1}: alert body missing "${t.reasonIncludes}": ${body.replace(/\n/g, ' | ')}`);
                }
            }

            history.push({ role: 'user', content: t.say });
            if (reply) history.push({ role: 'assistant', content: reply });
            else if (t.injectAssistant) history.push({ role: 'assistant', content: t.injectAssistant });
        }

        ok ? pass++ : fail++;
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${s.name}`);
        if (!ok) {
            for (const n of notes) console.log(`        ${n}`);
            console.log(`        why it matters: ${s.because}`);
        }
    }

    console.log(`\n${pass} passed, ${fail} failed, ${SCENARIOS.length} total`);
    process.exit(fail ? 1 : 0);
})();
