import { getLogger } from '@/lib/config/logger';
import type { AlertMessage, AlertTransport } from './types';

const logger = getLogger('AlertTransport');

/**
 * Default, side-effect-FREE transport. Used when SMTP isn't configured (or in
 * dev). It does NOT send and does NOT log PII — only that a send would occur.
 */
export class LogAlertTransport implements AlertTransport {
    public readonly name = 'log';

    async send(message: AlertMessage): Promise<void> {
        // Deliberately omit subject/body (they contain the customer name/email).
        logger.warn(`LogAlertTransport: would send an alert to ${message.to} (content withheld — contains PII). No email sent.`);
    }
}

/**
 * Authenticated-SMTP transport. `nodemailer` is imported dynamically via a
 * string specifier so this module type-checks and builds WITHOUT the dependency
 * installed — nodemailer is only needed at runtime once alerts are enabled with
 * SMTP configured. Before enabling: `npm i nodemailer`.
 *
 * Recommended for acesolutions.com.au: authenticated SMTP through the Workspace
 * mailbox (app password) or the Workspace SMTP relay. SPF/DKIM for the sending
 * domain are REQUIRED — these alerts hit HTG's Helpdesk and route by sender, so
 * if they land in spam the feature silently fails.
 */
export class SmtpAlertTransport implements AlertTransport {
    public readonly name = 'smtp';

    constructor(private readonly cfg: { host: string; port: number; user: string; pass: string }) {}

    async send(message: AlertMessage): Promise<void> {
        const specifier: string = 'nodemailer';
        const nodemailer = (await import(specifier)) as unknown as {
            createTransport(opts: unknown): { sendMail(mail: unknown): Promise<unknown> };
        };
        const transporter = nodemailer.createTransport({
            host: this.cfg.host,
            port: this.cfg.port,
            secure: this.cfg.port === 465,
            auth: { user: this.cfg.user, pass: this.cfg.pass },
        });
        await transporter.sendMail({
            from: message.from,
            to: message.to,
            subject: message.subject,
            text: message.body,
        });
    }
}

/**
 * n8n webhook transport — the CHOSEN alert path (supersedes SMTP / Workspace
 * app-password). POSTs the structured alert as JSON; the n8n workflow validates
 * the shared secret, then formats and sends the email. Wording (subject/body)
 * lives in n8n, so changes need no redeploy here.
 *
 * ⚠️ The shared secret is sent on every call (`x-alert-secret`). n8n MUST reject
 * requests without it — an unvalidated webhook is a spam vector into the HTG
 * inbox. The secret lives in `.env` only (never committed).
 *
 * Does NOT log the payload (it carries customer name/email/order). On failure it
 * throws only the HTTP status — no PII in the error path.
 */
export class WebhookAlertTransport implements AlertTransport {
    public readonly name = 'webhook';

    constructor(private readonly cfg: { url: string; secret: string }) {}

    async send(message: AlertMessage): Promise<void> {
        // Fail CLOSED: never transmit the PII payload unauthenticated. Without a
        // secret n8n would reject it anyway (no email sent), but the data would
        // already have left the process — so we don't send at all.
        if (!this.cfg.secret) {
            throw new Error('webhook secret not configured — refusing to POST alert');
        }
        const res = await fetch(this.cfg.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-alert-secret': this.cfg.secret,
            },
            body: JSON.stringify(message.payload),
        });
        if (res.status < 200 || res.status >= 300) {
            // Status only — never echo the response body (may reflect the payload).
            throw new Error(`webhook returned HTTP ${res.status}`);
        }
    }
}

export type AlertTransportKind = 'log' | 'webhook' | 'smtp';

export interface AlertTransportConfig {
    transport: string; // 'log' | 'webhook' | 'smtp' (validated here; unknown → log)
    webhook: { url: string; secret: string };
    smtp: { host: string; port: number; user: string; pass: string };
}

/**
 * Select the transport from `ALERTS_TRANSPORT`. `webhook` is the chosen path;
 * `smtp` is retained as a fallback option; `log` (default) is the safe no-send.
 * Any misconfiguration degrades to LogAlertTransport rather than silently failing
 * to alert with no trace.
 */
export function createAlertTransport(cfg: AlertTransportConfig): AlertTransport {
    switch (cfg.transport) {
        case 'webhook':
            if (cfg.webhook.url) return new WebhookAlertTransport(cfg.webhook);
            logger.warn('ALERTS_TRANSPORT=webhook but ALERTS_WEBHOOK_URL is empty — using LogAlertTransport (no alerts sent).');
            return new LogAlertTransport();
        case 'smtp':
            if (cfg.smtp.host && cfg.smtp.user && cfg.smtp.pass) return new SmtpAlertTransport(cfg.smtp);
            logger.warn('ALERTS_TRANSPORT=smtp but SMTP is not fully configured — using LogAlertTransport (no alerts sent).');
            return new LogAlertTransport();
        case 'log':
            return new LogAlertTransport();
        default:
            logger.warn(`Unknown ALERTS_TRANSPORT="${cfg.transport}" — using LogAlertTransport (no alerts sent).`);
            return new LogAlertTransport();
    }
}
