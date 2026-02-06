import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// Generate embeddings for text using Gemini
export async function generateEmbedding(text: string): Promise<number[]> {
    // Try text-embedding-004 first, fallback to text-embedding-004 if not available
    // Note: The correct model name may vary by API version
    try {
        const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
        const result = await model.embedContent(text);
        return result.embedding.values;
    } catch (error: any) {
        // If text-embedding-004 fails, try without specifying model (uses default)
        // Or skip embeddings if not critical
        console.warn(`[Embeddings] text-embedding-004 failed, trying alternative: ${error.message}`);
        throw new Error(`Embedding model not available: ${error.message}. Please check your Gemini API configuration.`);
    }
}

// Generate embeddings for multiple chunks in batch
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];

    // Process in batches to avoid rate limits
    for (const text of texts) {
        const embedding = await generateEmbedding(text);
        embeddings.push(embedding);

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    return embeddings;
}
