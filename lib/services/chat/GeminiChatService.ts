/**
 * GeminiChatService
 *
 * Orchestrator for the chat pipeline. Coordinates the other services and
 * drives the two-turn Gemini function-calling flow:
 *
 *   Turn 1 → send the user prompt (+ tool declarations for this agent)
 *   Tool call? → find the matching AgentTool, execute it, send the result back
 *   Turn 2 → Gemini writes the final human-readable response
 *
 * Depends on:
 *  - AgentToolRegistry           → resolves which tools are available per agent
 *  - ConversationHistoryService  → formats history
 *  - ContextService              → builds KB / file context
 *  - getSystemSettings / getPromptTemplate → agent prompt config
 *  - extractJsonFromResponse     → parses inline JSON from normal responses
 */

import { GoogleGenerativeAI, Content } from '@google/generative-ai';
import { traceable } from 'langsmith/traceable';
import { getLogger } from '@/lib/config/logger';
import { settings } from '@/lib/config/settings';
import { gcsClient } from '@/lib/services/storage/GcsClient';
import { extractJsonFromResponse } from '@/lib/utils/JsonParser';
import { AgentTool } from '../tools/AgentTool';
import { AgentToolRegistry } from '../tools/AgentToolRegistry';
import { ConversationHistoryService, ConversationMessage } from './ConversationHistoryService';
import { ContextService } from './ContextService';

const logger = getLogger('GeminiChatService');
const NO_RESULTS_FALLBACK_MESSAGE = "I couldn't find an article that directly answers this in the help center. You can still contact Honest to Goodness support via phone, email or web forms if you'd like more help.";
const KB_UNAVAILABLE_FALLBACK_MESSAGE = "I'm having trouble reaching the help center right now. Please try again in a moment or contact support via phone, email or web forms.";
const HEALTH_FORCE_NO_RESULTS_TOKEN = '__HEALTH_FORCE_NO_RESULTS__';
const HEALTH_FORCE_ERROR_TOKEN = '__HEALTH_FORCE_ERROR__';
const KB_SUCCESS_INSTRUCTION = [
    'Tool result policy:',
    '- If tool status is "success", answer using bestArticle first and optionally relatedArticles.',
    '- Do not output no-results or KB-unavailable fallback text when status is "success".',
    '- Use no-results fallback only for status "no_results".',
].join('\n');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ChatParams {
    message: string;
    conversationHistory?: ConversationMessage[];
    useKnowledgeBase?: boolean;
    agentId?: string;
    uploadedFiles?: any[];
}

export interface ChatResponse {
    response: string;
    sources?: Array<{ id: number; text: string; similarity: number; source: string }>;
    extractedData?: any;
    generateReport?: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class GeminiChatService {
    private static readonly MODEL_ID = 'gemini-2.5-flash';
    private static readonly MAX_OUTPUT_TOKENS = 65_536;

    private readonly historyService: ConversationHistoryService;
    private readonly contextService: ContextService;

    constructor() {
        this.historyService = new ConversationHistoryService();
        this.contextService = new ContextService();
    }

    // -------------------------------------------------------------------------
    // Public entry point — root LangSmith trace
    // -------------------------------------------------------------------------

    readonly chat = traceable(
        async (params: ChatParams): Promise<ChatResponse> => {
            const {
                message,
                conversationHistory = [],
                useKnowledgeBase = false,
                agentId,
                uploadedFiles = [],
            } = params;

            if (message.startsWith(HEALTH_FORCE_NO_RESULTS_TOKEN)) {
                logger.info('Health check forced no_results fallback path');
                return { response: NO_RESULTS_FALLBACK_MESSAGE };
            }
            if (message.startsWith(HEALTH_FORCE_ERROR_TOKEN)) {
                logger.info('Health check forced error fallback path');
                return { response: KB_UNAVAILABLE_FALLBACK_MESSAGE };
            }

            const tools = await AgentToolRegistry.getTools(agentId, this.contextService);

            // If a tool handles KB search (e.g. Zoho), skip the GCS vector retrieval —
            // the model will call the tool instead.
            const hasKbTool = tools.some((t) => t.canHandle('search_knowledge_base'));

            const historyContext = this.historyService.format(conversationHistory);
            const fileContext = this.contextService.buildFileContext(uploadedFiles);
            const agentPrompt = await this.buildAgentPrompt(agentId);

            const initialPrompt = await this.buildInitialPrompt({
                message,
                agentPrompt,
                historyContext,
                fileContext,
                useKnowledgeBase: useKnowledgeBase && !hasKbTool,
                agentId,
            });

            this.logPromptPreview(initialPrompt);

            const model = this.createModel(tools);
            const contents: Content[] = [{ role: 'user', parts: [{ text: initialPrompt }] }];

            // Turn 1: send prompt
            const firstResult = await this.generateTurn1(model, contents);
            const firstResponse = firstResult.response;

            // Detect tool call from any registered tool
            const functionCallPart = firstResponse.candidates?.[0]?.content?.parts?.find(
                (part: any) => part.functionCall && tools.some((t) => t.canHandle(part.functionCall.name)),
            );

            if (functionCallPart?.functionCall) {
                const tool = tools.find((t) => t.canHandle(functionCallPart.functionCall.name))!;
                return this.handleToolCall({
                    functionCallPart,
                    tool,
                    model,
                    contents,
                    uploadedFiles,
                    agentId,
                    useKnowledgeBase,
                    userMessage: message,
                });
            }

            if (hasKbTool) {
                logger.warn('Model did not call knowledge-base tool; returning KB unavailable fallback.');
                return { response: KB_UNAVAILABLE_FALLBACK_MESSAGE };
            }

            return this.handleNormalResponse(firstResponse.text(), message);
        },
        { name: 'chat', run_type: 'chain' },
    );

    // -------------------------------------------------------------------------
    // Turn 1 prompt builder
    // -------------------------------------------------------------------------

    private async buildInitialPrompt(options: {
        message: string;
        agentPrompt: string;
        historyContext: string;
        fileContext: string;
        useKnowledgeBase: boolean;
        agentId?: string;
    }): Promise<string> {
        const { message, agentPrompt, historyContext, fileContext, useKnowledgeBase, agentId } = options;

        if (useKnowledgeBase) {
            return this.buildKnowledgeBasePrompt({ message, agentPrompt, historyContext, fileContext, agentId });
        }

        if (fileContext) {
            return this.buildFilesOnlyPrompt({ message, agentPrompt, historyContext, fileContext });
        }

        return agentPrompt
            .replace('{{context}}', historyContext || '')
            .replace('{{message}}', message);
    }

    private async buildKnowledgeBasePrompt(options: {
        message: string;
        agentPrompt: string;
        historyContext: string;
        fileContext: string;
        agentId?: string;
    }): Promise<string> {
        const { message, agentPrompt, historyContext, fileContext, agentId } = options;

        const { kbContext, fileListContext } = await this.retrieveKBContext(message, agentId);

        const contextParts = [
            historyContext,
            fileListContext,
            kbContext ? `RELEVANT CONTENT FROM KNOWLEDGE BASE:\n${kbContext}` : '',
            fileContext ? `UPLOADED FILES FOR THIS CONVERSATION:\n${fileContext}` : '',
        ];

        const combinedContext = this.contextService.combineParts(contextParts);

        return agentPrompt
            .replace('{{context}}', combinedContext)
            .replace('{{message}}', message);
    }

    private buildFilesOnlyPrompt(options: {
        message: string;
        agentPrompt: string;
        historyContext: string;
        fileContext: string;
    }): string {
        const { message, agentPrompt, historyContext, fileContext } = options;
        const combinedContext = this.contextService.combineParts([
            historyContext,
            `UPLOADED FILES FOR THIS CONVERSATION:\n${fileContext}`,
        ]);
        return agentPrompt
            .replace('{{context}}', combinedContext)
            .replace('{{message}}', message);
    }

    // -------------------------------------------------------------------------
    // Model factory
    // -------------------------------------------------------------------------

    private createModel(tools: AgentTool[]): ReturnType<GoogleGenerativeAI['getGenerativeModel']> {
        const genAI = new GoogleGenerativeAI(settings.gemini.apiKey);
        const config: Parameters<typeof genAI.getGenerativeModel>[0] = {
            model: GeminiChatService.MODEL_ID,
            generationConfig: {
                maxOutputTokens: GeminiChatService.MAX_OUTPUT_TOKENS,
                temperature: 0.1,
            },
        };

        if (tools.length > 0) {
            (config as any).tools = tools.map((t) => t.declaration);
            logger.info(`Attached ${tools.length} tool(s) to model`);
        }

        return genAI.getGenerativeModel(config);
    }

    // -------------------------------------------------------------------------
    // Two-turn tool-call handler
    // -------------------------------------------------------------------------

    private async handleToolCall(options: {
        functionCallPart: any;
        tool: AgentTool;
        model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>;
        contents: Content[];
        uploadedFiles: any[];
        agentId?: string;
        useKnowledgeBase: boolean;
        userMessage: string;
    }): Promise<ChatResponse> {
        const { functionCallPart, tool, model, contents, uploadedFiles, agentId, useKnowledgeBase, userMessage } = options;
        const functionName: string = functionCallPart.functionCall.name;
        const args = functionCallPart.functionCall.args as Record<string, unknown>;

        logger.info(`Model invoked "${functionName}" with args: ${JSON.stringify(args)}`);

        const result = await tool.execute({
            functionCallName: functionName,
            args,
            uploadedFiles,
            agentId,
            useKnowledgeBase,
            userMessage,
        });

        // Turn 2: return the tool result to the model so it can write a human response.
        // If the tool overrides args (e.g. used userMessage instead of model-generated query),
        // use those so Turn 2 sees a consistent picture of what was searched and found.
        const recordedFunctionCall = result.actualArgs
            ? { ...functionCallPart.functionCall, args: result.actualArgs }
            : functionCallPart.functionCall;

        const turn2Contents: Content[] = [
            ...contents,
            { role: 'model', parts: [{ functionCall: recordedFunctionCall }] },
            {
                role: 'user',
                parts: functionName === 'search_knowledge_base'
                    ? [
                        { text: KB_SUCCESS_INSTRUCTION },
                        { functionResponse: { name: functionName, response: result.toolResponse } },
                    ]
                    : [{ functionResponse: { name: functionName, response: result.toolResponse } }],
            },
        ];

        const secondResult = await this.generateTurn2(model, turn2Contents);
        const status = result.toolResponse.status;

        if (functionName === 'search_knowledge_base') {
            if (status === 'no_results') {
                return { response: NO_RESULTS_FALLBACK_MESSAGE };
            }
            if (status === 'error') {
                return { response: KB_UNAVAILABLE_FALLBACK_MESSAGE };
            }
        }

        const responseText = this.cleanResponseText(secondResult.response.text());
        if (
            functionName === 'search_knowledge_base' &&
            status === 'success' &&
            this.isInvalidSuccessKbResponse(responseText)
        ) {
            logger.warn('Invalid KB success response detected; replacing with best article template.');
            return { response: this.buildBestArticleResponse(result.toolResponse) };
        }

        const reportSuffix = result.generateReport === undefined
            ? ''
            : ` — generateReport: ${result.generateReport}`;
        logger.info(`Tool call "${functionName}" completed${reportSuffix}`);

        return {
            response: responseText,
            ...(result.extractedData && { extractedData: result.extractedData }),
            ...(result.generateReport && { generateReport: result.generateReport }),
        };
    }

    // -------------------------------------------------------------------------
    // Normal response handler
    // -------------------------------------------------------------------------

    private handleNormalResponse(rawText: string, originalMessage: string): ChatResponse {
        const extractedJson = extractJsonFromResponse(rawText);
        let cleanedResponse = this.cleanResponseText(rawText);
        let extractedData: any = null;
        let generateReport = false;

        if (extractedJson.length > 0) {
            extractedData = extractedJson.length === 1 ? extractedJson[0] : extractedJson;
            cleanedResponse = this.removeJsonBlocks(rawText);
        }

        // Check for explicit report request in the original user message
        if (
            originalMessage.toLowerCase().includes('generate') &&
            originalMessage.toLowerCase().includes('report')
        ) {
            generateReport = true;
        }

        return {
            response: cleanedResponse,
            ...(extractedData && { extractedData }),
            ...(generateReport && { generateReport }),
        };
    }

    // -------------------------------------------------------------------------
    // Response text utilities
    // -------------------------------------------------------------------------

    /** Strip [GENERATE_REPORT] markers and trailing whitespace from a response. */
    private cleanResponseText(text: string): string {
        return text.replace(/\[GENERATE_REPORT\]/gi, '').trim();
    }

    private isInvalidSuccessKbResponse(text: string): boolean {
        const normalized = text.toLowerCase();
        return normalized.includes("i couldn't find an article that directly answers this in the help center")
            || normalized.includes("i'm having trouble reaching the help center right now")
            || normalized.includes('i cannot find any information about')
            || normalized.includes('in the available knowledge bases');
    }

    private buildBestArticleResponse(toolResponse: Record<string, unknown>): string {
        const bestArticle = toolResponse.bestArticle as { title?: string; summary?: string; url?: string } | undefined;
        if (!bestArticle?.title) {
            return KB_UNAVAILABLE_FALLBACK_MESSAGE;
        }

        const rawSummary = (bestArticle.summary || 'I found a relevant help article for your question.').trim();
        const summary = this.truncateSummary(rawSummary);
        const url = bestArticle.url ? `\n\nRead more: ${bestArticle.url}` : '';
        return `${summary}${url}`;
    }

    private truncateSummary(summary: string): string {
        const cleaned = summary.replace(/\s+/g, ' ').trim();
        if (!cleaned) return 'I found a relevant help article for your question.';

        // Prefer a natural 1-2 sentence cut before hard character slicing.
        const sentenceMatches = cleaned.match(/[^.!?]+[.!?]+/g) ?? [];
        if (sentenceMatches.length >= 2) {
            const twoSentences = `${sentenceMatches[0].trim()} ${sentenceMatches[1].trim()}`.trim();
            if (twoSentences.length <= 320) return twoSentences;
        }

        if (sentenceMatches.length >= 1) {
            const oneSentence = sentenceMatches[0].trim();
            if (oneSentence.length <= 320) return oneSentence;
        }

        if (cleaned.length <= 320) return cleaned;

        const softLimit = 300;
        const windowed = cleaned.slice(0, softLimit);
        const lastSpace = windowed.lastIndexOf(' ');
        const clipped = (lastSpace > 200 ? windowed.slice(0, lastSpace) : windowed).trim();
        return `${clipped}...`;
    }

    /**
     * Aggressively remove JSON code blocks and fragments that were part of a
     * structured extraction response but should not appear in the chat UI.
     */
    private removeJsonBlocks(text: string): string {
        return text
            // Remove fenced code blocks
            .replace(/```json\s*[\s\S]*?```/gi, '')
            .replace(/```\s*\{[\s\S]*?\}\s*```/g, '')
            .replace(/```\s*\[[\s\S]*?\]\s*```/g, '')
            .replace(/```\s*[\s\S]*?```/g, '')
            // Remove JSON objects and arrays
            .replace(/\{\s*"[\s\S]*?"\s*\}/g, '')
            .replace(/\[\s*\{[\s\S]*?\}\s*\]/g, '')
            .replace(/\{\s*[\s\S]*?\}/g, '')
            // Remove trailing fragments
            .replace(/,\s*\]\s*,\s*"error"\s*:\s*null\s*\}/g, '')
            .replace(/\]\s*,\s*"error"\s*:\s*null\s*\}/g, '')
            .replace(/"error"\s*:\s*null\s*\}/g, '')
            .replace(/^\s*[,\[\{]\s*$/gm, '')
            .replace(/^\s*"[^"]*"\s*:\s*[^,}\]]+\s*[,}\]]\s*$/gm, '')
            .replace(/^\s*json\s*$/gmi, '')
            .replace(/\n\s*json\s*\n/g, '\n')
            .replace(/\n\s*\n\s*\n/g, '\n\n')
            .replace(/^\s*,\s*$/gm, '')
            .trim();
    }

    // -------------------------------------------------------------------------
    // Prompt helpers
    // -------------------------------------------------------------------------

    private async buildAgentPrompt(agentId?: string): Promise<string> {
        const [systemSettings, agentPrompt] = await Promise.all([
            gcsClient.getSystemSettings(),
            gcsClient.getPromptTemplate(agentId),
        ]);
        return `${systemSettings.globalSystemPrompt}

---

${agentPrompt}

---

KNOWLEDGE BASE TOOL OVERRIDES:
- If search_knowledge_base status is "success", you must answer using the returned article content.
- Only use the no-results fallback when status is "no_results".
- Only use KB unavailable messaging when status is "error" or the tool was unavailable.
- Never claim no information is available when status is "success".`;
    }

    /** KB retrieval wrapped in a LangSmith traceable span. */
    private readonly retrieveKBContext = traceable(
        async (message: string, agentId?: string) => {
            return this.contextService.buildKnowledgeBaseContext(message, agentId);
        },
        { name: 'retrieve_documents' },
    );

    /** Turn 1 Gemini generation wrapped in a LangSmith traceable span. */
    private readonly generateTurn1 = traceable(
        async (model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>, contents: Content[]) => {
            return model.generateContent({ contents });
        },
        { name: 'generate_turn_1', run_type: 'llm' },
    );

    /** Turn 2 Gemini generation (after tool result) wrapped in a LangSmith traceable span. */
    private readonly generateTurn2 = traceable(
        async (model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>, contents: Content[]) => {
            return model.generateContent({ contents });
        },
        { name: 'generate_turn_2_with_tool_result', run_type: 'llm' },
    );

    // -------------------------------------------------------------------------
    // Diagnostics
    // -------------------------------------------------------------------------

    private logPromptPreview(prompt: string): void {
        const MAX_PREVIEW = 2_000;
        const preview = prompt.length > MAX_PREVIEW
            ? prompt.substring(0, MAX_PREVIEW) + `\n\n[... ${prompt.length - MAX_PREVIEW} more characters ...]`
            : prompt;
        logger.info(`Prompt sent to AI (${prompt.length} chars):\n${'='.repeat(80)}\n${preview}\n${'='.repeat(80)}`);
    }
}
