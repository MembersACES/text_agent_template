// lib/services/chat/ConversationClosersGate.ts
var COURTESY_WORDS = /\b(ok|okay|oki|okey|kk|k|righto|right|alright|all ?right|cool|great|good|perfect|awesome|excellent|lovely|brilliant|nice|sweet|thank|thanks|thankyou|thanx|thx|ta|cheers|much|appreciate|appreciated|appreciate it|grateful|no worries|no problem|np|all good|thats all|that is all|nothing else|nothing more|im done|i am done|done|bye|goodbye|good ?bye|see ya|see you|later|ciao|farewell|have a good one|have a great day|have a good day|good day|night|goodnight|you too|same to you|yep|yeah|yes|sure|got it|gotcha|understood|noted|will do|helpful|help|helped|so|very|really|heaps|lot|lots|a lot|for|it|that|this|your|you|my|me|the|and|now|then|then thanks|mate|legend|champ|team|again|anyway|anyways)\b/gi;
var CLOSER_SIGNAL = /\b(ok|okay|oki|okey|kk|righto|alright|all ?right|cool|great|perfect|awesome|excellent|lovely|brilliant|thank|thanks|thankyou|thanx|thx|ta|cheers|appreciate|appreciated|grateful|no worries|no problem|np|all good|thats all|that is all|nothing else|nothing more|done|bye|goodbye|see ya|see you|later|ciao|farewell|good ?night|helpful|got it|gotcha|noted|understood)\b/i;
var SIGN_OFF = /\b(bye|goodbye|good ?bye|see ya|see you|later|ciao|farewell|good ?night|thats all|that is all|nothing else|nothing more|im done|i am done|have a (?:good|great|nice|lovely) (?:day|one|weekend|night|evening))\b/i;
function normalise(message) {
  return String(message ?? "").replace(/['\u2018\u2019\u02BC]/g, "");
}
var ConversationClosersGate = class {
  /**
   * True when the message is purely a closing courtesy AND there is a prior
   * exchange for it to be closing.
   */
  static isClosing(message, history = []) {
    const raw = normalise(message).trim();
    if (!raw) return false;
    if (raw.length > 80) return false;
    if (!CLOSER_SIGNAL.test(raw)) return false;
    if (raw.includes("?")) return false;
    if (/\d|@/.test(raw)) return false;
    const residue = raw.replace(COURTESY_WORDS, " ").replace(/[^a-z0-9]+/gi, " ").trim();
    if (residue.length > 0) return false;
    return history.some((m) => m.role === "assistant");
  }
  /** Short, warm, no offer to search anything. */
  static buildResponse(message) {
    if (SIGN_OFF.test(normalise(message))) {
      return "You're welcome. Thanks for chatting, and have a good day.";
    }
    return "You're welcome. If anything else comes up, just ask.";
  }
};

// scripts/closers-gate-tests.src.ts
var AFTER = [
  { role: "user", content: "where is my order" },
  { role: "assistant", content: "Your order has been delivered." }
];
var COLD = [];
var CASES = [
  // ── Iri's case and its neighbours ────────────────────────────────────────
  { say: "Ok. Thank you", history: AFTER, closing: true, replyHas: "You're welcome", because: "the exact message Iri sent" },
  { say: "ok thanks", history: AFTER, closing: true, because: "the shortest form of the same thing" },
  { say: "Thanks!", history: AFTER, closing: true, because: "single courtesy word with punctuation" },
  { say: "thank you so much, much appreciated", history: AFTER, closing: true, because: "longer courtesy, still nothing but courtesy" },
  { say: "cheers mate", history: AFTER, closing: true, because: "Australian, and still only courtesy" },
  { say: "no worries, thanks", history: AFTER, closing: true, because: "acknowledgement plus thanks" },
  { say: "perfect, got it", history: AFTER, closing: true, because: "acknowledgement with no thanks at all" },
  { say: "that's all thanks", history: AFTER, closing: true, replyHas: "have a good day", because: "an explicit end of conversation gets the sign-off wording" },
  { say: "bye", history: AFTER, closing: true, replyHas: "have a good day", because: "a goodbye is a goodbye" },
  { say: "Thanks, have a good day", history: AFTER, closing: true, replyHas: "have a good day", because: "reciprocated sign-off" },
  // ── Must NOT fire: a real question wearing a polite hat ─────────────────
  { say: "thanks, where is my order", history: AFTER, closing: false, because: "courtesy plus a question is a question" },
  { say: "ok thanks, but it still has not arrived", history: AFTER, closing: false, because: "the complaint is the message, not the thanks" },
  { say: "thanks. can I get a tax invoice", history: AFTER, closing: false, because: "an invoice request must still reach the right gate" },
  { say: "ok thanks, order 10269854 email a@b.com", history: AFTER, closing: false, because: "order details must never be swallowed as courtesy" },
  { say: "thanks?", history: AFTER, closing: false, because: "a question mark makes it a question however short" },
  { say: "thanks, is it delivered?", history: AFTER, closing: false, because: "same, with an actual question attached" },
  { say: "thanks for nothing, this is the third time my order is late", history: AFTER, closing: false, because: "sarcasm carries a real complaint behind it" },
  { say: "ok", history: COLD, closing: false, because: "nothing to close as the very first message" },
  { say: "thanks", history: COLD, closing: false, because: "a cold thanks is an opening, not a sign-off" },
  { say: "hi", history: AFTER, closing: false, because: "a greeting is not a closer, even mid-conversation" },
  { say: "do you deliver to WA", history: AFTER, closing: false, because: "an ordinary question with no courtesy in it" },
  { say: "great, and do you deliver to WA", history: AFTER, closing: false, because: "opening courtesy does not make the rest disappear" },
  { say: "my order arrived damaged", history: AFTER, closing: false, because: "a complaint must reach the credit flow" },
  { say: "thank you for the tracking link but two boxes are missing", history: AFTER, closing: false, because: "the missing boxes are the message" }
];
(() => {
  let pass = 0, fail = 0;
  for (const c of CASES) {
    const got = ConversationClosersGate.isClosing(c.say, c.history);
    const notes = [];
    let ok = got === c.closing;
    if (!ok) notes.push(`expected isClosing=${c.closing}, got ${got}`);
    if (ok && c.closing && c.replyHas) {
      const reply = ConversationClosersGate.buildResponse(c.say);
      if (!reply.includes(c.replyHas)) {
        ok = false;
        notes.push(`reply missing "${c.replyHas}": ${reply}`);
      }
    }
    if (ok && c.closing) {
      const reply = ConversationClosersGate.buildResponse(c.say);
      if (/article|help cent/i.test(reply)) {
        ok = false;
        notes.push(`reply leaked the KB fallback wording: ${reply}`);
      }
    }
    if (ok) pass++;
    else fail++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${JSON.stringify(c.say)}`);
    if (!ok) {
      for (const n of notes) console.log(`        ${n}`);
      console.log(`        why it matters: ${c.because}`);
    }
  }
  console.log(`
${pass} passed, ${fail} failed, ${CASES.length} total`);
  process.exit(fail ? 1 : 0);
})();
