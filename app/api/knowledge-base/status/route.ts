import { NextResponse } from 'next/server';
import { knowledgeBaseStorage } from '@/lib/services/storage/KnowledgeBaseStorage';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const agentId = searchParams.get('agentId') || undefined;

        const kb = await knowledgeBaseStorage.getCached(agentId);

        if (!kb) {
            return NextResponse.json({
                exists: false,
                message: `No knowledge base found for agent: ${agentId || 'default'}. KB may need to be indexed.`,
                agentId: agentId || 'default'
            });
        }

        const fileCount = Object.keys(kb.fileMetadata || {}).length;
        const chunkCount = kb.chunks?.length || 0;

        return NextResponse.json({
            exists: true,
            agentId: agentId || 'default',
            fileCount,
            chunkCount,
            files: Object.entries(kb.fileMetadata || {}).map(([id, meta]: [string, any]) => ({
                id,
                name: meta.name || 'Unknown',
                chunkCount: meta.chunkCount || 0,
                indexedAt: meta.indexedAt || 'unknown'
            })),
            documentName: kb.documentName,
            indexedAt: kb.indexedAt
        });
    } catch (error) {
        console.error('Error checking KB status:', error);
        return NextResponse.json(
            { error: 'Failed to check KB status', details: String(error) },
            { status: 500 }
        );
    }
}

