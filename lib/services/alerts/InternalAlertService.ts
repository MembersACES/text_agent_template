import { getLogger } from '@/lib/config/logger';
import { settings } from '@/lib/config/settings';
import { createAlertTransport } from './transports';
import { DEFAULT_REASON, teamForTrigger } from './triggerMap';
import type { AlertMessage, AlertSendResult, AlertTransport, InternalAlert } from './types';

const logger = getLogger('InternalAlertService');

interface AlertServiceOpts {
    transport?: AlertTransport;
    now?: () => number;
    enabled?: boolean;
    fromAddress?: string;
    toAddress?: string;
    dedupTtlMs?: number;
    maxPerHour?: number;
}

/**
 * Composes and sends internal CS/WH alert emails, gated + deduped + rate-limited.
 *
 * SERVER-SIDE ONLY. Behind `settings.alerts.enabled` (default false). NOT wired
 * into /api/chat or OrderStatusGate — automated email must wait on the API
 * hardening (an open endpoint could spam the HTG Helpdesk).
 *
 * Dedup + rate-limit are IN-MEMORY, so they are per-instance. On multi-instance
 * Cloud Run that means the caps are per-instance, not global — acceptable as a
 * flood-stop for phase 1, but for true global limits use the same shared store
 * the /api/chat rate-limiter will need (see API-Hardening-Plan.md). The store is
 * intentionally simple and swappable here.
 */
export class InternalAlertService {
    private readonly transport: AlertTransport;
    private readonly now: () => number;
    private readonly enabled: boolean;
    private readonly fromAddress: string;
    private readonly toAddress: string;
    private readonly dedupTtlMs: number;
    private readonly maxPerHour: number;

    /** dedup key → expiry timestamp (ms). */
    private readonly seen = new Map<string, number>();
    /** send timestamps within the rolling hour, for the global rate cap. */
    private sentTimestamps: number[] = [];

    constructor(opts: AlertServiceOpts = {}) {
        this.enabled = opts.enabled ?? settings.alerts.enabled;
        this.fromAddress = opts.fromAddress ?? settings.alerts.fromAddress;
        this.toAddress = opts.toAddress ?? settings.alerts.toAddress;
        this.dedupTtlMs = opts.dedupTtlMs ?? settings.alerts.dedupTtlMinutes * 60_000;
        this.maxPerHour = opts.maxPerHour ?? settings.alerts.maxPerHour;
        this.now = opts.now ?? (() => Date.now());
        this.transport = opts.transport ?? createAlertTransport({
            transport: settings.alerts.transport,
            webhook: settings.alerts.webhook,
            smtp: settings.alerts.smtp,
        });
    }

    /** Compose the subject: `H2G AI ALERT_<TEAM>_<Name or (Unknown)>`. */
    buildSubject(alert: InternalAlert): string {
        const team = teamForTrigger(alert.trigger);
        const name = alert.customerName?.trim() || '(Unknown)';
        return `H2G AI ALERT_${team}_${name}`;
    }

    buildBody(alert: InternalAlert): string {
        return [
            `Customer Name: ${alert.customerName?.trim() || '(Unknown)'}`,
            `Email Address: ${alert.customerEmail.trim()}`,
            `Order Number: ${alert.orderNumber.trim()}`,
            `Reason: ${alert.reason?.trim() || DEFAULT_REASON[alert.trigger]}`,
        ].join('\n');
    }

    compose(alert: InternalAlert): AlertMessage {
        return {
            from: this.fromAddress,
            to: this.toAddress,
            subject: this.buildSubject(alert),
            body: this.buildBody(alert),
            // Structured fields for the webhook transport (n8n builds its own
            // subject/body from these). Email transports use subject/body above.
            payload: {
                team: teamForTrigger(alert.trigger),
                customerName: alert.customerName?.trim() || null,
                orderNumber: alert.orderNumber.trim(),
                customerEmail: alert.customerEmail.trim(),
                reason: alert.reason?.trim() || DEFAULT_REASON[alert.trigger],
            },
        };
    }

    async send(alert: InternalAlert): Promise<AlertSendResult> {
        const team = teamForTrigger(alert.trigger);
        // Mask order in any log line; never log name/email.
        const maskedOrder = this.maskOrder(alert.orderNumber);

        if (!this.enabled) {
            logger.info(`alert suppressed: feature disabled (team=${team}, order=${maskedOrder})`);
            return { sent: false, disabled: true, team };
        }

        const key = this.dedupKey(alert);
        const nowMs = this.now();
        this.purge(nowMs);

        if (this.seen.has(key)) {
            logger.info(`alert deduped (team=${team}, order=${maskedOrder})`);
            return { sent: false, deduped: true, team };
        }
        if (this.sentTimestamps.length >= this.maxPerHour) {
            logger.warn(`alert rate-limited: ${this.maxPerHour}/hour reached (team=${team}, order=${maskedOrder})`);
            return { sent: false, rateLimited: true, team };
        }

        // Record the ATTEMPT *before* sending: a failing/misconfigured transport
        // (e.g. n8n secret out of sync) must not be able to re-POST the same
        // customer's PII on every turn. Dedup + hourly cap are therefore attempt-
        // based — a down webhook is suppressed for the dedup window rather than
        // hammered. The pre-send checks above already gate on these counters.
        this.seen.set(key, nowMs + this.dedupTtlMs);
        this.sentTimestamps.push(nowMs);

        try {
            await this.transport.send(this.compose(alert));
        } catch (err) {
            // No PII in the error path.
            logger.error(`alert send failed via ${this.transport.name} (team=${team}, order=${maskedOrder})`, err);
            return { sent: false, error: err instanceof Error ? err.message : String(err), team };
        }

        logger.info(`alert sent via ${this.transport.name} (team=${team}, order=${maskedOrder})`);
        return { sent: true, team };
    }

    private dedupKey(alert: InternalAlert): string {
        const scope = alert.conversationId?.trim() || `${alert.orderNumber.trim()}|${alert.customerEmail.trim().toLowerCase()}`;
        return `${alert.trigger}:${scope}`;
    }

    private purge(nowMs: number): void {
        for (const [k, expiry] of this.seen) {
            if (expiry <= nowMs) this.seen.delete(k);
        }
        const cutoff = nowMs - 3_600_000;
        this.sentTimestamps = this.sentTimestamps.filter((t) => t > cutoff);
    }

    private maskOrder(order: string): string {
        const s = String(order ?? '').trim();
        return s.length > 3 ? `***${s.slice(-3)}` : '***';
    }
}
