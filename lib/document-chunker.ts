// Split document into semantic chunks
export function chunkDocument(text: string, chunkSize = 500): string[] {
    // Split by paragraphs first (double newlines or single newlines)
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);

    const chunks: string[] = [];
    let currentChunk = '';

    for (const paragraph of paragraphs) {
        const trimmedParagraph = paragraph.trim();

        // If adding this paragraph exceeds chunk size, save current chunk
        if (currentChunk.length + trimmedParagraph.length > chunkSize && currentChunk.length > 0) {
            chunks.push(currentChunk.trim());
            currentChunk = trimmedParagraph;
        } else {
            currentChunk += (currentChunk ? '\n\n' : '') + trimmedParagraph;
        }
    }

    // Add the last chunk
    if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
}

// Calculate cosine similarity between two vectors
export function cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Find most similar chunks to a query embedding
export function findSimilarChunks(
    queryEmbedding: number[],
    chunks: Array<{ text: string; embedding: number[] }>,
    topK = 3
): Array<{ text: string; score: number }> {
    const similarities = chunks.map(chunk => ({
        text: chunk.text,
        score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }));

    // Sort by similarity score (highest first)
    similarities.sort((a, b) => b.score - a.score);

    return similarities.slice(0, topK);
}
