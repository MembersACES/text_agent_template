/**
 * Chat API Route
 *
 * Thin HTTP controller — validates the request, delegates everything to
 * GeminiChatService, and maps the result back to an HTTP response.
 *
 * Business logic lives exclusively in lib/services/chat/.
 */

import { NextResponse } from 'next/server';
import { chatMessageTrace } from '@/lib/config/chatMessageTrace';
import { getLogger } from '@/lib/config/logger';
import { GeminiChatService } from '@/lib/services/chat/GeminiChatService';

const logger = getLogger('ChatAPI');

export async function POST(request: Request) {
    const body = await request.json();
    const { message, conversationHistory, useKnowledgeBase, agentId, uploadedFiles } = body;

    if (!message) {
        return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    try {
        const result = await chatMessageTrace.run(
            { message, conversationHistory, useKnowledgeBase, agentId, uploadedFiles },
            async () => {
                const chatService = new GeminiChatService();
                return chatService.chat({
                    message,
                    conversationHistory,
                    useKnowledgeBase,
                    agentId,
                    uploadedFiles,
                });
            },
        );

        return NextResponse.json(result);
    } catch (error: unknown) {
        logger.error('Chat request failed', error);

        const messageText = error instanceof Error ? error.message : 'Failed to process message';
        return NextResponse.json({ error: messageText }, { status: 500 });
    }
}
