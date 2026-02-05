import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextResponse } from 'next/server';
import { generateEmbedding } from '@/lib/embeddings';
import { getCachedKnowledgeBase } from '@/lib/knowledge-base-storage';
import { findSimilarChunks } from '@/lib/document-chunker';
import { traceable } from 'langsmith/traceable';
import { getPromptTemplate, getSystemSettings } from '@/lib/gcs-client';

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
            ``
            
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
            
            const similarChunks = await retrieveContext(message, agentId);

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

            // Build context from KB chunks (semantic search results)
            const kbContext = similarChunks && similarChunks.length > 0
                ? similarChunks
                    .map((chunk: any, i: number) => {
                        const sourceInfo = chunk.source ? ` (File: ${chunk.source})` : '';
                        return `[Source ${i + 1}${sourceInfo}]:\n${chunk.text}`;
                    })
                    .join('\n\n---\n\n')
                : '';

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
                combinedContextParts.push(`RELEVANT CONTENT FROM KNOWLEDGE BASE:\n${kbContext}`);
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

            // Replace placeholders with actual content
            finalMessage = fullPrompt
                .replace('{{context}}', combinedContext)
                .replace('{{message}}', message);

            // Debug logging
            if (fileListContext) {
                console.log(`[Chat API] File list included in context for agent ${agentId || 'default'}`);
                console.log(`[Chat API] Files: ${Object.keys(kb?.fileMetadata || {}).length}`);
            } else {
                console.log(`[Chat API] No file list context - KB exists: ${!!kb}, fileMetadata: ${!!kb?.fileMetadata}, fileCount: ${Object.keys(kb?.fileMetadata || {}).length}`);
            }

            if (similarChunks && similarChunks.length > 0) {
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
            finalMessage = fullPrompt
                .replace('{{context}}', contextParts.join('\n\n---\n\n'))
                .replace('{{message}}', message);
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

        // Check for JSON code blocks in the response - extract ALL blocks, not just the first
        // Use ([\s\S]*?) instead of (\{[\s\S]*?\}) to capture all content, including nested JSON
        const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
        const jsonBlockMatches = [...text.matchAll(jsonBlockRegex)];
        
        if (jsonBlockMatches.length > 0) {
            try {
                // Parse all JSON blocks into an array
                const parsedBlocks = jsonBlockMatches
                    .map(match => {
                        try {
                            let jsonContent = match[1].trim();
                            
                            // If content doesn't start with { or [, try to find JSON within the content
                            if (!jsonContent.startsWith('{') && !jsonContent.startsWith('[')) {
                                // Try to find a JSON object or array within the content
                                const jsonObjectMatch = jsonContent.match(/\{[\s\S]*\}/);
                                const jsonArrayMatch = jsonContent.match(/\[[\s\S]*\]/);
                                
                                if (jsonObjectMatch) {
                                    jsonContent = jsonObjectMatch[0];
                                } else if (jsonArrayMatch) {
                                    jsonContent = jsonArrayMatch[0];
                                } else {
                                    return null; // No JSON found
                                }
                            }
                            
                            // Try to parse, but if it fails, try to extract just the JSON part
                            try {
                                return JSON.parse(jsonContent);
                            } catch (parseError) {
                                // If parsing fails, try to find the actual JSON boundaries
                                // Look for the first { or [ and find its matching closing brace/bracket
                                const startChar = jsonContent[0];
                                const endChar = startChar === '{' ? '}' : ']';
                                
                                let depth = 0;
                                let jsonStart = -1;
                                let jsonEnd = -1;
                                
                                for (let i = 0; i < jsonContent.length; i++) {
                                    if (jsonContent[i] === startChar) {
                                        if (jsonStart === -1) jsonStart = i;
                                        depth++;
                                    } else if (jsonContent[i] === endChar) {
                                        depth--;
                                        if (depth === 0 && jsonStart !== -1) {
                                            jsonEnd = i;
                                            break;
                                        }
                                    }
                                }
                                
                                if (jsonStart !== -1 && jsonEnd !== -1) {
                                    const extractedJson = jsonContent.substring(jsonStart, jsonEnd + 1);
                                    return JSON.parse(extractedJson);
                                }
                                
                                throw parseError; // Re-throw if we couldn't extract valid JSON
                            }
                        } catch (e) {
                            console.error('Failed to parse JSON block:', e);
                            return null;
                        }
                    })
                    .filter(block => block !== null); // Remove any failed parses
                
                if (parsedBlocks.length > 0) {
                    // If only one block, return it as a single object (backward compatible)
                    // If multiple blocks, return as array
                    extractedData = parsedBlocks.length === 1 ? parsedBlocks[0] : parsedBlocks;
                    
                    // Remove all JSON blocks from the response text (more aggressive pattern)
                    // This removes: ```json ... ```, ``` ... ```, and any JSON-like content
                    cleanedResponse = text
                        .replace(/```json\s*[\s\S]*?```/gi, '') // Remove ```json ... ```
                        .replace(/```\s*\{[\s\S]*?\}\s*```/g, '') // Remove ``` {...} ```
                        .replace(/```\s*\[[\s\S]*?\]\s*```/g, '') // Remove ``` [...] ```
                        .replace(/```\s*[\s\S]*?```/g, '') // Remove any remaining ``` ... ```
                        .replace(/^json\s*$/gmi, '') // Remove standalone "json" lines
                        .replace(/^json\s*\{[\s\S]*?\}$/gmi, '') // Remove "json {...}" blocks without backticks
                        .replace(/^json\s*\{[\s\S]*?\}\s*$/gmi, '') // Remove "json {...}" with whitespace
                        .trim();
                    
                    // Also remove any standalone JSON objects/arrays that might be in the text
                    // Match JSON objects that might be on multiple lines
                    cleanedResponse = cleanedResponse
                        .replace(/\{\s*"[\s\S]*?"\s*\}/g, '') // Remove {...} JSON objects (single line or multiline)
                        .replace(/\[\s*\{[\s\S]*?\}\s*\]/g, '') // Remove [{...}] JSON arrays
                        .replace(/^json\s*$/gmi, '') // Remove any remaining "json" lines
                        .replace(/\n\s*json\s*\n/g, '\n') // Remove "json" on its own line with newlines
                        .trim();
                    
                    console.log(`[Chat API] Extracted ${parsedBlocks.length} JSON block(s) from response`);
                }
            } catch (e) {
                console.error('Failed to parse extracted JSON:', e);
            }
        }

        console.log(`[Chat API] JSON blocks found: ${jsonBlockMatches.length}, extractedData: ${extractedData ? (Array.isArray(extractedData) ? extractedData.length + ' invoices' : '1 invoice') : 'none'}`);

        // Check if user requested report generation OR if AI response contains [GENERATE_REPORT]
        if (message.toLowerCase().includes('generate') && message.toLowerCase().includes('report')) {
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
    } catch (error) {
        console.error('Error in chat API:', error);
        return NextResponse.json(
            { error: 'Failed to process message' },
            { status: 500 }
        );
    }
}
