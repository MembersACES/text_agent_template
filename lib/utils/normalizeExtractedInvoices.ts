import type { ExtractedInvoice } from '@/lib/types/ReportTypes';

/**
 * Maps common alternate keys from Gemini (esp. when field names drift from OUTPUT SCHEMA)
 * onto our ExtractedInvoice shape.
 */
export function normalizeExtractedInvoices(raw: unknown[]): ExtractedInvoice[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((item) => normalizeOne(item)).filter((x): x is ExtractedInvoice => x != null);
}

function firstDefined<T>(...values: (T | null | undefined)[]): T | null | undefined {
    for (const v of values) {
        if (v !== null && v !== undefined) return v;
    }
    return undefined;
}

/** Parse DD/MM/YYYY (AU invoice default). */
function parseAuDate(s: string): Date | null {
    const t = s.trim();
    const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const y = parseInt(m[3], 10);
    const dt = new Date(y, mo, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
}

/** Inclusive day count for a billing window (min 1 if same day). */
function billingDaysFromRange(start: string, end: string): number | null {
    const a = parseAuDate(start);
    const b = parseAuDate(end);
    if (!a || !b) return null;
    const dayMs = 86_400_000;
    const days = Math.round((b.getTime() - a.getTime()) / dayMs) + 1;
    return days >= 1 ? days : null;
}

/**
 * Gemini often appends " NMI XXXXX" to customer_name even when nmi is a separate field.
 */
function cleanBusinessName(name: string | null | undefined, nmi: string | null | undefined): string | null {
    if (name == null || typeof name !== 'string') return name ?? null;
    let s = name.trim();
    if (!s) return null;
    if (nmi && nmi.length > 0) {
        const re = new RegExp(`\\s*NMI\\s*${nmi.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
        s = s.replace(re, '').trim();
    } else {
        s = s.replace(/\s+NMI\s+[A-Z0-9]{4,20}\s*$/i, '').trim();
    }
    return s || name.trim();
}

function normalizeOne(item: unknown): ExtractedInvoice | null {
    if (item == null || typeof item !== 'object') return null;
    const o = item as Record<string, unknown>;
    const n = { ...o } as Record<string, unknown>;

    // Customer / business
    if (n.business_name == null) {
        n.business_name = firstDefined(
            o.customer_name as string | null,
            o.client_name as string | null,
            o.customer as string | null,
        ) ?? null;
    }

    if (n.invoice_date == null) {
        n.invoice_date = firstDefined(
            o.issue_date as string | null,
            o.bill_date as string | null,
        ) ?? null;
    }

    if (n.billing_period_start == null) {
        n.billing_period_start = firstDefined(
            o.billing_period_start as string | null,
            o.invoice_period_start as string | null,
            o.invoice_period_start_date as string | null,
            o.bill_period_start_date as string | null,
            o.bill_period_start as string | null,
            o.start_date as string | null,
        ) ?? null;
    }

    if (n.billing_period_end == null) {
        n.billing_period_end = firstDefined(
            o.billing_period_end as string | null,
            o.invoice_period_end as string | null,
            o.invoice_period_end_date as string | null,
            o.bill_period_end_date as string | null,
            o.bill_period_end as string | null,
            o.end_date as string | null,
        ) ?? null;
    }

    if (n.supplier == null) {
        n.supplier = firstDefined(
            o.supplier as string | null,
            o.provider_name as string | null,
            o.retailer_name as string | null,
            o.retailer as string | null,
        ) ?? null;
    }

    if (n.meter_charges == null) {
        const m = firstDefined(
            o.meter_charges as number | null,
            o.metering_charges as number | null,
            o.metering_fee as number | null,
            o.dma_charges as number | null,
            o.daily_metering as number | null,
        );
        if (m != null) {
            const num = typeof m === 'number' ? m : Number(m);
            n.meter_charges = Number.isFinite(num) ? num : null;
        } else n.meter_charges = null;
    }

    if (n.billing_days == null) {
        const d = o.billing_days ?? o.invoice_period_days;
        if (d == null) {
            const start = n.billing_period_start as string | null | undefined;
            const end = n.billing_period_end as string | null | undefined;
            if (start && end) n.billing_days = billingDaysFromRange(start, end);
            else n.billing_days = null;
        } else {
            const num = typeof d === 'number' ? d : Number(d);
            n.billing_days = Number.isFinite(num) ? num : null;
        }
    }

    const nmi = (n.nmi ?? o.nmi) as string | null | undefined;
    if (typeof n.business_name === 'string') {
        n.business_name = cleanBusinessName(n.business_name, nmi ?? null);
    }

    if (n.total_inc_gst == null) {
        const t = firstDefined(
            o.total_inc_gst as number | null,
            o.total_amount_due as number | null,
            o.total_due as number | null,
            o.amount_due as number | null,
        );
        if (t == null) n.total_inc_gst = null;
        else {
            const num = typeof t === 'number' ? t : Number(t);
            n.total_inc_gst = Number.isFinite(num) ? num : null;
        }
    }

    if (n.invoice_number == null && o.invoice_num != null) n.invoice_number = o.invoice_num as string;

    return n as unknown as ExtractedInvoice;
}
