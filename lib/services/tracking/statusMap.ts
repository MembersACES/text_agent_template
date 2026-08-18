/**
 * MachShip consignment status vocabulary → semantic render bucket.
 *
 * The status NAMES below are those OBSERVED in live HTG data (4 Aug 2026) plus
 * MachShip's documented core set. This is the SINGLE PLACE the vocabulary lives.
 * It is NOT guaranteed exhaustive — MachShip may emit statuses we haven't seen.
 * Any status not mapped (and not caught by the defensive fallbacks) resolves to
 * `unknown`, which renders a safe, non-committal message and NEVER claims
 * "delivered". Add new statuses here as the finder/live traffic surfaces them.
 *
 * Observed lifecycle (Ex2–Ex5): Unmanifested → Manifested → Booked →
 * Scanned into Depot → In Transit → Picked Up → On For Delivery →
 * [Partial Delivery → Delayed → In Transit → On For Delivery →
 *  Delivery Attempted] → Complete.
 *
 * `statusIsPartial` (a per-statusHistory-event boolean) corroborates `partial`
 * but the STATUS NAME is the primary trigger (per Morgan, 4 Aug).
 */
export type StatusBucket =
    | 'delivered'
    | 'partial'
    | 'out_for_delivery'
    | 'in_transit'
    | 'preparing'
    | 'delayed'
    | 'attempted'
    | 'unknown';

/** Exact (lower-cased) status name → bucket. Extend as new statuses appear. */
export const CONSIGNMENT_STATUS_MAP: Record<string, StatusBucket> = {
    complete: 'delivered',
    delivered: 'delivered',
    'partial delivery': 'partial',
    'on for delivery': 'out_for_delivery',
    'out for delivery': 'out_for_delivery',
    'in transit': 'in_transit',
    'picked up': 'in_transit',
    'scanned into depot': 'in_transit',
    'delivery time scheduled': 'in_transit',
    unmanifested: 'preparing',
    manifested: 'preparing',
    booked: 'preparing',
    delayed: 'delayed',
    'delivery attempted': 'attempted',
};

/**
 * Classify a status name into a bucket. Exact map first, then conservative
 * keyword fallbacks ordered so a problem state (attempted/failed, delayed) is
 * never misread as delivered. Truly unrecognised → 'unknown' (safe default).
 */
export function classifyConsignmentStatus(name: string | null | undefined): StatusBucket {
    const key = String(name ?? '').trim().toLowerCase();
    if (!key) return 'unknown';
    const exact = CONSIGNMENT_STATUS_MAP[key];
    if (exact) return exact;

    if (/partial/.test(key)) return 'partial';
    if (/attempt|failed|unsuccessful|refused|returned to sender|rtn/.test(key)) return 'attempted';
    if (/delay|exception|on hold|held/.test(key)) return 'delayed';
    if (/complete|delivered/.test(key)) return 'delivered';
    if (/out for delivery|for delivery/.test(key)) return 'out_for_delivery';
    if (/transit|depot|picked|scanned|collected|linehaul|line ?haul|despatch|dispatch|schedul/.test(key)) return 'in_transit';
    if (/manifest|booked|await|prepar|pack|created|new/.test(key)) return 'preparing';
    return 'unknown';
}
