/**
 * KbSearchQueryResolver
 *
 * When the customer answers a clarification question (retail/wholesale,
 * weight, postcode) after the assistant asked for segment/shipping details,
 * resolves the KB search back to the original question instead of searching
 * the literal follow-up string.
 */

import { ConversationMessage } from './ConversationHistoryService';

const SEGMENT_ONLY_REPLY =
    /^(retail|wholesale|trade)(\s+customer)?[!.?\s]*$/i;

const SEGMENT_LABEL = /\b(retail|wholesale|trade)\b/i;

const CLARIFICATION_SIGNALS =
    /\b(postcode|post\s*code|\d{4}\b|kg|kilo|weight|order\s+weight)\b/i;

const ASSISTANT_CLARIFICATION_ASK = [
    /\b(retail|wholesale)\b.*\b(retail|wholesale)\b/i,
    /whether you(?:'re| are) a retail or wholesale/i,
    /retail or wholesale customer/i,
    /(postcode|weight).*(retail|wholesale)|(retail|wholesale).*(postcode|weight)/i,
    /free shipping eligibility depends on these factors/i,
    /approximate weight of your order/i,
    /specific .* postcode/i,
];

export interface SegmentFollowUpContext {
    /** Customer's follow-up message (may include segment + weight + postcode). */
    segmentAnswer: string;
    /** Retail | wholesale | trade when detected. */
    segmentLabel: string | null;
    /** Earlier user question (e.g. free shipping to Melbourne). */
    originalQuestion: string;
    /** KB search query built from original question + follow-up facts. */
    enrichedSearchQuery: string;
}

export class KbSearchQueryResolver {
    static resolveSearchQuery(message: string, history: ConversationMessage[] = []): string {
        const followUp = this.getClarificationFollowUp(message, history);
        if (followUp) return followUp.enrichedSearchQuery;
        return message.trim();
    }

    static getSegmentFollowUp(
        message: string,
        history: ConversationMessage[] = [],
    ): SegmentFollowUpContext | null {
        return this.getClarificationFollowUp(message, history);
    }

    static getClarificationFollowUp(
        message: string,
        history: ConversationMessage[] = [],
    ): SegmentFollowUpContext | null {
        const trimmed = message.trim();
        if (!trimmed || !this.assistantAskedClarification(history)) return null;
        if (!this.isClarificationFollowUpMessage(trimmed)) return null;

        const originalQuestion = this.findPriorUserQuestion(history);
        if (!originalQuestion) return null;

        return {
            segmentAnswer: trimmed,
            segmentLabel: this.extractSegmentLabel(trimmed),
            originalQuestion,
            enrichedSearchQuery: this.buildEnrichedSearchQuery(originalQuestion, trimmed),
        };
    }

    static buildTurn2Instruction(followUp: SegmentFollowUpContext): string {
        const segment = followUp.segmentLabel ?? 'the segment they stated';
        const shipping = /(ship|shipping|freight|deliver|postcode|melbourne|free delivery)/i.test(
            `${followUp.originalQuestion} ${followUp.segmentAnswer}`,
        );
        const payment = /(pay|payment|paypal|visa|mastercard|amex|apple pay|card)/i.test(
            followUp.originalQuestion,
        );

        const lines = [
            'Clarification follow-up policy:',
            `- The customer is answering your earlier clarification request, not asking a new topic.`,
            `- Their follow-up: "${followUp.segmentAnswer}"`,
            `- Their original question to answer: "${followUp.originalQuestion}"`,
            `- Treat them as a ${segment} customer and apply facts they gave (weight, postcode, etc.).`,
            `- Do NOT search or answer about "${followUp.segmentAnswer}" as a standalone topic.`,
        ];

        if (shipping) {
            lines.push(
                '- Use the free-shipping / shipping articles for this segment. Under 24 kg and minimum spend by postcode are the usual retail rules when the article says so.',
                '- Give a direct eligibility answer for their postcode and weight when the article supports it. Do NOT say the knowledge base lacks information when status is "success".',
            );
        } else if (payment) {
            lines.push(
                '- List accepted payment methods for this segment from the article. Do NOT say the KB is silent when status is "success".',
            );
        } else {
            lines.push(
                '- Answer the original question using the retrieved articles for this segment.',
            );
        }

        return lines.join('\n');
    }

    private static isClarificationFollowUpMessage(message: string): boolean {
        if (SEGMENT_ONLY_REPLY.test(message)) return true;

        const hasSegment = SEGMENT_LABEL.test(message);
        const hasClarification = CLARIFICATION_SIGNALS.test(message);

        if (hasSegment && hasClarification) return true;
        if (hasSegment && message.length < 100) return true;

        // Details-only reply after assistant asked for weight/postcode (e.g. "10kg, 3000")
        if (
            hasClarification &&
            message.length < 180 &&
            !/^(how|what|when|where|why|can|do|does|is|are)\s/i.test(message)
        ) {
            return true;
        }

        return false;
    }

    private static isFollowUpAnswerContent(content: string): boolean {
        return this.isClarificationFollowUpMessage(content.trim());
    }

    private static extractSegmentLabel(message: string): string | null {
        const match = message.match(/\b(retail|wholesale|trade)\b/i);
        return match ? match[1].toLowerCase() : null;
    }

    private static buildEnrichedSearchQuery(originalQuestion: string, followUp: string): string {
        const parts: string[] = [originalQuestion];

        const segment = this.extractSegmentLabel(followUp);
        if (segment) parts.push(segment);

        const postcode = followUp.match(/\b(\d{4})\b/);
        if (postcode) parts.push(`postcode ${postcode[1]}`);

        const weight = followUp.match(/\b(\d+)\s*(?:kg|kilograms?)\b/i);
        if (weight) parts.push(`${weight[1]} kg`);

        if (/free\s+ship|shipping|delivery/i.test(originalQuestion)) {
            parts.push('free shipping');
        }

        return parts.join(' ').replace(/\s+/g, ' ').trim();
    }

    private static assistantAskedClarification(history: ConversationMessage[]): boolean {
        for (let i = history.length - 1; i >= 0; i--) {
            const msg = history[i];
            if (msg.role !== 'assistant') continue;
            const text = String(msg.content ?? '');
            return ASSISTANT_CLARIFICATION_ASK.some((pattern) => pattern.test(text));
        }
        return false;
    }

    private static findPriorUserQuestion(history: ConversationMessage[]): string | null {
        for (let i = history.length - 1; i >= 0; i--) {
            const msg = history[i];
            if (msg.role !== 'user') continue;
            const content = String(msg.content ?? '').trim();
            if (!content || this.isFollowUpAnswerContent(content)) continue;
            return content;
        }
        return null;
    }
}
