import type { AlertTeam, AlertTrigger } from './types';

/**
 * Trigger → team routing (per Order-Tracking-Scope-Expansion-4Aug.md):
 *   - not_found      → CS  (advise re-check; if confirmed correct, CS follows up)
 *   - queued_chasing → WH  (order in packing queue, customer chasing to expedite)
 *   - wont_wait      → CS  (customer doesn't want to wait for a remaining box)
 *   - collection_refused → CS  (parcel at a collection point, customer cannot collect)
 */
const TRIGGER_TEAM: Record<AlertTrigger, AlertTeam> = {
    not_found: 'CS',
    queued_chasing: 'WH',
    wont_wait: 'CS',
    collection_refused: 'CS',
    duplicate_consignments: 'CS',
};

export function teamForTrigger(trigger: AlertTrigger): AlertTeam {
    return TRIGGER_TEAM[trigger];
}

/** Default brief reasons per trigger (callers may override with something specific). */
export const DEFAULT_REASON: Record<AlertTrigger, string> = {
    not_found: 'Order not found in lookup; customer confirms the details are correct.',
    queued_chasing: 'Order is in the packing queue and the customer is chasing to receive it sooner.',
    wont_wait: 'Split order: customer does not want to wait for the remaining box.',
    collection_refused: 'Parcel is at a collection point and the customer is not able to collect it.',
    duplicate_consignments: 'More than one live consignment against this order in MachShip; needs a person to confirm which is correct.',
};
