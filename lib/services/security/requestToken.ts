import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Short-lived HMAC request token for the chat widget (Tier 2 of the hardening).
 *
 * The widget page fetches a token from `/api/chat-session` (origin-checked) and
 * sends it on every `/api/chat` call. `/api/chat` verifies signature + expiry.
 * This is NOT a user-auth boundary (the widget is anonymous, client-side) — it's
 * a proportionate gate against scripted abuse: a caller must have obtained a
 * fresh, server-signed token, which combined with the origin check + rate limit
 * raises the bar on burning Gemini/dotWMS/MachShip spend.
 *
 * Format: `base64url(JSON{exp,n})` + '.' + HMAC-SHA256(secret, payload) hex.
 * No PII in the token; the nonce is random and opaque.
 */
export function issueToken(secret: string, ttlMs: number, nowMs: number, nonce: string): string {
    const payloadObj = { exp: nowMs + ttlMs, n: nonce };
    const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
    const sig = createHmac('sha256', secret).update(payload).digest('hex');
    return `${payload}.${sig}`;
}

export interface TokenVerifyResult {
    valid: boolean;
    reason?: 'no-secret' | 'malformed' | 'bad-signature' | 'bad-payload' | 'expired';
}

export function verifyToken(secret: string, token: string | null | undefined, nowMs: number): TokenVerifyResult {
    if (!secret) return { valid: false, reason: 'no-secret' };
    if (!token || typeof token !== 'string' || !token.includes('.')) return { valid: false, reason: 'malformed' };
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return { valid: false, reason: 'malformed' };

    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false, reason: 'bad-signature' };

    let parsed: { exp?: unknown };
    try {
        parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
        return { valid: false, reason: 'bad-payload' };
    }
    if (typeof parsed.exp !== 'number' || parsed.exp < nowMs) return { valid: false, reason: 'expired' };
    return { valid: true };
}
