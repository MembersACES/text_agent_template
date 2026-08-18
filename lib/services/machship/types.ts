/**
 * Subset of the MachShip consignment shape we rely on. Field names verified via
 * scripts/chain-test.mjs and scripts/machship-capability-check.mjs against live
 * data. The index signature keeps access to fields we have NOT yet confirmed
 * (e.g. the creation/manifest date used by the 60-day gate) typed-but-loose.
 */
export interface MachShipStatus {
    name?: string;
}

export interface MachShipTrackingStatus {
    consignmentTrackingStatus?: { name?: string };
}

/** A line/carton within a consignment. Comes back as "Generic Item" (no SKU) —
 *  we know boxes, not contents. Used as the secondary split dimension. */
export interface MachShipConsignmentItem {
    name?: string;
    sku?: string | null;
    [key: string]: unknown;
}

export interface MachShipConsignment {
    /** digits only, e.g. "10216938" */
    customerReference?: string;
    /** "SO" + digits, e.g. "SO10216938" */
    customerReference2?: string;
    carrierConsignmentId?: string;
    carrierName?: string;
    status?: MachShipStatus;
    etaLocal?: string | null;
    eta?: string | null;
    trackingPageAccessToken?: string | null;
    attachmentCount?: number;
    /**
     * Delivery email carried on the consignment. This is what lets an 8-digit
     * Syspro-number lookup (which bypasses dotWMS) still be verified — match the
     * customer's email against this. May be empty on some consignments.
     */
    toEmail?: string | null;
    /** Cartons/items within THIS consignment (secondary split dimension). */
    consignmentItems?: MachShipConsignmentItem[];
    statusHistory?: MachShipTrackingStatus[];
    /**
     * Other fields (incl. the exact created/manifested date field, which is NOT
     * yet confirmed against a real order) are reachable via this index signature.
     * See MachShipService.consignmentDate().
     */
    [key: string]: unknown;
}

/** Standard MachShip envelope: HTTP 200 even on error — always read `errors`. */
export interface MachShipEnvelope<T> {
    object: T | null;
    errors?: Array<{ errorMessage?: string }> | null;
}

export type MachShipReference = 'reference1' | 'reference2';

export interface MachShipLookupResult {
    outcome: 'found' | 'not_found' | 'error';
    consignments: MachShipConsignment[];
    /** which reference field matched (audit); null when nothing matched */
    via: MachShipReference | null;
    /** MachShip error messages if any (logs only) */
    errors: string[];
}
