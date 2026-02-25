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
import { AgentTool } from './AgentTool';
import { AgentToolRegistry } from './AgentToolRegistry';
import { ConversationHistoryService, ConversationMessage } from './ConversationHistoryService';
import { ContextService } from './ContextService';

const logger = getLogger('GeminiChatService');

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
    // Public entry point
    // -------------------------------------------------------------------------

    async chat(params: ChatParams): Promise<ChatResponse> {
        const {
            message,
            conversationHistory = [],
            useKnowledgeBase = false,
            agentId,
            uploadedFiles = [],
        } = params;

        const tools = AgentToolRegistry.getTools(agentId, this.contextService);

        const historyContext = this.historyService.format(conversationHistory);
        const fileContext = this.contextService.buildFileContext(uploadedFiles);
        const agentPrompt = await this.buildAgentPrompt(agentId);

        const initialPrompt = await this.buildInitialPrompt({
            message,
            agentPrompt,
            historyContext,
            fileContext,
            useKnowledgeBase,
            agentId,
        });

        this.logPromptPreview(initialPrompt);

        const model = this.createModel(tools);
        const contents: Content[] = [{ role: 'user', parts: [{ text: initialPrompt }] }];

        // Turn 1: send prompt
        const firstResult = await model.generateContent({ contents });
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
            });
        }

        return this.handleNormalResponse(firstResponse.text(), message);
    }

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

        const { kbContext, fileListContext } =
            await this.retrieveKBContext(message, agentId);

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
    }): Promise<ChatResponse> {
        const { functionCallPart, tool, model, contents, uploadedFiles, agentId, useKnowledgeBase } = options;
        const functionName: string = functionCallPart.functionCall.name;
        const args = functionCallPart.functionCall.args as Record<string, unknown>;

        logger.info(`Model invoked "${functionName}" with args: ${JSON.stringify(args)}`);

        const result = await tool.execute({
            functionCallName: functionName,
            args,
            uploadedFiles,
            agentId,
            useKnowledgeBase,
        });

        // Turn 2: return the tool result to the model so it can write a human response
        const turn2Contents: Content[] = [
            ...contents,
            { role: 'model', parts: [{ functionCall: functionCallPart.functionCall }] },
            {
                role: 'user',
                parts: [{ functionResponse: { name: functionName, response: result.toolResponse } }],
            },
        ];

        const secondResult = await model.generateContent({ contents: turn2Contents });
        const responseText = this.cleanResponseText(secondResult.response.text());

        logger.info(`Tool call "${functionName}" completed — generateReport: ${result.generateReport}`);

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
        return `${systemSettings.globalSystemPrompt}\n\n---\n\n${agentPrompt}`;
    }

    /** KB retrieval wrapped in a langsmith traceable span. */
    private readonly retrieveKBContext = traceable(
        async (message: string, agentId?: string) => {
            return this.contextService.buildKnowledgeBaseContext(message, agentId);
        },
        { name: 'retrieve_documents' },
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
