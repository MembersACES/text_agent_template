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
            let articles = await this.searchArticlesTraceable(query, portalId);
            let relevant = articles.length > 0 && await this.isRelevantToQuery(query, articles);

            if (portalId2) {
                if (!relevant) {
                    logger.info('Portal 1 did not answer the question, trying portal 2');
                    const articles2 = await this.searchArticlesTraceable(query, portalId2);
                    if (articles2.length > 0) {
                        articles = articles2;
                        relevant = await this.isRelevantToQuery(query, articles2);
                    }
                }
            }

            if (articles.length === 0 || !relevant) {
                return {
                    toolResponse: {
                        status: 'no_results',
                        message: `No knowledge base articles found for "${query}".`,
                    },
                    actualArgs,
                };
            }

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

    private async isRelevantToQuery(query: string, articles: { title: string; summary: string }[]): Promise<boolean> {
        if (this.hasStrongLexicalMatch(query, articles)) {
            logger.info('Relevance check passed via lexical matching');
            return true;
        }

        return this.articlesAnswerQuery(query, articles);
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

        return articles.some((article) => {
            const title = this.normalizeText(article.title);
            const summary = this.normalizeText(article.summary);
            const corpus = `${title} ${summary}`;

            // Strong signal: title contains at least one token from each keyword group.
            const titleHasAllKeywordGroups = keywordGroups.every((group) =>
                group.some((token) => this.matchesToken(title, token)),
            );
            if (titleHasAllKeywordGroups) return true;

            // Secondary signal: article text covers at least one token from each group.
            const corpusHasAllKeywordGroups = keywordGroups.every((group) =>
                group.some((token) => this.matchesToken(corpus, token)),
            );
            if (corpusHasAllKeywordGroups) return true;

            return false;
        });
    }

    private extractQueryKeywordGroups(query: string): string[][] {
        const stopWords = new Set([
            'a', 'an', 'and', 'are', 'can', 'could', 'do', 'does', 'for', 'from', 'how', 'i', 'in', 'is', 'it',
            'me', 'my', 'of', 'offer', 'on', 'or', 'please', 'the', 'to', 'we', 'what', 'when', 'where', 'with',
            'you', 'your',
        ]);

        const synonyms: Record<string, string[]> = {
            join: ['join', 'joining', 'signup', 'sign up', 'register', 'enrol', 'enroll', 'buying group'],
            click: ['click'],
            collect: ['collect', 'pickup', 'pick up'],
            goodness: ['goodness'],
            group: ['group'],
        };

        const raw = this.normalizeText(query)
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

    private async articlesAnswerQuery(query: string, articles: { title: string; summary: string }[]): Promise<boolean> {
        const articleList = articles
            .map((a, i) => `${i + 1}. ${a.title}: ${a.summary}`)
            .join('\n');

        const prompt =
            `Question: "${query}"\n\n` +
            `Articles found:\n${articleList}\n\n` +
            `Do any of these articles answer or substantially help answer the question? ` +
            `Prefer "yes" when articles explain the same concept in general (for example an introduction page that explains what something is, how to join, or how it works), even if wording differs. ` +
            `Reply with only "yes" or "no".`;

        try {
            const genAI = new GoogleGenerativeAI(settings.gemini.apiKey);
            const model = genAI.getGenerativeModel({
                model: settings.gemini.model,
                generationConfig: { maxOutputTokens: 10, temperature: 0 },
            });
            const result = await model.generateContent(prompt);
            const answer = result.response.text().trim().toLowerCase();
            logger.info(`Relevance check for portal 1 articles: "${answer}"`);
            return answer.startsWith('yes');
        } catch (err) {
            logger.warn('Relevance check failed, assuming articles are relevant', err);
            return true;
        }
    }
}
