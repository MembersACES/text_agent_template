import { FunctionDeclarationsTool, SchemaType } from '@google/generative-ai';
import { getLogger } from '@/lib/config/logger';
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
                        'Search the company knowledge base for help articles, FAQs, and documentation. ' +
                        'Call this tool when the user asks a how-to question, needs support information, ' +
                        'or is looking for guidance on a product or process.',
                    parameters: {
                        type: SchemaType.OBJECT,
                        properties: {
                            query: {
                                type: SchemaType.STRING,
                                description: 'Keywords describing what the user needs help with.',
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

        // Use the OAuth-authenticated service if the agent has zohoConfig
        const agentConfig = await gcsClient.getPromptConfig(params.agentId);
        const zohoConfig = (agentConfig as any).config?.zohoDesk;

        if (zohoConfig?.enabled) {
            logger.info('Using OAuth Zoho KB search');
            const { kbContext } = await this.contextService.buildZohoDeskKBContext(query, zohoConfig);
            if (kbContext) {
                return { toolResponse: { status: 'success', content: kbContext } };
            }
            logger.info('OAuth search returned no results, falling back to public API');
        }

        // Fallback: public portal API
        logger.info('Using public Zoho portal API search');
        const articles = await this.publicClient.searchArticles(query);

        if (articles.length === 0) {
            return {
                toolResponse: {
                    status: 'no_results',
                    message: `No knowledge base articles found for "${query}".`,
                },
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
        };
    }
}
