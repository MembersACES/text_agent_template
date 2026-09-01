/**
 * Internal team alerts (server-side only).
 *
 * When the agent hits a case it can't resolve, it emails an internal HTG team so
 * a human follows up. Two teams, routed by trigger (see triggerMap):
 *   - CS (customer service): order not found; customer won't wait for a box.
 *   - WH (warehouse):        customer chasing a queued / in-packing order.
 *
 * ⚠️ These emails are a SIDE-EFFECTING action to a real inbox. They must ONLY be
 * sent server-side, behind the ALERTS_ENABLED flag, AND only once the /api/chat
 * hardening lands — an open endpoint could otherwise be used to spam the HTG
 * Helpdesk. Never invoke from client code.
 */

export type AlertTeam = 'CS' | 'WH';

/** The conversational situations that escalate. Mapped to a team in triggerMap. */
export type AlertTrigger = 'not_found' | 'queued_chasing' | 'wont_wait' | 'collection_refused' | 'duplicate_consignments';

export interface InternalAlert {
    trigger: AlertTrigger;
    /** Customer name if known; null → subject uses "(Unknown)". */
    customerName: string | null;
    customerEmail: string;
    orderNumber: string;
    /** Brief, human-readable reason for the escalation. */
    reason: string;
    /**
     * Optional scope for dedup — pass the conversation/session id so the same
     * conversation can't fire the same alert repeatedly. Falls back to order+email.
     */
    conversationId?: string;
}

export interface AlertSendResult {
    sent: boolean;
    /** true when suppressed as a duplicate within the dedup window. */
    deduped?: boolean;
    /** true when suppressed by the global rate limit. */
    rateLimited?: boolean;
    /** true when the ALERTS_ENABLED flag is off. */
    disabled?: boolean;
    /** transport error message (no PII). */
    error?: string;
    /** which team it routed to (audit). */
    team?: AlertTeam;
}

/**
 * Structured alert fields for transports that reformat downstream (the n8n
 * webhook builds its own subject/body from these, so wording changes need no
 * redeploy). Contains PII (name/email/order) — transports MUST NOT log it.
 */
export interface AlertPayload {
    team: AlertTeam;
    customerName: string | null;
    orderNumber: string;
    customerEmail: string;
    reason: string;
}

/** A composed, ready-to-send message. No PII beyond what the alert already carries. */
export interface AlertMessage {
    from: string;
    to: string;
    subject: string;
    body: string;
    /** Structured fields for reformatting transports (webhook). Email transports use subject/body. */
    payload: AlertPayload;
}

/** Swappable send mechanism. Implementations must not log PII. */
export interface AlertTransport {
    readonly name: string;
    send(message: AlertMessage): Promise<void>;
}
