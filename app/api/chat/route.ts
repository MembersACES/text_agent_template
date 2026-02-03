import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextResponse } from 'next/server';
import { generateEmbedding } from '@/lib/embeddings';
import { getCachedKnowledgeBase } from '@/lib/knowledge-base-storage';
import { findSimilarChunks } from '@/lib/document-chunker';
import { traceable } from 'langsmith/traceable';
import { getPromptTemplate } from '@/lib/gcs-client';

const retrieveContext = traceable(async (query: string) => {
    const kb = await getCachedKnowledgeBase();
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
        const { message, useKnowledgeBase } = await request.json();

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

        // If knowledge base mode is enabled, retrieve relevant context
        if (useKnowledgeBase) {
            const similarChunks = await retrieveContext(message);

            if (similarChunks) {
                // Build context from chunks
                const context = similarChunks
                    .map((chunk: any, i: number) => {
                        const sourceInfo = chunk.source ? ` (File: ${chunk.source})` : '';
                        return `[Source ${i + 1}${sourceInfo}]:\n${chunk.text}`;
                    })
                    .join('\n\n---\n\n');

                // Retrieve dynamic prompt template
                let template = await getPromptTemplate();

                // Replace placeholders with actual content
                finalMessage = template
                    .replace('{{context}}', context)
                    .replace('{{message}}', message);

                sources = similarChunks.map((chunk: any, i: number) => ({
                    id: i + 1,
                    text: chunk.text,
                    similarity: chunk.score,
                    source: chunk.source // Pass source metadata to client
                }));
            }
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
