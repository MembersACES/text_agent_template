/**
 * Customer-facing wording for order tracking.
 *
 * CONFIRMED by Iri (28 Jul 2026): the own-driver line and the ETA disclaimer.
 * DRAFT (NOT yet signed off — handoff outstanding item #2): every other status
 * line. Do not treat draft copy as final; Iri edits these. They are separated
 * here so sign-off is a copy edit, not a code change.
 */

/** CONFIRMED (Iri, 28 Jul 2026) — own-driver deliveries (in dotWMS, not MachShip). */
export const OWN_DRIVER_LINE =
    'Your order has been packed and is out for delivery on the H2G run delivery day.';

/** CONFIRMED (Iri, 28 Jul 2026) — appended whenever an ETA is shown. */
export const ETA_DISCLAIMER =
    "If you haven't received it within 24 hours of the estimated date, please contact us and we'll chase it up.";

/** DRAFT — pending Iri sign-off. Wording is placeholder; the BRANCHING is the point. */
export const DRAFT_COPY = {
    notFound:
        "I couldn't find an order matching that number and email. Please double-check both — the email must be the one used on the order.",
    preparing:
        "Your order is being prepared for dispatch. We'll have tracking for you once it leaves our warehouse.",
    held: (reason: string | null): string =>
        reason
            ? `Your order is currently on hold (${reason}). Please contact us and we'll sort it out.`
            : "Your order is currently on hold. Please contact us and we'll sort it out.",
    tooOld:
        'That order is outside the window I can look up here (the last 60 days). Please contact us and we will help.',
    unverifiedRefused:
        'To protect your order details, I can only look these up with your BigCommerce order number and the email address used on the order.',
    // Running late — surfaced instead of a plain "on its way".
    delayed:
        "Your order is on its way but is currently running behind schedule. If you're concerned, contact us and we'll chase it up with the courier.",
    // A delivery was attempted but not completed.
    attempted:
        "The courier attempted to deliver your order but couldn't complete it. They'll usually try again — your tracking link has the details.",
    // Status we don't recognise — never over-claim; stay neutral and point to us.
    unknownStatus:
        "Your order is in progress. For the latest status, please contact us with your order number and email.",
} as const;
