/**
 * In-memory sliding-window rate limiter (Tier 3 of the hardening).
 *
 * ⚠️ PER-INSTANCE. Cloud Run runs one of these per container instance, so the
 * caps are per-instance, not global. HTG's Cloud Run service is NOT behind a
 * load balancer (confirmed 5 Aug — GCP Load Balancing list empty), so app-level
 * limiting is the chosen approach; this is a genuine flood-stop against scripted
 * abuse. For a strictly-global cap, back this with a shared store (Firestore /
 * Memorystore) — the same store the alert dedup would use. Documented, not hidden.
 */
export interface RateLimitResult {
    allowed: boolean;
    reason?: 'per-key' | 'global';
    retryAfterMs?: number;
}

export class RateLimiter {
    private readonly windowMs: number;
    private readonly perKeyMax: number;
    private readonly globalMax: number;
    private readonly perKey = new Map<string, number[]>();
    private globalHits: number[] = [];

    constructor(opts: { windowMs: number; perKeyMax: number; globalMax: number }) {
        this.windowMs = opts.windowMs;
        this.perKeyMax = opts.perKeyMax;
        this.globalMax = opts.globalMax;
    }

    check(key: string, nowMs: number): RateLimitResult {
        const cutoff = nowMs - this.windowMs;

        this.globalHits = this.globalHits.filter((t) => t > cutoff);
        if (this.globalHits.length >= this.globalMax) {
            return { allowed: false, reason: 'global', retryAfterMs: this.windowMs };
        }

        const arr = (this.perKey.get(key) ?? []).filter((t) => t > cutoff);
        if (arr.length >= this.perKeyMax) {
            this.perKey.set(key, arr);
            return { allowed: false, reason: 'per-key', retryAfterMs: this.windowMs };
        }

        arr.push(nowMs);
        this.perKey.set(key, arr);
        this.globalHits.push(nowMs);

        // Opportunistic cleanup so the map doesn't grow unbounded across many IPs.
        if (this.perKey.size > 10_000) {
            for (const [k, v] of this.perKey) {
                if (v.every((t) => t <= cutoff)) this.perKey.delete(k);
            }
        }
        return { allowed: true };
    }
}
