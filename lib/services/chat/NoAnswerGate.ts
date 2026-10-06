/**
 * What the agent says when it cannot answer.
 *
 * Iri's wording, confirmed 21 Sep 2026, plus the enquiry form. This used to be
 * reached only when the knowledge base returned nothing at all. Once the
 * Systems Support KB went live the KB nearly always returns SOMETHING, so the
 * model started composing its own "I don't have information about that" replies
 * and Iri's wording and the enquiry form link stopped appearing. This gate
 * catches those replies after the fact.
 *
 * It also catches the agent talking about its own knowledge base. A customer
 * should never be told we have one, let alone that an answer "is not settled"
 * in it.
 */

export const ENQUIRY_FORM_URL = 'https://goodness.com.au/contact-us/';

export const NO_RESULTS_FALLBACK_MESSAGE =
    "I'm so sorry, I don't have the answer to that one. One of my colleagues will be able to help. "
    + `Please fill in our enquiry form and the team will get back to you shortly:\n\n${ENQUIRY_FORM_URL}`;

/** The model saying, in its own words, that it cannot answer. */
const CANNOT_ANSWER =
    /couldn'?t find an article|could not find an article|\bno article\b|not find.*help cent(?:er|re)|don'?t have the answer|do not have the answer|one of my colleagues|i cannot assist|(?:don'?t|do not|doesn'?t|does not) have (?:any |specific |detailed |further )?(?:information|details|specifics)\b|\bno (?:information|details) (?:about|on|regarding)\b/i;

/** Our plumbing, named out loud to a customer. */
const MENTIONS_INTERNALS = /\bknowledge base\b|\bkb\b|\bhelp cent(?:er|re) article\b/i;

/** Order tracking and live stock have their own wording and own gates; this one
 *  must not reach across and overwrite them. */
const OWNED_ELSEWHERE = /\blive stock\b|\bstock level\b|\btracking link\b|\bconsignment\b/i;

export class NoAnswerGate {
    /** True when the reply should be replaced with Iri's wording. */
    static shouldReplace(response: string): boolean {
        const text = String(response ?? '');
        if (!text.trim()) return false;
        if (OWNED_ELSEWHERE.test(text)) return false;
        return CANNOT_ANSWER.test(text) || MENTIONS_INTERNALS.test(text);
    }

    /** Exposed for tests and for logging which of the two tripped. */
    static saysCannotAnswer(response: string): boolean {
        return CANNOT_ANSWER.test(String(response ?? ''));
    }

    static mentionsInternals(response: string): boolean {
        return MENTIONS_INTERNALS.test(String(response ?? ''));
    }
}
