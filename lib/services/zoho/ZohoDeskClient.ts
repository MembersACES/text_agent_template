import { getLogger } from '@/lib/config/logger';
import { redactPII } from '@/lib/services/privacy/redact';

const logger = getLogger('ZohoDeskClient');

const BASE_URL = 'https://desk.zoho.com/portal/api';
const MAX_RESULTS = 5;

export interface ZohoArticle {
    id: string;
    title: string;
    summary: string;
    permalink: string;
}

export class ZohoDeskClient {
    async searchArticles(query: string, portalId: string): Promise<ZohoArticle[]> {
        const url = new URL(`${BASE_URL}/kbArticles/search`);
        url.searchParams.set('portalId', portalId);
        url.searchParams.set('searchStr', query);
        url.searchParams.set('limit', String(MAX_RESULTS));

        // query is the customer's raw words (email + order# when tracking is off) — redact.
        logger.info(`Searching Zoho KB for: "${redactPII(query)}"`);

        const response = await fetch(url.toString());

        if (!response.ok) {
            logger.error(`Zoho KB search failed: ${response.status} ${response.statusText}`);
            throw new Error(`Zoho Desk API error: ${response.status}`);
        }

        const data = await response.json();

        // Was: full JSON dump (could contain PII echoed back). Log count + titles only.
        // Array.isArray (not `?? []`) so a 200 with a non-array `data` can't throw
        // in .map — the old JSON.stringify never threw, so keep that soft-fail.
        const rawResults: Array<Record<string, unknown>> = Array.isArray(data.data) ? data.data : [];
        logger.info(`Zoho API returned ${rawResults.length} article(s): ${rawResults.map((a) => String(a.title ?? '')).filter(Boolean).join(' | ') || '(none)'}`);

        const articles: ZohoArticle[] = rawResults.map((item) => ({
            id: String(item.id ?? ''),
            title: String(item.title ?? ''),
            summary: String(item.summary ?? item.answer ?? ''),
            permalink: String(item.webUrl ?? item.permalink ?? ''),
        }));

        logger.info(`Found ${articles.length} article(s) for query: "${redactPII(query)}"`);
        return articles;
    }
}
