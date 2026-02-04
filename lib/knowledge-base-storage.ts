import { getStorageClient } from './google-auth';

export interface KnowledgeBaseData {
    chunks: Array<{ text: string; embedding: number[]; source?: string }>;
    documentId: string;
    documentName: string;
    lastModified: string;
    indexedAt: string;
    fileMetadata?: Record<string, { modifiedTime: string; chunkCount: number }>;
}

const BUCKET_NAME = process.env.GCS_BUCKET_NAME!;
const FILE_NAME = 'knowledge-base.json';

// Save knowledge base data to Cloud Storage
export async function saveKnowledgeBase(data: KnowledgeBaseData): Promise<void> {
    const storage = getStorageClient();
    const bucket = storage.bucket(BUCKET_NAME);
    const file = bucket.file(FILE_NAME);

    await file.save(JSON.stringify(data, null, 2), {
        contentType: 'application/json',
        metadata: {
            cacheControl: 'no-cache',
        },
    });
}

// Load knowledge base data from Cloud Storage
export async function loadKnowledgeBase(): Promise<KnowledgeBaseData | null> {
    try {
        const storage = getStorageClient();
        const bucket = storage.bucket(BUCKET_NAME);
        const file = bucket.file(FILE_NAME);

        const [exists] = await file.exists();
        if (!exists) {
            return null;
        }

        const [contents] = await file.download();
        return JSON.parse(contents.toString());
    } catch (error) {
        console.error('Error loading knowledge base:', error);
        return null;
    }
}

// In-memory cache with 10-minute TTL
let cachedData: KnowledgeBaseData | null = null;
let cacheTime: number = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export async function getCachedKnowledgeBase(): Promise<KnowledgeBaseData | null> {
    const now = Date.now();

    // Return cached data if still valid
    if (cachedData && (now - cacheTime < CACHE_TTL)) {
        return cachedData;
    }

    // Reload from Cloud Storage
    cachedData = await loadKnowledgeBase();
    cacheTime = now;

    return cachedData;
}
