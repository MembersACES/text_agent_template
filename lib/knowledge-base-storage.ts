import { getStorageClient } from './google-auth';

export interface KnowledgeBaseData {
    chunks: Array<{ text: string; embedding: number[]; source?: string }>;
    documentId: string;
    documentName: string;
    lastModified: string;
    indexedAt: string;
    fileMetadata?: Record<string, { modifiedTime: string; chunkCount: number; name: string; indexedAt?: string }>;
}

const BUCKET_NAME = process.env.GCS_BUCKET_NAME!;
const FILE_NAME = 'knowledge-base.json';
const AGENTS_DIR = 'agents';

// Save knowledge base data to Cloud Storage
export async function saveKnowledgeBase(data: KnowledgeBaseData, agentId?: string): Promise<void> {
    const storage = getStorageClient();
    const bucket = storage.bucket(BUCKET_NAME);
    
    // Determine file path based on agentId
    const filePath = agentId 
        ? `${AGENTS_DIR}/${agentId}/knowledge-base.json`
        : FILE_NAME;
    
    const file = bucket.file(filePath);

    await file.save(JSON.stringify(data, null, 2), {
        contentType: 'application/json',
        metadata: {
            cacheControl: 'no-cache',
        },
    });
}

// Load knowledge base data from Cloud Storage
export async function loadKnowledgeBase(agentId?: string): Promise<KnowledgeBaseData | null> {
    try {
        const storage = getStorageClient();
        const bucket = storage.bucket(BUCKET_NAME);
        
        // Determine file path based on agentId
        let filePath: string;
        if (agentId) {
            filePath = `${AGENTS_DIR}/${agentId}/knowledge-base.json`;
        } else {
            filePath = FILE_NAME;
        }
        
        let file = bucket.file(filePath);
        let [exists] = await file.exists();
        
        // If agent-specific file doesn't exist, try default
        if (!exists && agentId) {
            file = bucket.file(FILE_NAME);
            [exists] = await file.exists();
        }

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

// In-memory cache with 10-minute TTL (per agent)
const cache: Map<string, { data: KnowledgeBaseData | null; time: number }> = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export async function getCachedKnowledgeBase(agentId?: string): Promise<KnowledgeBaseData | null> {
    const now = Date.now();
    const cacheKey = agentId || 'default';

    // Return cached data if still valid
    const cached = cache.get(cacheKey);
    if (cached && (now - cached.time < CACHE_TTL)) {
        return cached.data;
    }

    // Reload from Cloud Storage
    const data = await loadKnowledgeBase(agentId);
    cache.set(cacheKey, { data, time: now });

    return data;
}
