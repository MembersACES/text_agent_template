import { GoogleGenerativeAI } from '@google/generative-ai';
import { getLogger } from '@/lib/config/logger';
import { settings } from '@/lib/config/settings';

const logger = getLogger('EmbeddingService');

export class EmbeddingService {
    private readonly genAI: GoogleGenerativeAI;
    private readonly model: string;

    constructor() {
        this.genAI = new GoogleGenerativeAI(settings.gemini.apiKey);
        this.model = settings.gemini.embeddingModel;
    }

    async generateEmbedding(text: string): Promise<number[]> {
        try {
            const model = this.genAI.getGenerativeModel({ model: this.model });
            const result = await model.embedContent(text);
            return result.embedding.values;
        } catch (error: any) {
            logger.warn(`Embedding failed: ${error.message}`);
            throw new Error(`Embedding model not available: ${error.message}. Please check your Gemini API configuration.`);
        }
    }

    async generateEmbeddings(texts: string[]): Promise<number[][]> {
        const embeddings: number[][] = [];

        for (const text of texts) {
            const embedding = await this.generateEmbedding(text);
            embeddings.push(embedding);
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        return embeddings;
    }
}

export const embeddingService = new EmbeddingService();
