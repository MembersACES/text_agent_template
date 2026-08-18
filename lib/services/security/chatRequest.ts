/**
 * Request-side hardening helpers for /api/chat (Tier 1 + Tier 2 origin check).
 * Pure functions over plain inputs so they're unit-testable without a server.
 */

export interface ChatLimits {
    maxMessageChars: number;
    maxHistory: number;
    maxUploads: number;
    maxUploadBytes: number;
    /** Allowed agentId shape — keep permissive but bounded. */
    agentIdPattern: RegExp;
}

export interface ChatValidation {
    ok: boolean;
    /** Generic, PII-free reason for logs; never echo raw payload to the client. */
    error?: string;
}

/**
 * Best-effort client IP for the rate-limit key.
 *
 * ⚠️ Uses the RIGHTMOST X-Forwarded-For entry, not the leftmost. HTG's Cloud Run
 * service is hit directly on `*.run.app` with NO load balancer (confirmed 5 Aug),
 * and the platform APPENDS the real peer IP to any client-supplied XFF. So the
 * leftmost value is attacker-controlled — keying the limiter on it would let a
 * spoofer send `X-Forwarded-For: <random>` per request, land in a fresh bucket
 * each time, and sail past the per-IP cap (also turning the global cap into a
 * DoS lever against real users). The rightmost entry is the trustworthy one.
 *
 * If a load balancer / Cloud Armor is ever fronted in, the trusted-hop index
 * changes — revisit this then.
 */
export function clientIp(headers: { get(name: string): string | null }): string {
    const xff = headers.get('x-forwarded-for');
    if (xff) {
        const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
        if (parts.length) return parts[parts.length - 1];
    }
    return headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * Window conversation history to the last `max` turns. TRUNCATE, don't reject:
 * the client re-sends the full history every turn and never trims, so a hard
 * length rejection would 400 every send once a real conversation passes `max`
 * messages — an availability regression. Windowing keeps long chats working
 * while still bounding per-request cost (the route never processes more than
 * `max` turns regardless of what is POSTed).
 */
export function clampHistory<T>(history: T[] | undefined, max: number): T[] | undefined {
    if (!Array.isArray(history)) return history;
    return history.length > max ? history.slice(-max) : history;
}

/**
 * Origin/Referer allowlist check. Returns true when the request's Origin (or, as
 * a fallback, Referer host) is in `allowed`. If `allowed` is empty, returns true
 * (advisory mode) so the check can't break the widget before the production
 * domains are configured. Note: Origin is browser-set and spoofable outside a
 * browser — this is defence-in-depth, not a hard boundary.
 */
export function originAllowed(
    headers: { get(name: string): string | null },
    allowed: string[],
): boolean {
    if (!allowed.length) return true; // advisory until CHAT_ALLOWED_ORIGINS is set
    const origin = headers.get('origin');
    if (origin && allowed.includes(origin)) return true;
    const referer = headers.get('referer');
    if (referer) {
        try {
            const refOrigin = new URL(referer).origin;
            if (allowed.includes(refOrigin)) return true;
        } catch {
            /* malformed referer */
        }
    }
    return false;
}

/** Validate the chat body against caps. Rejects oversized/abusive payloads. */
export function validateChatBody(body: unknown, limits: ChatLimits): ChatValidation {
    if (!body || typeof body !== 'object') return { ok: false, error: 'body not an object' };
    const b = body as Record<string, unknown>;

    if (typeof b.message !== 'string' || !b.message.trim()) return { ok: false, error: 'message missing/empty' };
    if (b.message.length > limits.maxMessageChars) return { ok: false, error: 'message too long' };

    if (b.conversationHistory !== undefined) {
        // Type-check only. Length is NOT rejected here — the route windows it via
        // clampHistory() so long legitimate chats keep working (see clampHistory).
        if (!Array.isArray(b.conversationHistory)) return { ok: false, error: 'conversationHistory not array' };
    }

    if (b.agentId !== undefined) {
        if (typeof b.agentId !== 'string' || !limits.agentIdPattern.test(b.agentId)) {
            return { ok: false, error: 'invalid agentId' };
        }
    }

    if (b.uploadedFiles !== undefined) {
        if (!Array.isArray(b.uploadedFiles)) return { ok: false, error: 'uploadedFiles not array' };
        if (b.uploadedFiles.length > limits.maxUploads) return { ok: false, error: 'too many uploads' };
        for (const f of b.uploadedFiles) {
            const size = (f && typeof f === 'object' && typeof (f as { size?: unknown }).size === 'number')
                ? (f as { size: number }).size
                : 0;
            if (size > limits.maxUploadBytes) return { ok: false, error: 'upload too large' };
        }
    }

    return { ok: true };
}
