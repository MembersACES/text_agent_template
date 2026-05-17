/**
 * ProductAvailabilityGate
 *
 * Ensures stock / availability questions never get the cold global "no article found"
 * response when KB search misses or relevance fails.
 */

const SUPPORT_CHANNELS =
    'Honest to Goodness support by phone, email, or the web forms on our website';

const NO_RESULTS_PHRASING =
    /couldn't find an article|could not find an article|no article|knowledge base lacks|kb lacks|not find.*help center|i cannot assist/i;

/** Order-tracking intents handled by OrderStatusGate — not product catalogue stock. */
const ORDER_STATUS_EXCLUDE =
    /\b(where is my order|track(?:ing)? my order|order status|in queue for packing|queue for packing|has(?:n't| not) shipped|dispatch(?:ed)?)\b/i;

const RESTOCK_PATTERN =
    /\b(back in stock|restock|re-stock|available again|when will\b.+\b(?:be\s+)?(?:back\s+)?(?:in stock|available))\b/i;

const IN_STOCK_PATTERN =
    /\b(in stock|out of stock|do you have\b.+\b(?:in stock|available)|is\s+.+\s+available)\b/i;

const PRODUCT_EXTRACT_PATTERNS: RegExp[] = [
    /\bdo you have\s+(.+?)\s+in\s+stock\b/i,
    /\bis\s+(.+?)\s+(?:in stock|available)\b/i,
    /\bwhen will\s+(.+?)\s+be\s+back\s+in\s+stock\b/i,
    /\bwhen (?:is|will)\s+(.+?)\s+(?:be\s+)?(?:available|back)\b/i,
];

export type ProductAvailabilityScenario = 'restock_eta' | 'in_stock_check';

export class ProductAvailabilityGate {
    static matches(message: string): boolean {
        return this.classify(message) !== null;
    }

    static classify(message: string): ProductAvailabilityScenario | null {
        if (ORDER_STATUS_EXCLUDE.test(message)) return null;
        if (RESTOCK_PATTERN.test(message)) return 'restock_eta';
        if (IN_STOCK_PATTERN.test(message)) return 'in_stock_check';
        return null;
    }

    static extractProductHint(message: string): string | null {
        for (const pattern of PRODUCT_EXTRACT_PATTERNS) {
            const match = message.match(pattern);
            if (!match?.[1]) continue;
            const hint = match[1].trim().replace(/^(the|a|an)\s+/i, '');
            if (hint.length > 2 && hint.length < 120) return hint;
        }
        return null;
    }

    static isNoResultsPhrasing(response: string): boolean {
        return NO_RESULTS_PHRASING.test(response);
    }

    /** Model answered correctly on substance but opened cold (no brief empathy). */
    static isColdAvailabilityResponse(response: string): boolean {
        if (!/\b(cannot see|can't see|do not have|don't have)\b.*\blive stock\b/i.test(response)) {
            return false;
        }
        return !/\b(happy to help|let me help|sorry|understand|frustrat|point you)\b/i.test(response);
    }

    static buildFallbackResponse(message: string): string | null {
        const scenario = this.classify(message);
        if (!scenario) return null;
        return scenario === 'restock_eta'
            ? this.buildRestockResponse(message)
            : this.buildInStockResponse(message);
    }

    private static buildInStockResponse(message: string): string {
        const product = this.extractProductHint(message);
        const productPhrase = product ? ` for ${product}` : '';

        return [
            'Happy to help you find out about availability.',
            '',
            `I can't see live stock information${productPhrase} in this channel.`,
            '',
            `For current availability, please contact ${SUPPORT_CHANNELS}. It helps to have the SKU or exact product name and pack size ready when you get in touch.`,
        ].join('\n');
    }

    private static buildRestockResponse(message: string): string {
        const product = this.extractProductHint(message);
        const productPhrase = product ? ` for ${product}` : '';

        return [
            'Happy to help you find out about availability.',
            '',
            `I can't see live stock levels or restock dates${productPhrase} from here — inventory changes often and the team can confirm timing.`,
            '',
            `Please contact ${SUPPORT_CHANNELS}. It helps to have the SKU or exact product name and pack size ready when you get in touch.`,
        ].join('\n');
    }
}
