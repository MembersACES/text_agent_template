/**
 * OrderStatusGate — live order tracking + deflection
 * ==================================================
 * Adds real order tracking via OrderTrackingService (the swappable
 * dotWMS→MachShip pipeline) on top of the original "can't look up your order"
 * deflection (retained verbatim in the lower half of this file).
 *
 * WIRED: GeminiChatService.runChat calls handleOrderTracking() in the pre-KB
 * stage, ahead of the stuck-packing deflection, so a real status answer wins.
 * Tracking stays DARK until ORDER_TRACKING_ENABLED=true
 * (→ settings.freight.trackingEnabled): handleOrderTracking() returns null when
 * the flag is off, so the existing deflection continues to serve unchanged.
 *
 * (History: staged during the hardening build as OrderStatusGate.rewrite.ts;
 * that file now re-exports from here so the two never drift.)
 *
 * No secrets or PII are logged here; order numbers and emails are never written
 * to logs.
 */

import { getLogger } from '@/lib/config/logger';
import { settings } from '@/lib/config/settings';
import { OrderTrackingService } from '@/lib/services/tracking/OrderTrackingService';
import type { TrackingResult } from '@/lib/services/tracking/types';
import { DRAFT_COPY } from '@/lib/services/tracking/trackingCopy';
import { InternalAlertService } from '@/lib/services/alerts/InternalAlertService';
import type { InternalAlert } from '@/lib/services/alerts/types';
import { ConversationMessage } from './ConversationHistoryService';

const logger = getLogger('OrderStatusGate');

const ORDER_STATUS_PAGE = 'https://goodness.com.au/order-status/';

const SUPPORT_CHANNELS =
    'Honest to Goodness support by phone, email, or the web forms on our website';

// ── Existing deflection intents (unchanged from the live gate) ───────────────
const STUCK_PACKING_INTENT =
    /\b(in queue for packing|queue for packing|stuck in packing|still (?:in )?(?:queue|packing)|packing for (?:more than )?\d+|\d+\s*(?:business\s*)?days?.*(?:packing|packed|shipped|dispatch)|not shipped|hasn't shipped|has not shipped)\b/i;

const EXTENDED_DELAY_INTENT =
    /\b(more than|over|past|at least|for)\s*(?:two|2|three|3|four|4|five|5|\d+)\s*(?:business\s*)?days?\b/i;

const FALSE_ESCALATION_PROMISE =
    /\b(I will|I'll|we will|I can)\s+(?:then\s+)?(?:escalat|raise|log|create).*(?:ticket|case|support team)/i;

// ── New: live order-tracking intent + extraction ─────────────────────────────
// Heuristic (tunable): a tracking/status verb together with an order-ish noun or
// an order-number-looking token. Kept deliberately conservative so it doesn't
// swallow general delivery-policy questions ("do you deliver to WA?").
// Widened 18 Aug 2026 after live widget testing: "Can you check order X for Y"
// carried a full order number AND email but matched no verb, so the gate returned
// null and the customer got the legacy "go to goodness.com.au/order-status"
// deflection. Added the ask-shaped verbs (check / look up / find / chase / follow
// up / update / progress / received / eta). Regression-tested against the
// delivery-POLICY questions this must NOT swallow ("do you deliver to WA?",
// "how much is shipping?", "can you check if you have turmeric powder?").
const TRACKING_VERB =
    /\b(track|tracking|where(?:'?s| is| are)?|status|arriv\w*|deliver(?:ed|y)?|dispatch\w*|shipp\w*|coming|on its way|check|checking|look ?up|looking up|find|chase|chasing|follow(?:ing)? ?up|update|progress|received|receive|eta|when will)\b/i;
const ORDER_NOUN = /\b(order|parcel|package|shipment|consignment|#?\d{6,8})\b/i;

// A product-CONDITION complaint is not a tracking question, even when the message
// carries a valid order number and email. Found by live widget test 18 Aug 2026:
// "My order 359633 arrived damaged, email ..." returned "Your order has been
// delivered" and the damage report was never seen — the customer never reached the
// credit/returns form (Iri's policy, 3 May 2026). Cause: GeminiChatService runs
// OrderStatusGate (line ~173) BEFORE ComplaintsResponseGate (line ~194), and
// `arriv\w*` matches "arrived". Deliberately EXCLUDES refund/return/cancel — the
// wont_wait trigger below owns "I don't want to wait, just refund it".
const CONDITION_COMPLAINT =
    /\b(damaged|broken|crushed|leaking|smashed|mouldy|moldy|rotten|spoiled|spoilt|expired|out of date|wrong item|incorrect item|received the wrong|sent the wrong|missing item|item missing|short ?shipped|faulty|not in (?:my|the) order)\b/i;

// An explicit request to CHANGE something about the order is not a tracking question,
// even though it usually carries the order number and often the word "delivery".
// Found 1 Sep 2026 while regression-testing the bare-details fix: "Can you change the
// delivery address on order 359633, email ..." matched TRACKING_VERB via `deliver(?:ed|y)?`
// ("delivery address") and returned a delivery status instead of routing the customer to
// someone who can actually change it. Pre-dates the bare-details change.
// Guarded on !isWontWaitFollowup at the call site, same as CONDITION_COMPLAINT, because
// WONT_WAIT_INTENT legitimately owns "cancel the rest" / "cancel the remaining".
const ORDER_CHANGE_REQUEST =
    /\b(cancel (?:my|the|this|that) order|cancel order|change (?:the |my )?(?:delivery |shipping |postal |street |home )?address|change (?:the |my )?(?:delivery |dispatch )?(?:date|day)|update (?:the |my )?(?:delivery |shipping |postal )?address|add (?:an? |another )?item|remove (?:an? )?item|amend (?:my |the )?order|tax invoice|invoice|receipt|reschedule|redirect (?:my |the )?(?:order|parcel|delivery))\b/i;

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
// 6-digit BigCommerce (optionally BC- prefixed) or 8-digit Syspro (optionally SO).
const ORDER_NUM_RE = /\b(?:BC-?)?(?:SO)?\d{6,8}\b/i;

// Global twins used only for stripping in isBareOrderDetails (String.replace with a
// non-global regex replaces the first match only).
const EMAIL_RE_G = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const ORDER_NUM_RE_G = /\b(?:BC-?)?(?:SO)?\d{6,8}\b/gi;

// Words that carry no intent of their own once the order number and email have been
// stripped out. Used to decide whether a message is NOTHING BUT a set of order
// details. Found by live widget test 1 Sep 2026: "Order 359633, email TIFFANY@..."
// sent cold (not as a reply to our own ask) matched ORDER_NOUN but no TRACKING_VERB,
// so wantsOrderTracking() was false and the customer got the legacy
// "visit goodness.com.au/order-status" deflection while holding a valid order+email.
// It passed on 18 Aug only because it was sent as a reply to our details prompt,
// which made isOrderDetailsReply() true.
const BARE_DETAILS_FILLER =
    /\b(order|orders|number|numbers|no|num|ref|reference|email|e-?mail|address|my|is|are|was|it|its|it's|for|the|a|an|and|with|on|of|to|placed|under|please|thanks|thank|you|hi|hello|hey|details|here|below|see|this|that)\b/gi;

// Marker text used to recognise our own prior "give me your details" ask.
const ASK_DETAILS_MARKER = 'your order number and the email';

// ── Escalation-alert markers + intents (Triggers 2 & 3) ──────────────────────
// Markers are natural-language phrases embedded in our own replies, so they
// survive in conversationHistory and are recognisable next turn without any
// hidden tokens leaking to the customer.
/** Embedded in the first-not_found reply; its presence in the LAST assistant
 *  message signals "this turn is the re-confirm attempt". */
const NOT_FOUND_RECONFIRM = 'double-check the order number and the email';
/** Appended to a partly_delivered render; its presence anywhere in history lets
 *  a later "won't wait" message fire the wont_wait alert. */
// Collection-point escalation (Iri, 31 Aug 2026). The FIRST response about a parcel
// at a collection point deliberately does NOT offer escalation; Iri only wants a
// handoff if the customer says they cannot collect. This marker is the phrase the
// collection lines both contain, so a refusal is only recognised as a follow-up to
// one of those answers, never out of the blue.
const COLLECTION_MARKER = 'post office or collection point';

/** The Zoho returns/credit form URL appears in every ComplaintsResponseGate answer.
 *  Its presence in the LAST assistant message means the customer is mid credit-claim,
 *  so a bare "order X, email Y" is them supplying details for THAT, not asking where
 *  their parcel is. Only gates the bare-details path: an explicit "where is my order
 *  X, email Y" after the form is still a tracking question and is still answered. */
const CREDIT_FORM_MARKER = 'forms.zohopublic.com';
const COLLECTION_REFUSED_INTENT =
    /\b(can'?t collect|cannot collect|can'?t pick|cannot pick|won'?t collect|not able to collect|unable to collect|can'?t get (?:there|to)|too far|no ?one (?:can|to) collect|don'?t drive|no transport|can'?t make it)\b/i;

const WONT_WAIT_MARKER = 'prefer not to wait for the rest';
const WONT_WAIT_MARKER_SENTENCE =
    "If you'd prefer not to wait for the rest, just let us know and we'll help sort it out.";
/** Customer intent to abandon the outstanding part of a split order (tunable). */
const WONT_WAIT_INTENT =
    /\b(don'?t want to wait|do not want to wait|can'?t wait|cancel the rest|cancel the remaining|just refund|refund the rest|forget the rest|don'?t need the rest|too long)\b/i;

export class OrderStatusGate {
    // ═════════════════════ NEW: live order tracking ═════════════════════════

    /**
     * Process-scoped alert service used when no `alerts` is injected. Constructed
     * ONCE and reused across turns so the in-memory dedup (`seen`) and hourly cap
     * (`sentTimestamps`) persist within a Cloud Run instance — a per-turn `new`
     * would reset them and defeat per-conversation dedup. (Per-instance, like the
     * chat rate-limiter; a strictly-global cap needs the shared store noted in
     * API-Hardening-Plan.md.) Public so tests can assert the singleton is stable.
     */
    private static sharedAlerts: InternalAlertService | null = null;
    static defaultAlertService(): InternalAlertService {
        return (this.sharedAlerts ??= new InternalAlertService());
    }

    /** Broad order-tracking / "where is my order" intent. */
    static wantsOrderTracking(message: string): boolean {
        return TRACKING_VERB.test(message) && ORDER_NOUN.test(message);
    }

    /** True when the customer is replying to our request for order number + email. */
    static isOrderDetailsReply(message: string, history: ConversationMessage[]): boolean {
        if (!this.assistantAskedForOrderDetails(history)) return false;
        return EMAIL_RE.test(message) || ORDER_NUM_RE.test(message);
    }

    /**
     * True when the message is NOTHING BUT order details — an order number, an email
     * and filler ("Order 359633, email x@y.com"). Such a message is a tracking
     * question by construction: nobody volunteers both an order number and the email
     * on the order for any other reason. Deliberately residue-based rather than
     * "has order + email", so a message that carries the details AND a different ask
     * ("cancel order 359633, email x@y.com", "change the address on order 359633...")
     * leaves a residue, fails this test, and still falls through to the KB path
     * instead of being answered with a delivery status.
     */
    /** True when our own most recent reply was a credit/returns form answer. */
    static lastAssistantOfferedCreditForm(history: ConversationMessage[]): boolean {
        for (let i = history.length - 1; i >= 0; i--) {
            const m = history[i];
            if (m.role !== 'assistant') continue;
            return String(m.content ?? '').includes(CREDIT_FORM_MARKER);
        }
        return false;
    }

    static isBareOrderDetails(message: string): boolean {
        const residue = String(message ?? '')
            .replace(EMAIL_RE_G, ' ')
            .replace(ORDER_NUM_RE_G, ' ')
            .replace(BARE_DETAILS_FILLER, ' ')
            .replace(/[^a-z0-9]+/gi, ' ')
            .trim();
        return residue.length === 0;
    }

    /**
     * The tracking entry point. Returns a customer-facing response string, or null
     * when this gate should not handle the turn (so the caller falls through to
     * the KB / deflection path).
     *
     * Dark until `settings.freight.trackingEnabled`. `service` and `alerts` are
     * injectable for tests. Internal CS/WH alerts fire as a SIDE-EFFECT of a
     * tracking turn — only when tracking is live (this returns early otherwise)
     * and only when `ALERTS_ENABLED` is on (the alert service gates that itself).
     * An alert send is always awaited (Cloud Run may freeze the instance after the
     * response flushes) and always wrapped so a throw NEVER changes or blocks the
     * customer-facing answer.
     */
    static async handleOrderTracking(
        message: string,
        history: ConversationMessage[] = [],
        service?: OrderTrackingService,
        alerts?: InternalAlertService,
        conversationId?: string,
    ): Promise<string | null> {
        if (!settings.freight.trackingEnabled) return null; // dark until the flag is on

        const current = this.extractOrderAndEmail(message);
        // A message carrying a full order+email is a fresh tracking query — never a
        // "won't wait" follow-up. This stops a genuine status question about a
        // DIFFERENT order (e.g. "my order 888999 x@y.com is taking too long") from
        // being hijacked by a stale partly_delivered marker + broad WONT_WAIT_INTENT
        // and firing an alert with the WRONG (old) order.
        const hasFreshDetails = Boolean(current.order && current.email);

        // A message that is nothing but an order number + email counts as tracking intent
        // on its own, with or without a verb. See isBareOrderDetails().
        const isBareDetails =
            hasFreshDetails && this.isBareOrderDetails(message) && !this.lastAssistantOfferedCreditForm(history);

        const isDetailsReply = this.assistantAskedForOrderDetails(history);
        const isReconfirmReply = this.assistantAskedReconfirm(history);
        const isWontWaitFollowup =
            !hasFreshDetails && this.assistantRenderedPartlyDelivered(history) && WONT_WAIT_INTENT.test(message);
        // Same shape as isWontWaitFollowup, and for the same reason: "I can't collect
        // it, I have no transport" carries no tracking verb and no order noun, so
        // wantsOrderTracking() is false. Without this term the bail below returns null
        // and the collection_refused branch further down is unreachable. Caught 1 Sep
        // 2026 by scripts/gate-intent-tests; the live test for it (D6) needed an order
        // sitting at a collection point and had never been runnable.
        const isCollectionRefusalFollowup =
            !hasFreshDetails && this.assistantRenderedCollection(history) && COLLECTION_REFUSED_INTENT.test(message);

        if (
            !this.wantsOrderTracking(message) &&
            !isBareDetails &&
            !isDetailsReply &&
            !isReconfirmReply &&
            !isWontWaitFollowup &&
            !isCollectionRefusalFollowup
        ) {
            return null;
        }

        // Stand down for condition complaints so ComplaintsResponseGate can serve the
        // credit/returns flow. Guarded on !isWontWaitFollowup so the wont_wait trigger
        // is never suppressed by a stray complaint word.
        const isEscalationFollowup = isWontWaitFollowup || isCollectionRefusalFollowup;
        if (!isEscalationFollowup && CONDITION_COMPLAINT.test(message)) return null;

        // Same stand-down for an explicit change/cancel/invoice request: the customer
        // wants something done to the order, not a status read on it.
        if (!isEscalationFollowup && ORDER_CHANGE_REQUEST.test(message)) return null;

        // Persistent per-instance alert service (default) so conversationId dedup +
        // the hourly rate cap actually hold ACROSS turns — a fresh `new` per turn
        // would reset the in-memory state every request and defeat both.
        const alertSvc = alerts ?? OrderStatusGate.defaultAlertService();

        // ── Trigger 3: wont_wait → CS. The customer, after a partly_delivered
        //    render, says they won't wait. No fresh lookup — reuse the order+email
        //    from the turn that produced the partly_delivered render.
        // Customer says they cannot collect from the post office → hand to CS.
        if (isCollectionRefusalFollowup) {
            const prior = this.extractAttemptBeforeMarker(history, COLLECTION_MARKER);
            if (prior.order && prior.email) {
                await this.fireAlertSafely(
                    alertSvc,
                    this.buildAlert('collection_refused', prior.order, prior.email, conversationId),
                );
            }
            return DRAFT_COPY.collectionRefused;
        }

        if (isWontWaitFollowup) {
            const prior = this.extractAttemptBeforeMarker(history, WONT_WAIT_MARKER);
            if (prior.order && prior.email) {
                await this.fireAlertSafely(alertSvc, this.buildAlert('wont_wait', prior.order, prior.email, conversationId));
                return this.buildEscalatedReply('wont_wait');
            }
            // Couldn't recover the order → do NOT claim an escalation was raised.
            return `I understand you'd prefer not to wait for the rest. Please contact ${SUPPORT_CHANNELS} and the team will sort it out.`;
        }

        const { order, email } = current;
        if (!order || !email) {
            return this.buildAskForOrderDetails(order, email);
        }

        let result: TrackingResult;
        try {
            const svc = service ?? new OrderTrackingService();
            result = await svc.track(order, email);
        } catch (err) {
            logger.error('order tracking failed', err);
            return `I couldn't check that just now. Please try again shortly, or contact ${SUPPORT_CHANNELS}.`;
        }
        logger.info(`order tracking handled: state=${result.state}, verifiedVia=${result.verifiedVia ?? 'n/a'}`);

        // ── Duplicate consignments → CS. The customer gets a neutral "we're checking"
        //    line; the team gets told, because nobody else will notice.
        if (result.state === 'multiple_consignments') {
            await this.fireAlertSafely(
                alertSvc,
                this.buildAlert('duplicate_consignments', order, email, conversationId),
            );
            return result.message;
        }

        // ── Trigger 1: queued_chasing → WH. Order verified & in the packing queue,
        //    and the message reads as a stuck-packing / extended-delay chase.
        if (result.state === 'preparing' && this.needsStuckPackingHandoff(message)) {
            await this.fireAlertSafely(alertSvc, this.buildAlert('queued_chasing', order, email, conversationId));
            return this.renderTracking(result);
        }

        // ── Trigger 2: not_found → CS (two-turn re-confirm). Only escalate on the
        //    SECOND identical failed attempt; a first miss (or changed details) just
        //    asks the customer to re-confirm.
        if (result.state === 'not_found') {
            if (isReconfirmReply) {
                const prior = this.extractAttemptBeforeMarker(history, NOT_FOUND_RECONFIRM);
                if (prior.order && prior.email && this.sameAttempt(order, email, prior.order, prior.email)) {
                    await this.fireAlertSafely(alertSvc, this.buildAlert('not_found', order, email, conversationId));
                    return this.buildEscalatedReply('not_found');
                }
                // Details differ from the prior miss → treat as a fresh lookup: no
                // alert, ask them to re-confirm again (restarts the two-turn cycle).
            }
            return this.buildNotFoundReconfirm();
        }

        // ── Trigger 3 setup: mark a partly_delivered render so a later "won't wait"
        //    turn can escalate. No alert on this turn.
        if (result.state === 'partly_delivered') {
            return `${this.renderTracking(result)}\n\n${WONT_WAIT_MARKER_SENTENCE}`;
        }

        return this.renderTracking(result);
    }

    // ── Alert plumbing ───────────────────────────────────────────────────────
    // customerName is NOT available in the gate (TrackingResult carries no
    // recipient name) → pass null so the subject reads "(Unknown)".
    // TODO: if TrackingResult ever exposes a recipient/customer name, thread it
    // here instead of null.
    // NOTE: the alert payload uses the REAL order + email on purpose — it must be
    // actionable in the CS/WH inbox. redactPII is a trace/log boundary concern and
    // is deliberately NOT applied on this path (the payload bypasses redaction).
    private static buildAlert(
        trigger: InternalAlert['trigger'],
        order: string,
        email: string,
        conversationId?: string,
    ): InternalAlert {
        return {
            trigger,
            customerName: null, // TODO: no recipient name available from TrackingResult
            customerEmail: email,
            orderNumber: order,
            reason: '', // empty → InternalAlertService fills DEFAULT_REASON[trigger]
            conversationId,
        };
    }

    /** Send an alert, awaiting it, with any throw swallowed after logging so the
     *  customer answer is returned regardless. (InternalAlertService already turns
     *  transport errors into a result rather than throwing; this is belt-and-braces
     *  against an unexpected throw.) No PII is logged — trigger name only. */
    private static async fireAlertSafely(alerts: InternalAlertService, alert: InternalAlert): Promise<void> {
        try {
            const res = await alerts.send(alert);
            if (!res.sent) logger.info(`alert not sent (trigger=${alert.trigger}, outcome=${res.disabled ? 'disabled' : res.deduped ? 'deduped' : res.rateLimited ? 'rate-limited' : res.error ? 'error' : 'n/a'})`);
        } catch (err) {
            logger.error(`alert send threw (trigger=${alert.trigger})`, err);
        }
    }

    /** Extract order+email from the user message immediately preceding the most
     *  recent assistant message containing `marker`. Used to recover the prior
     *  attempt's details for re-confirm matching and wont_wait escalation. */
    private static extractAttemptBeforeMarker(
        history: ConversationMessage[],
        marker: string,
    ): { order: string | null; email: string | null } {
        for (let i = history.length - 1; i >= 0; i--) {
            const m = history[i];
            if (m.role === 'assistant' && String(m.content ?? '').includes(marker)) {
                for (let j = i - 1; j >= 0; j--) {
                    if (history[j].role === 'user') {
                        return this.extractOrderAndEmail(String(history[j].content ?? ''));
                    }
                }
                break;
            }
        }
        return { order: null, email: null };
    }

    /** Same order (digits-only) + same email (case-insensitive)? */
    private static sameAttempt(o1: string, e1: string, o2: string, e2: string): boolean {
        return o1.replace(/\D/g, '') === o2.replace(/\D/g, '')
            && e1.trim().toLowerCase() === e2.trim().toLowerCase();
    }

    /** LAST assistant message carries the not_found re-confirm marker. */
    private static assistantAskedReconfirm(history: ConversationMessage[]): boolean {
        for (let i = history.length - 1; i >= 0; i--) {
            const m = history[i];
            if (m.role !== 'assistant') continue;
            return String(m.content ?? '').includes(NOT_FOUND_RECONFIRM);
        }
        return false;
    }

    /** ANY prior assistant message rendered a partly_delivered result. */
    private static assistantRenderedCollection(history: ConversationMessage[]): boolean {
        return history.some((m) => m.role === 'assistant' && String(m.content ?? '').includes(COLLECTION_MARKER));
    }

    private static assistantRenderedPartlyDelivered(history: ConversationMessage[]): boolean {
        return history.some((m) => m.role === 'assistant' && String(m.content ?? '').includes(WONT_WAIT_MARKER));
    }

    private static buildNotFoundReconfirm(): string {
        return `I couldn't find an order matching those details. Could you ${NOT_FOUND_RECONFIRM} address used on the order, and send them through again? If they're correct, I'll pass it to our team to look into.`;
    }

    private static buildEscalatedReply(trigger: 'not_found' | 'wont_wait'): string {
        if (trigger === 'wont_wait') {
            return "Thanks for letting us know. I've flagged this with our customer service team, who'll sort out the remaining part of your order and follow up with you.";
        }
        return "Thanks for confirming those details. I've flagged this with our customer service team, who'll look into it and follow up with you.";
    }

    /** Pull an order number and email out of free text. Email removed before the
     *  order-number scan so its digits aren't mistaken for an order number. */
    static extractOrderAndEmail(message: string): { order: string | null; email: string | null } {
        const rawEmail = message.match(EMAIL_RE)?.[0] ?? null;
        // EMAIL_RE greedily consumes trailing punctuation ("me@x.com." / "me@x.com,")
        // which corrupts BOTH the alert email AND the real dotWMS lookup (a valid
        // order then reads not_found). Strip it. The RAW match (with punctuation) is
        // still what we remove from the message before the order scan. (ORDER_NUM_RE
        // ends on \b, so the order number never captures trailing punctuation.)
        const email = rawEmail ? rawEmail.replace(/[.,;:!?)\]]+$/, '') : null;
        const withoutEmail = rawEmail ? message.replace(rawEmail, ' ') : message;
        const order = withoutEmail.match(ORDER_NUM_RE)?.[0] ?? null;
        return { order, email };
    }

    private static buildAskForOrderDetails(order: string | null, email: string | null): string {
        if (!order && !email) {
            return "Happy to help track your order. What's your order number and the email address used on the order?";
        }
        const missing = !order ? 'order number' : 'email address on the order';
        return `Thanks — I just need your ${missing} as well, then I can look it up. (Your order number and the email must match what's on the order.)`;
    }

    private static renderTracking(result: TrackingResult): string {
        let out = result.message;
        const links = result.boxes.map((b) => b.trackingUrl).filter((u): u is string => Boolean(u));
        if (links.length) {
            out += `\n\nTrack your ${links.length > 1 ? 'boxes' : 'parcel'}: ${links.join('   ')}`;
        }
        return out;
    }

    private static assistantAskedForOrderDetails(history: ConversationMessage[]): boolean {
        for (let i = history.length - 1; i >= 0; i--) {
            const msg = history[i];
            if (msg.role !== 'assistant') continue;
            return String(msg.content ?? '').includes(ASK_DETAILS_MARKER);
        }
        return false;
    }

    // ═══════════════ EXISTING deflection (unchanged behaviour) ═══════════════
    // Retained verbatim so this file is a safe drop-in even with the flag off,
    // and so the post-KB false-escalation guard keeps working.

    /** "In queue for packing" with implied extended delay (e.g. 4 days). */
    static needsStuckPackingHandoff(message: string): boolean {
        if (!STUCK_PACKING_INTENT.test(message)) return false;
        return (
            EXTENDED_DELAY_INTENT.test(message) ||
            /\b(extended|long time|still|hasn't moved|not moving)\b/i.test(message)
        );
    }

    static isStuckPackingDetailsReply(message: string, history: ConversationMessage[]): boolean {
        if (!this.assistantGaveStuckPackingHandoff(history)) return false;
        return /\b(order|invoice|#?\d{4,})\b/i.test(message) || /@/.test(message);
    }

    static promisesFalseEscalation(response: string): boolean {
        return FALSE_ESCALATION_PROMISE.test(response);
    }

    static buildStuckPackingResponse(): string {
        return [
            "I'm sorry to hear your order has been in queue for packing longer than expected.",
            '',
            "I can't access live order statuses or create support tickets from here. Because it's been more than two business days, please contact " +
                `${SUPPORT_CHANNELS} so the team can investigate.`,
            '',
            `Have your order number and the email used on the order ready when you get in touch. You can also check ${ORDER_STATUS_PAGE} with those details.`,
        ].join('\n');
    }

    static buildStuckPackingDetailsReply(): string {
        return [
            "Thanks — I've noted you have your order details to hand.",
            '',
            "I still can't escalate or look up your order from here. Please contact " +
                `${SUPPORT_CHANNELS} with your order number and email so they can investigate the delay.`,
        ].join('\n');
    }

    private static assistantGaveStuckPackingHandoff(history: ConversationMessage[]): boolean {
        for (let i = history.length - 1; i >= 0; i--) {
            const msg = history[i];
            if (msg.role !== 'assistant') continue;
            const text = String(msg.content ?? '');
            return text.includes("can't access live order statuses") ||
                text.includes("can't escalate or look up your order");
        }
        return false;
    }
}
