import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextResponse } from 'next/server';
import { generateEmbedding } from '@/lib/embeddings';
import { getCachedKnowledgeBase } from '@/lib/knowledge-base-storage';
import { findSimilarChunks } from '@/lib/document-chunker';
import { traceable } from 'langsmith/traceable';

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
                    .map((chunk: any, i: number) => `[Source ${i + 1}]:\n${chunk.text}`)
                    .join('\n\n---\n\n');

                // Enhance message with context
                finalMessage = `You are a friendly, conversational AI assistant helping users with step-by-step guidance.

Context from documentation:
${context}

User message: ${message}

CRITICAL INSTRUCTIONS:
1. **Be concise and conversational** - Keep responses SHORT (2-4 sentences typically)
2. **Step-by-step approach** - If the context contains a procedure with multiple steps:
   - Only explain the FIRST step in detail
   - Give clear, actionable instructions for that step
   - End by asking if they've completed it before moving on
   - Wait for user confirmation before explaining the next step
3. **Formatting** - Use plain text, natural language. NO markdown symbols like ** or ##
4. **Tone** - Be friendly, supportive, and patient like a helpful colleague
5. **If not procedural** - Answer the question directly and briefly

Examples:
- Bad: "**Step 1:** Go to Settings. **Step 2:** Click on API Keys..."
- Good: "Let's start! First, go to Settings in your Google Cloud console. Once you're there, let me know and I'll guide you to the next step."

Remember: ONE step at a time. Keep it SHORT and FRIENDLY.

Response:`;

                sources = similarChunks.map((chunk: any, i: number) => ({
                    id: i + 1,
                    text: chunk.text,
                    similarity: chunk.score,
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
