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

import { GoogleGenerativeAI, Content, FunctionCallingMode } from '@google/generative-ai';
import { createHash } from 'node:crypto';
import { traceable } from 'langsmith/traceable';
import { getLogger } from '@/lib/config/logger';
import { settings } from '@/lib/config/settings';
import { gcsClient } from '@/lib/services/storage/GcsClient';
import { extractJsonFromResponse } from '@/lib/utils/JsonParser';
import { AgentTool } from '../tools/AgentTool';
import { AgentToolRegistry } from '../tools/AgentToolRegistry';
import { ConversationHistoryService, ConversationMessage } from './ConversationHistoryService';
import { ContextService } from './ContextService';
import { chatMessageTrace } from '@/lib/config/chatMessageTrace';
import { redactPII, redactTraceInputs } from '@/lib/services/privacy/redact';
import { KbSearchQueryResolver } from './KbSearchQueryResolver';
import { ComplaintsResponseGate } from './ComplaintsResponseGate';
import { OrderStatusGate } from './OrderStatusGate';
import { PaymentSegmentGate } from './PaymentSegmentGate';
import { ProductAvailabilityGate } from './ProductAvailabilityGate';
import { GroupGoodnessPaymentGate } from './GroupGoodnessPaymentGate';

const logger = getLogger('GeminiChatService');
const NO_RESULTS_FALLBACK_MESSAGE = "I couldn't find an article that directly answers this in the help center. You can still contact Honest to Goodness support via phone, email or web forms if you'd like more help.";
const KB_UNAVAILABLE_FALLBACK_MESSAGE = "I'm having trouble reaching the help center right now. Please try again in a moment or contact support via phone, email or web forms.";
const EMPTY_CLARIFICATION_RESPONSE =
    "Sorry — I'm not quite sure how to help with that. Could you let me know a bit more about what you're looking for? I can help with payment options, shipping, order status, product availability, or returns and credits.";
const HEALTH_FORCE_NO_RESULTS_TOKEN = '__HEALTH_FORCE_NO_RESULTS__';
const HEALTH_FORCE_ERROR_TOKEN = '__HEALTH_FORCE_ERROR__';
const KB_SUCCESS_INSTRUCTION = [
    'Tool result policy:',
    '- If tool status is "success", answer using bestArticle and optionally relatedArticles.',
    '- Do not output no-results or KB-unavailable fallback text when status is "success".',
    '- Use no-results fallback only for status "no_results".',
    '- Payment Critical Rule overrides no-results: if the message contains card/credit card/debit card or any payment brand and segment is unknown, the first response is ALWAYS the segment question — never "I couldn\'t find an article" even when the KB returned no or weak matches. Exception: Group Goodness / buying group / group admin / group coordinator / group order / group member / group cart — do not ask retail vs wholesale; use GG articles.',
    '- Complaints override no-results: for damaged/missing/wrong item/wrong price/new credit issues, empathise and point to the credit form with scenario-specific intake reminders — never "I couldn\'t find an article". Existing claim follow-ups: escalate only, no credit form.',
    '- Product availability override no-results: for in-stock, out-of-stock, or restock questions, empathise, explain live stock is not visible here, collect SKU or product name and pack size, and direct to support — never "I couldn\'t find an article".',
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
    /** Optional stable conversation id. If the client ever plumbs one, it wins;
     *  otherwise runChat derives one (see deriveConversationId). Used only to
     *  scope internal-alert dedup per conversation — never contains PII. */
    sessionId?: string;
}

/**
 * A stable per-conversation id for alert dedup. Cloud Run is stateless per request
 * and the client sends no session id, so we derive one from the FIRST user message
 * (which is identical across every turn of the same conversation — on turn 1 it is
 * the current message; thereafter it is history[0]-ish). Hashed, so no PII leaks
 * into the id. Caveat: if history is truncated past the first message on a very
 * long conversation the anchor shifts — acceptable, as escalations happen early.
 */
function deriveConversationId(history: ConversationMessage[], message: string): string {
    const firstUser = history.find((m) => m.role === 'user')?.content ?? message;
    return 'conv-' + createHash('sha256').update(String(firstUser)).digest('hex').slice(0, 16);
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
            return this.ensureNonEmptyResponse(await this.runChat(params));
        },
        // processInputs redacts the customer message (email + order#) from the
        // trace input BEFORE it reaches LangSmith — the wrapped fn still gets the
        // real params. See lib/services/privacy/redact.ts.
        { name: 'chat', run_type: 'chain', processInputs: redactTraceInputs },
    );

    private async runChat(params: ChatParams): Promise<ChatResponse> {
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

            if (
                useKnowledgeBase &&
                hasKbTool &&
                PaymentSegmentGate.needsSegmentQuestion(message, conversationHistory)
            ) {
                logger.info(
                    'Payment segment gate: segment required before KB search; returning segment question.',
                );
                return { response: PaymentSegmentGate.getSegmentOpener(message) };
            }

            if (
                useKnowledgeBase &&
                hasKbTool &&
                ComplaintsResponseGate.isExistingClaimDetailsReply(message, conversationHistory)
            ) {
                logger.info('Complaints gate: existing claim details reply; redirecting to support.');
                return { response: ComplaintsResponseGate.buildExistingClaimDetailsReply() };
            }

            // Live order tracking (flag-gated via settings.freight.trackingEnabled).
            // Runs BEFORE the stuck-packing deflection so a real status answer wins.
            // Dark until ORDER_TRACKING_ENABLED=true — handleOrderTracking returns
            // null when the flag is off, so the deflection below continues to fire.
            if (useKnowledgeBase && hasKbTool) {
                const conversationId = params.sessionId ?? deriveConversationId(conversationHistory, message);
                // Default service + alerts (real InternalAlertService, gated by ALERTS_ENABLED).
                const tracked = await OrderStatusGate.handleOrderTracking(message, conversationHistory, undefined, undefined, conversationId);
                if (tracked) {
                    logger.info('Order status gate: live order tracking handled the turn.');
                    return { response: tracked };
                }
            }

            if (useKnowledgeBase && hasKbTool && OrderStatusGate.needsStuckPackingHandoff(message)) {
                logger.info('Order status gate: stuck packing handoff; returning support template.');
                return { response: OrderStatusGate.buildStuckPackingResponse() };
            }

            if (
                useKnowledgeBase &&
                hasKbTool &&
                OrderStatusGate.isStuckPackingDetailsReply(message, conversationHistory)
            ) {
                logger.info('Order status gate: stuck packing details reply; redirecting to support.');
                return { response: OrderStatusGate.buildStuckPackingDetailsReply() };
            }

            const complaintScenario = ComplaintsResponseGate.classify(message, conversationHistory);
            if (
                useKnowledgeBase &&
                hasKbTool &&
                complaintScenario === 'existing_claim_followup'
            ) {
                logger.info('Complaints gate: existing claim follow-up; skipping KB search.');
                return {
                    response: ComplaintsResponseGate.buildFallbackResponse(message, conversationHistory)!,
                };
            }

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

            const forceKbTool =
                useKnowledgeBase && hasKbTool && uploadedFiles.length === 0;

            // Turn 1: send prompt (force KB tool when no uploads so support questions always search Zoho)
            const firstResult = await this.generateTurn1(model, contents, forceKbTool);
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
                    conversationHistory,
                });
            }

            if (hasKbTool && useKnowledgeBase && this.shouldAutoInvokeKbSearch(message)) {
                const kbTool = tools.find((t) => t.canHandle('search_knowledge_base'));
                if (kbTool) {
                    logger.info('Model skipped KB tool; running search_knowledge_base server-side.');
                    return this.handleToolCall({
                        functionCallPart: {
                            functionCall: { name: 'search_knowledge_base', args: { query: message } },
                        },
                        tool: kbTool,
                        model,
                        contents,
                        uploadedFiles,
                        agentId,
                        useKnowledgeBase,
                        userMessage: message,
                        conversationHistory,
                    });
                }
                logger.warn('KB tool missing; returning KB unavailable fallback.');
                return { response: KB_UNAVAILABLE_FALLBACK_MESSAGE };
            }

            return this.handleNormalResponse(firstResponse.text(), message);
    }

    private ensureNonEmptyResponse(result: ChatResponse): ChatResponse {
        if (!result.response?.trim()) {
            logger.warn('Empty assistantReply detected; substituting clarification template.');
            return { ...result, response: EMPTY_CLARIFICATION_RESPONSE };
        }
        return result;
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
        conversationHistory?: ConversationMessage[];
    }): Promise<ChatResponse> {
        const {
            functionCallPart,
            tool,
            model,
            contents,
            uploadedFiles,
            agentId,
            useKnowledgeBase,
            userMessage,
            conversationHistory = [],
        } = options;
        const functionName: string = functionCallPart.functionCall.name;
        const args = functionCallPart.functionCall.args as Record<string, unknown>;

        // Redact: args.query is routinely the raw customer message (email + order#),
        // and with tracking off an order question falls through to KB search here.
        logger.info(`Model invoked "${functionName}" with args: ${redactPII(JSON.stringify(args))}`);

        const result = await tool.execute({
            functionCallName: functionName,
            args,
            uploadedFiles,
            agentId,
            useKnowledgeBase,
            userMessage,
            conversationHistory,
        });

        // Turn 2: return the tool result to the model so it can write a human response.
        // If the tool overrides args (e.g. used userMessage instead of model-generated query),
        // use those so Turn 2 sees a consistent picture of what was searched and found.
        const recordedFunctionCall = result.actualArgs
            ? { ...functionCallPart.functionCall, args: result.actualArgs }
            : functionCallPart.functionCall;

        const segmentFollowUp = KbSearchQueryResolver.getSegmentFollowUp(userMessage, conversationHistory);
        const kbTurn2Preamble =
            functionName === 'search_knowledge_base'
                ? [
                    KB_SUCCESS_INSTRUCTION,
                    ...(segmentFollowUp
                        ? [KbSearchQueryResolver.buildTurn2Instruction(segmentFollowUp)]
                        : []),
                ].join('\n\n')
                : '';

        const turn2Contents: Content[] = [
            ...contents,
            { role: 'model', parts: [{ functionCall: recordedFunctionCall }] },
            {
                role: 'user',
                parts: functionName === 'search_knowledge_base'
                    ? [
                        { text: kbTurn2Preamble },
                        { functionResponse: { name: functionName, response: result.toolResponse } },
                    ]
                    : [{ functionResponse: { name: functionName, response: result.toolResponse } }],
            },
        ];

        const secondResult = await this.generateTurn2(model, turn2Contents);
        const status = result.toolResponse.status;

        if (functionName === 'search_knowledge_base') {
            if (status === 'no_results') {
                if (PaymentSegmentGate.needsSegmentQuestion(userMessage, conversationHistory)) {
                    logger.info(
                        'Payment segment gate: no_results suppressed; asking retail/wholesale.',
                    );
                    return { response: PaymentSegmentGate.getSegmentOpener(userMessage) };
                }
                const complaintResponse = ComplaintsResponseGate.buildFallbackResponse(
                    userMessage,
                    conversationHistory,
                );
                if (complaintResponse) {
                    logger.info('Complaints gate: no_results suppressed for complaint.');
                    return { response: complaintResponse };
                }
                const availabilityResponse = ProductAvailabilityGate.buildFallbackResponse(userMessage);
                if (availabilityResponse) {
                    logger.info('Product availability gate: no_results suppressed.');
                    return { response: availabilityResponse };
                }
                return { response: NO_RESULTS_FALLBACK_MESSAGE };
            }
            if (status === 'error') {
                return { response: KB_UNAVAILABLE_FALLBACK_MESSAGE };
            }
        }

        const responseText = this.cleanResponseText(secondResult.response.text());
        if (
            functionName === 'search_knowledge_base' &&
            (OrderStatusGate.needsStuckPackingHandoff(userMessage) ||
                OrderStatusGate.promisesFalseEscalation(responseText))
        ) {
            logger.warn('Order status gate: replacing false escalation promise with support template.');
            return { response: OrderStatusGate.buildStuckPackingResponse() };
        }
        if (functionName === 'search_knowledge_base' && ProductAvailabilityGate.matches(userMessage)) {
            if (
                ProductAvailabilityGate.isNoResultsPhrasing(responseText) ||
                ProductAvailabilityGate.isColdAvailabilityResponse(responseText)
            ) {
                const availabilityResponse = ProductAvailabilityGate.buildFallbackResponse(userMessage);
                if (availabilityResponse) {
                    logger.warn('Product availability gate: replacing cold/invalid availability reply.');
                    return { response: availabilityResponse };
                }
            }
        }
        if (functionName === 'search_knowledge_base' && ComplaintsResponseGate.matches(userMessage)) {
            const complaintScenario = ComplaintsResponseGate.classify(userMessage, conversationHistory);
            const wronglyIncludesForm =
                complaintScenario === 'existing_claim_followup' &&
                /forms\.zohopublic\.com/i.test(responseText);
            if (
                ComplaintsResponseGate.isNoResultsPhrasing(responseText) ||
                wronglyIncludesForm
            ) {
                const complaintResponse = ComplaintsResponseGate.buildFallbackResponse(
                    userMessage,
                    conversationHistory,
                );
                if (complaintResponse) {
                    logger.warn('Complaints gate: replacing invalid complaint reply with template.');
                    return { response: complaintResponse };
                }
            }
        }
        if (
            functionName === 'search_knowledge_base' &&
            status === 'success' &&
            GroupGoodnessPaymentGate.isGroupGoodnessPaymentQuestion(userMessage)
        ) {
            const ggPaymentReply = GroupGoodnessPaymentGate.buildResponseFromToolResult(
                userMessage,
                result.toolResponse,
            );
            const articles = result.toolResponse.articles as Array<{ title?: string; summary?: string }> | undefined;
            const kbPaymentArticle = articles?.find((a) =>
                /payment option|payment method/i.test(a.title ?? ''),
            );
            if (
                ggPaymentReply &&
                (GroupGoodnessPaymentGate.isOverlyHedgedResponse(responseText) ||
                    (kbPaymentArticle &&
                        !GroupGoodnessPaymentGate.citesPaymentArticle(responseText, kbPaymentArticle)))
            ) {
                logger.warn('Group Goodness payment gate: replacing hedged reply with KB article template.');
                return { response: ggPaymentReply };
            }
        }
        if (
            functionName === 'search_knowledge_base' &&
            PaymentSegmentGate.needsSegmentQuestion(userMessage, conversationHistory) &&
            (PaymentSegmentGate.violatesOpener(responseText) ||
                PaymentSegmentGate.isNoResultsPhrasing(responseText))
        ) {
            logger.warn(
                'Payment segment gate: invalid payment reply before segment; using segment opener.',
            );
            return { response: PaymentSegmentGate.getSegmentOpener(userMessage) };
        }
        if (
            functionName === 'search_knowledge_base' &&
            status === 'success' &&
            this.isInvalidSuccessKbResponse(responseText)
        ) {
            logger.warn('Invalid KB success response detected; replacing with best article template.');
            if (PaymentSegmentGate.needsSegmentQuestion(userMessage, conversationHistory)) {
                return { response: PaymentSegmentGate.getSegmentOpener(userMessage) };
            }
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
            const firstSentence = sentenceMatches[0];
            const secondSentence = sentenceMatches[1];
            if (firstSentence && secondSentence) {
                const twoSentences = `${firstSentence.trim()} ${secondSentence.trim()}`.trim();
                if (twoSentences.length <= 320) return twoSentences;
            }
        }

        if (sentenceMatches.length >= 1) {
            const firstSentence = sentenceMatches[0];
            if (firstSentence) {
                const oneSentence = firstSentence.trim();
                if (oneSentence.length <= 320) return oneSentence;
            }
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
        const stack = await gcsClient.buildGlobalAndAgentPrompt(agentId);
        return `${stack}

---

KNOWLEDGE BASE TOOL OVERRIDES:
- If search_knowledge_base status is "success", answer using the returned article content unless your agent prompt has a payment-methods exception (retail vs wholesale must be asked first — that exception overrides this rule).
- Only use the no-results fallback when status is "no_results".
- Only use KB unavailable messaging when status is "error" or the tool was unavailable.
- Never claim no information is available when status is "success".`;
    }

    /** KB retrieval wrapped in a LangSmith traceable span. */
    private readonly retrieveKBContext = traceable(
        async (message: string, agentId?: string) => {
            return this.contextService.buildKnowledgeBaseContext(message, agentId);
        },
        { name: 'retrieve_documents', processInputs: redactTraceInputs },
    );

    /** Turn 1 Gemini generation wrapped in a LangSmith traceable span. */
    private readonly generateTurn1 = traceable(
        async (
            model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>,
            contents: Content[],
            forceKbTool = false,
        ) => {
            if (!forceKbTool) {
                return model.generateContent({ contents });
            }
            return model.generateContent({
                contents,
                toolConfig: {
                    functionCallingConfig: {
                        mode: FunctionCallingMode.ANY,
                        allowedFunctionNames: ['search_knowledge_base'],
                    },
                },
            });
        },
        // Redact the prompt contents (they embed the customer message) from the
        // LLM span input sent to LangSmith; the model still receives real contents.
        { name: 'generate_turn_1', run_type: 'llm', processInputs: redactTraceInputs },
    );

    /** Skip Zoho search for brief acknowledgments; run search for real support questions. */
    private shouldAutoInvokeKbSearch(message: string): boolean {
        const trimmed = message.trim();
        if (!trimmed) return false;
        return !/^(ok|okay|yes|no|thanks|thank you|cheers|go|yep|nope|hi|hello|hey|👍|👌)[!.?\s]*$/i.test(trimmed);
    }

    /** Turn 2 Gemini generation (after tool result) wrapped in a LangSmith traceable span. */
    private readonly generateTurn2 = traceable(
        async (model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>, contents: Content[]) => {
            return model.generateContent({ contents });
        },
        { name: 'generate_turn_2_with_tool_result', run_type: 'llm', processInputs: redactTraceInputs },
    );

    // -------------------------------------------------------------------------
    // Diagnostics
    // -------------------------------------------------------------------------

    private logPromptPreview(prompt: string): void {
        // Redact PII from the diagnostic copy (the prompt embeds the customer
        // message). Length is reported from the ORIGINAL so the count stays true.
        const safePrompt = redactPII(prompt);
        const MAX_PREVIEW = 2_000;
        const preview = safePrompt.length > MAX_PREVIEW
            ? safePrompt.substring(0, MAX_PREVIEW) + `\n\n[... ${safePrompt.length - MAX_PREVIEW} more characters ...]`
            : safePrompt;
        logger.info(`Prompt sent to AI (${prompt.length} chars):\n${'='.repeat(80)}\n${preview}\n${'='.repeat(80)}`);

        if (chatMessageTrace.isCapturingTerminal()) {
            chatMessageTrace.appendSection(
                `FULL PROMPT SENT TO AI (${prompt.length} chars)`,
                safePrompt,
            );
        }
    }
}
