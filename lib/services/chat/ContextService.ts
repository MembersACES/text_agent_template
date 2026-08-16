/**
 * ContextService
 *
 * Single responsibility: build all context strings that are injected into
 * LLM prompts — file context, knowledge-base semantic search, guide-document
 * context (for invoice extraction), and the final combined context.
 */

import { getLogger } from '@/lib/config/logger';
import { embeddingService } from '@/lib/services/ai/EmbeddingService';
import { knowledgeBaseStorage } from '@/lib/services/storage/KnowledgeBaseStorage';
import { findSimilarChunks } from '@/lib/utils/DocumentChunker';
import {
    chunkSourceMatchesGuide,
    inferUtilitiesFromFilesContentAndNames,
    sortGuideChunksForExtraction,
} from '@/lib/config/knowledgeBaseGuides';

const logger = getLogger('ContextService');

export interface KnowledgeBaseContextResult {
    kbContext: string;
    fileListContext: string;
    similarChunks: any[];
}

export interface GuideDocumentContextResult {
    kbContext: string;
    fileListContext: string;
}

export class ContextService {
    /** Maximum total characters allocated to uploaded file content. */
    private static readonly TOTAL_FILE_BUDGET = 200_000;
    /** Hard safety limit for the combined prompt context to avoid token overflow. */
    private static readonly MAX_CONTEXT_LENGTH = 2_000_000;
    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * Build a readable string from an array of uploaded file objects.
     * Applies per-file truncation so the total stays within the file budget.
     */
    buildFileContext(uploadedFiles: any[]): string {
        if (!Array.isArray(uploadedFiles) || uploadedFiles.length === 0) return '';

        const maxPerFile = Math.max(
            4_000,
            Math.floor(ContextService.TOTAL_FILE_BUDGET / uploadedFiles.length),
        );

        return uploadedFiles
            .map((file: any, index: number) => {
                const name = typeof file.name === 'string' ? file.name : `File ${index + 1}`;
                let content = typeof file.content === 'string' ? file.content : '';
                if (content.length > maxPerFile) {
                    content = content.substring(0, maxPerFile) + '\n\n[... content truncated for length ...]';
                }
                return `Uploaded File ${index + 1}: ${name}\n${content}`;
            })
            .join('\n\n---\n\n');
    }

    /**
     * Perform a semantic vector search against the agent's knowledge base and
     * return matching chunks along with supporting metadata.
     */
    async buildKnowledgeBaseContext(message: string, agentId?: string): Promise<KnowledgeBaseContextResult> {
        const kb = await knowledgeBaseStorage.getCached(agentId);

        if (!kb) {
            logger.info(`No KB found for agent: ${agentId ?? 'default'}`);
            return { kbContext: '', fileListContext: '', similarChunks: [] };
        }

        logger.info(`KB loaded for agent ${agentId ?? 'default'}: ${Object.keys(kb.fileMetadata || {}).length} files, ${kb.chunks.length} chunks`);

        const queryEmbedding = await embeddingService.generateEmbedding(message);
        // Reduced from 5 to 3 chunks to keep token usage manageable when files are also present
        const similarChunks = findSimilarChunks(queryEmbedding, kb.chunks, 3);

        const kbContext = similarChunks.length > 0
            ? similarChunks
                .map((chunk: any, i: number) => {
                    const source = chunk.source ? ` (File: ${chunk.source})` : '';
                    return `[Source ${i + 1}${source}]:\n${chunk.text}`;
                })
                .join('\n\n---\n\n')
            : '';

        const fileListContext = this.buildFileListContext(kb.fileMetadata);
        if (fileListContext && kb.fileMetadata) {
            logger.info(`File list built: ${Object.keys(kb.fileMetadata).length} files`);
        }

        return { kbContext, fileListContext, similarChunks };
    }

    /**
     * Retrieve chunks from guide documents (ELECTRICITY, GAS, …) rather than semantic search.
     * Optional `fileContext` / `fileNames` adjust **sort order** (benchmark + utility hint), not inclusion.
     */
    async buildGuideDocumentContext(
        agentId?: string,
        opts?: { fileContext?: string; fileNames?: string[] },
    ): Promise<GuideDocumentContextResult> {
        const kb = await knowledgeBaseStorage.getCached(agentId);

        if (!kb) {
            logger.info(`No KB found for guide document context (agent: ${agentId ?? 'default'})`);
            return { kbContext: '', fileListContext: '' };
        }

        const allGuides = kb.chunks.filter((chunk: any) => chunkSourceMatchesGuide(chunk.source));

        const utilityHint = opts?.fileContext
            ? inferUtilitiesFromFilesContentAndNames(opts.fileContext, opts.fileNames)
            : null;
        if (utilityHint && utilityHint.size > 0) {
            logger.info(
                `Guide utility hint: ${[...utilityHint].sort().join(', ')} (sort tie-break; all guide families still included)`,
            );
        }

        const guideChunks = sortGuideChunksForExtraction(allGuides, utilityHint);

        if (guideChunks.length === 0) {
            const available = [...new Set(kb.chunks.map((c: any) => c.source))].join(', ');
            logger.warn(`No guide document chunks found. Available sources: ${available}`);
            return { kbContext: '', fileListContext: this.buildFileListContext(kb.fileMetadata) };
        }

        logger.info(`Including ${guideChunks.length} guide document chunks for invoice extraction`);

        const kbContext = guideChunks
            .map((chunk: any, i: number) => {
                const source = chunk.source ? ` (File: ${chunk.source})` : '';
                return `[Guide Document ${i + 1}${source}]:\n${chunk.text}`;
            })
            .join('\n\n---\n\n');

        return { kbContext, fileListContext: this.buildFileListContext(kb.fileMetadata) };
    }

    /**
     * Join non-empty context parts with a separator and apply the hard safety
     * truncation so the combined prompt never exceeds the context limit.
     */
    combineParts(parts: string[], separator = '\n\n---\n\n'): string {
        const nonEmpty = parts.filter(Boolean);
        let combined = nonEmpty.join(separator);

        if (combined.length > ContextService.MAX_CONTEXT_LENGTH) {
            logger.warn(`Context too long (${combined.length} chars), truncating to ${ContextService.MAX_CONTEXT_LENGTH}`);
            combined = combined.substring(0, ContextService.MAX_CONTEXT_LENGTH) + '\n\n[... context truncated due to length ...]';
        }

        return combined;
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private buildFileListContext(fileMetadata: Record<string, any> | undefined): string {
        if (!fileMetadata || Object.keys(fileMetadata).length === 0) return '';

        const fileList = Object.entries(fileMetadata)
            .map(([, meta]: [string, any]) =>
                `- ${meta.name ?? 'Unknown File'} (${meta.chunkCount ?? 0} chunks)`,
            )
            .join('\n');

        return `KNOWLEDGE BASE FILES AVAILABLE:\n${fileList}\n\n`;
    }
}
