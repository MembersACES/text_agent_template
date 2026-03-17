/**
 * ZohoDeskKBService
 *
 * Client for the Zoho Desk Knowledge Base APIs. Provides article search,
 * full-content retrieval, and category listing — all scoped to the
 * category allow-list defined in the agent config.
 */

import { getLogger } from '@/lib/config/logger';
import { settings } from '@/lib/config/settings';
import { zohoAuthService } from './ZohoAuthService';
import { zohoArticleSanitizer } from './ZohoArticleSanitizer';
import type { ZohoArticle, ZohoCategory } from './types';

const logger = getLogger('ZohoDeskKBService');

/** Maximum retry attempts on rate-limit (429) responses. */
const MAX_RETRIES = 3;

/** Base delay in ms for exponential backoff. */
const BASE_BACKOFF_MS = 1_000;

/** Cache TTL for fetched articles (15 minutes). */
const ARTICLE_CACHE_TTL_MS = 15 * 60 * 1000;

/** Maximum number of articles to keep in the in-memory cache. */
const ARTICLE_CACHE_MAX_SIZE = 200;

interface CachedArticle {
    article: ZohoArticle;
    cachedAt: number;
}

export class ZohoDeskKBService {
    private readonly orgId: string;
    private readonly baseUrl: string;
    private readonly articleCache = new Map<string, CachedArticle>();

    constructor() {
        this.orgId = settings.zohoDesk.orgId;
        const dc = settings.zohoDesk.datacenter;
        this.baseUrl = `https://desk.zoho.${dc}/api/v1`;
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * List categories under a specific knowledge-base section.
     * Useful for initial discovery and periodic refresh of allowed category IDs.
     */
    async listCategories(kbId: string): Promise<ZohoCategory[]> {
        const data = await this.request(`/kbCategories?departmentId=${encodeURIComponent(kbId)}`);
        const raw: any[] = data?.data ?? [];
        return raw.map((cat: any) => ({
            id: String(cat.id),
            name: cat.name ?? '',
            kbId,
        }));
    }

    /**
     * Fetch the full content of a single article. Results are cached
     * in memory to reduce API calls for frequently accessed articles.
     */
    async getArticle(articleId: string, kbName: string): Promise<ZohoArticle | null> {
        // Check cache
        const cached = this.articleCache.get(articleId);
        if (cached && Date.now() - cached.cachedAt < ARTICLE_CACHE_TTL_MS) {
            return cached.article;
        }

        try {
            const data = await this.request(`/articles/${encodeURIComponent(articleId)}`);
            if (!data) return null;

            const article = this.normaliseArticle(data, kbName);

            // Sanitise HTML body to plain text
            if (article.bodyText) {
                article.bodyText = zohoArticleSanitizer.sanitize(article.bodyText);
            }

            this.cacheArticle(articleId, article);
            return article;
        } catch (error) {
            logger.error(`Failed to fetch article ${articleId}: ${error}`);
            return null;
        }
    }

    // -------------------------------------------------------------------------
    // HTTP layer with auth, rate-limit handling, and retries
    // -------------------------------------------------------------------------

    private async request(path: string, attempt = 1): Promise<any> {
        const token = await zohoAuthService.getAccessToken();
        const url = `${this.baseUrl}${path}`;

        const response = await fetch(url, {
            headers: {
                Authorization: `Zoho-oauthtoken ${token}`,
                orgId: this.orgId,
            },
        });

        // Rate-limit: back off and retry
        if (response.status === 429 && attempt <= MAX_RETRIES) {
            const delay = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
            logger.warn(`Rate-limited (429) on ${path}, retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})`);
            await this.sleep(delay);
            return this.request(path, attempt + 1);
        }

        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Zoho API ${response.status} on ${path}: ${body}`);
        }

        return response.json();
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private normaliseArticle(raw: any, kbName: string): ZohoArticle {
        return {
            id: String(raw.id ?? ''),
            categoryId: String(raw.categoryId ?? raw.category?.id ?? ''),
            title: raw.title ?? '',
            snippet: raw.snippet ?? raw.summary ?? '',
            bodyText: raw.answer ?? raw.body ?? raw.content ?? '',
            tags: Array.isArray(raw.tags) ? raw.tags : [],
            lastUpdated: raw.modifiedTime ?? raw.updatedTime ?? '',
            kbName,
            visibility: raw.visibility ?? raw.status ?? 'public',
        };
    }

    /** Only keep articles from allowed categories and with public visibility. */
    private isAllowed(article: ZohoArticle, allowedCategoryIds: string[]): boolean {
        if (article.visibility && article.visibility.toLowerCase() !== 'public') {
            return false;
        }
        if (allowedCategoryIds.length > 0 && !allowedCategoryIds.includes(article.categoryId)) {
            return false;
        }
        return true;
    }

    private cacheArticle(id: string, article: ZohoArticle): void {
        // Evict oldest entries when cache is full
        if (this.articleCache.size >= ARTICLE_CACHE_MAX_SIZE) {
            const oldestKey = this.articleCache.keys().next().value;
            if (oldestKey) this.articleCache.delete(oldestKey);
        }
        this.articleCache.set(id, { article, cachedAt: Date.now() });
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

export const zohoDeskKBService = new ZohoDeskKBService();
