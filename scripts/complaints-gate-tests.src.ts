/* ─────────────────────────────────────────────────────────────────────────
 * complaints-gate-tests — ComplaintsResponseGate routing and copy.
 *
 * Iri's sweep, 21 Sep 2026. Quality complaints (taste, texture, mould,
 * infestation, incorrect weight) had no scenario of their own, so they fell
 * through to the knowledge base and came back "I couldn't find an article".
 * His live examples: "the dried sultana I got in my last order tastes awful"
 * and "you send me mouldy passata".
 *
 * This also guards the pairing between ComplaintsResponseGate's patterns and
 * OrderStatusGate.CONDITION_COMPLAINT. A word in only one of the two either
 * answers a quality complaint with a delivery status, or drops it into the KB.
 *
 * Run:  node scripts/complaints-gate-tests.mjs
 * Rebuild: npx esbuild scripts/complaints-gate-tests.src.ts --bundle \
 *   --platform=node --format=esm --alias:@=. --outfile=scripts/complaints-gate-tests.mjs
 * ───────────────────────────────────────────────────────────────────────── */
import { ComplaintsResponseGate } from '@/lib/services/chat/ComplaintsResponseGate';
import { OrderStatusGate } from '@/lib/services/chat/OrderStatusGate';

interface Case {
    say: string;
    scenario: string | null;
    /** Substrings the customer-facing reply must contain. */
    replyHas?: string[];
    /** Substrings the reply must NOT contain. */
    replyLacks?: string[];
    /** Must OrderStatusGate stand down for this message? */
    trackingStandsDown: boolean;
    because: string;
}

const FORM = 'forms.zohopublic.com';

const CASES: Case[] = [
    // ── Iri's two live examples ─────────────────────────────────────────────
    {
        say: 'the dried sultana I got in my last order tastes awful',
        scenario: 'quality_complaint',
        replyHas: ['so sorry', FORM, 'relevant photos', '48 hours'],
        replyLacks: ['article', 'help cent', '2 days'],
        trackingStandsDown: true,
        because: 'this exact message returned "I couldn\'t find an article" on the sandbox',
    },
    {
        say: 'you send me mouldy passata',
        scenario: 'quality_complaint',
        replyHas: ['so sorry', FORM, '48 hours'],
        replyLacks: ['article', 'help cent'],
        trackingStandsDown: true,
        because: 'Iri\'s second live example; mould was in the tracking stand-down list but had no answer behind it',
    },

    // ── The rest of the categories Iri listed ───────────────────────────────
    { say: 'the texture of the tahini is completely wrong', scenario: 'quality_complaint', replyHas: [FORM, '48 hours'], trackingStandsDown: true, because: 'texture' },
    { say: 'there are weevils in the flour', scenario: 'quality_complaint', replyHas: [FORM, '48 hours'], trackingStandsDown: true, because: 'infestation' },
    { say: 'the bag is underweight, I got 800g not 1kg', scenario: 'quality_complaint', replyHas: [FORM, '48 hours'], trackingStandsDown: true, because: 'incorrect weight' },
    { say: 'the quality of the cashews is poor this time', scenario: 'quality_complaint', replyHas: [FORM, '48 hours'], trackingStandsDown: true, because: 'quality' },
    { say: 'the olive oil smells rancid', scenario: 'quality_complaint', replyHas: [FORM, '48 hours'], trackingStandsDown: true, because: 'smell and rancid' },

    // ── Damaged keeps its OWN wording, which is different ───────────────────
    {
        say: 'the jar of coconut oil in my last order came broken',
        scenario: 'damaged',
        replyHas: ['so sorry', FORM, 'clear photos of the damage', '2 days of receipt', '3 to 4 days'],
        replyLacks: ['48 hours', '7 business days'],
        trackingStandsDown: true,
        because: 'Iri changed the damage wording and the processing time from 7 business days to 3 to 4',
    },

    // ── The specific scenarios must still win over the new broad one ────────
    {
        say: 'I received the wrong item in my order',
        scenario: 'wrong_item',
        replyHas: [FORM, 'what you ordered'],
        replyLacks: ['48 hours'],
        trackingStandsDown: true,
        because: 'quality_complaint sits after the specific scenarios and must not swallow them',
    },
    {
        say: 'there is a missing item in my order',
        scenario: 'missing_item',
        replyHas: [FORM, 'split deliveries'],
        trackingStandsDown: true,
        because: 'same, for missing items',
    },
    {
        say: 'I was charged the wrong price',
        scenario: 'wrong_price',
        replyHas: [FORM, 'what you were charged'],
        // NOT in CONDITION_COMPLAINT, and correctly so: a pricing dispute is not a
        // complaint about the condition of the goods. It never reaches the tracking
        // gate anyway, because "charged" is not a tracking verb, so wantsOrderTracking
        // is false. Asserted explicitly so nobody "fixes" this later by adding price
        // words to a list about mould and breakage.
        trackingStandsDown: false,
        because: 'billing is a complaint but not a condition complaint, and the two lists should not be conflated',
    },

    // ── Must NOT fire ───────────────────────────────────────────────────────
    {
        say: 'where is my order 10269854, email customer@example.com',
        scenario: null,
        trackingStandsDown: false,
        because: 'an ordinary tracking question must still reach the tracking gate',
    },
    {
        say: 'do you deliver to WA?',
        scenario: null,
        trackingStandsDown: false,
        because: 'a delivery-policy question is not a complaint',
    },
    {
        say: 'is your product kosher',
        scenario: null,
        trackingStandsDown: false,
        because: 'a product question must reach the knowledge base, not the credit form',
    },
    {
        say: 'what is the shelf life of your almonds',
        scenario: null,
        trackingStandsDown: false,
        because: 'asking ABOUT shelf life is not reporting a spoiled product',
    },
];

(() => {
    let pass = 0, fail = 0;
    for (const c of CASES) {
        const notes: string[] = [];
        let ok = true;

        const scenario = ComplaintsResponseGate.classify(c.say);
        if (scenario !== c.scenario) {
            ok = false;
            notes.push(`expected scenario ${c.scenario}, got ${scenario}`);
        }

        if (ok && c.scenario) {
            const reply = ComplaintsResponseGate.buildFallbackResponse(c.say) ?? '';
            for (const want of c.replyHas ?? []) {
                if (!reply.toLowerCase().includes(want.toLowerCase())) {
                    ok = false;
                    notes.push(`reply missing "${want}"`);
                }
            }
            for (const avoid of c.replyLacks ?? []) {
                if (reply.toLowerCase().includes(avoid.toLowerCase())) {
                    ok = false;
                    notes.push(`reply should not contain "${avoid}"`);
                }
            }
        }

        // The two word lists must agree.
        const standsDown = OrderStatusGate.conditionComplaintForTests(c.say);
        if (standsDown !== c.trackingStandsDown) {
            ok = false;
            notes.push(`tracking stand-down expected ${c.trackingStandsDown}, got ${standsDown}`);
        }

        if (ok) pass++;
        else fail++;
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${JSON.stringify(c.say)}`);
        if (!ok) {
            for (const n of notes) console.log(`        ${n}`);
            console.log(`        why it matters: ${c.because}`);
        }
    }
    console.log(`\n${pass} passed, ${fail} failed, ${CASES.length} total`);
    process.exit(fail ? 1 : 0);
})();
