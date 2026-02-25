/**
 * InvoiceToolService
 *
 * Single responsibility: own the Gemini function-calling declaration for the
 * `process_invoices` tool AND execute the actual invoice extraction when the
 * model decides to invoke it.
 *
 * Depends on:
 *  - ContextService  → builds the KB + file prompt context
 *  - buildInvoiceExtractionPrompt / buildNoKBExtractionPrompt → prompt templates
 *  - extractJsonFromResponse → parses structured JSON from the LLM response
 */

import { GoogleGenerativeAI, SchemaType, FunctionDeclarationsTool } from '@google/generative-ai';
import { getLogger } from '@/lib/config/logger';
import { settings } from '@/lib/config/settings';
import { buildInvoiceExtractionPrompt, buildNoKBExtractionPrompt } from '@/lib/utils/Prompts';
import { extractJsonFromResponse } from '@/lib/utils/JsonParser';
import { ContextService } from './ContextService';

const logger = getLogger('InvoiceToolService');

export interface InvoiceToolResult {
    extractedData: any;
    generateReport: boolean;
}

export class InvoiceToolService {
    private static readonly MODEL_ID = 'gemini-2.5-flash';
    private static readonly MAX_OUTPUT_TOKENS = 65_536;

    constructor(private readonly contextService: ContextService) { }

    // -------------------------------------------------------------------------
    // Tool declaration (Gemini FunctionDeclaration)
    // -------------------------------------------------------------------------

    /**
     * Returns the Gemini tool declaration that should be passed to the model
     * when the user has uploaded files. The model uses the description to decide
     * when to call this tool.
     */
    get declaration(): FunctionDeclarationsTool {
        return {
            functionDeclarations: [
                {
                    name: 'process_invoices',
                    description:
                        'Extracts and analyses structured data from utility invoice files uploaded by the user. ' +
                        'Call this tool when the user wants to process, review, run, or analyse invoice files they have uploaded. ' +
                        'The tool reads every uploaded file, applies knowledge-base benchmarks and extraction rules, ' +
                        'and returns structured JSON data ready for reporting.',
                    parameters: {
                        type: SchemaType.OBJECT,
                        properties: {
                            instruction: {
                                type: SchemaType.STRING,
                                description:
                                    'Optional additional instruction or focus area for the extraction, ' +
                                    'e.g. "focus on electricity invoices" or "compare against demand charge benchmarks".',
                            },
                        },
                        required: [],
                    },
                },
            ],
        };
    }

    // -------------------------------------------------------------------------
    // Tool execution
    // -------------------------------------------------------------------------

    /**
     * Run the invoice extraction pipeline:
     *  1. Build a combined context (KB guide documents + uploaded files).
     *  2. Select the appropriate extraction prompt template.
     *  3. Call Gemini to extract structured JSON.
     *  4. Parse and return the results.
     */
    async execute(
        uploadedFiles: any[],
        agentId: string | undefined,
        useKnowledgeBase: boolean,
    ): Promise<InvoiceToolResult> {
        const fileContext = this.contextService.buildFileContext(uploadedFiles);
        const finalMessage = await this.buildExtractionPrompt(fileContext, agentId, useKnowledgeBase);

        logger.info(`Running extraction prompt (${finalMessage.length} chars)`);

        const text = await this.runExtractionModel(finalMessage);
        return this.parseExtractionResult(text, uploadedFiles.length);
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private async buildExtractionPrompt(
        fileContext: string,
        agentId: string | undefined,
        useKnowledgeBase: boolean,
    ): Promise<string> {
        if (!useKnowledgeBase) {
            return buildNoKBExtractionPrompt(fileContext);
        }

        const { kbContext, fileListContext } = await this.contextService.buildGuideDocumentContext(agentId);

        if (!kbContext) {
            // KB exists but has no guide chunks — fall back to no-KB prompt
            return buildNoKBExtractionPrompt(fileContext);
        }

        const combinedContext = this.contextService.combineParts([
            fileListContext,
            `GUIDE DOCUMENTS FROM KNOWLEDGE BASE (Extraction Rules & Benchmarks):\n${kbContext}`,
            `UPLOADED FILES FOR THIS CONVERSATION:\n${fileContext}`,
        ]);

        return buildInvoiceExtractionPrompt(combinedContext);
    }

    private async runExtractionModel(prompt: string): Promise<string> {
        const genAI = new GoogleGenerativeAI(settings.gemini.apiKey);
        const model = genAI.getGenerativeModel({
            model: InvoiceToolService.MODEL_ID,
            generationConfig: {
                maxOutputTokens: InvoiceToolService.MAX_OUTPUT_TOKENS,
                temperature: 0.1,
            },
        });

        const result = await model.generateContent(prompt);
        return result.response.text();
    }

    private parseExtractionResult(text: string, fileCount: number): InvoiceToolResult {
        const extractedJson = extractJsonFromResponse(text);

        const extractedData = extractedJson.length > 0
            ? (extractedJson.length === 1 ? extractedJson[0] : extractedJson)
            : null;

        const extractedCount = Array.isArray(extractedData)
            ? extractedData.length
            : extractedData != null ? 1 : 0;

        this.logResults(extractedData, fileCount, extractedCount);

        return {
            extractedData,
            generateReport: extractedCount > 0,
        };
    }

    private logResults(extractedData: any, fileCount: number, extractedCount: number): void {
        logger.info(`Extracted ${extractedCount} invoice(s)`);

        if (extractedData) {
            const invoices: any[] = Array.isArray(extractedData) ? extractedData : [extractedData];
            invoices.forEach((invoice, idx) => {
                const fruitCount = Array.isArray(invoice.low_hanging_fruit)
                    ? invoice.low_hanging_fruit.length
                    : 0;
                logger.info(`Invoice ${idx + 1}: ${fruitCount} low_hanging_fruit entries`);
                invoice.low_hanging_fruit?.forEach((fruit: any, fIdx: number) => {
                    logger.info(`  [${fIdx + 1}] type="${fruit.type}", severity="${fruit.severity}", savings="${fruit.potential_savings}"`);
                });
            });
        }

        if (fileCount > extractedCount) {
            logger.warn(
                `${fileCount} files uploaded but only ${extractedCount} invoices extracted. ` +
                'Some files may not contain valid invoice data.',
            );
        }
    }
}
