/**
 * ConversationHistoryService
 *
 * Single responsibility: transform a raw conversation history array into a
 * human-readable, token-safe string that can be injected into a prompt.
 */

export interface ConversationMessage {
    role: 'user' | 'assistant' | string;
    content: string | unknown;
}

export class ConversationHistoryService {
    private static readonly MAX_MESSAGES = 10;
    private static readonly MAX_MESSAGE_LENGTH = 2_000;

    /**
     * Format the conversation history for injection into an LLM prompt.
     * Returns an empty string when there is no relevant history.
     */
    format(history: ConversationMessage[]): string {
        if (!Array.isArray(history) || history.length === 0) return '';

        const relevant = history
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .slice(-ConversationHistoryService.MAX_MESSAGES);

        if (relevant.length === 0) return '';

        const lines = relevant.map(m => {
            const role = m.role === 'user' ? 'User' : 'Assistant';
            let content = typeof m.content === 'string' ? m.content : '';
            if (content.length > ConversationHistoryService.MAX_MESSAGE_LENGTH) {
                content = content.substring(0, ConversationHistoryService.MAX_MESSAGE_LENGTH) + '[... truncated ...]';
            }
            return `${role}: ${content}`;
        });

        return `PREVIOUS CONVERSATION (last ${relevant.length} messages):\n${lines.join('\n\n')}\n\n`;
    }
}
