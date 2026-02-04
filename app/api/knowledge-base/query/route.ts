import { NextResponse } from 'next/server';
import { generateEmbedding } from '@/lib/embeddings';
import { getCachedKnowledgeBase } from '@/lib/knowledge-base-storage';
import { findSimilarChunks } from '@/lib/document-chunker';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(request: Request) {
    try {
        const { query, agentId } = await request.json();

        if (!query) {
            return NextResponse.json(
                { error: 'Query is required' },
                { status: 400 }
            );
        }

        // 1. Load knowledge base (agent-specific or default)
        const kb = await getCachedKnowledgeBase(agentId);

        if (!kb) {
            return NextResponse.json(
                { error: 'Knowledge base not indexed yet. Please run /api/knowledge-base/index first.' },
                { status: 404 }
            );
        }

        // 2. Generate query embedding
        const queryEmbedding = await generateEmbedding(query);

        // 3. Find similar chunks
        const similarChunks = findSimilarChunks(queryEmbedding, kb.chunks, 3);

        // 4. Build context from chunks
        const context = similarChunks
            .map((chunk, i) => `[Source ${i + 1}]:\n${chunk.text}`)
            .join('\n\n---\n\n');

        // 5. Generate answer using Gemini
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        const prompt = `You are a helpful assistant answering questions based on the provided document context.

Context from document:
${context}

User question: ${query}

Instructions:
- Answer the question using ONLY the information in the context above
- If the answer is not in the context, say "I don't have enough information to answer that question based on the document."
- Be concise and accurate
- You can cite sources like [Source 1] if helpful

Answer:`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const answer = response.text();

        return NextResponse.json({
            answer,
            sources: similarChunks.map((chunk, i) => ({
                id: i + 1,
                text: chunk.text,
                similarity: chunk.score,
            })),
            documentName: kb.documentName,
        });
    } catch (error) {
        console.error('Error querying knowledge base:', error);
        return NextResponse.json(
            { error: 'Failed to query knowledge base', details: String(error) },
            { status: 500 }
        );
    }
}
