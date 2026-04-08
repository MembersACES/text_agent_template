import { FunctionDeclarationsTool, SchemaType, GoogleGenerativeAI } from '@google/generative-ai';
import { getLogger } from '@/lib/config/logger';
import { settings } from '@/lib/config/settings';
import { gcsClient } from '@/lib/services/storage/GcsClient';
import { AgentTool, ToolExecutionParams, ToolExecutionResult, ToolMetadata } from './AgentTool';
import { ZohoDeskClient, ZohoArticle } from '../zoho/ZohoDeskClient';
import { traceable } from 'langsmith/traceable';

const logger = getLogger('ZohoKbToolService');

export class ZohoKbToolService implements AgentTool {
    private readonly publicClient: ZohoDeskClient;

    constructor() {
        this.publicClient = new ZohoDeskClient();
    }

    /** Zoho article search wrapped in a LangSmith traceable span. */
    private readonly searchArticlesTraceable = traceable(
        async (query: string, portalId: string): Promise<ZohoArticle[]> => {
            return this.publicClient.searchArticles(query, portalId);
        },
        { name: 'retrieve_zoho_kb_articles' },
    );

    get metadata(): ToolMetadata {
        return {
            name: 'Search Knowledge Base',
            description: 'Search Zoho Help Center articles to answer support questions',
        };
    }

    get declaration(): FunctionDeclarationsTool {
        return {
            functionDeclarations: [
                {
                    name: 'search_knowledge_base',
                    description:
                        'Search support articles and FAQs to answer the user\'s question. ' +
                        'Call this tool when the user asks a support question, needs how-to guidance, ' +
                        'or is looking for information about a product or process. ' +
                        'Always pass the user\'s actual question as the query — do NOT paraphrase or substitute generic terms.',
                    parameters: {
                        type: SchemaType.OBJECT,
                        properties: {
                            query: {
                                type: SchemaType.STRING,
                                description: 'The user\'s exact question or topic, copied verbatim from their message.',
                            },
                        },
                        required: ['query'],
                    },
                },
            ],
        };
    }

    canHandle(functionCallName: string): boolean {
        return functionCallName === 'search_knowledge_base';
    }

    async execute(params: ToolExecutionParams): Promise<ToolExecutionResult> {
        const query = (params.userMessage ?? String(params.args.query ?? '')).trim();

        if (!query) {
            logger.warn('search_knowledge_base called with empty query');
            return { toolResponse: { status: 'error', message: 'No search query provided.' } };
        }

        logger.info(`Executing search_knowledge_base with query: "${query}"`);

        const agentConfig = await gcsClient.getPromptConfig(params.agentId);
        const zohoConfig = agentConfig.config?.zohoDesk;

        const actualArgs = { query };

        const [portalId, portalId2] = zohoConfig?.publicPortalIds ?? [];

        if (!portalId) {
            return {
                toolResponse: { status: 'no_results', message: `No knowledge base articles found for "${query}".` },
                actualArgs,
            };
        }

        try {
            logger.info('Using public Zoho portal API search');
            const paymentFallbackQueries = this.getPaymentFallbackQueries(query);
            const portal1Articles = await this.searchPortalWithFallbacks(portalId, query, paymentFallbackQueries);
            const portal1Relevant = portal1Articles.length > 0
                && await this.isRelevantToQuery(query, portal1Articles, 'portal 1');
            const portal1Score = this.scoreArticleSet(query, portal1Articles);

            let portal2Articles: ZohoArticle[] = [];
            let portal2Relevant = false;
            let portal2Score = -1;

            if (portalId2) {
                logger.info('Portal 2 configured; evaluating both portals and selecting best match');
                portal2Articles = await this.searchPortalWithFallbacks(portalId2, query, paymentFallbackQueries);
                portal2Relevant = portal2Articles.length > 0
                    && await this.isRelevantToQuery(query, portal2Articles, 'portal 2');
                portal2Score = this.scoreArticleSet(query, portal2Articles);
            }

            const normalizedQuery = this.normalizeText(query);
            const preferPortal2 = normalizedQuery.includes('group goodness');
            const cardBrandIntent = /(amex|american express|visa|mastercard|paypal|apple pay|google pay)/.test(normalizedQuery);
            const portal1PriorityBoost = !preferPortal2 && cardBrandIntent ? 6 : 0;
            const portal2PriorityBoost = preferPortal2 ? 3 : 0;
            const candidates = [
                {
                    label: 'portal 1',
                    articles: portal1Articles,
                    relevant: portal1Relevant,
                    score: portal1Score + (preferPortal2 ? 0 : 1) + portal1PriorityBoost,
                },
                {
                    label: 'portal 2',
                    articles: portal2Articles,
                    relevant: portal2Relevant,
                    score: portal2Score + (preferPortal2 ? 1 : 0) + portal2PriorityBoost,
                },
            ].filter((candidate) => candidate.articles.length > 0);

            candidates.sort((a, b) => {
                if (a.relevant !== b.relevant) return a.relevant ? -1 : 1;
                if (a.score !== b.score) return b.score - a.score;
                return b.articles.length - a.articles.length;
            });

            const bestCandidate = candidates[0];
            if (!bestCandidate || !bestCandidate.relevant) {
                return {
                    toolResponse: {
                        status: 'no_results',
                        message: `No knowledge base articles found for "${query}".`,
                    },
                    actualArgs,
                };
            }

            logger.info(
                `Selected ${bestCandidate.label} with relevance=${bestCandidate.relevant} score=${bestCandidate.score} for query "${query}"`,
            );
            const articles = this.rankArticlesForQuery(query, bestCandidate.articles);

            return {
                toolResponse: {
                    status: 'success',
                    bestArticle: {
                        title: articles[0].title,
                        summary: articles[0].summary,
                        url: articles[0].permalink,
                    },
                    relatedArticles: articles.slice(1, 3).map((a: ZohoArticle) => ({
                        title: a.title,
                        summary: a.summary,
                        url: a.permalink,
                    })),
                    articles: articles.map((a: ZohoArticle) => ({
                        title: a.title,
                        summary: a.summary,
                        url: a.permalink,
                    })),
                },
                actualArgs,
            };
        } catch (error) {
            logger.error(`Zoho KB search failed for query "${query}": ${error}`);
            return {
                toolResponse: {
                    status: 'error',
                    message: 'Failed to query knowledge base articles.',
                },
                actualArgs,
            };
        }
    }

    private async isRelevantToQuery(
        query: string,
        articles: { title: string; summary: string }[],
        portalLabel: string,
    ): Promise<boolean> {
        if (this.hasStrongLexicalMatch(query, articles)) {
            logger.info(`Relevance check passed via lexical matching (${portalLabel})`);
            return true;
        }

        return this.articlesAnswerQuery(query, articles, portalLabel);
    }

    private async searchPortalWithFallbacks(
        portalId: string,
        query: string,
        fallbackQueries: string[],
    ): Promise<ZohoArticle[]> {
        const primary = await this.searchArticlesTraceable(query, portalId);

        if (fallbackQueries.length === 0) return primary;

        const primaryScore = this.scoreArticleSet(query, primary);
        const shouldTryFallbacks = primary.length === 0 || primaryScore < 6;
        if (!shouldTryFallbacks) return primary;

        logger.info(
            `Primary search appears weak for "${query}" (score=${primaryScore}); trying ${fallbackQueries.length} fallback query(ies).`,
        );

        const merged = new Map<string, ZohoArticle>();
        for (const article of primary) {
            merged.set(article.id || article.permalink || article.title, article);
        }

        for (const fallbackQuery of fallbackQueries) {
            const fallbackArticles = await this.searchArticlesTraceable(fallbackQuery, portalId);
            for (const article of fallbackArticles) {
                merged.set(article.id || article.permalink || article.title, article);
            }
        }

        const mergedArticles = Array.from(merged.values());
        return this.rankArticlesForQuery(query, mergedArticles);
    }

    private hasStrongLexicalMatch(query: string, articles: { title: string; summary: string }[]): boolean {
        const normalizedQuery = this.normalizeText(query);
        const queryIsGroupGoodness = normalizedQuery.includes('group goodness');
        if (queryIsGroupGoodness) {
            const hasGroupGoodnessArticle = articles.some((article) => {
                const corpus = this.normalizeText(`${article.title} ${article.summary}`);
                return corpus.includes('group goodness') || corpus.includes('buying group');
            });
            if (hasGroupGoodnessArticle) {
                return true;
            }
        }

        const keywordGroups = this.extractQueryKeywordGroups(query);
        if (keywordGroups.length === 0) return false;

        const requiredGroups = keywordGroups.length <= 2
            ? keywordGroups.length
            : Math.max(2, Math.ceil(keywordGroups.length * 0.6));

        return articles.some((article) => {
            const title = this.normalizeText(article.title);
            const summary = this.normalizeText(article.summary);
            const corpus = `${title} ${summary}`;

            const titleMatchCount = keywordGroups.filter((group) =>
                group.some((token) => this.matchesToken(title, token)),
            ).length;
            if (titleMatchCount >= requiredGroups) return true;

            const corpusMatchCount = keywordGroups.filter((group) =>
                group.some((token) => this.matchesToken(corpus, token)),
            ).length;
            if (corpusMatchCount >= requiredGroups) return true;

            return false;
        });
    }

    private extractQueryKeywordGroups(query: string): string[][] {
        const stopWords = new Set([
            'a', 'an', 'and', 'are', 'can', 'could', 'do', 'does', 'for', 'from', 'how', 'i', 'in', 'is', 'it',
            'me', 'my', 'of', 'offer', 'on', 'or', 'please', 'the', 'to', 'we', 'what', 'when', 'where', 'with',
            'you', 'your',
        ]);

        const shippingDeliveryCluster = [
            'delivery',
            'shipping',
            'freight',
            'postage',
            'dispatch',
            'courier',
            'ship',
            'deliver',
        ];
        const paymentCluster = [
            'pay',
            'payment',
            'payments',
            'paying',
            'paid',
            'checkout',
            'option',
            'options',
            'method',
            'methods',
            'accept',
            'accepts',
            'accepted',
            'american express',
            'amex',
            'visa',
            'mastercard',
            'paypal',
            'apple pay',
            'google pay',
        ];
        const costCluster = ['much', 'cost', 'costs', 'price', 'prices', 'fee', 'fees', 'charge', 'charges'];

        const synonyms: Record<string, string[]> = {
            join: ['join', 'joining', 'signup', 'sign up', 'register', 'enrol', 'enroll', 'buying group'],
            click: ['click'],
            collect: ['collect', 'pickup', 'pick up'],
            goodness: ['goodness'],
            group: ['group'],
            delivery: shippingDeliveryCluster,
            shipping: shippingDeliveryCluster,
            freight: shippingDeliveryCluster,
            postage: shippingDeliveryCluster,
            dispatch: shippingDeliveryCluster,
            courier: shippingDeliveryCluster,
            ship: shippingDeliveryCluster,
            deliver: shippingDeliveryCluster,
            pay: paymentCluster,
            payment: paymentCluster,
            payments: paymentCluster,
            paying: paymentCluster,
            paid: paymentCluster,
            checkout: paymentCluster,
            option: paymentCluster,
            options: paymentCluster,
            method: paymentCluster,
            methods: paymentCluster,
            accept: paymentCluster,
            accepts: paymentCluster,
            accepted: paymentCluster,
            much: costCluster,
            cost: costCluster,
            costs: costCluster,
            price: costCluster,
            prices: costCluster,
            fee: costCluster,
            fees: costCluster,
            charge: costCluster,
            charges: costCluster,
            american: ['american', 'amex'],
            amex: ['amex', 'american'],
            express: ['express', 'amex', 'american express'],
            visa: ['visa'],
            mastercard: ['mastercard', 'master'],
            paypal: ['paypal'],
            paypall: ['paypal'],
            apple: ['apple'],
            applepay: ['apple', 'pay', 'apple pay'],
            google: ['google'],
            googlepay: ['google', 'pay', 'google pay'],
        };

        const normalizedQuery = this.normalizeText(query)
            .replace(/\bamerican express\b/g, 'amex');

        const raw = normalizedQuery
            .split(/\s+/)
            .filter(Boolean)
            .filter((token) => !stopWords.has(token));

        // Deduplicate while preserving order.
        const deduped: string[] = [];
        for (const token of raw) {
            if (!deduped.includes(token)) deduped.push(token);
        }

        // Build alternative token groups for each keyword (any one token in a group may match).
        return deduped.map((token) => {
            const group = synonyms[token] ?? [token];
            const seen = new Set<string>();
            const normalizedGroup: string[] = [];
            for (const candidate of group) {
                const normalized = this.normalizeText(candidate);
                if (normalized && !seen.has(normalized)) {
                    seen.add(normalized);
                    normalizedGroup.push(normalized);
                }
            }
            return normalizedGroup;
        }).filter((group) => group.length > 0);
    }

    private getPaymentFallbackQueries(query: string): string[] {
        const normalized = this.normalizeText(query);
        const looksLikePaymentIntent = /(pay|payment|method|option|checkout|amex|american express|visa|mastercard|paypal|apple pay|google pay)/.test(normalized);
        if (!looksLikePaymentIntent) return [];

        const fallbacks: string[] = ['payment options', 'payment methods'];

        if (/(amex|american express)/.test(normalized)) {
            fallbacks.push('what payment options you offer', 'american express payment');
        }
        if (/apple pay/.test(normalized)) {
            fallbacks.push('what payment options you offer', 'apple pay payment');
        }
        if (/paypal/.test(normalized)) {
            fallbacks.push('what payment options you offer', 'paypal payment');
        }

        return Array.from(new Set(fallbacks));
    }

    private normalizeText(text: string): string {
        return text
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private matchesToken(text: string, token: string): boolean {
        if (!token) return false;
        if (token.includes(' ')) {
            return text.includes(token);
        }
        return text.split(' ').includes(token);
    }

    private async articlesAnswerQuery(
        query: string,
        articles: { title: string; summary: string }[],
        portalLabel: string,
    ): Promise<boolean> {
        const articleList = articles
            .map((a, i) => `${i + 1}. ${a.title}: ${a.summary}`)
            .join('\n');

        const prompt =
            `Question: "${query}"\n\n` +
            `Articles found:\n${articleList}\n\n` +
            `Do any of these articles answer or substantially help answer the question?\n` +
            `- Reply "yes" if wording differs but the topic matches (e.g. "delivery" vs "shipping" or "freight" for costs; "pay" vs "payment" or "checkout").\n` +
            `- Reply "yes" for short follow-ups about a card or method (e.g. "American Express", "Visa") if an article lists that method among accepted payments.\n` +
            `- Prefer "yes" when an article explains the same concept in general, even if the title uses different words.\n` +
            `Reply with only "yes" or "no".`;

        try {
            const genAI = new GoogleGenerativeAI(settings.gemini.apiKey);
            const model = genAI.getGenerativeModel({
                model: settings.gemini.model,
                generationConfig: { maxOutputTokens: 10, temperature: 0 },
            });
            const result = await model.generateContent(prompt);
            const answer = result.response.text().trim().toLowerCase();
            logger.info(`Relevance check for ${portalLabel} articles: "${answer}"`);

            if (answer.startsWith('yes')) return true;
            if (answer.startsWith('no')) return false;

            const fallbackScore = this.scoreArticleSet(query, articles);
            logger.warn(
                `Ambiguous relevance response for ${portalLabel}; fallback lexical score=${fallbackScore}.`,
            );
            return fallbackScore >= 4;
        } catch (err) {
            logger.warn('Relevance check failed, assuming articles are relevant', err);
            return true;
        }
    }

    private rankArticlesForQuery(query: string, articles: ZohoArticle[]): ZohoArticle[] {
        return [...articles].sort((a, b) => this.scoreArticle(query, b) - this.scoreArticle(query, a));
    }

    private scoreArticleSet(query: string, articles: { title: string; summary: string }[]): number {
        if (articles.length === 0) return 0;
        const top3 = articles.slice(0, 3);
        return top3.reduce((sum, article) => sum + this.scoreArticle(query, article), 0);
    }

    private scoreArticle(query: string, article: { title: string; summary: string }): number {
        const groups = this.extractQueryKeywordGroups(query);
        if (groups.length === 0) return 0;

        const title = this.normalizeText(article.title);
        const summary = this.normalizeText(article.summary);
        const queryNorm = this.normalizeText(query);
        const fullText = `${title} ${summary}`;

        const titleMatches = groups.filter((group) => group.some((token) => this.matchesToken(title, token))).length;
        const bodyMatches = groups.filter((group) => group.some((token) => this.matchesToken(fullText, token))).length;

        let score = titleMatches * 3 + bodyMatches;

        if (queryNorm && title.includes(queryNorm)) score += 4;

        const paymentIntent = /(pay|payment|amex|visa|mastercard|paypal|apple|google|option|method|accept)/.test(queryNorm);
        if (paymentIntent) {
            if (/(pay|payment|checkout|visa|mastercard|amex|paypal|apple pay|google pay)/.test(fullText)) score += 3;
        }

        const shippingIntent = /(deliver|shipping|freight|postage|courier|dispatch|ship)/.test(queryNorm);
        if (shippingIntent) {
            if (/(deliver|shipping|freight|postage|courier|dispatch|ship)/.test(fullText)) score += 3;
        }

        return score;
    }
}
