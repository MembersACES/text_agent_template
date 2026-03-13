/**
 * Chat API Route
 *
 * Thin HTTP controller — validates the request, delegates everything to
 * GeminiChatService, and maps the result back to an HTTP response.
 *
 * Business logic lives exclusively in lib/services/chat/.
 */

import { NextResponse } from 'next/server';
import { GeminiChatService } from '@/lib/services/chat/GeminiChatService';

export async function POST(request: Request) {
    try {
        const { message, conversationHistory, useKnowledgeBase, agentId, uploadedFiles } =
            await request.json();

        const chatService = new GeminiChatService();

        if (!message) {
            return NextResponse.json({ error: 'Message is required' }, { status: 400 });
        }

        const result = await chatService.chat({
            message,
            conversationHistory,
            useKnowledgeBase,
            agentId,
            uploadedFiles,
        });

        return NextResponse.json(result);
    } catch (error: any) {
        console.error('[Chat API] Error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to process message' },
            { status: 500 },
        );
    }
}
