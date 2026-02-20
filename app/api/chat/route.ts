import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextResponse } from 'next/server';
import { generateEmbedding } from '@/lib/embeddings';
import { getCachedKnowledgeBase } from '@/lib/knowledge-base-storage';
import { findSimilarChunks } from '@/lib/document-chunker';
import { traceable } from 'langsmith/traceable';
import { getPromptTemplate, getSystemSettings } from '@/lib/gcs-client';
import { buildInvoiceExtractionPrompt, buildNoKBExtractionPrompt } from '@/lib/prompts';
import { extractJsonFromResponse } from '@/lib/json-parser';

const retrieveContext = traceable(async (query: string, agentId?: string) => {
    const kb = await getCachedKnowledgeBase(agentId);
    if (!kb) return null;

    const queryEmbedding = await generateEmbedding(query);
    // Reduced from 5 to 3 chunks to save tokens when we have large uploaded files
    const similarChunks = findSimilarChunks(queryEmbedding, kb.chunks, 3);

    return similarChunks;
}, { name: "retrieve_documents" });

const generateAIResponse = traceable(async ({ model, prompt }: { model: any, prompt: string }) => {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
}, { name: "generate_answer" });

export async function POST(request: Request) {
    try {
        const { message, conversationHistory, useKnowledgeBase, agentId, uploadedFiles } = await request.json();

        if (!message) {
            return NextResponse.json(
                { error: 'Message is required' },
                { status: 400 }
            );
        }

        // Format conversation history if provided
        // Limit to last 10 messages to prevent token overflow
        const MAX_HISTORY_MESSAGES = 10;
        let historyContext = '';
        if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
            // Filter out the current message if it's already in history (it shouldn't be, but just in case)
            const previousMessages = conversationHistory.filter((m: any) => 
                m.role === 'user' || m.role === 'assistant'
            );
            
            // Take only the last N messages
            const recentMessages = previousMessages.slice(-MAX_HISTORY_MESSAGES);
            
            if (recentMessages.length > 0) {
                const historyText = recentMessages
                    .map((m: any) => {
                        const role = m.role === 'user' ? 'User' : 'Assistant';
                        let content = typeof m.content === 'string' ? m.content : '';
                        // Limit each message to 2000 chars
                        if (content.length > 2000) {
                            content = content.substring(0, 2000) + '[... truncated ...]';
                        }
                        return `${role}: ${content}`;
                    })
                    .join('\n\n');
                historyContext = `PREVIOUS CONVERSATION (last ${recentMessages.length} messages):\n${historyText}\n\n`;
            }
        }

        // Get API key from environment variable (server-side only)
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            return NextResponse.json(
                { error: 'API key not configured' },
                { status: 500 }
            );
        }

        // Initialize Gemini AI
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: {
                maxOutputTokens: 65536,
                temperature: 0.1,
            },
        });

        let finalMessage = message;
        let sources = null;

        // Check if this is an invoice processing request
        const isInvoiceProcessingRequest = Array.isArray(uploadedFiles) && uploadedFiles.length > 0 && 
            (message.toLowerCase().includes('run these invoices') || 
             message.toLowerCase().includes('base 1 review') ||
             message.toLowerCase().includes('process these invoices') ||
             message.toLowerCase().includes('analyze these invoices'));

        // Build optional file context from uploaded files (per-conversation)
        // Adjust truncation based on number of files to prevent token overflow
        let fileContext = '';
        if (Array.isArray(uploadedFiles) && uploadedFiles.length > 0) {
            // More aggressive truncation when we have many files
            const TOTAL_FILE_BUDGET = 200000; // 200K chars for all uploaded files combined
            const maxLengthPerFile = Math.max(
                4000, // minimum per file
                Math.floor(TOTAL_FILE_BUDGET / uploadedFiles.length)
            );
            
            fileContext = uploadedFiles
                .map((f: any, i: number) => {
                    const name = typeof f.name === 'string' ? f.name : `File ${i + 1}`;
                    let content = typeof f.content === 'string' ? f.content : '';
                    // Truncate if too long
                    if (content.length > maxLengthPerFile) {
                        content = content.substring(0, maxLengthPerFile) + '\n\n[... content truncated for length ...]';
                    }
                    return `Uploaded File ${i + 1}: ${name}\n${content}`;
                })
                .join('\n\n---\n\n');
        }

        // Retrieve global system prompt and agent-specific prompt (needed in all cases)
        const systemSettings = await getSystemSettings();
        const agentPrompt = await getPromptTemplate(agentId);
        const fullPrompt = `${systemSettings.globalSystemPrompt}\n\n---\n\n${agentPrompt}`;

        // If knowledge base mode is enabled, retrieve relevant context
        if (useKnowledgeBase) {
            const kb = await getCachedKnowledgeBase(agentId);
            
            if (!kb) {
                console.log(`[Chat API] No knowledge base found for agent: ${agentId || 'default'}. KB may need to be indexed.`);
            } else {
                console.log(`[Chat API] KB loaded for agent ${agentId || 'default'}: ${Object.keys(kb.fileMetadata || {}).length} files, ${kb.chunks.length} chunks`);
            }
            
            // For invoice processing, include ALL guide document chunks instead of semantic search
            let kbContext = '';
            let similarChunks: any[] = [];
            
            if (isInvoiceProcessingRequest && kb) {
                // Guide documents that contain extraction rules and benchmarks
                const guideDocuments = ['ELECTRICITY_GUIDE', 'GAS_GUIDE', 'WATER_GUIDE', 'WASTE_GUIDE', 'OIL_GUIDE'];
                
                // Get all chunks from guide documents
                const guideChunks = kb.chunks.filter((chunk: any) => {
                    const source = chunk.source || '';
                    return guideDocuments.some(guide => source.includes(guide));
                });
                
                if (guideChunks.length > 0) {
                    console.log(`[Chat API] Including ${guideChunks.length} chunks from guide documents for invoice extraction`);
                    kbContext = guideChunks
                        .map((chunk: any, i: number) => {
                            const sourceInfo = chunk.source ? ` (File: ${chunk.source})` : '';
                            return `[Guide Document ${i + 1}${sourceInfo}]:\n${chunk.text}`;
                        })
                        .join('\n\n---\n\n');
                } else {
                    console.warn(`[Chat API] No guide document chunks found. Available sources: ${[...new Set(kb.chunks.map((c: any) => c.source))].join(', ')}`);
                }
            } else {
                // For normal chat, use semantic search
                similarChunks = await retrieveContext(message, agentId) || [];
                kbContext = similarChunks.length > 0
                    ? similarChunks
                        .map((chunk: any, i: number) => {
                            const sourceInfo = chunk.source ? ` (File: ${chunk.source})` : '';
                            return `[Source ${i + 1}${sourceInfo}]:\n${chunk.text}`;
                        })
                        .join('\n\n---\n\n')
                    : '';
            }

            // Build file list metadata for the model to reference (ALWAYS include if KB exists)
            let fileListContext = '';
            if (kb && kb.fileMetadata && Object.keys(kb.fileMetadata).length > 0) {
                const fileList = Object.entries(kb.fileMetadata)
                    .map(([id, meta]: [string, any]) => {
                        const fileName = meta.name || 'Unknown File';
                        const chunkCount = meta.chunkCount || 0;
                        return `- ${fileName} (${chunkCount} chunks)`;
                    })
                    .join('\n');
                fileListContext = `KNOWLEDGE BASE FILES AVAILABLE:\n${fileList}\n\n`;
                console.log(`[Chat API] File list context built: ${Object.keys(kb.fileMetadata).length} files`);
            }

            // Combine all context parts: conversation history, file list, KB content, uploaded files
            // Apply additional truncation if total context is too large
            const combinedContextParts = [];
            if (historyContext) {
                combinedContextParts.push(historyContext);
            }
            if (fileListContext) {
                combinedContextParts.push(fileListContext);
            }
            if (kbContext) {
                const kbLabel = isInvoiceProcessingRequest 
                    ? 'GUIDE DOCUMENTS FROM KNOWLEDGE BASE (Extraction Rules & Benchmarks):'
                    : 'RELEVANT CONTENT FROM KNOWLEDGE BASE:';
                combinedContextParts.push(`${kbLabel}\n${kbContext}`);
            }
            if (fileContext) {
                combinedContextParts.push(`UPLOADED FILES FOR THIS CONVERSATION:\n${fileContext}`);
            }
            
            let combinedContext = combinedContextParts.length > 0 
                ? combinedContextParts.join('\n\n---\n\n')
                : '';

            // Final safety check: if context is extremely long, truncate it
            // Rough estimate: 1 token ≈ 4 characters, so 800k tokens ≈ 3.2M characters
            // We'll limit to ~2M characters to be safe
            const MAX_CONTEXT_LENGTH = 2000000;
            if (combinedContext.length > MAX_CONTEXT_LENGTH) {
                console.warn(`[Chat API] Context too long (${combinedContext.length} chars), truncating to ${MAX_CONTEXT_LENGTH}`);
                combinedContext = combinedContext.substring(0, MAX_CONTEXT_LENGTH) + '\n\n[... context truncated due to length ...]';
            }

            // If this is an invoice processing request, use the extraction prompt
            if (isInvoiceProcessingRequest) {
                console.log(`[Chat API] Detected invoice processing request, using extraction prompt`);
                finalMessage = buildInvoiceExtractionPrompt(combinedContext);
            } else {
                // Replace placeholders with actual content
                finalMessage = fullPrompt
                    .replace('{{context}}', combinedContext)
                    .replace('{{message}}', message);
            }

            // Debug logging
            if (fileListContext) {
                console.log(`[Chat API] File list included in context for agent ${agentId || 'default'}`);
                console.log(`[Chat API] Files: ${Object.keys(kb?.fileMetadata || {}).length}`);
            } else {
                console.log(`[Chat API] No file list context - KB exists: ${!!kb}, fileMetadata: ${!!kb?.fileMetadata}, fileCount: ${Object.keys(kb?.fileMetadata || {}).length}`);
            }

            // Set sources for non-invoice processing requests (where we use semantic search)
            if (!isInvoiceProcessingRequest && similarChunks && similarChunks.length > 0) {
                sources = similarChunks.map((chunk: any, i: number) => ({
                    id: i + 1,
                    text: chunk.text,
                    similarity: chunk.score,
                    source: chunk.source
                }));
            }
        } else if (fileContext) {
            // Knowledge base disabled but we still have uploaded files: build a simple context
            const contextParts = [];
            if (historyContext) contextParts.push(historyContext);
            contextParts.push(`UPLOADED FILES FOR THIS CONVERSATION:\n${fileContext}`);
            
            // If this is an invoice processing request, use the extraction prompt
            if (isInvoiceProcessingRequest) {
                console.log(`[Chat API] Detected invoice processing request, using extraction prompt`);
                finalMessage = buildNoKBExtractionPrompt(fileContext);
            } else {
                finalMessage = fullPrompt
                    .replace('{{context}}', contextParts.join('\n\n---\n\n'))
                    .replace('{{message}}', message);
            }
        } else {
            // No KB, no files: still combine global + agent prompts with history if available
            finalMessage = fullPrompt
                .replace('{{context}}', historyContext || '')
                .replace('{{message}}', message);
        }

        // Log the prompt being sent (truncated for readability)
        const promptPreview = finalMessage.length > 2000 
            ? finalMessage.substring(0, 2000) + `\n\n[... ${finalMessage.length - 2000} more characters ...]`
            : finalMessage;
        console.log(`[Chat API] Prompt being sent to AI (${finalMessage.length} chars):\n${'='.repeat(80)}\n${promptPreview}\n${'='.repeat(80)}`);

        // Generate response using the traceable function
        const text = await generateAIResponse({ model, prompt: finalMessage });

        // Extract JSON from response if present (for invoice extraction)
        let extractedData = null;
        // First, remove any [GENERATE_REPORT] markers from the response
        let cleanedResponse = text.replace(/\[GENERATE_REPORT\]/gi, '').trim();
        let generateReport = false;

        // Use shared JSON extraction utility
        const extractedJson = extractJsonFromResponse(text);
        if (extractedJson.length > 0) {
            extractedData = extractedJson.length === 1 ? extractedJson[0] : extractedJson;
            
            // Remove all JSON blocks from the response text (very aggressive pattern)
            // First pass: Remove code blocks
            cleanedResponse = text
                .replace(/```json\s*[\s\S]*?```/gi, '') // Remove ```json ... ```
                .replace(/```\s*\{[\s\S]*?\}\s*```/g, '') // Remove ``` {...} ```
                .replace(/```\s*\[[\s\S]*?\]\s*```/g, '') // Remove ``` [...] ```
                .replace(/```\s*[\s\S]*?```/g, '') // Remove any remaining ``` ... ```
                .trim();
            
            // Second pass: Remove complete JSON objects/arrays
            cleanedResponse = cleanedResponse
                .replace(/\{\s*"[\s\S]*?"\s*\}/g, '') // Remove {...} JSON objects (multiline)
                .replace(/\[\s*\{[\s\S]*?\}\s*\]/g, '') // Remove [{...}] JSON arrays
                .replace(/\{\s*[\s\S]*?\}/g, '') // More aggressive: any {...} blocks
                .trim();
            
            // Third pass: Remove JSON fragments and artifacts (like ",],\n"error": null\n}")
            cleanedResponse = cleanedResponse
                .replace(/,\s*\]\s*,\s*"error"\s*:\s*null\s*\}/g, '') // Remove trailing JSON fragments
                .replace(/\]\s*,\s*"error"\s*:\s*null\s*\}/g, '') // Remove ] ,"error": null}
                .replace(/"error"\s*:\s*null\s*\}/g, '') // Remove "error": null}
                .replace(/^\s*[,\[\{]\s*$/gm, '') // Remove lines with just brackets/commas
                .replace(/^\s*"[^"]*"\s*:\s*[^,}\]]+\s*[,}\]]\s*$/gm, '') // Remove JSON key-value lines
                .replace(/^\s*json\s*$/gmi, '') // Remove standalone "json" lines
                .replace(/\n\s*json\s*\n/g, '\n') // Remove "json" on its own line
                .replace(/\n\s*\n\s*\n/g, '\n\n') // Remove excessive blank lines
                .replace(/^\s*,\s*$/gm, '') // Remove lines with just commas
                .trim();
            
            console.log(`[Chat API] Extracted ${extractedJson.length} JSON block(s) from response`);
        }

        const extractedCount = extractedData 
            ? (Array.isArray(extractedData) ? extractedData.length : 1)
            : 0;
        console.log(`[Chat API] Extracted ${extractedCount} invoice(s) from response`);
        
        // Log low_hanging_fruit data for debugging
        if (extractedData) {
            const invoices = Array.isArray(extractedData) ? extractedData : [extractedData];
            invoices.forEach((inv: any, idx: number) => {
                if (inv.low_hanging_fruit) {
                    const fruitCount = Array.isArray(inv.low_hanging_fruit) ? inv.low_hanging_fruit.length : 0;
                    console.log(`[Chat API] Invoice ${idx + 1} has ${fruitCount} low_hanging_fruit entries`);
                    if (fruitCount > 0) {
                        inv.low_hanging_fruit.forEach((fruit: any, fIdx: number) => {
                            console.log(`[Chat API]   Entry ${fIdx + 1}: type="${fruit.type}", severity="${fruit.severity}", savings="${fruit.potential_savings}"`);
                        });
                    }
                } else {
                    console.log(`[Chat API] Invoice ${idx + 1} has no low_hanging_fruit array`);
                }
            });
        }
        
        // Log if we have uploaded files but extracted fewer invoices
        if (uploadedFiles && Array.isArray(uploadedFiles) && uploadedFiles.length > extractedCount) {
            console.warn(`[Chat API] Warning: ${uploadedFiles.length} files uploaded but only ${extractedCount} invoices extracted. Some files may not have contained invoice data or extraction failed.`);
        }

        // Automatically trigger report generation if invoices were extracted and this is an invoice processing request
        if (isInvoiceProcessingRequest && extractedCount > 0) {
            console.log(`[Chat API] Automatically triggering report generation for ${extractedCount} extracted invoice(s)`);
            generateReport = true;
        }
        // Also check if user explicitly requested report generation
        else if (message.toLowerCase().includes('generate') && message.toLowerCase().includes('report')) {
            generateReport = true;
        }
        
        // Also check if AI response contains [GENERATE_REPORT] marker
        if (cleanedResponse.includes('[GENERATE_REPORT]')) {
            generateReport = true;
            // Remove the marker from the response
            cleanedResponse = cleanedResponse.replace(/\[GENERATE_REPORT\]/g, '').trim();
        }

        return NextResponse.json({
            response: cleanedResponse,
            ...(sources && { sources }),
            ...(extractedData && { extractedData }),
            ...(generateReport && { generateReport }),
        });
    } catch (error: any) {
        console.error('Error in chat API:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to process message' },
            { status: 500 }
        );
    }
}
