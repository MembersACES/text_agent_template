import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextResponse } from 'next/server';
import { generateEmbedding } from '@/lib/embeddings';
import { getCachedKnowledgeBase } from '@/lib/knowledge-base-storage';
import { findSimilarChunks } from '@/lib/document-chunker';

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
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

        let finalMessage = message;
        let sources = null;

        // If knowledge base mode is enabled, retrieve relevant context
        if (useKnowledgeBase) {
            const kb = await getCachedKnowledgeBase();

            if (kb) {
                // Generate query embedding and find similar chunks
                const queryEmbedding = await generateEmbedding(message);
                const similarChunks = findSimilarChunks(queryEmbedding, kb.chunks, 3);

                // Build context from chunks
                const context = similarChunks
                    .map((chunk, i) => `[Source ${i + 1}]:\n${chunk.text}`)
                    .join('\n\n---\n\n');

                // Enhance message with context
                finalMessage = `You are a helpful assistant answering questions based on the provided document context.

Context from document:
${context}

User question: ${message}

Instructions:
- Answer the question using the information in the context above when relevant
- If the answer is not in the context, you can still use your general knowledge
- Be conversational and helpful
- You can cite sources like [Source 1] if helpful

Answer:`;

                sources = similarChunks.map((chunk, i) => ({
                    id: i + 1,
                    text: chunk.text,
                    similarity: chunk.score,
                }));
            }
        }

        // Generate response
        const result = await model.generateContent(finalMessage);
        const response = await result.response;
        const text = response.text();

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
