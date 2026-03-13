import { NextResponse } from 'next/server';
import { gcsClient } from '@/lib/services/storage/GcsClient';

/**
 * DELETE /api/agents/[agentId]
 *
 * Deletes all GCS files for the given agent (agents/{agentId}/ prefix only).
 * No other agent files or root-level bucket files are affected.
 */
export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ agentId: string }> }
) {
    const { agentId } = await params;

    if (!agentId) {
        return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
    }

    try {
        const result = await gcsClient.deleteAgent(agentId);
        return NextResponse.json({
            success: true,
            agentId,
            deletedFiles: result.deleted,
        });
    } catch (err: any) {
        console.error(`[DELETE /api/agents/${agentId}] Error:`, err);
        return NextResponse.json(
            { error: err.message || 'Failed to delete agent' },
            { status: 500 }
        );
    }
}
