/* ─────────────────────────────────────────────────────────────────────────
 * no-answer-gate-tests — NoAnswerGate.
 *
 * The defect this covers, found on the sandbox 5 Oct 2026:
 *
 *   Q: do you ship internationally
 *   A: "I can help with questions about shipping. However, I don't have
 *       information in my knowledge base about international shipping. For
 *       specific details ... please contact Honest to Goodness support
 *       directly via phone, email, or the web forms on their website."
 *
 * Two faults in one reply. Iri's agreed wording and the enquiry form link were
 * missing, and the customer was told we have a knowledge base. It happened
 * because the no-results path only fires when the KB returns NOTHING, and since
 * the Systems Support KB went live it nearly always returns something.
 *
 * Run:  node scripts/no-answer-gate-tests.mjs
 * Rebuild: npx esbuild scripts/no-answer-gate-tests.src.ts --bundle \
 *   --platform=node --format=esm --alias:@=. --outfile=scripts/no-answer-gate-tests.mjs
 * ───────────────────────────────────────────────────────────────────────── */
import { NoAnswerGate, NO_RESULTS_FALLBACK_MESSAGE } from '@/lib/services/chat/NoAnswerGate';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = '', because = '') {
    if (ok) { pass++; console.log(`PASS  ${name}`); return; }
    fail++;
    console.log(`FAIL  ${name}`);
    if (detail) console.log(`        ${detail}`);
    if (because) console.log(`        why it matters: ${because}`);
}

// ── replies that must be replaced ───────────────────────────────────────────
const MUST_REPLACE: Array<[string, string]> = [
    ["I can help with questions about shipping. However, I don't have information in my knowledge base about international shipping.",
        'the exact reply the sandbox gave on 5 Oct'],
    ['For postcode 2534, the free shipping threshold is not settled in our knowledge base.',
        'the conflicted-postcode reply, same day'],
    ["I couldn't find an article about that.",
        'the original wording Iri asked us to remove on 21 Sep'],
    ["I don't have specific information about that product.",
        'the model composing its own non-answer now the KB usually returns something'],
    ['No information about wholesale minimums is available.',
        'another phrasing of the same thing'],
    ['That is covered in our KB.',
        'never name our plumbing to a customer'],
];
for (const [text, because] of MUST_REPLACE) {
    check(`replaced: "${text.slice(0, 52)}..."`, NoAnswerGate.shouldReplace(text), '', because);
}

// ── replies that must be left alone ─────────────────────────────────────────
const MUST_KEEP: Array<[string, string]> = [
    ['Postcode 3029 qualifies for free shipping on retail orders of $150 or more, provided the order weight does not exceed 24kg.',
        'a correct answer must survive'],
    ['All 3 boxes of your order have been delivered.\n\nTrack your parcel: https://mship.io/v2/abc',
        'order tracking has its own wording'],
    ["I can't see live stock information for individual products.",
        'product availability has its own gate and its own wording'],
    ['Could you let me know whether you are a retail or wholesale customer?',
        'asking a clarifying question is not a failure to answer'],
    ['', 'an empty string is not a non-answer, it is handled elsewhere'],
];
for (const [text, because] of MUST_KEEP) {
    check(`kept: "${(text || '(empty)').slice(0, 52)}..."`, !NoAnswerGate.shouldReplace(text), '', because);
}

// ── the replacement itself ──────────────────────────────────────────────────
check('the replacement carries the enquiry form link',
    NO_RESULTS_FALLBACK_MESSAGE.includes('https://goodness.com.au/contact-us/'),
    '',
    "Iri asked for the link specifically; without it the customer has nowhere to go");

check('the replacement never names the knowledge base',
    !/knowledge base/i.test(NO_RESULTS_FALLBACK_MESSAGE));

check('replacing is idempotent',
    NoAnswerGate.shouldReplace(NO_RESULTS_FALLBACK_MESSAGE),
    '',
    'the fallback itself says "I do not have the answer", so it must be safe to match it');

// ── the two reasons are reported separately, for the logs ───────────────────
check('a plain non-answer is reported as cannot-answer, not internals',
    NoAnswerGate.saysCannotAnswer("I don't have the answer to that one.")
    && !NoAnswerGate.mentionsInternals("I don't have the answer to that one."));

check('a knowledge-base mention is reported as internals',
    NoAnswerGate.mentionsInternals('That is in the knowledge base.'));

console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
