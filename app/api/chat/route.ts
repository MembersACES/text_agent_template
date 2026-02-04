import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextResponse } from 'next/server';
import { generateEmbedding } from '@/lib/embeddings';
import { getCachedKnowledgeBase } from '@/lib/knowledge-base-storage';
import { findSimilarChunks } from '@/lib/document-chunker';
import { traceable } from 'langsmith/traceable';
import { getPromptTemplate } from '@/lib/gcs-client';

const retrieveContext = traceable(async (query: string, agentId?: string) => {
    const kb = await getCachedKnowledgeBase(agentId);
    if (!kb) return null;

    const queryEmbedding = await generateEmbedding(query);
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
        const { message, useKnowledgeBase, agentId, uploadedFiles } = await request.json();

        if (!message) {
            return NextResponse.json(
                { error: 'Message is required' },
                { status: 400 }
            );
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
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        let finalMessage = message;
        let sources = null;

        // Build optional file context from uploaded files (per-conversation)
        let fileContext = '';
        if (Array.isArray(uploadedFiles) && uploadedFiles.length > 0) {
            fileContext = uploadedFiles
                .map((f: any, i: number) => {
                    const name = typeof f.name === 'string' ? f.name : `File ${i + 1}`;
                    const content = typeof f.content === 'string' ? f.content : '';
                    return `Uploaded File ${i + 1}: ${name}\n${content}`;
                })
                .join('\n\n---\n\n');
        }

        // If knowledge base mode is enabled, retrieve relevant context
        if (useKnowledgeBase) {
            const similarChunks = await retrieveContext(message, agentId);

            if (similarChunks || fileContext) {
                // Build context from KB chunks
                const kbContext = similarChunks
                    ? similarChunks
                        .map((chunk: any, i: number) => {
                            const sourceInfo = chunk.source ? ` (File: ${chunk.source})` : '';
                            return `[Source ${i + 1}${sourceInfo}]:\n${chunk.text}`;
                        })
                        .join('\n\n---\n\n')
                    : '';

                // Combine KB context and uploaded file context
                const combinedContextParts = [];
                if (kbContext) combinedContextParts.push(kbContext);
                if (fileContext) combinedContextParts.push(`Uploaded Files:\n${fileContext}`);
                const combinedContext = combinedContextParts.join('\n\n---\n\n');

                // Retrieve dynamic prompt template for the specific agent
                let template = await getPromptTemplate(agentId);

                // Replace placeholders with actual content
                finalMessage = template
                    .replace('{{context}}', combinedContext || '')
                    .replace('{{message}}', message);

                if (similarChunks) {
                    sources = similarChunks.map((chunk: any, i: number) => ({
                        id: i + 1,
                        text: chunk.text,
                        similarity: chunk.score,
                        source: chunk.source // Pass source metadata to client
                    }));
                }
            } else if (fileContext) {
                // No KB, but we have uploaded files: still use template with file context
                let template = await getPromptTemplate(agentId);
                finalMessage = template
                    .replace('{{context}}', `Uploaded Files:\n${fileContext}`)
                    .replace('{{message}}', message);
            }
        } else if (fileContext) {
            // Knowledge base disabled but we still have uploaded files: build a simple context
            let template = await getPromptTemplate(agentId);
            finalMessage = template
                .replace('{{context}}', `Uploaded Files:\n${fileContext}`)
                .replace('{{message}}', message);
        }

        // Generate response using the traceable function
        const text = await generateAIResponse({ model, prompt: finalMessage });

        return NextResponse.json({
            response: text,
            ...(sources && { sources })
        });
    } catch (error) {
        console.error('Error in chat API:', error);
        return NextResponse.json(
            { error: 'Failed to process message' },
            { status: 500 }
        );
    }
}
