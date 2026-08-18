/**
 * Chat API Route
 *
 * Thin HTTP controller — validates the request, delegates everything to
 * GeminiChatService, and maps the result back to an HTTP response.
 *
 * Business logic lives exclusively in lib/services/chat/.
 *
 * HARDENING (API-Hardening-Plan.md, Tiers 1–3). Applied in cheap-to-expensive
 * order so abusive traffic is shed before it costs anything:
 *   1. Origin/Referer sanity check  (Tier 2, defence-in-depth — spoofable)
 *   2. Per-IP + global rate limit    (Tier 3, app-level — no LB/Cloud Armor)
 *   3. Signed request token          (Tier 2, the real gate — flag-gated)
 *   4. JSON parse + payload caps      (Tier 1)
 *   5. Delegate to GeminiChatService
 * On any handled error we log full detail server-side and return ONLY a generic
 * body + correlationId (Tier 1 error hygiene — never leak error.message).
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { chatMessageTrace } from '@/lib/config/chatMessageTrace';
import { getLogger } from '@/lib/config/logger';
import { GeminiChatService } from '@/lib/services/chat/GeminiChatService';
import { settings } from '@/lib/config/settings';
import { RateLimiter } from '@/lib/services/security/rateLimiter';
import {
    clientIp,
    originAllowed,
    validateChatBody,
    clampHistory,
    type ChatLimits,
} from '@/lib/services/security/chatRequest';
import { verifyToken } from '@/lib/services/security/requestToken';
import { redactPII, redactDeep } from '@/lib/services/privacy/redact';
import type { ConversationMessage } from '@/lib/services/chat/ConversationHistoryService';

const logger = getLogger('ChatAPI');

/**
 * Module-scoped so it survives across requests within a single Cloud Run
 * instance. PER-INSTANCE (see RateLimiter docs): HTG's service is NOT behind a
 * load balancer (confirmed 5 Aug — GCP Load Balancing list empty), so app-level
 * limiting is the chosen approach. A strictly-global cap would need a shared
 * store (Firestore/Memorystore) — deliberately deferred, documented not hidden.
 */
const rateLimiter = new RateLimiter({
    windowMs: settings.chatSecurity.rateLimit.windowMs,
    perKeyMax: settings.chatSecurity.rateLimit.perIpMax,
    globalMax: settings.chatSecurity.rateLimit.globalMax,
});

const CHAT_LIMITS: ChatLimits = {
    maxMessageChars: settings.chatSecurity.limits.maxMessageChars,
    maxHistory: settings.chatSecurity.limits.maxHistory,
    maxUploads: settings.chatSecurity.limits.maxUploads,
    maxUploadBytes: settings.chatSecurity.limits.maxUploadBytes,
    // Permissive but bounded — the app's agent ids are short slugs.
    agentIdPattern: /^[A-Za-z0-9_-]{1,64}$/,
};

export async function POST(request: Request) {
    const correlationId = randomUUID();
    const { headers } = request;
    const sec = settings.chatSecurity;
    const now = Date.now();

    // ── Tier 2a: Origin/Referer sanity check (defence-in-depth; spoofable) ──
    // Advisory when allowedOrigins is empty (see originAllowed) so this can't
    // break the widget before the production domains are configured.
    if (sec.requireOrigin && !originAllowed(headers, sec.allowedOrigins)) {
        logger.warn(`chat rejected: origin not allowed [${correlationId}]`);
        return NextResponse.json({ error: 'Forbidden', correlationId }, { status: 403 });
    }

    // ── Tier 3: per-IP + global rate limit ──
    const rl = rateLimiter.check(clientIp(headers), now);
    if (!rl.allowed) {
        logger.warn(`chat rate-limited (${rl.reason}) [${correlationId}]`);
        const res = NextResponse.json({ error: 'Too many requests', correlationId }, { status: 429 });
        if (rl.retryAfterMs) res.headers.set('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
        return res;
    }

    // ── Tier 2b: signed request token (flag-gated; default OFF until smoke-tested) ──
    if (sec.requireToken) {
        const verdict = verifyToken(sec.tokenSecret, headers.get('x-chat-token'), now);
        if (!verdict.valid) {
            logger.warn(`chat rejected: token ${verdict.reason} [${correlationId}]`);
            return NextResponse.json({ error: 'Unauthorized', correlationId }, { status: 401 });
        }
    }

    // ── Parse body defensively (Tier 1) ──
    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid request', correlationId }, { status: 400 });
    }

    // ── Tier 1: payload caps + input validation ──
    const validation = validateChatBody(body, CHAT_LIMITS);
    if (!validation.ok) {
        // Generic reason only — never echo the raw payload back to the client.
        logger.warn(`chat rejected: ${validation.error} [${correlationId}]`);
        return NextResponse.json({ error: 'Invalid request', correlationId }, { status: 400 });
    }

    const { message, conversationHistory, useKnowledgeBase, agentId, uploadedFiles } = body;
    // Window history to the last N turns (truncate, don't reject — see clampHistory).
    const history = clampHistory<ConversationMessage>(
        conversationHistory as ConversationMessage[] | undefined,
        CHAT_LIMITS.maxHistory,
    );

    try {
        // Trace metadata gets REDACTED copies (email + order# scrubbed everywhere —
        // prior turns in history carry PII too, and uploads are elided by redactDeep);
        // the chat call inside the closure gets the REAL values so the lookup works.
        const result = await chatMessageTrace.run(
            {
                message: redactPII(message),
                conversationHistory: redactDeep(history) as unknown[],
                useKnowledgeBase,
                agentId,
                uploadedFiles: redactDeep(uploadedFiles) as unknown[],
            },
            async () => {
                const chatService = new GeminiChatService();
                return chatService.chat({
                    message,
                    conversationHistory: history,
                    useKnowledgeBase,
                    agentId,
                    uploadedFiles,
                });
            },
        );

        return NextResponse.json(result);
    } catch (error: unknown) {
        // Tier 1 error hygiene: full detail to the server log, generic body out.
        logger.error(`Chat request failed [${correlationId}]`, error);
        return NextResponse.json({ error: 'Something went wrong', correlationId }, { status: 500 });
    }
}
