/**
 * ComplaintsResponseGate
 *
 * Ensures order/credit complaint messages never get a cold "no article found"
 * response, and returns scenario-specific guidance (new claim vs existing follow-up).
 */

import { ConversationMessage } from './ConversationHistoryService';

export const CREDIT_REQUEST_FORM_URL =
    'https://forms.zohopublic.com/admin2553/form/ReturnsCreditForm/formperma/awlhYFHJMB1C-LHd-qUCX5ZbrW9q1OLQL1t_g-7T48Q';

const SUPPORT_CHANNELS =
    'Honest to Goodness support by phone, email, or the web forms on our website';

const NO_RESULTS_PHRASING =
    /couldn't find an article|could not find an article|no article|knowledge base lacks|kb lacks|not find.*help center|i cannot assist/i;

const GROUP_GOODNESS = /\b(group goodness|buying group|group member|group admin|group order|group cart)\b/i;

export type ComplaintScenario =
    | 'existing_claim_followup'
    | 'damaged'
    | 'missing_item'
    | 'wrong_item'
    | 'wrong_price'
    | 'generic_complaint';

const SCENARIO_PATTERNS: Array<{ scenario: ComplaintScenario; pattern: RegExp }> = [
    {
        scenario: 'existing_claim_followup',
        pattern: /follow[\s-]?up.*(credit|claim|return)|status of.*(credit|claim)|(?:already )?submitted?.*(credit|claim)|existing (credit|claim)/i,
    },
    { scenario: 'damaged', pattern: /\b(damaged|broken|crushed|leaking|arrived damaged)\b/i },
    { scenario: 'missing_item', pattern: /\b(missing item|item missing|not in (?:my|the) order|short(?:age)?|didn't receive)\b/i },
    { scenario: 'wrong_item', pattern: /\b(wrong item|incorrect item|received the wrong|sent the wrong)\b/i },
    {
        scenario: 'wrong_price',
        pattern: /\b(wrong price|overcharged|undercharged|charged (?:the )?wrong|incorrect (?:charge|amount|price)|billing (?:error|issue))\b/i,
    },
    {
        scenario: 'generic_complaint',
        pattern: /\b(return|refund|credit request|complaint|faulty|problem with my order)\b/i,
    },
];

export class ComplaintsResponseGate {
    static matches(message: string): boolean {
        return this.classify(message) !== null;
    }

    static classify(message: string, _history: ConversationMessage[] = []): ComplaintScenario | null {
        for (const { scenario, pattern } of SCENARIO_PATTERNS) {
            if (pattern.test(message)) return scenario;
        }
        return null;
    }

    /** Retail Contact & FAQs complaints — prefer portal 1 unless Group Goodness is mentioned. */
    static prefersRetailPortal(message: string): boolean {
        if (GROUP_GOODNESS.test(message)) return false;
        return this.matches(message);
    }

    static isNoResultsPhrasing(response: string): boolean {
        return NO_RESULTS_PHRASING.test(response);
    }

    /**
     * User replied with order/email after we already handed off an existing-claim follow-up.
     * We still cannot look up status — acknowledge and redirect to support with those details.
     */
    static isExistingClaimDetailsReply(message: string, history: ConversationMessage[]): boolean {
        if (!this.assistantGaveExistingClaimHandoff(history)) return false;
        return /\b(order|invoice|#?\d{4,})\b/i.test(message) || /@/.test(message);
    }

    static buildExistingClaimDetailsReply(): string {
        return [
            "Thanks — I've noted you have your order details to hand.",
            '',
            "I still can't look up claim status from here. Please pass your order number and email to " +
                `${SUPPORT_CHANNELS} so they can check your existing claim.`,
        ].join('\n');
    }

    static buildFallbackResponse(message: string, history: ConversationMessage[] = []): string | null {
        const scenario = this.classify(message, history);
        if (!scenario) return null;

        switch (scenario) {
            case 'existing_claim_followup':
                return this.buildExistingClaimResponse();
            case 'damaged':
                return this.buildDamagedResponse();
            case 'missing_item':
                return this.buildMissingItemResponse();
            case 'wrong_item':
                return this.buildWrongItemResponse();
            case 'wrong_price':
                return this.buildWrongPriceResponse();
            case 'generic_complaint':
                return this.buildGenericComplaintResponse();
            default:
                return null;
        }
    }

    private static assistantGaveExistingClaimHandoff(history: ConversationMessage[]): boolean {
        for (let i = history.length - 1; i >= 0; i--) {
            const msg = history[i];
            if (msg.role !== 'assistant') continue;
            const text = String(msg.content ?? '');
            return text.includes("can't check the status of an existing claim");
        }
        return false;
    }

    private static buildExistingClaimResponse(): string {
        return [
            "I understand you'd like to follow up on a credit request you've already submitted.",
            '',
            "I can't check the status of an existing claim from here. For an update, please contact " +
                `${SUPPORT_CHANNELS}.`,
            '',
            'When you get in touch, have your order number and the email address used on the order ready — that will help the team find your claim faster.',
        ].join('\n');
    }

    private static buildDamagedResponse(): string {
        return [
            "I'm sorry to hear your item arrived damaged — that's frustrating.",
            '',
            'You can submit a new credit or returns request using our official form:',
            '',
            CREDIT_REQUEST_FORM_URL,
            '',
            'When you submit, please report damage within 2 days of receipt and include clear photos of the damage and packaging. Claims are usually processed within about 7 business days once submitted with the required information.',
        ].join('\n');
    }

    private static buildMissingItemResponse(): string {
        return [
            "I'm sorry to hear there's a missing item in your order.",
            '',
            'You can report this using our official credit request form:',
            '',
            CREDIT_REQUEST_FORM_URL,
            '',
            'Before submitting, please check your invoice and whether the order may have been sent in split deliveries. Include your order number and the missing item details in the form. Processing is typically within about 7 business days once we have the required information.',
        ].join('\n');
    }

    private static buildWrongItemResponse(): string {
        return [
            "I'm sorry to hear you received the wrong item.",
            '',
            'You can submit a credit request using our official form:',
            '',
            CREDIT_REQUEST_FORM_URL,
            '',
            'Please include your order number, the item you received, and what you ordered. Processing is typically within about 7 business days once we have the required information.',
        ].join('\n');
    }

    private static buildWrongPriceResponse(): string {
        return [
            "I'm sorry to hear you were charged the wrong price.",
            '',
            'You can report a billing or pricing issue using our official credit request form:',
            '',
            CREDIT_REQUEST_FORM_URL,
            '',
            'Please include your order number, what you were charged, and what you expected to pay. Our team will review your submission — processing is typically within about 7 business days.',
        ].join('\n');
    }

    private static buildGenericComplaintResponse(): string {
        return [
            "I'm sorry to hear you're having an issue with your order.",
            '',
            'For a new credit or returns request, please use our official form:',
            '',
            CREDIT_REQUEST_FORM_URL,
            '',
            `If you need help with an existing claim, please contact ${SUPPORT_CHANNELS} with your order number and email address.`,
        ].join('\n');
    }
}
