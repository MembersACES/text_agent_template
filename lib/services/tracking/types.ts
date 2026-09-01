/** The customer-facing outcome of a tracking lookup. */
export type TrackingState =
    | 'not_found'
    | 'unverified_refused'
    | 'preparing'
    | 'own_driver_out'
    | 'multiple_consignments'
    | 'awaiting_collection'
    | 'out_for_delivery'
    | 'in_transit'
    | 'partly_delivered'
    | 'delivered'
    | 'delayed'
    | 'attempted'
    | 'held'
    | 'too_old'
    | 'unknown'
    | 'error';

/** One box (consignment) as the customer would see it. */
export interface TrackedBox {
    reference: string | null;
    carrier: string | null;
    status: string | null;
    etaLocal: string | null;
    trackingUrl: string | null;
}

export interface TrackingResult {
    state: TrackingState;
    /** Suggested customer-facing message (confirmed or DRAFT — see trackingCopy). */
    message: string;
    /** Structured box detail for the agent / UI to render richer output if desired. */
    boxes: TrackedBox[];
    /** Number of consignments — the status-bearing unit ("2 of 3 delivered"). */
    totalBoxes: number;
    deliveredBoxes: number;
    /**
     * Total cartons/items summed across consignments' `consignmentItems`.
     * SETTLED 18 Aug 2026 against live data: HTG books ONE consignment holding N
     * cartons (Ex1 2, Ex2 9, Ex5 8), so this — not `totalBoxes` — is the number
     * of parcels the customer actually receives, and it is what customer-facing
     * copy states. `totalBoxes`/`deliveredBoxes` stay the status-bearing unit.
     * 0 when no item arrays.
     */
    totalItems: number;
    /** How ownership was proven for this result (audit): 'dotwms' | 'machship-toEmail' | null. */
    verifiedVia: 'dotwms' | 'machship-toEmail' | null;
    /** ETA to surface (earliest outstanding box), ISO local, or null. */
    eta: string | null;
    /** Whether the confirmed ETA disclaimer was appended to `message`. */
    showEtaDisclaimer: boolean;
    /** Resolver provider that produced this (audit). */
    provider: string;
    /**
     * Delivery recipient's name from the consignment, or null when there is no
     * consignment to read it from (not_found, preparing, too_old). INTERNAL ONLY:
     * this exists so an escalation alert can name the customer in its subject
     * (`H2G AI ALERT_CS_<Name>`), which is what the Helpdesk routing rule reads.
     * Never render it back to the customer — they already know their own name, and
     * echoing it would leak whose order a guessed order number belongs to.
     */
    recipientName: string | null;
    /** Internal diagnostic — never shown to the customer. */
    diagnostic?: string;
}
