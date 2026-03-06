import { FunctionDeclarationsTool, SchemaType } from '@google/generative-ai';
import { getLogger } from '@/lib/config/logger';
import { AgentTool, ToolExecutionParams, ToolExecutionResult, ToolMetadata } from './AgentTool';
import { ZohoDeskClient } from '../zoho/ZohoDeskClient';

const logger = getLogger('ZohoKbToolService');

export class ZohoKbToolService implements AgentTool {
    private readonly client: ZohoDeskClient;

    constructor() {
        this.client = new ZohoDeskClient();
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
                                description:
                                    'The search query to use when looking up articles. ' +
                                    'Use concise keywords that describe what the user needs help with.',
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
            return {
                toolResponse: { status: 'error', message: 'No search query provided.' },
            };
        }

        logger.info(`Executing search_knowledge_base with query: "${query}"`);

        const articles = await this.client.searchArticles(query);

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
