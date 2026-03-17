import { getLogger } from '@/lib/config/logger';

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

        logger.info(`Searching Zoho KB for: "${query}"`);

        const response = await fetch(url.toString());

        if (!response.ok) {
            logger.error(`Zoho KB search failed: ${response.status} ${response.statusText}`);
            throw new Error(`Zoho Desk API error: ${response.status}`);
        }

        const data = await response.json();

        logger.info(`Raw Zoho API response: ${JSON.stringify(data)}`);

        const articles: ZohoArticle[] = (data.data ?? []).map((item: any) => ({
            id: String(item.id ?? ''),
            title: item.title ?? '',
            summary: item.summary ?? item.answer ?? '',
            permalink: item.webUrl ?? item.permalink ?? '',
        }));

        logger.info(`Found ${articles.length} article(s) for query: "${query}"`);
        return articles;
    }
}
