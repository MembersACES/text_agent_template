import type { MachShipConsignment } from './types';

/**
 * Canned MachShip response in the KNOWN shape (field names verified via
 * scripts/machship-capability-check.mjs). Used ONLY when MACHSHIP_USE_FIXTURE=true,
 * so the tracking pipeline can be exercised before Iri supplies a real order that
 * exists in both dotWMS and MachShip. THIS IS NOT REAL DATA.
 *
 * Scenario modelled: one order shipped in two boxes with the same references —
 * box 1 delivered ("Complete"), box 2 still "In Transit" — i.e. a split,
 * partly-delivered order, which is the exact case phase 1 exists to handle.
 */
export const MACHSHIP_FIXTURE_CONSIGNMENTS: MachShipConsignment[] = [
    {
        customerReference: '10216938',
        customerReference2: 'SO10216938',
        carrierConsignmentId: 'XPD1234567',
        carrierName: 'StarTrack',
        status: { name: 'Complete' },
        etaLocal: '2026-08-01T00:00:00',
        eta: '2026-08-01T00:00:00',
        etaUtc: '2026-07-31T14:00:00',
        trackingPageAccessToken: 'FIXTURE-TOKEN-BOX1',
        attachmentCount: 1,
        toEmail: 'fixture@example.com',
        despatchDateUtc: '2026-07-30T02:15:00',
        dateCreated: '2026-07-30T02:15:00.000',
        statusHistory: [{ consignmentTrackingStatus: { name: 'Complete' } }],
    },
    {
        customerReference: '10216938',
        customerReference2: 'SO10216938',
        carrierConsignmentId: 'XPD1234568',
        carrierName: 'StarTrack',
        status: { name: 'On For Delivery' },
        etaLocal: '2026-08-05T00:00:00',
        eta: '2026-08-05T00:00:00',
        etaUtc: '2026-08-04T14:00:00',
        trackingPageAccessToken: 'FIXTURE-TOKEN-BOX2',
        attachmentCount: 0,
        toEmail: 'fixture@example.com',
        despatchDateUtc: '2026-07-30T02:15:00',
        dateCreated: '2026-07-30T02:15:00.000',
        statusHistory: [{ consignmentTrackingStatus: { name: 'On For Delivery' } }],
    },
];
