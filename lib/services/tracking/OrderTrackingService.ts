import { getLogger } from '@/lib/config/logger';
import { settings } from '@/lib/config/settings';
import { FreightReferenceResolverFactory } from '@/lib/services/freight/FreightReferenceResolverFactory';
import type { FreightReferenceResolver, ResolvedOrder } from '@/lib/services/freight/types';
import { MachShipService } from '@/lib/services/machship/MachShipService';
import type { MachShipConsignment } from '@/lib/services/machship/types';
import { DRAFT_COPY, ETA_DISCLAIMER, OWN_DRIVER_LINE } from './trackingCopy';
import { classifyConsignmentStatus, type StatusBucket } from './statusMap';
import type { TrackedBox, TrackingResult, TrackingState } from './types';

const logger = getLogger('OrderTrackingService');

const PREPARING_STATUS = /pack|queue|prepar|pick/i;

/**
 * Phase-1 order tracking orchestrator.
 *
 *   customer order + email
 *     -> FreightReferenceResolver (SWAPPABLE: dotWMS today, Odoo end Oct 2026)
 *     -> MachShipService (boxes, courier, ETA, tracking)
 *     -> a customer-facing TrackingResult
 *
 * Ownership is proven one of two ways (see VerificationMethod):
 *   - 6-digit BigCommerce order → dotWMS matches the email (verified up front).
 *   - 8-digit Syspro number → dotWMS is bypassed, so we verify by matching the
 *     customer's email against the consignment `toEmail` AFTER the MachShip
 *     lookup. The only unverifiable case is 8-digit + own-driver (absent from
 *     MachShip → nothing to match) → refused.
 *
 * Confirmed decisions baked in (Iri, 28 Jul 2026): 60-day lookback, ETA shown
 * with a 24h disclaimer, own-driver wording. Status->wording for the other
 * states is DRAFT pending Iri sign-off (see trackingCopy).
 *
 * NOT yet wired into /api/chat — that work replaces OrderStatusGate and depends
 * on the pre-go-live API hardening. This service is the unit that rewrite calls.
 */
/**
 * Is this WMS hold reason one the CUSTOMER should be told about?
 * Confirmed with Iri 31 Aug 2026 — only the Syspro suspension is genuine.
 */
/**
 * Cancelled / deleted consignments must never be counted as boxes.
 * CONFIRMED live 31 Aug 2026 on order 10257041: the superseded consignment comes
 * back as {"id":10,"name":"Cancelled"} with consignmentStatusType 6, alongside the
 * real one. Matched on the NAME (readable, and survives a statusType renumber).
 */
function isDeadConsignment(c: { status?: { name?: string | null } | null }): boolean {
    return /cancel|delet|void/i.test(String(c.status?.name ?? ''));
}

function isCustomerFacingHold(reason: string | null | undefined): boolean {
    const r = String(reason ?? '').trim().toLowerCase();
    if (!r) return false;
    return r.includes('suspended in syspro');
}

export class OrderTrackingService {
    private readonly resolver: FreightReferenceResolver;
    private readonly machship: MachShipService;
    private readonly lookbackDays: number;
    private readonly requireVerifiedEmail: boolean;

    constructor(resolver?: FreightReferenceResolver, machship?: MachShipService) {
        this.resolver = resolver ?? FreightReferenceResolverFactory.create();
        this.machship = machship ?? new MachShipService();
        this.lookbackDays = settings.freight.lookbackDays;
        this.requireVerifiedEmail = settings.freight.requireVerifiedEmail;
    }

    async track(orderNumber: string, email: string): Promise<TrackingResult> {
        const resolved = await this.resolver.resolve({ orderNumber, email });

        if (resolved.outcome === 'error') {
            return this.simple('error', DRAFT_COPY.notFound, resolved.provider, resolved.diagnostic);
        }
        if (resolved.outcome === 'not_found' || !resolved.orders.length) {
            return this.simple('not_found', DRAFT_COPY.notFound, resolved.provider, resolved.diagnostic);
        }

        // ── Ownership, phase 1: what does the resolver already know? ──────────
        // dotWMS path → already verified. Direct 8-digit → defer to a toEmail
        // match after the MachShip lookup. No route → refuse (when enforcing).
        let ownershipVerified = resolved.verified;
        let verifyViaMachShip = false;
        if (this.requireVerifiedEmail && !resolved.verified) {
            if (resolved.verifyVia === 'machship-toEmail') {
                verifyViaMachShip = true;
            } else {
                logger.info('unverifiable match and requireVerifiedEmail=true — refusing');
                return this.simple('unverified_refused', DRAFT_COPY.unverifiedRefused, resolved.provider);
            }
        } else if (!this.requireVerifiedEmail) {
            ownershipVerified = true; // enforcement disabled
        }

        // On hold (warehouse system) — only present on the dotWMS path; surface early.
        // CONFIRMED (Iri, 31 Aug 2026): only "Suspended in SYSPRO" is a genuine hold a
        // customer should hear about (waiting on information or prepayment). The other
        // WMS hold reasons are internal workflow markers and must NOT be surfaced:
        //   - "Hold For Release >250kg"
        //   - "SPECIAL PACKING REQUIRED. SEE SUPERVISOR"
        // Anything else falls through to normal tracking rather than telling a customer
        // their order is stuck. Matched case-insensitively; the WMS screen shows
        // "Suspended in SYSPRO" while Iri wrote "Suspended in Syspro".
        if (ownershipVerified) {
            const held = resolved.orders.find((o) => isCustomerFacingHold(o.heldReason));
            if (held) {
                // heldReason only ever comes from the dotWMS path (verified up front).
                const via = resolved.verifyVia === 'dotwms' ? 'dotwms' : null;
                return this.simple('held', DRAFT_COPY.held(held.heldReason), resolved.provider, undefined, via);
            }
        }

        const lookup = await this.machship.lookupByReferences({
            sysproReferences: resolved.orders.map((o) => o.sysproReference),
            bareReferences: resolved.orders.map((o) => o.bareReference),
        });

        if (lookup.outcome === 'error') {
            return this.simple('error', DRAFT_COPY.notFound, resolved.provider, `machship: ${lookup.errors.join('; ')}`);
        }

        // ── Ownership, phase 2: the deferred toEmail match (8-digit path) ─────
        if (verifyViaMachShip) {
            if (lookup.outcome !== 'found') {
                // 8-digit but absent from MachShip = own-driver (or predates/other):
                // nothing to match the email against → cannot verify → refuse.
                logger.info('direct Syspro ref not in MachShip — cannot verify ownership, refusing');
                return this.simple('unverified_refused', DRAFT_COPY.unverifiedRefused, resolved.provider);
            }
            if (!this.ownershipMatchesToEmail(lookup.consignments, email)) {
                logger.info('MachShip toEmail did not match customer email — refusing');
                return this.simple('unverified_refused', DRAFT_COPY.unverifiedRefused, resolved.provider);
            }
            ownershipVerified = true;
        }

        // Matched in the warehouse system but NOT in MachShip (dotWMS path only —
        // the 8-digit path already refused above). Own-driver vs still-preparing.
        if (lookup.outcome === 'not_found') {
            return this.classifyNoMachShip(resolved.orders, resolved.provider);
        }

        // 60-day lookback (confirmed). Enforced on consignment date where readable;
        // if NO consignment has a readable date we flag it rather than silently pass.
        const inWindow = this.withinLookback(lookup.consignments);
        if (inWindow === false) {
            return this.simple('too_old', DRAFT_COPY.tooOld, resolved.provider);
        }

        return this.buildFromConsignments(
            lookup.consignments,
            resolved.provider,
            inWindow === null,
            verifyViaMachShip ? 'machship-toEmail' : 'dotwms',
        );
    }

    /** Match the customer's email against consignment `toEmail`. Requires at least
     *  one populated toEmail and that EVERY populated one matches. */
    private ownershipMatchesToEmail(cons: MachShipConsignment[], email: string): boolean {
        const target = email.trim().toLowerCase();
        const populated = cons.filter((c) => typeof c.toEmail === 'string' && c.toEmail.trim());
        if (!populated.length) {
            logger.warn('no toEmail on any consignment — cannot verify 8-digit ownership');
            return false;
        }
        return populated.every((c) => String(c.toEmail).trim().toLowerCase() === target);
    }

    private classifyNoMachShip(orders: ResolvedOrder[], provider: string): TrackingResult {
        const status = orders[0]?.warehouseStatusRaw ?? '';
        if (PREPARING_STATUS.test(status)) {
            return this.simple('preparing', DRAFT_COPY.preparing, provider, undefined, 'dotwms');
        }
        // Packed/dispatched but absent from MachShip => own-driver run (CONFIRMED wording).
        return this.simple(
            'own_driver_out',
            OWN_DRIVER_LINE,
            provider,
            'no MachShip consignment; treated as own-driver (also possible: predates MachShip / shipped otherwise)',
            'dotwms',
        );
    }

    private buildFromConsignments(
        consRaw: MachShipConsignment[],
        provider: string,
        dateUnknown: boolean,
        verifiedVia: 'dotwms' | 'machship-toEmail',
    ): TrackingResult {
        // Drop cancelled/deleted consignments before anything counts them (Iri, 31 Aug).
        const cons = consRaw.filter((c) => !isDeadConsignment(c));
        const droppedDead = consRaw.length - cons.length;

        // If MORE THAN ONE live consignment survives, this is the operator-error case
        // Iri described: a bad consignment was raised and not deleted, so two are open
        // against one order. Evidence says genuine separate-consignment splits do not
        // occur on this account (freight-split-finder, 20 Aug: 200 consignments over
        // 9 days, every multi-reference group collapsed to one on lookup), so treating
        // any survivor pair as an error and escalating is the safe reading. Never guess
        // which consignment is the real one.
        if (cons.length > 1) {
            return this.simple(
                'multiple_consignments',
                DRAFT_COPY.multipleConsignments,
                provider,
                `${cons.length} live consignments against one order (${cons
                    .map((c) => c.consignmentNumber ?? c.carrierConsignmentId)
                    .join(', ')})${droppedDead ? `; ${droppedDead} cancelled ignored` : ''} — escalated rather than rendered`,
                verifiedVia,
                this.recipientNameOf(cons),
            );
        }

        const boxes: TrackedBox[] = cons.map((c) => ({
            reference: c.carrierConsignmentId ?? null,
            carrier: c.carrierName ?? null,
            status: c.status?.name ?? null,
            etaLocal: c.etaLocal ?? c.eta ?? null,
            trackingUrl: c.trackingPageAccessToken ? `https://mship.io/v2/${c.trackingPageAccessToken}` : null,
        }));

        // Each consignment carries its OWN status; classify each into a bucket
        // (see statusMap.ts for the full vocabulary). Delivery status is per-
        // consignment. Items are a secondary split dimension — summed for
        // visibility; a real example settles which to show.
        const total = boxes.length;
        const buckets: StatusBucket[] = boxes.map((b) => classifyConsignmentStatus(b.status));
        const delivered = buckets.filter((x) => x === 'delivered').length;
        const totalItems = cons.reduce((n, c) => n + (Array.isArray(c.consignmentItems) ? c.consignmentItems.length : 0), 0);
        const carrier = boxes.find((b) => b.carrier)?.carrier ?? 'the courier';

        // CUSTOMER-FACING BOX COUNT. Confirmed live 18 Aug 2026 (freight-chain-harness +
        // freight-split-finder): HTG books ONE consignment holding N cartons — Ex1 items=2,
        // Ex2 items=9, Ex5 items=8, every one consignments=1 with
        // consolidatedIntoConsignmentId=null. Separate-consignment splits do not occur on
        // this account, so `total` (consignments) understates what the customer receives.
        // The customer counts cartons on their doorstep, so state cartons when we have more
        // of them than consignments. `total`/`delivered` remain the STATUS-bearing unit —
        // only a consignment carries a delivery status, so any X-of-Y ratio still uses them.
        const boxCount = Math.max(total, totalItems);

        // Earliest ETA among boxes not yet delivered.
        const eta = boxes
            .filter((_, i) => buckets[i] !== 'delivered')
            .map((b) => b.etaLocal)
            .filter((e): e is string => Boolean(e))
            .sort()[0] ?? null;
        const etaSuffix = eta ? `, expected ${this.dateOnly(eta)}` : '';

        // partly_delivered fires ONLY on a CURRENT signal, never a historical one:
        //   (a) MULTIPLE consignments with mixed delivery (>=1 delivered AND >=1 not), OR
        //   (b) a consignment's CURRENT status is 'Partial Delivery' (bucket 'partial').
        // NOTE: `statusIsPartial` lives on statusHistory EVENTS (past states). Scanning
        // the whole history flagged a now-Complete order that merely PASSED THROUGH
        // partial delivery (e.g. Ex5) as partial — that was the over-fire bug. We key on
        // the CURRENT status only. Item count is NEVER a trigger (diagnostic only, below).
        const currentPartial = buckets.includes('partial');
        const mixedMultiConsignment = delivered > 0 && delivered < total;
        const has = (b: StatusBucket): boolean => buckets.includes(b);
        const unknownStatuses = boxes.filter((_, i) => buckets[i] === 'unknown').map((b) => b.status ?? '?');

        let state: TrackingState;
        let message: string;
        if (currentPartial || mixedMultiConsignment) {
            state = 'partly_delivered';
            message = mixedMultiConsignment
                ? `Your order is coming in ${total} ${total === 1 ? 'box' : 'boxes'}. ${delivered} ${delivered === 1 ? 'has' : 'have'} been delivered; the rest are on their way with ${carrier}${etaSuffix}.`
                : boxCount > 1
                    ? `Your order is coming in ${boxCount} boxes. Some have already been delivered and the rest are on their way with ${carrier}${etaSuffix}.`
                    : `Part of your order has been delivered; the rest is on its way with ${carrier}${etaSuffix}.`;
        } else if (delivered === total && total > 0) {
            state = 'delivered';
            message = boxCount > 1 ? `All ${boxCount} boxes of your order have been delivered.` : 'Your order has been delivered.';
        } else if (has('delayed')) {
            state = 'delayed';
            message = DRAFT_COPY.delayed;
        } else if (has('attempted')) {
            state = 'attempted';
            message = DRAFT_COPY.attempted;
        } else if (has('awaiting_collection')) {
            state = 'awaiting_collection';
            message = DRAFT_COPY.awaitingCollection;
        } else if (has('out_for_delivery')) {
            state = 'out_for_delivery';
            message = boxCount > 1
                ? `Your order is out for delivery today with ${carrier}, in ${boxCount} boxes.`
                : `Your order is out for delivery today with ${carrier}.`;
        } else if (has('in_transit')) {
            state = 'in_transit';
            message = boxCount > 1
                ? `Your order is on its way in ${boxCount} boxes with ${carrier}${etaSuffix}.`
                : `Your order is on its way with ${carrier}${etaSuffix}.`;
        } else if (buckets.every((x) => x === 'preparing')) {
            state = 'preparing';
            message = DRAFT_COPY.preparing;
        } else {
            state = 'unknown';
            message = DRAFT_COPY.unknownStatus;
        }

        // ETA disclaimer only where we actually surfaced an ETA in the message.
        const showEtaDisclaimer = Boolean(eta) && (state === 'partly_delivered' || state === 'in_transit' || state === 'delayed');
        const fullMessage = showEtaDisclaimer ? `${message} ${ETA_DISCLAIMER}` : message;

        const diagnostics: string[] = [];
        if (dateUnknown) diagnostics.push('consignment date unreadable — 60-day gate NOT enforced (date field name unconfirmed)');
        if (totalItems > total) diagnostics.push(`items (${totalItems}) exceed consignments (${total}) — showing carton count ${boxCount} to the customer (confirmed 18 Aug 2026); delivery status remains per-consignment`);
        if (unknownStatuses.length) diagnostics.push(`unrecognised MachShip status(es): ${[...new Set(unknownStatuses)].join(', ')} — mapped to 'unknown' safe default; add to statusMap.ts`);

        return {
            state,
            message: fullMessage,
            boxes,
            totalBoxes: total,
            deliveredBoxes: delivered,
            totalItems,
            verifiedVia,
            eta,
            showEtaDisclaimer,
            provider,
            recipientName: this.recipientNameOf(cons),
            diagnostic: diagnostics.length ? diagnostics.join(' | ') : undefined,
        };
    }

    /**
     * true  = at least one consignment is within the lookback window
     * false = every consignment with a readable date is older than the window
     * null  = no readable dates at all (cannot decide — do NOT treat as pass)
     */
    private withinLookback(cons: MachShipConsignment[]): boolean | null {
        const cutoff = Date.now() - this.lookbackDays * 86_400_000;
        let sawDate = false;
        let anyInWindow = false;
        for (const c of cons) {
            const d = this.machship.consignmentDate(c);
            if (d) {
                sawDate = true;
                if (d.getTime() >= cutoff) anyInWindow = true;
            }
        }
        if (!sawDate) return null;
        return anyInWindow;
    }

    /**
     * Customer-facing date. Was `iso.split('T')[0]`, which rendered "expected
     * 2026-08-28" in an otherwise plain-English sentence (spotted live 31 Aug 2026 on
     * order 10265537). MachShip's own page says "Friday, 28 Aug", so match that.
     *
     * CRITICAL: the value is `etaLocal`, which is ALREADY local and carries no zone
     * suffix. Passing it through `new Date()` and a timeZone formatter re-interprets
     * it as UTC and slides the day — "2026-08-28T23:59:59" came out as
     * "Saturday 29 August". So take the DATE PARTS verbatim and format those; never
     * convert. Falls back to the raw date portion if the shape is unexpected.
     */
    private dateOnly(iso: string): string {
        const datePart = String(iso).split('T')[0];
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
        if (!m) return datePart;
        const [, y, mo, d] = m;
        // Noon UTC + UTC formatting keeps the calendar date exactly as supplied.
        const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), 12));
        if (Number.isNaN(dt.getTime())) return datePart;
        return new Intl.DateTimeFormat('en-AU', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            timeZone: 'UTC',
        }).format(dt);
    }

    /** First non-empty recipient name across consignments, or null. */
    private recipientNameOf(cons: MachShipConsignment[]): string | null {
        for (const c of cons) {
            const n = String(c.toName ?? '').trim();
            if (n) return n;
        }
        return null;
    }

    private simple(
        state: TrackingState,
        message: string,
        provider: string,
        diagnostic?: string,
        verifiedVia: 'dotwms' | 'machship-toEmail' | null = null,
        recipientName: string | null = null,
    ): TrackingResult {
        return {
            state,
            message,
            boxes: [],
            totalBoxes: 0,
            deliveredBoxes: 0,
            totalItems: 0,
            verifiedVia,
            eta: null,
            showEtaDisclaimer: false,
            provider,
            recipientName,
            diagnostic,
        };
    }
}
