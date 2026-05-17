/**
 * OrderStatusGate
 *
 * Handles order-status scenarios where the agent must not promise escalation
 * or ticket creation it cannot perform.
 */

import { ConversationMessage } from './ConversationHistoryService';

const ORDER_STATUS_PAGE = 'https://goodness.com.au/order-status/';

const SUPPORT_CHANNELS =
    'Honest to Goodness support by phone, email, or the web forms on our website';

const STUCK_PACKING_INTENT =
    /\b(in queue for packing|queue for packing|stuck in packing|still (?:in )?(?:queue|packing)|packing for (?:more than )?\d+|\d+\s*(?:business\s*)?days?.*(?:packing|packed|shipped|dispatch)|not shipped|hasn't shipped|has not shipped)\b/i;

const EXTENDED_DELAY_INTENT =
    /\b(more than|over|past|at least|for)\s*(?:two|2|three|3|four|4|five|5|\d+)\s*(?:business\s*)?days?\b/i;

const FALSE_ESCALATION_PROMISE =
    /\b(I will|I'll|we will|I can)\s+(?:then\s+)?(?:escalat|raise|log|create).*(?:ticket|case|support team)/i;

export class OrderStatusGate {
    /** "In queue for packing" with implied extended delay (e.g. 4 days). */
    static needsStuckPackingHandoff(message: string): boolean {
        if (!STUCK_PACKING_INTENT.test(message)) return false;
        return (
            EXTENDED_DELAY_INTENT.test(message) ||
            /\b(extended|long time|still|hasn't moved|not moving)\b/i.test(message)
        );
    }

    static isStuckPackingDetailsReply(message: string, history: ConversationMessage[]): boolean {
        if (!this.assistantGaveStuckPackingHandoff(history)) return false;
        return /\b(order|invoice|#?\d{4,})\b/i.test(message) || /@/.test(message);
    }

    static promisesFalseEscalation(response: string): boolean {
        return FALSE_ESCALATION_PROMISE.test(response);
    }

    static buildStuckPackingResponse(): string {
        return [
            "I'm sorry to hear your order has been in queue for packing longer than expected.",
            '',
            "I can't access live order statuses or create support tickets from here. Because it's been more than two business days, please contact " +
                `${SUPPORT_CHANNELS} so the team can investigate.`,
            '',
            `Have your order number and the email used on the order ready when you get in touch. You can also check ${ORDER_STATUS_PAGE} with those details.`,
        ].join('\n');
    }

    static buildStuckPackingDetailsReply(): string {
        return [
            "Thanks — I've noted you have your order details to hand.",
            '',
            "I still can't escalate or look up your order from here. Please contact " +
                `${SUPPORT_CHANNELS} with your order number and email so they can investigate the delay.`,
        ].join('\n');
    }

    private static assistantGaveStuckPackingHandoff(history: ConversationMessage[]): boolean {
        for (let i = history.length - 1; i >= 0; i--) {
            const msg = history[i];
            if (msg.role !== 'assistant') continue;
            const text = String(msg.content ?? '');
            return text.includes("can't access live order statuses") ||
                text.includes("can't escalate or look up your order");
        }
        return false;
    }
}
