/**
 * GroupGoodnessPaymentGate
 *
 * When a Group Goodness admin asks about payment (e.g. two cards), ensures the
 * reply cites the GG payment KB article instead of hedging to support only.
 */

import { PaymentSegmentGate } from './PaymentSegmentGate';

const PAYMENT_INTENT =
    /(?:pay|payment|checkout|card|credit card|debit card|two cards?|split pay|multiple cards?)/i;

const MULTI_CARD_INTENT = /\b(two cards?|split pay|multiple cards?|pay with two)\b/i;

const PAYMENT_ARTICLE_TITLE = /payment option|payment method/i;

const OVERLY_HEDGED =
    /can't see specific payment|cannot see specific payment|can't see.*payment options through this channel|recommend contacting.*support directly.*payment/i;

type KbArticleRef = { title?: string; summary?: string; url?: string };

export class GroupGoodnessPaymentGate {
    static isGroupGoodnessPaymentQuestion(message: string): boolean {
        return PaymentSegmentGate.mentionsGroupGoodness(message) && PAYMENT_INTENT.test(message);
    }

    static isOverlyHedgedResponse(response: string): boolean {
        return OVERLY_HEDGED.test(response) || PaymentSegmentGate.isNoResultsPhrasing(response);
    }

    static citesPaymentArticle(response: string, article: KbArticleRef): boolean {
        const title = (article.title ?? '').trim();
        if (!title) return false;
        if (response.includes(title)) return true;
        const body = `${article.summary ?? ''}`.toLowerCase();
        if (body.includes('credit card') && body.includes('bank transfer')) {
            return response.toLowerCase().includes('credit card') &&
                response.toLowerCase().includes('bank transfer');
        }
        return false;
    }

    static buildResponseFromToolResult(
        message: string,
        toolResponse: Record<string, unknown>,
    ): string | null {
        if (!this.isGroupGoodnessPaymentQuestion(message)) return null;

        const article = this.findPaymentArticle(toolResponse);
        if (!article?.title) return null;

        const summary = (article.summary ?? '').replace(/\s+/g, ' ').trim();
        const methodsSentence = this.extractPaymentMethodsSentence(summary);
        const url = article.url ? `\n\nRead more: ${article.url}` : '';
        const multiCard = MULTI_CARD_INTENT.test(message);

        const lines = [
            'Happy to help with Group Goodness payment options.',
            '',
            `According to our help article "${article.title}", ${methodsSentence}`,
        ];

        if (multiCard) {
            lines.push(
                '',
                'That article describes credit card and bank transfer for Group Goodness orders — it does not describe paying with two separate cards or a split-card checkout. For that specific scenario, please contact Honest to Goodness support by phone, email, or the web forms on our website so they can confirm what is possible for your group order.',
            );
        }

        lines.push(url);
        return lines.join('\n').trim();
    }

    private static findPaymentArticle(toolResponse: Record<string, unknown>): KbArticleRef | null {
        const articles = toolResponse.articles as KbArticleRef[] | undefined;
        const fromList = articles?.find((a) => PAYMENT_ARTICLE_TITLE.test(a.title ?? ''));
        if (fromList) return fromList;

        const best = toolResponse.bestArticle as KbArticleRef | undefined;
        if (best?.title && PAYMENT_ARTICLE_TITLE.test(best.title)) return best;
        return null;
    }

    private static extractPaymentMethodsSentence(summary: string): string {
        if (/credit card.*bank transfer|bank transfer.*credit card/i.test(summary)) {
            return 'Group Goodness orders can be paid by credit card or bank transfer when you submit your order in the portal.';
        }
        if (summary.length > 0) {
            const clipped = summary.length > 220 ? `${summary.slice(0, 217).trim()}...` : summary;
            return clipped;
        }
        return 'Group Goodness orders can be paid by credit card or bank transfer when you submit your order in the portal.';
    }
}
