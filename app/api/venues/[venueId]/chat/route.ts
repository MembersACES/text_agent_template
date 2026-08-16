/**
 * POST /api/venues/{venueId}/chat
 *
 * Venue-scoped chat — same body as POST /api/chat; `venueId` in the path overrides
 * body/header/env for GVACA records (e.g. RGR tool). Use this shape when adding
 * multi-venue routing (subdomain can map to this path server-side).
 */

import { NextResponse } from 'next/server';
import { GeminiChatService } from '@/lib/services/chat/GeminiChatService';

export async function POST(
    request: Request,
    { params }: { params: Promise<{ venueId: string }> },
) {
    try {
        const { venueId: venueIdParam } = await params;
        const venueId = decodeURIComponent(venueIdParam ?? '').trim();
        if (!venueId) {
            return NextResponse.json({ error: 'venueId path segment is required' }, { status: 400 });
        }

        const body = await request.json();
        const { message, conversationHistory, useKnowledgeBase, agentId, uploadedFiles } = body;

        if (!message) {
            return NextResponse.json({ error: 'Message is required' }, { status: 400 });
        }

        const chatService = new GeminiChatService();
        const result = await chatService.chat({
            message,
            conversationHistory,
            useKnowledgeBase,
            agentId,
            uploadedFiles,
            venueId,
        });

        return NextResponse.json(result);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to process message';
        console.error('[Venue Chat API] Error:', error);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
