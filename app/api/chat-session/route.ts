/**
 * Chat session token endpoint (Tier 2 of the hardening).
 *
 * The chat widget page is a CLIENT component ('use client'), so it can't mint a
 * server-signed token at render time. Instead it GETs one from here on load and
 * sends it as `x-chat-token` on every `/api/chat` call. This route:
 *   - runs the same Origin/Referer sanity check as /api/chat (spoofable, so
 *     defence-in-depth only), and
 *   - mints a short-lived HMAC token via issueToken.
 *
 * INERT when no secret is configured (CHAT_TOKEN_SECRET unset): returns
 * { token: null } so the widget proceeds token-less. Enforcement only bites when
 * /api/chat has requireToken=true AND a secret is set. No PII in the token.
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getLogger } from '@/lib/config/logger';
import { settings } from '@/lib/config/settings';
import { clientIp, originAllowed } from '@/lib/services/security/chatRequest';
import { RateLimiter } from '@/lib/services/security/rateLimiter';
import { issueToken } from '@/lib/services/security/requestToken';

const logger = getLogger('ChatSession');

/**
 * Rate-limit token MINTING too, not just /api/chat. Otherwise a scripted caller
 * could pull a fresh 60-min token on demand and the Tier-2 token buys nothing
 * against exactly the scripted abuse it's meant to slow. Same per-instance
 * limiter shape as /api/chat (separate instance — module scope per route file).
 */
const rateLimiter = new RateLimiter({
    windowMs: settings.chatSecurity.rateLimit.windowMs,
    perKeyMax: settings.chatSecurity.rateLimit.perIpMax,
    globalMax: settings.chatSecurity.rateLimit.globalMax,
});

export async function GET(request: Request) {
    const { headers } = request;
    const sec = settings.chatSecurity;

    // Same advisory origin check as /api/chat (empty allowlist ⇒ allowed).
    if (sec.requireOrigin && !originAllowed(headers, sec.allowedOrigins)) {
        logger.warn('chat-session rejected: origin not allowed');
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const rl = rateLimiter.check(clientIp(headers), Date.now());
    if (!rl.allowed) {
        logger.warn(`chat-session rate-limited (${rl.reason})`);
        const res = NextResponse.json({ error: 'Too many requests' }, { status: 429 });
        if (rl.retryAfterMs) res.headers.set('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
        return res;
    }

    // Inert until a secret is configured — widget proceeds token-less.
    if (!sec.tokenSecret) {
        return NextResponse.json({ token: null, expiresIn: 0 });
    }

    const ttlMs = Math.max(1, sec.tokenTtlMinutes) * 60_000;
    const token = issueToken(sec.tokenSecret, ttlMs, Date.now(), randomUUID());

    // no-store: a token must never be cached by a proxy/CDN and replayed.
    const res = NextResponse.json({ token, expiresIn: ttlMs });
    res.headers.set('Cache-Control', 'no-store');
    return res;
}
