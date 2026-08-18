import { getLogger } from '@/lib/config/logger';
import { settings } from '@/lib/config/settings';
import type {
    FreightLookupInput,
    FreightReferenceResolver,
    FreightReferenceResult,
    ResolvedOrder,
} from './types';

const logger = getLogger('DotWmsReferenceResolver');

interface DotWmsRow {
    PackSlipNumber?: string;
    JobStatus?: string;
    JobStatusTranslated?: string;
    JobHeldReason?: string | null;
    DeliveryEmail?: string;
}

/**
 * dotWMS-backed resolver (Syspro era). The request/response behaviour here is
 * proven against live data in scripts/chain-test.mjs and
 * scripts/dotwms-access-check.mjs. Retire at Odoo go-live — see the
 * FreightReferenceResolver contract in ./types.
 *
 * Behaviour notes (verified via the access-check script):
 *  - GET; API key in the query string; DocumentKey is `email|order`.
 *  - Success => JSON array of rows. Failure => XML body on HTTP 400.
 *  - A wrong email and a non-existent order return the SAME error (no info leak),
 *    so we surface one generic "couldn't find it" upstream.
 *  - dotWMS enforces the email match server-side; we re-check as defence in depth.
 *  - dotWMS does NOT tolerate padding — trim order and email before sending.
 */
export class DotWmsReferenceResolver implements FreightReferenceResolver {
    public readonly provider = 'dotwms';

    private readonly baseUrl: string;
    private readonly apiKey: string;
    private readonly instanceCode: string;
    private readonly exportFileType: string;
    private readonly orderPrefix: string;
    private readonly sysproPrefix: string;

    constructor() {
        this.baseUrl = settings.dotwms.baseUrl;
        this.apiKey = settings.dotwms.apiKey;
        this.instanceCode = settings.dotwms.instanceCode;
        this.exportFileType = settings.dotwms.exportFileType;
        this.orderPrefix = settings.dotwms.orderPrefix;
        this.sysproPrefix = settings.dotwms.sysproPrefix;
    }

    async resolve(input: FreightLookupInput): Promise<FreightReferenceResult> {
        const email = input.email.trim();
        const rawOrder = input.orderNumber.trim();

        if (!this.apiKey) {
            logger.error('DOTWMS_API_KEY missing — cannot resolve');
            return this.error('dotWMS API key not configured');
        }
        if (!email || !rawOrder) {
            return this.notFound('empty order or email');
        }

        // Both a 6-digit BigCommerce order AND an 8-digit Syspro number go through
        // dotWMS: dotWMS enforces the email on BOTH key forms (6-digit BC-prefixed,
        // 8-digit SO-prefixed — confirmed 4 Aug 2026). So the 8-digit path is
        // email-verified here too, and gets warehouse job status — which lets
        // own-driver / not-yet-shipped 8-digit orders be answered instead of
        // dead-ending at MachShip.
        const order = this.normaliseOrderKey(rawOrder);
        const url = this.buildUrl(email, order);

        let res: Response;
        try {
            res = await fetch(url);
        } catch (err) {
            logger.error('dotWMS request failed', err);
            return this.error(`transport error: ${err instanceof Error ? err.message : String(err)}`);
        }

        const text = await res.text();
        let rows: DotWmsRow[] = [];
        try {
            const parsed = JSON.parse(text);
            rows = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
            // XML / HTTP 400 error body = wrong email OR unknown order (indistinguishable).
            logger.info(`dotWMS no-match (HTTP ${res.status})`);
            return this.notFound(`non-JSON body, HTTP ${res.status}`);
        }

        const usable = rows.filter((r) => r.PackSlipNumber);
        if (!usable.length) {
            return this.notFound(`HTTP ${res.status}, 0 usable rows`);
        }

        // Defence in depth — dotWMS already gates on email, we re-check.
        // Case-insensitive; trim both sides (dotWMS is not whitespace-safe).
        const deliveryEmail = usable.find((r) => r.DeliveryEmail)?.DeliveryEmail ?? null;
        const emailOk = usable.every(
            (r) => String(r.DeliveryEmail ?? '').trim().toLowerCase() === email.toLowerCase(),
        );
        if (!emailOk) {
            logger.warn('dotWMS returned rows but our email re-check FAILED — refusing');
            return {
                outcome: 'not_found',
                verified: false,
                verifyVia: 'none',
                deliveryEmail,
                orders: [],
                provider: this.provider,
                diagnostic: 'email re-check failed',
            };
        }

        const orders: ResolvedOrder[] = usable.map((r) => this.toResolvedOrder(r));
        logger.info(`dotWMS matched ${orders.length} pack slip(s); email verified`);
        return {
            outcome: 'matched',
            verified: true,
            verifyVia: 'dotwms',
            deliveryEmail,
            orders,
            provider: this.provider,
        };
    }

    /**
     * Normalise the customer's number into the dotWMS DocumentKey form:
     *   6 digits          → BigCommerce order, `${orderPrefix}` (default "BC-")
     *   8 digits (±"SO")  → Syspro number,     `${sysproPrefix}` (default "SO")
     * dotWMS enforces the email on both. Anything else is passed through unchanged.
     */
    private normaliseOrderKey(raw: string): string {
        if (/^\d{6}$/.test(raw) && this.orderPrefix) {
            return `${this.orderPrefix}${raw}`;
        }
        const so = raw.match(/^(?:SO)?(\d{8})$/i);
        if (so) {
            return `${this.sysproPrefix}${so[1]}`;
        }
        return raw;
    }

    private toResolvedOrder(r: DotWmsRow): ResolvedOrder {
        const pack = String(r.PackSlipNumber ?? '').trim();
        const digits = pack.replace(/^SO/i, '');
        return {
            sysproReference: /^SO/i.test(pack) ? pack : `SO${digits}`,
            bareReference: digits,
            warehouseStatusRaw: r.JobStatus ?? null,
            warehouseStatusTranslated: r.JobStatusTranslated ?? null,
            heldReason: r.JobHeldReason ?? null,
        };
    }

    private buildUrl(email: string, order: string): string {
        const params = new URLSearchParams({
            InstanceCode: this.instanceCode,
            ExportFileType: this.exportFileType,
            APIKey: this.apiKey,
            DocumentFormat: 'JSON',
            DocumentKey: `${email}|${order}`,
        });
        return `${this.baseUrl}?${params.toString()}`;
    }

    private notFound(diagnostic: string): FreightReferenceResult {
        return {
            outcome: 'not_found',
            verified: false,
            verifyVia: 'none',
            deliveryEmail: null,
            orders: [],
            provider: this.provider,
            diagnostic,
        };
    }

    private error(diagnostic: string): FreightReferenceResult {
        return {
            outcome: 'error',
            verified: false,
            verifyVia: 'none',
            deliveryEmail: null,
            orders: [],
            provider: this.provider,
            diagnostic,
        };
    }
}
