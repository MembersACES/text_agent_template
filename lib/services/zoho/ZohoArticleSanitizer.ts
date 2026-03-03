/**
 * ZohoArticleSanitizer
 *
 * Converts Zoho Desk article HTML bodies into clean plain text suitable
 * for LLM context injection. Preserves paragraph breaks and list structure
 * while stripping all markup.
 */

import { getLogger } from '@/lib/config/logger';

const logger = getLogger('ZohoArticleSanitizer');

export class ZohoArticleSanitizer {
    /**
     * Convert an HTML string to readable plain text.
     */
    sanitize(html: string): string {
        if (!html) return '';

        try {
            let text = html;

            // Replace block-level tags with line breaks before stripping
            text = text.replace(/<\/?(p|div|br|h[1-6]|tr|blockquote|section|article|header|footer)\b[^>]*\/?>/gi, '\n');

            // Convert list items to bullet points
            text = text.replace(/<li\b[^>]*>/gi, '\n- ');
            text = text.replace(/<\/li>/gi, '');

            // Remove list wrappers
            text = text.replace(/<\/?(ul|ol)\b[^>]*>/gi, '\n');

            // Extract link text with URL: [text](url)
            text = text.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)');

            // Strip all remaining tags
            text = text.replace(/<[^>]+>/g, '');

            // Decode common HTML entities
            text = text
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&nbsp;/g, ' ')
                .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)));

            // Normalise whitespace: collapse runs of blank lines to max 2
            text = text.replace(/[ \t]+/g, ' ');
            text = text.replace(/\n{3,}/g, '\n\n');
            text = text.trim();

            return text;
        } catch (error) {
            logger.error(`HTML sanitization failed: ${error}`);
            // Fallback: aggressive tag strip
            return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        }
    }
}

export const zohoArticleSanitizer = new ZohoArticleSanitizer();
