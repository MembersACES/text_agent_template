import { getLogger } from '@/lib/config/logger';
import { settings } from '@/lib/config/settings';
import { MACHSHIP_FIXTURE_CONSIGNMENTS } from './fixture';
import type {
    MachShipConsignment,
    MachShipEnvelope,
    MachShipLookupResult,
} from './types';

const logger = getLogger('MachShipService');

/**
 * MachShip lookup — Syspro reference → consignments (boxes, courier, ETA, tracking).
 *
 * The live request logic is proven in scripts/chain-test.mjs: try the SO-prefixed
 * customerReference2 first, then the digits-only customerReference1. Until we have
 * a real order that exists in BOTH dotWMS and MachShip (blocked on Iri's example
 * orders), set MACHSHIP_USE_FIXTURE=true to exercise the pipeline against a canned,
 * known-shape response. Unset it (or set "false") to hit live MachShip.
 */
export class MachShipService {
    private readonly baseUrl: string;
    private readonly token: string;
    private readonly useFixture: boolean;

    constructor() {
        this.baseUrl = settings.machship.baseUrl;
        this.token = settings.machship.token;
        this.useFixture = settings.machship.useFixture;
    }

    /**
     * Look up consignments for the given references. Tries SO-prefixed
     * customerReference2 first, then the digits-only customerReference1.
     * Never throws for "not found" — returns an outcome.
     */
    async lookupByReferences(refs: {
        sysproReferences: string[];
        bareReferences: string[];
    }): Promise<MachShipLookupResult> {
        if (this.useFixture) {
            logger.warn('MACHSHIP_USE_FIXTURE=true — returning canned fixture, NOT live data');
            return {
                outcome: 'found',
                consignments: MACHSHIP_FIXTURE_CONSIGNMENTS,
                via: 'reference2',
                errors: [],
            };
        }
        if (!this.token) {
            logger.error('MACHSHIP_TOKEN missing — cannot look up');
            return { outcome: 'error', consignments: [], via: null, errors: ['MachShip token not configured'] };
        }

        const ref2 = await this.call('/apiv2/consignments/returnConsignmentsByReference2', refs.sysproReferences);
        if (ref2.consignments.length) return { ...ref2, via: 'reference2' };

        const ref1 = await this.call('/apiv2/consignments/returnConsignmentsByReference1', refs.bareReferences);
        if (ref1.consignments.length) return { ...ref1, via: 'reference1' };

        const errors = [...ref2.errors, ...ref1.errors];
        // Zero consignments after BOTH reference fields is the "own-driver /
        // not-in-MachShip" case — unless MachShip actually reported an error.
        return {
            outcome: errors.length ? 'error' : 'not_found',
            consignments: [],
            via: null,
            errors,
        };
    }

    private async call(
        path: string,
        references: string[],
    ): Promise<{ outcome: 'found' | 'not_found' | 'error'; consignments: MachShipConsignment[]; errors: string[] }> {
        if (!references.length) {
            return { outcome: 'not_found', consignments: [], errors: [] };
        }
        try {
            const res = await fetch(`${this.baseUrl}${path}`, {
                method: 'POST',
                headers: { token: this.token, 'Content-Type': 'application/json' },
                body: JSON.stringify(references),
            });
            const text = await res.text();
            let env: MachShipEnvelope<MachShipConsignment[]> | null = null;
            try {
                env = JSON.parse(text) as MachShipEnvelope<MachShipConsignment[]>;
            } catch {
                /* non-JSON body */
            }
            const consignments = Array.isArray(env?.object) ? (env!.object as MachShipConsignment[]) : [];
            const allMessages = (env?.errors ?? [])
                .map((e) => e.errorMessage)
                .filter((m): m is string => Boolean(m));
            // MachShip returns a BENIGN "No Consignments were found" INSIDE the
            // errors envelope for a plain not-found (confirmed against live data,
            // 4 Aug 2026). Treating that as a system error would break the
            // own-driver / not-yet-shipped path, which relies on a clean
            // not_found. So filter it out and only keep genuine errors.
            const realErrors = allMessages.filter((m) => !/no consignments?\s*(?:were|was)?\s*found/i.test(m));
            if (realErrors.length) logger.warn(`MachShip ${path} returned errors: ${realErrors.join('; ')}`);
            return {
                outcome: consignments.length ? 'found' : realErrors.length ? 'error' : 'not_found',
                consignments,
                errors: realErrors,
            };
        } catch (err) {
            logger.error(`MachShip ${path} transport error`, err);
            return { outcome: 'error', consignments: [], errors: [err instanceof Error ? err.message : String(err)] };
        }
    }

    /**
     * Best-effort consignment date for the 60-day lookback gate.
     *
     * Field names CONFIRMED against live consignments (4 Aug 2026): a consignment
     * carries despatchDateUtc, dateCreated, bookedDate, completedDateUtc and
     * etaUtc/eta (NOT manifestedDateUtc / createdDateUtc / consignmentDate). We
     * prefer the actual despatch date, then creation/booking, then completion,
     * then ETA. If none are present, return null so the caller treats the date as
     * UNKNOWN rather than silently assuming "in window".
     */
    consignmentDate(c: MachShipConsignment): Date | null {
        const candidates = [
            'despatchDateUtc',
            'dateCreated',
            'bookedDate',
            'completedDateUtc',
            'etaUtc',
            'eta',
        ];
        for (const key of candidates) {
            const v = c[key];
            if (typeof v === 'string' && v) {
                const d = new Date(v);
                if (!Number.isNaN(d.getTime())) return d;
            }
        }
        return null;
    }
}
