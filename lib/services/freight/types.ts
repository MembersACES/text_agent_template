/**
 * Freight-reference resolution — the SWAPPABLE seam of phase-1 order tracking.
 *
 * A customer gives an order number + email. A resolver turns that into the
 * freight reference(s) MachShip understands (the Syspro sales-order number),
 * having verified the email wherever the source system can.
 *
 * Today the only implementation is dotWMS (Syspro-backed). At Odoo go-live
 * (end of October 2026) dotWMS + Syspro are retired: implement a new
 * FreightReferenceResolver against Odoo and switch `settings.freight.provider`.
 * NOTHING downstream (MachShip lookup, customer wording) should change.
 */

/** One order as resolved to a MachShip-usable freight reference. */
export interface ResolvedOrder {
    /** SO-prefixed reference — MachShip `customerReference2`, e.g. "SO10216938". */
    sysproReference: string;
    /** Digits-only reference — MachShip `customerReference1`, e.g. "10216938". */
    bareReference: string;
    /** Raw warehouse status from the source system (unmapped). May be null. */
    warehouseStatusRaw: string | null;
    /** Source system's own human-readable status, if provided. May be null. */
    warehouseStatusTranslated: string | null;
    /** Held reason if the order is on hold, else null. */
    heldReason: string | null;
}

export type FreightLookupOutcome = 'matched' | 'not_found' | 'error';

/**
 * How ownership of this order can be / was proven:
 *  - 'dotwms'          — the source system already matched the email (verified:true).
 *  - 'machship-toEmail' — not yet proven; the caller must match the customer's
 *                         email against the consignment `toEmail` AFTER the
 *                         MachShip lookup (the 8-digit direct-Syspro path).
 *  - 'none'            — no verification route exists (e.g. 8-digit own-driver:
 *                         not in MachShip, so nothing to match against).
 */
export type VerificationMethod = 'dotwms' | 'machship-toEmail' | 'none';

export interface FreightReferenceResult {
    outcome: FreightLookupOutcome;
    /**
     * True only when the source system confirmed the customer's email owns the
     * order (the dotWMS path). `matched` with `verified:false` means we found
     * references but ownership is NOT yet proven — see `verifyVia` for whether a
     * downstream route exists (MachShip `toEmail`) or the case is unverifiable.
     */
    verified: boolean;
    /** How ownership is / can be proven. See VerificationMethod. */
    verifyVia: VerificationMethod;
    /** Delivery email on record, if the source returned one. Never shown to the customer. */
    deliveryEmail: string | null;
    /** Resolved orders (more than one = multiple pack slips for the same order). */
    orders: ResolvedOrder[];
    /** Resolver that produced this result (audit / logging). */
    provider: string;
    /** Internal diagnostic for logs — never surfaced to the customer. */
    diagnostic?: string;
}

export interface FreightLookupInput {
    /** Exactly what the customer typed. The resolver normalises (trim, prefix). */
    orderNumber: string;
    /** Exactly what the customer typed. The resolver normalises (trim, lowercase). */
    email: string;
}

/**
 * The swappable contract. One method, provider-neutral in and out.
 * Implementations MUST NOT throw for "not found" / "wrong email" — return an
 * `outcome` instead; reserve throwing for genuine transport failures, and even
 * then prefer returning `outcome:'error'` so the agent can degrade gracefully.
 */
export interface FreightReferenceResolver {
    readonly provider: string;
    resolve(input: FreightLookupInput): Promise<FreightReferenceResult>;
}
