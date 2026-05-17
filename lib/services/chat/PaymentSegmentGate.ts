/**
 * PaymentSegmentGate
 *
 * Enforces "ask retail vs wholesale before listing payment methods" when the
 * model would otherwise open with article text or a KB no-results fallback.
 */

import { ConversationMessage } from './ConversationHistoryService';

export const PAYMENT_SEGMENT_OPENER =
    "Happy to help with that. Could you let me know whether you're a retail or wholesale customer? Accepted payment methods can differ between the two.";

export const CARD_DECLINE_SEGMENT_OPENER =
    "Sorry to hear that's happening — I can help. Could you let me know whether you're a retail or wholesale customer? Accepted payment methods can differ between the two.";

const PAYMENT_INTENT =
    /(?:pay|payment|checkout|card|credit card|debit card|visa|mastercard|amex|american express|apple pay|google pay|paypal|pay in 4|bank transfer|afterpay|zip)/i;

const CARD_DECLINE_INTENT =
    /(?:won't|wont|not)\s+(?:take|accept|working)|(?:declined|rejected)|system\s+won't|card\s+(?:isn't|is not|won't|wont|not being)|isn't being accepted|not being accepted/i;

const SEGMENT_STATED = /\b(retail|wholesale|trade customer|trade account)\b/i;

/** Group Goodness context — segment is known; do not ask retail vs wholesale. */
const GROUP_GOODNESS =
    /\b(group goodness|buying group|group member|group admin|group coordinator|group order|group cart)\b/i;

const BANNED_OPENER_PATTERNS = [
    /^\s*yes\b/i,
    /^\s*we (do )?accept\b/i,
    /^\s*we offer\b/i,
    /^\s*our\b.*\baccepts?\b/i,
    /\bis accepted\b/i,
    /\bare accepted\b/i,
    /\bwe accept\b/i,
    /^\s*(visa|mastercard|american express|amex|apple pay|google pay|paypal)\b/i,
    /\b(visa|mastercard|american express|amex|apple pay|google pay|paypal)\b.*\b(and|&)\b/i,
];

const NO_RESULTS_PHRASING =
    /couldn't find an article|could not find an article|no article|knowledge base lacks|kb lacks|not find.*help center/i;

export class PaymentSegmentGate {
    static needsSegmentQuestion(message: string, history: ConversationMessage[] = []): boolean {
        if (!PAYMENT_INTENT.test(message)) return false;

        const transcript = [
            message,
            ...history.map((m) => String(m.content ?? '')),
        ].join('\n');

        if (GROUP_GOODNESS.test(transcript)) return false;
        return !SEGMENT_STATED.test(transcript);
    }

    static mentionsGroupGoodness(text: string): boolean {
        return GROUP_GOODNESS.test(text);
    }

    static hasRetailSegment(text: string): boolean {
        return /\bretail\b/i.test(text);
    }

    static hasSegmentStated(text: string): boolean {
        return SEGMENT_STATED.test(text);
    }

    static looksLikePaymentIntent(text: string): boolean {
        return PAYMENT_INTENT.test(text);
    }

    static getSegmentOpener(message: string): string {
        if (CARD_DECLINE_INTENT.test(message) || /\bmy card\b/i.test(message)) {
            return CARD_DECLINE_SEGMENT_OPENER;
        }
        return PAYMENT_SEGMENT_OPENER;
    }

    static isNoResultsPhrasing(response: string): boolean {
        return NO_RESULTS_PHRASING.test(response);
    }

    static violatesOpener(response: string): boolean {
        const trimmed = response.trim();
        if (!trimmed) return false;

        const firstChunk = trimmed.slice(0, 280);
        return BANNED_OPENER_PATTERNS.some((pattern) => pattern.test(firstChunk));
    }
}
