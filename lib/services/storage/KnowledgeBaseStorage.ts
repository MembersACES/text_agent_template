import { getLogger } from '@/lib/config/logger';
import { settings } from '@/lib/config/settings';
import { googleAuthService } from '@/lib/services/google/GoogleAuthService';

const logger = getLogger('KnowledgeBaseStorage');

const FILE_NAME = 'knowledge-base.json';
const AGENTS_DIR = 'agents';
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export interface KnowledgeBaseData {
    chunks: Array<{ text: string; embedding: number[]; source?: string }>;
    documentId: string;
    documentName: string;
    lastModified: string;
    indexedAt: string;
    fileMetadata?: Record<string, { modifiedTime: string; chunkCount: number; name: string; indexedAt?: string }>;
}

export class KnowledgeBaseStorage {
    private readonly bucketName: string;
    private readonly cache: Map<string, { data: KnowledgeBaseData | null; time: number }> = new Map();

    constructor() {
        this.bucketName = settings.gcs.bucketName;
    }

    async save(data: KnowledgeBaseData, agentId?: string): Promise<void> {
        const storage = googleAuthService.getStorageClient();
        const bucket = storage.bucket(this.bucketName);

        const filePath = agentId
            ? `${AGENTS_DIR}/${agentId}/knowledge-base.json`
            : FILE_NAME;

        const file = bucket.file(filePath);
        await file.save(JSON.stringify(data, null, 2), {
            contentType: 'application/json',
            metadata: { cacheControl: 'no-cache' },
        });

        // Update cache immediately so new data is visible without waiting for TTL
        const cacheKey = agentId || 'default';
        this.cache.set(cacheKey, { data, time: Date.now() });
    }

    async load(agentId?: string): Promise<KnowledgeBaseData | null> {
        try {
            const storage = googleAuthService.getStorageClient();
            const bucket = storage.bucket(this.bucketName);

            let filePath = agentId
                ? `${AGENTS_DIR}/${agentId}/knowledge-base.json`
                : FILE_NAME;

            let file = bucket.file(filePath);
            let [exists] = await file.exists();

            if (!exists && agentId) {
                file = bucket.file(FILE_NAME);
                [exists] = await file.exists();
            }

            if (!exists) return null;

            const [contents] = await file.download();
            return JSON.parse(contents.toString());
        } catch (error) {
            logger.error(`Error loading knowledge base: ${error}`);
            return null;
        }
    }

    async getCached(agentId?: string): Promise<KnowledgeBaseData | null> {
        const now = Date.now();
        const cacheKey = agentId || 'default';

        const cached = this.cache.get(cacheKey);
        if (cached && now - cached.time < CACHE_TTL) {
            return cached.data;
        }

        const data = await this.load(agentId);
        this.cache.set(cacheKey, { data, time: now });
        return data;
    }
}

export const knowledgeBaseStorage = new KnowledgeBaseStorage();
