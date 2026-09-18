/**
 * ConversationClosersGate
 *
 * A customer signing off is not a knowledge-base question. Found live by Iri,
 * 18 Sep 2026: after a successful tracking answer the customer typed
 * "Ok. Thank you" and the agent replied "I couldn't find an article that
 * directly answers this in the help center", because the message reached the KB
 * path, matched nothing, and got the global no-results fallback.
 *
 * Deliberately narrow. This only fires when the message is NOTHING BUT courtesy,
 * so it can never swallow "thanks, but where is my order 10269854". Same
 * residue-based approach as OrderStatusGate.isBareOrderDetails: strip the
 * courtesy words and punctuation, and require nothing to be left.
 *
 * It also requires a prior exchange. A cold "hi" is a greeting, not a sign-off,
 * and belongs to the normal opening flow.
 */

import type { ConversationMessage } from './ConversationHistoryService';

/** Courtesy and acknowledgement words. Stripped, then the residue must be empty. */
const COURTESY_WORDS =
    /\b(ok|okay|oki|okey|kk|k|righto|right|alright|all ?right|cool|great|good|perfect|awesome|excellent|lovely|brilliant|nice|sweet|thank|thanks|thankyou|thanx|thx|ta|cheers|much|appreciate|appreciated|appreciate it|grateful|no worries|no problem|np|all good|thats all|that is all|nothing else|nothing more|im done|i am done|done|bye|goodbye|good ?bye|see ya|see you|later|ciao|farewell|have a good one|have a great day|have a good day|good day|night|goodnight|you too|same to you|yep|yeah|yes|sure|got it|gotcha|understood|noted|will do|helpful|help|helped|so|very|really|heaps|lot|lots|a lot|for|it|that|this|your|you|my|me|the|and|now|then|then thanks|mate|legend|champ|team|again|anyway|anyways)\b/gi;

/** At least one of these must be present, so a bare "ok" alone still counts but
 *  a stray "you" or "the" on its own does not reach this gate. */
const CLOSER_SIGNAL =
    /\b(ok|okay|oki|okey|kk|righto|alright|all ?right|cool|great|perfect|awesome|excellent|lovely|brilliant|thank|thanks|thankyou|thanx|thx|ta|cheers|appreciate|appreciated|grateful|no worries|no problem|np|all good|thats all|that is all|nothing else|nothing more|done|bye|goodbye|see ya|see you|later|ciao|farewell|good ?night|helpful|got it|gotcha|noted|understood)\b/i;

/** A closer that says goodbye rather than just acknowledging. */
const SIGN_OFF =
    /\b(bye|goodbye|good ?bye|see ya|see you|later|ciao|farewell|good ?night|thats all|that is all|nothing else|nothing more|im done|i am done|have a (?:good|great|nice|lovely) (?:day|one|weekend|night|evening))\b/i;

/** Apostrophes are dropped before any matching so "that's all" and "thats all"
 *  are the same message. Caught by closers-gate-tests: without this, "that's all
 *  thanks" left an "s" behind after the courtesy strip and fell through to the KB,
 *  which is the exact failure this gate exists to stop. */
function normalise(message: string): string {
    return String(message ?? '').replace(/['\u2018\u2019\u02BC]/g, '');
}

export class ConversationClosersGate {
    /**
     * True when the message is purely a closing courtesy AND there is a prior
     * exchange for it to be closing.
     */
    static isClosing(message: string, history: ConversationMessage[] = []): boolean {
        const raw = normalise(message).trim();
        if (!raw) return false;
        // Long messages are never bare courtesy; cheap guard before the regex work.
        if (raw.length > 80) return false;
        if (!CLOSER_SIGNAL.test(raw)) return false;

        // Anything with a question mark is a question, however politely phrased.
        if (raw.includes('?')) return false;

        // A digit or an @ means order details or an email are in here somewhere.
        if (/\d|@/.test(raw)) return false;

        const residue = raw
            .replace(COURTESY_WORDS, ' ')
            .replace(/[^a-z0-9]+/gi, ' ')
            .trim();
        if (residue.length > 0) return false;

        // Needs something to close. A cold "hi" or "thanks" as the very first
        // message is an opening, and the normal flow handles it.
        return history.some((m) => m.role === 'assistant');
    }

    /** Short, warm, no offer to search anything. */
    static buildResponse(message: string): string {
        if (SIGN_OFF.test(normalise(message))) {
            return "You're welcome. Thanks for chatting, and have a good day.";
        }
        return "You're welcome. If anything else comes up, just ask.";
    }
}
