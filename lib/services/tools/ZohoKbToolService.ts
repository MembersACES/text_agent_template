import { FunctionDeclarationsTool, SchemaType, GoogleGenerativeAI } from '@google/generative-ai';
import { getLogger } from '@/lib/config/logger';
import { settings } from '@/lib/config/settings';
import { gcsClient } from '@/lib/services/storage/GcsClient';
import { AgentTool, ToolExecutionParams, ToolExecutionResult, ToolMetadata } from './AgentTool';
import { ContextService } from '../chat/ContextService';
import { ZohoDeskClient } from '../zoho/ZohoDeskClient';

const logger = getLogger('ZohoKbToolService');

export class ZohoKbToolService implements AgentTool {
    private readonly publicClient: ZohoDeskClient;

    constructor(private readonly contextService: ContextService) {
        this.publicClient = new ZohoDeskClient();
    }

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
        const zohoConfig = (agentConfig as any).config?.zohoDesk;

        const actualArgs = { query };

        if (zohoConfig?.enabled) {
            logger.info('Using OAuth Zoho KB search');
            const { kbContext } = await this.contextService.buildZohoDeskKBContext(query, zohoConfig);
            if (kbContext) {
                return { toolResponse: { status: 'success', content: kbContext }, actualArgs };
            }
            logger.info('OAuth search returned no results, falling back to public API');
        }

        logger.info('Using public Zoho portal API search');
        let articles = await this.publicClient.searchArticles(query, settings.zohoDesk.portalId);

        if (settings.zohoDesk.portalId2) {
            const relevant = articles.length > 0 && await this.articlesAnswerQuery(query, articles);
            if (!relevant) {
                logger.info('Portal 1 did not answer the question, trying portal 2');
                const articles2 = await this.publicClient.searchArticles(query, settings.zohoDesk.portalId2);
                if (articles2.length > 0) {
                    articles = articles2;
                }
            }
        }

        if (articles.length === 0) {
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
                articles: articles.map((a) => ({
                    title: a.title,
                    summary: a.summary,
                    url: a.permalink,
                })),
            },
            actualArgs,
        };
    }

    private async articlesAnswerQuery(query: string, articles: { title: string; summary: string }[]): Promise<boolean> {
        const articleList = articles
            .map((a, i) => `${i + 1}. ${a.title}: ${a.summary}`)
            .join('\n');

        const prompt =
            `Question: "${query}"\n\n` +
            `Articles found:\n${articleList}\n\n` +
            `Do any of these articles appear to answer the question? Reply with only "yes" or "no".`;

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
