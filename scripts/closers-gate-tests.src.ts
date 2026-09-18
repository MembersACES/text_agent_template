/* ─────────────────────────────────────────────────────────────────────────
 * closers-gate-tests — ConversationClosersGate routing.
 *
 * Iri, 18 Sep 2026: "Ok. Thank you" after a tracking answer came back with
 * "I couldn't find an article that directly answers this in the help center".
 *
 * The risk in fixing it is over-firing: swallowing a real question that happens
 * to open politely. Most of the cases below are the NEGATIVES that prove it does
 * not. No network, no credentials.
 *
 * Run:  node scripts/closers-gate-tests.mjs
 * Rebuild: npx esbuild scripts/closers-gate-tests.src.ts --bundle \
 *   --platform=node --format=esm --alias:@=. --outfile=scripts/closers-gate-tests.mjs
 * ───────────────────────────────────────────────────────────────────────── */
import { ConversationClosersGate } from '@/lib/services/chat/ConversationClosersGate';
import type { ConversationMessage } from '@/lib/services/chat/ConversationHistoryService';

const AFTER: ConversationMessage[] = [
    { role: 'user', content: 'where is my order' },
    { role: 'assistant', content: 'Your order has been delivered.' },
];
const COLD: ConversationMessage[] = [];

interface Case {
    say: string;
    history: ConversationMessage[];
    closing: boolean;
    /** Substring the reply must contain, when it is handled. */
    replyHas?: string;
    because: string;
}

const CASES: Case[] = [
    // ── Iri's case and its neighbours ────────────────────────────────────────
    { say: 'Ok. Thank you', history: AFTER, closing: true, replyHas: "You're welcome", because: 'the exact message Iri sent' },
    { say: 'ok thanks', history: AFTER, closing: true, because: 'the shortest form of the same thing' },
    { say: 'Thanks!', history: AFTER, closing: true, because: 'single courtesy word with punctuation' },
    { say: 'thank you so much, much appreciated', history: AFTER, closing: true, because: 'longer courtesy, still nothing but courtesy' },
    { say: 'cheers mate', history: AFTER, closing: true, because: 'Australian, and still only courtesy' },
    { say: 'no worries, thanks', history: AFTER, closing: true, because: 'acknowledgement plus thanks' },
    { say: 'perfect, got it', history: AFTER, closing: true, because: 'acknowledgement with no thanks at all' },
    { say: "that's all thanks", history: AFTER, closing: true, replyHas: 'have a good day', because: 'an explicit end of conversation gets the sign-off wording' },
    { say: 'bye', history: AFTER, closing: true, replyHas: 'have a good day', because: 'a goodbye is a goodbye' },
    { say: 'Thanks, have a good day', history: AFTER, closing: true, replyHas: 'have a good day', because: 'reciprocated sign-off' },

    // ── Must NOT fire: a real question wearing a polite hat ─────────────────
    { say: 'thanks, where is my order', history: AFTER, closing: false, because: 'courtesy plus a question is a question' },
    { say: 'ok thanks, but it still has not arrived', history: AFTER, closing: false, because: 'the complaint is the message, not the thanks' },
    { say: 'thanks. can I get a tax invoice', history: AFTER, closing: false, because: 'an invoice request must still reach the right gate' },
    { say: 'ok thanks, order 10269854 email a@b.com', history: AFTER, closing: false, because: 'order details must never be swallowed as courtesy' },
    { say: 'thanks?', history: AFTER, closing: false, because: 'a question mark makes it a question however short' },
    { say: 'thanks, is it delivered?', history: AFTER, closing: false, because: 'same, with an actual question attached' },
    { say: 'thanks for nothing, this is the third time my order is late', history: AFTER, closing: false, because: 'sarcasm carries a real complaint behind it' },
    { say: 'ok', history: COLD, closing: false, because: 'nothing to close as the very first message' },
    { say: 'thanks', history: COLD, closing: false, because: 'a cold thanks is an opening, not a sign-off' },
    { say: 'hi', history: AFTER, closing: false, because: 'a greeting is not a closer, even mid-conversation' },
    { say: 'do you deliver to WA', history: AFTER, closing: false, because: 'an ordinary question with no courtesy in it' },
    { say: 'great, and do you deliver to WA', history: AFTER, closing: false, because: 'opening courtesy does not make the rest disappear' },
    { say: 'my order arrived damaged', history: AFTER, closing: false, because: 'a complaint must reach the credit flow' },
    { say: 'thank you for the tracking link but two boxes are missing', history: AFTER, closing: false, because: 'the missing boxes are the message' },
];

(() => {
    let pass = 0, fail = 0;
    for (const c of CASES) {
        const got = ConversationClosersGate.isClosing(c.say, c.history);
        const notes: string[] = [];
        let ok = got === c.closing;
        if (!ok) notes.push(`expected isClosing=${c.closing}, got ${got}`);

        if (ok && c.closing && c.replyHas) {
            const reply = ConversationClosersGate.buildResponse(c.say);
            if (!reply.includes(c.replyHas)) {
                ok = false;
                notes.push(`reply missing "${c.replyHas}": ${reply}`);
            }
        }

        // Nothing this gate says may ever mention articles or the help centre.
        if (ok && c.closing) {
            const reply = ConversationClosersGate.buildResponse(c.say);
            if (/article|help cent/i.test(reply)) {
                ok = false;
                notes.push(`reply leaked the KB fallback wording: ${reply}`);
            }
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
