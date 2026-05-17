/**
 * PromptBuilderService
 *
 * Single responsibility: build the complete LLM prompt for the chat turn.
 *
 * It owns the three prompt strategies:
 *   1. Knowledge-base mode  → semantic search + file list + uploaded files
 *   2. Files-only mode      → uploaded files without KB
 *   3. Plain mode           → conversation history only
 *
 * It also fetches the agent-level prompt templates from GCS and wraps the
 * KB retrieval call in a LangSmith traceable span.
 *
 * Depends on:
 *   - ContextService                          → builds KB + file context strings
 *   - getSystemSettings / getPromptTemplate   → agent prompt config from GCS
 *   - traceable                               → LangSmith observability
 */

import { traceable } from 'langsmith/traceable';
import { gcsClient } from '@/lib/services/storage/GcsClient';
import { ContextService, KnowledgeBaseContextResult } from './ContextService';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BuildPromptOptions {
    message: string;
    agentId?: string;
    historyContext: string;
    fileContext: string;
    useKnowledgeBase: boolean;
}

/** Sources returned alongside the built prompt so the caller can attach them to the response. */
export interface BuiltPrompt {
    prompt: string;
    sources: Array<{ id: number; text: string; similarity: number; source: string }> | null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class PromptBuilderService {
    constructor(private readonly contextService: ContextService) { }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * Build the full LLM prompt for the current chat turn.
     * Selects the appropriate strategy based on the flags provided.
     *
     * Returns both the prompt string and any KB sources to include in the
     * HTTP response (relevant for the KB strategy only).
     */
    async build(options: BuildPromptOptions): Promise<BuiltPrompt> {
        const { message, agentId, historyContext, fileContext, useKnowledgeBase } = options;

        const agentPrompt = await this.fetchAgentPrompt(agentId);

        if (useKnowledgeBase) {
            return this.buildWithKnowledgeBase({ message, agentPrompt, historyContext, fileContext, agentId });
        }

        if (fileContext) {
            return this.buildWithFilesOnly({ message, agentPrompt, historyContext, fileContext });
        }

        return this.buildPlain({ message, agentPrompt, historyContext });
    }

    // -------------------------------------------------------------------------
    // Prompt strategies (private)
    // -------------------------------------------------------------------------

    /**
     * Strategy 1 – Knowledge-base mode.
     * Performs a semantic vector search against the agent's KB, includes the
     * matching chunks and the full file-list manifest, then injects everything
     * into the agent prompt template.
     */
    private async buildWithKnowledgeBase(options: {
        message: string;
        agentPrompt: string;
        historyContext: string;
        fileContext: string;
        agentId?: string;
    }): Promise<BuiltPrompt> {
        const { message, agentPrompt, historyContext, fileContext, agentId } = options;

        const { kbContext, fileListContext, similarChunks } =
            await this.retrieveKnowledgeBaseContext(message, agentId);

        const contextParts = [
            historyContext,
            fileListContext,
            kbContext ? `RELEVANT CONTENT FROM KNOWLEDGE BASE:\n${kbContext}` : '',
            fileContext ? `UPLOADED FILES FOR THIS CONVERSATION:\n${fileContext}` : '',
        ];

        const combinedContext = this.contextService.combineParts(contextParts);

        const prompt = agentPrompt
            .replace('{{context}}', combinedContext)
            .replace('{{message}}', message);

        const sources = similarChunks.length > 0
            ? similarChunks.map((chunk: any, i: number) => ({
                id: i + 1,
                text: chunk.text,
                similarity: chunk.score,
                source: chunk.source,
            }))
            : null;

        return { prompt, sources };
    }

    /**
     * Strategy 2 – Files-only mode.
     * The KB is disabled but the user has uploaded files. Combines history
     * and file content into the context placeholder.
     */
    private buildWithFilesOnly(options: {
        message: string;
        agentPrompt: string;
        historyContext: string;
        fileContext: string;
    }): BuiltPrompt {
        const { message, agentPrompt, historyContext, fileContext } = options;

        const combinedContext = this.contextService.combineParts([
            historyContext,
            `UPLOADED FILES FOR THIS CONVERSATION:\n${fileContext}`,
        ]);

        const prompt = agentPrompt
            .replace('{{context}}', combinedContext)
            .replace('{{message}}', message);

        return { prompt, sources: null };
    }

    /**
     * Strategy 3 – Plain mode.
     * No KB, no files. Injects only the conversation history (or an empty
     * string) into the context placeholder.
     */
    private buildPlain(options: {
        message: string;
        agentPrompt: string;
        historyContext: string;
    }): BuiltPrompt {
        const { message, agentPrompt, historyContext } = options;

        const prompt = agentPrompt
            .replace('{{context}}', historyContext || '')
            .replace('{{message}}', message);

        return { prompt, sources: null };
    }

    // -------------------------------------------------------------------------
    // Agent prompt helper
    // -------------------------------------------------------------------------

    /**
     * Fetch and combine the global system prompt with the agent-specific prompt
     * template from GCS. Both calls are made in parallel for efficiency.
     */
    private async fetchAgentPrompt(agentId?: string): Promise<string> {
        return gcsClient.buildGlobalAndAgentPrompt(agentId);
    }

    // -------------------------------------------------------------------------
    // Traceable KB retrieval
    // -------------------------------------------------------------------------

    /**
     * Retrieves vector-search results from the agent's knowledge base.
     * Wrapped in a LangSmith traceable span so the retrieval step appears as a
     * distinct node in the trace.
     */
    private readonly retrieveKnowledgeBaseContext = traceable(
        async (message: string, agentId?: string): Promise<KnowledgeBaseContextResult> => {
            return this.contextService.buildKnowledgeBaseContext(message, agentId);
        },
        { name: 'retrieve_documents' },
    );
}
