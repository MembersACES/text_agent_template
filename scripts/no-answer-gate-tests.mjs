// lib/services/chat/NoAnswerGate.ts
var ENQUIRY_FORM_URL = "https://goodness.com.au/contact-us/";
var NO_RESULTS_FALLBACK_MESSAGE = `I'm so sorry, I don't have the answer to that one. One of my colleagues will be able to help. Please fill in our enquiry form and the team will get back to you shortly:

${ENQUIRY_FORM_URL}`;
var CANNOT_ANSWER = /couldn'?t find an article|could not find an article|\bno article\b|not find.*help cent(?:er|re)|don'?t have the answer|do not have the answer|one of my colleagues|i cannot assist|(?:don'?t|do not|doesn'?t|does not) have (?:any |specific |detailed |further )?(?:information|details|specifics)\b|\bno (?:information|details) (?:about|on|regarding)\b/i;
var MENTIONS_INTERNALS = /\bknowledge base\b|\bkb\b|\bhelp cent(?:er|re) article\b/i;
var OWNED_ELSEWHERE = /\blive stock\b|\bstock level\b|\btracking link\b|\bconsignment\b/i;
var NoAnswerGate = class {
  /** True when the reply should be replaced with Iri's wording. */
  static shouldReplace(response) {
    const text = String(response ?? "");
    if (!text.trim()) return false;
    if (OWNED_ELSEWHERE.test(text)) return false;
    return CANNOT_ANSWER.test(text) || MENTIONS_INTERNALS.test(text);
  }
  /** Exposed for tests and for logging which of the two tripped. */
  static saysCannotAnswer(response) {
    return CANNOT_ANSWER.test(String(response ?? ""));
  }
  static mentionsInternals(response) {
    return MENTIONS_INTERNALS.test(String(response ?? ""));
  }
};

// scripts/no-answer-gate-tests.src.ts
var pass = 0;
var fail = 0;
function check(name, ok, detail = "", because = "") {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}`);
    return;
  }
  fail++;
  console.log(`FAIL  ${name}`);
  if (detail) console.log(`        ${detail}`);
  if (because) console.log(`        why it matters: ${because}`);
}
var MUST_REPLACE = [
  [
    "I can help with questions about shipping. However, I don't have information in my knowledge base about international shipping.",
    "the exact reply the sandbox gave on 5 Oct"
  ],
  [
    "For postcode 2534, the free shipping threshold is not settled in our knowledge base.",
    "the conflicted-postcode reply, same day"
  ],
  [
    "I couldn't find an article about that.",
    "the original wording Iri asked us to remove on 21 Sep"
  ],
  [
    "I don't have specific information about that product.",
    "the model composing its own non-answer now the KB usually returns something"
  ],
  [
    "No information about wholesale minimums is available.",
    "another phrasing of the same thing"
  ],
  [
    "That is covered in our KB.",
    "never name our plumbing to a customer"
  ]
];
for (const [text, because] of MUST_REPLACE) {
  check(`replaced: "${text.slice(0, 52)}..."`, NoAnswerGate.shouldReplace(text), "", because);
}
var MUST_KEEP = [
  [
    "Postcode 3029 qualifies for free shipping on retail orders of $150 or more, provided the order weight does not exceed 24kg.",
    "a correct answer must survive"
  ],
  [
    "All 3 boxes of your order have been delivered.\n\nTrack your parcel: https://mship.io/v2/abc",
    "order tracking has its own wording"
  ],
  [
    "I can't see live stock information for individual products.",
    "product availability has its own gate and its own wording"
  ],
  [
    "Could you let me know whether you are a retail or wholesale customer?",
    "asking a clarifying question is not a failure to answer"
  ],
  ["", "an empty string is not a non-answer, it is handled elsewhere"]
];
for (const [text, because] of MUST_KEEP) {
  check(`kept: "${(text || "(empty)").slice(0, 52)}..."`, !NoAnswerGate.shouldReplace(text), "", because);
}
check(
  "the replacement carries the enquiry form link",
  NO_RESULTS_FALLBACK_MESSAGE.includes("https://goodness.com.au/contact-us/"),
  "",
  "Iri asked for the link specifically; without it the customer has nowhere to go"
);
check(
  "the replacement never names the knowledge base",
  !/knowledge base/i.test(NO_RESULTS_FALLBACK_MESSAGE)
);
check(
  "replacing is idempotent",
  NoAnswerGate.shouldReplace(NO_RESULTS_FALLBACK_MESSAGE),
  "",
  'the fallback itself says "I do not have the answer", so it must be safe to match it'
);
check(
  "a plain non-answer is reported as cannot-answer, not internals",
  NoAnswerGate.saysCannotAnswer("I don't have the answer to that one.") && !NoAnswerGate.mentionsInternals("I don't have the answer to that one.")
);
check(
  "a knowledge-base mention is reported as internals",
  NoAnswerGate.mentionsInternals("That is in the knowledge base.")
);
console.log(`
${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
