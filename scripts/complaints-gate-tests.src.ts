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
    // ── the strict trigger, added 5 Oct 2026 ────────────────────────────────
    // The scenario patterns are broad on purpose, so they cannot be used on
    // their own to short-circuit the model. These cases fix where the line is.
    const DEFINITE: Array<[string, boolean, string]> = [
        ['the dried sultana I got in my last order tastes awful', true,
            "Iri's own example; must give his wording including the 48 hours"],
        ['you send me mouldy passata', true, "Iri's other example"],
        ['my order arrived damaged', true, 'the original damage case'],
        ['I received the wrong item', true, 'wrong item goes to the same form'],
        ['there was an item missing from my order', true, 'so does a missing item'],

        ['do you have 20% off anything this week', false,
            '"off" is in the quality pattern; a sale question must not reach the credit form'],
        ['what is the quality of your olive oil', false,
            '"quality" is in the pattern; this is a product question'],
        ['how does the taste compare to the organic range', false,
            '"taste" is in the pattern; this is a product question'],
        ['I was overcharged on my order', false,
            'wrong_price is deliberately excluded; Iri asked to leave that at seven business days'],
        ['where is my order 10269854', false, 'tracking, not a complaint'],
        ['I want to follow up on a credit I already submitted', false,
            'existing claims have their own reply and must not be sent the form again'],
    ];
    for (const [say, want, because] of DEFINITE) {
        const got = ComplaintsResponseGate.isDefiniteProductComplaint(say);
        if (got === want) { pass++; console.log(`PASS  definite=${want}  ${JSON.stringify(say)}`); }
        else {
            fail++;
            console.log(`FAIL  definite  ${JSON.stringify(say)}`);
            console.log(`        expected ${want}, got ${got}`);
            console.log(`        why it matters: ${because}`);
        }
    }

    // The template Iri signed off has to be the one that actually goes out.
    const qualityReply = ComplaintsResponseGate.buildFallbackResponse(
        'the dried sultana I got in my last order tastes awful', [],
    ) ?? '';
    if (/within 48 hours/i.test(qualityReply) && /forms\.zohopublic\.com/i.test(qualityReply)) {
        pass++; console.log('PASS  the quality template keeps the 48 hour commitment and the form link');
    } else {
        fail++;
        console.log('FAIL  the quality template keeps the 48 hour commitment and the form link');
        console.log(`        got: ${qualityReply.slice(0, 160)}`);
        console.log('        why it matters: this is the wording Iri asked for on 21 Sep');
    }

    console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
    process.exit(fail ? 1 : 0);
})();
