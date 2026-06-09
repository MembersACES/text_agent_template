// TypeScript interfaces for Base 1 Review report generation

export interface ExtractedInvoice {
    // Customer & Account
    business_name: string | null;
    supplier: string | null;
    utility_type: "Electricity" | "Gas" | "Water" | "Waste" | "Oil" | "Cleaning";
    site_address: string | null;
    nmi: string | null;           // Electricity: 10-11 chars
    mrin: string | null;          // Gas: 8-12 chars
    account_number: string | null;
    
    // Invoice Details
    invoice_date: string | null;  // DD/MM/YYYY
    invoice_number: string | null;
    billing_period_start: string | null;
    billing_period_end: string | null;
    billing_days: number | null;
    
    // Electricity Usage & Rates
    peak_usage_kwh: number | null;
    shoulder_usage_kwh: number | null;
    off_peak_usage_kwh: number | null;
    total_usage_kwh: number | null;
    peak_rate_c_per_kwh: number | null;
    shoulder_rate_c_per_kwh: number | null;
    off_peak_rate_c_per_kwh: number | null;
    daily_supply_charge: number | null;
    /**
     * Demand used for billed demand charges this period (kW or kVA — use the same unit as the invoice;
     * many C&I bills are kVA; store the numeric value here).
     */
    demand_kw: number | null;
    /** Highest interval / max demand on the invoice (same unit as demand_kw). */
    recorded_max_demand_kw?: number | null;
    demand_charges: number | null;
    meter_charges: number | null;
    
    // Gas Specific
    total_usage_mj: number | null;
    total_usage_gj: number | null;
    volume_m3: number | null;
    gas_rate_per_gj: number | null;  // $/GJ rate from invoice
    
    // Waste Specific
    waste_services?: Array<{
        service_type: string;      // e.g., "3M3 Frontlift General"
        frequency: number | null;  // collections per period
        unit_cost: number | null;  // cost per collection
        total_cost: number | null;
        pickup_dates?: string[];    // Array of pickup dates (DD/MM/YYYY format)
    }>;
    
    // Oil Specific
    oil_services?: Array<{
        service_type: string;      // e.g., "Waste Oil Collection"
        quantity: number | null;
        unit_cost: number | null;
        total_cost: number | null;
    }>;
    
    // Costs
    usage_charges_ex_gst: number | null;
    supply_charges_ex_gst: number | null;
    network_charges_ex_gst: number | null;
    total_charges_ex_gst: number | null;
    gst_amount: number | null;
    total_inc_gst: number | null;
    
    // Tariff & Meter
    tariff_type: string | null;
    meter_number: string | null;
    
    // Analysis
    low_hanging_fruit?: Array<{
        type: string;
        severity: "high" | "medium" | "low";
        message: string;
        potential_savings: string | null;
    }>;
    error?: string | null;
}

export interface BusinessInfo {
    name: string;
    address?: string;
    contact?: string;
    sites?: string[];
}

export interface SavingsSummary {
    conservative: number;
    moderate: number;
    /** @deprecated Kept for backwards compatibility; equals `moderate` (100% scenario). */
    optimistic: number;
    criticalIssues: Array<{
        issue: string;
        savings: number;
        severity: "high" | "medium" | "low";
    }>;
}

export interface ReportData {
    businessInfo: BusinessInfo;
    invoices: ExtractedInvoice[];
    savingsSummary?: SavingsSummary;
    generatedAt: string; // ISO timestamp
}

export interface SavingsFilterOptions {
    hideWasteForMemberReport?: boolean;
}

export interface InvoiceOpportunity {
    type: string;
    issue: string;
    savings: number;
    severity: 'high' | 'medium' | 'low';
    utilityType: ExtractedInvoice['utility_type'];
    /** Invoice row index in the original `invoices` array (for distinct invoice counts per bucket). */
    invoiceIndex: number;
}

function normalizeText(value: string | null | undefined): string {
    return (value || '').trim().toLowerCase();
}

function parseAuDateToEpoch(value: string | null | undefined): number {
    if (!value) return Number.NEGATIVE_INFINITY;
    const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return Number.NEGATIVE_INFINITY;
    const d = Number(match[1]);
    const m = Number(match[2]) - 1;
    const y = Number(match[3]);
    const dt = new Date(y, m, d);
    const ts = dt.getTime();
    return Number.isFinite(ts) ? ts : Number.NEGATIVE_INFINITY;
}

/** Calendar span in whole days inclusive (Aus DD/MM/YYYY). */
function billingSpanDaysInclusive(start: string | null | undefined, end: string | null | undefined): number | null {
    const ta = parseAuDateToEpoch(start);
    const tb = parseAuDateToEpoch(end);
    if (!Number.isFinite(ta) || !Number.isFinite(tb) || ta === Number.NEGATIVE_INFINITY || tb === Number.NEGATIVE_INFINITY) {
        return null;
    }
    const diff = Math.abs(tb - ta) / (24 * 60 * 60 * 1000);
    return Math.round(diff) + 1;
}

/** True when start and end fall in the same calendar month/year (classic “whole month” bill). */
function periodWithinSingleCalendarMonth(start: string | null | undefined, end: string | null | undefined): boolean | null {
    const ms = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((start ?? '').trim());
    const me = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((end ?? '').trim());
    if (!ms || !me) return null;
    return ms[3] === me[3] && ms[2] === me[2];
}

function periodSpansMultipleCalendarMonths(start: string | null | undefined, end: string | null | undefined): boolean | null {
    const ms = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((start ?? '').trim());
    const me = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((end ?? '').trim());
    if (!ms || !me) return null;
    const y = Number(ms[3]);
    const m0 = Number(ms[2]);
    const m1 = Number(me[2]);
    const ye = Number(me[3]);
    if (ye !== y) return true;
    return m1 !== m0;
}

/**
 * C&I vs SME for routing savings exclusions (paired with portfolio rule).
 *
 * Signals (no single metric is authoritative):
 * - Tariff wording (explicit SME / C&I).
 * - Long billed cycles (~quarterly): SME-heavy (bundled SME rollover).
 * - Separated network / unbundling (network_charges_ex_gst): C&I-heavy.
 * - Usage dominates ex-GST total with negligible network: bundled SME-heavy.
 * - Demand dollar lines alone do not force C&I (some SME tariffs still show demand).
 */
export interface ElectricityClassificationDebug {
    classification: 'c_and_i' | 'sme';
    cAndSignals: number;
    smeSignals: number;
    reasons: string[];
}

function evaluateElectricityCustomerType(inv: ExtractedInvoice): ElectricityClassificationDebug {
    const tariffRaw = inv.tariff_type || '';
    const tariff = normalizeText(tariffRaw);
    const reasons: string[] = [];

    const hasExplicitCAndI =
        /c\s*&\s*i\b|commercial(?:\s+and\s+|\s*[/&]\s*)industrial|large\s*business\b/.test(tariff);
    const hasExplicitSME = /\bsme\b|small\s+business\b/.test(tariff);

    if (hasExplicitCAndI) {
        reasons.push('explicit tariff keyword matched C&I');
        return { classification: 'c_and_i', cAndSignals: 999, smeSignals: 0, reasons };
    }
    if (hasExplicitSME) {
        reasons.push('explicit tariff keyword matched SME');
        return { classification: 'sme', cAndSignals: 0, smeSignals: 999, reasons };
    }

    const billingDays = inv.billing_days;
    const spanFromDates =
        billingSpanDaysInclusive(inv.billing_period_start, inv.billing_period_end) ?? billingDays ?? null;

    const effectiveDays =
        billingDays != null &&
        billingDays > 0 &&
        spanFromDates != null &&
        spanFromDates > 0 &&
        Math.abs(billingDays - spanFromDates) > 5
            ? spanFromDates
            : billingDays ?? spanFromDates;

    const usageKwh = inv.total_usage_kwh ?? null;
    const annualUsage =
        usageKwh != null && effectiveDays != null && effectiveDays > 0
            ? (usageKwh / effectiveDays) * 365
            : null;

    const netRaw = inv.network_charges_ex_gst;
    const useRaw = inv.usage_charges_ex_gst;
    const supplyRaw = inv.supply_charges_ex_gst;
    const tex = inv.total_charges_ex_gst;

    let net =
        netRaw != null && Number.isFinite(netRaw)
            ? netRaw
            : null;
    if (net !== null && net < 0) net = Math.abs(net);
    let usageCharges =
        useRaw != null && Number.isFinite(useRaw)
            ? useRaw
            : null;
    if (usageCharges !== null && usageCharges < 0) usageCharges = Math.abs(usageCharges);
    let supplyCharges =
        supplyRaw != null && Number.isFinite(supplyRaw)
            ? supplyRaw
            : null;
    if (supplyCharges !== null && supplyCharges < 0) supplyCharges = Math.abs(supplyCharges);

    let smeSignals = 0;
    let cAndSignals = 0;

    // Long-cycle / rollover bills (typically SME-style bundled aggregates)
    if (effectiveDays != null && Number.isFinite(effectiveDays)) {
        if (effectiveDays >= 55) {
            smeSignals += 4;
            reasons.push(`+4 SME: long billing cycle (${effectiveDays} days >= 55)`);
        } else if (effectiveDays >= 45) {
            smeSignals += 2;
            reasons.push(`+2 SME: extended billing cycle (${effectiveDays} days >= 45)`);
        }
    }

    // Does the printed period resemble a tidy single calendar month slab?
    const singleMonthBill = periodWithinSingleCalendarMonth(inv.billing_period_start, inv.billing_period_end);
    const crossesMonths = periodSpansMultipleCalendarMonths(inv.billing_period_start, inv.billing_period_end);

    if (singleMonthBill === true && effectiveDays != null && effectiveDays >= 24 && effectiveDays <= 37) {
        cAndSignals += 1;
        reasons.push('+1 C&I: period contained within single calendar month');
    }
    if (crossesMonths === true && effectiveDays != null && effectiveDays >= 32 && effectiveDays < 55) {
        smeSignals += 1;
        reasons.push('+1 SME: period crosses months with non-monthly cycle');
    }

    // Unbundling / network-visible split
    if (tex != null && tex > 0 && net != null && net > 0) {
        const netRatio = net / tex;
        if (net >= 120 || netRatio >= 0.05) {
            cAndSignals += 4;
            reasons.push(`+4 C&I: significant network split (network=$${net.toFixed(2)}, ratio=${(netRatio * 100).toFixed(1)}%)`);
        } else if (net >= 40 || netRatio >= 0.025) {
            cAndSignals += 3;
            reasons.push(`+3 C&I: moderate network split (network=$${net.toFixed(2)}, ratio=${(netRatio * 100).toFixed(1)}%)`);
        } else if (net >= 15 || netRatio >= 0.012) {
            cAndSignals += 2;
            reasons.push(`+2 C&I: light network split (network=$${net.toFixed(2)}, ratio=${(netRatio * 100).toFixed(1)}%)`);
        }
    } else if (net != null && net >= 120) {
        cAndSignals += 3;
        reasons.push(`+3 C&I: network charge present without total split (network=$${net.toFixed(2)})`);
    }

    const supplySeparate =
        supplyCharges != null && supplyCharges > 15 && tex != null && tex > 0 && supplyCharges / tex >= 0.02;

    const envOrMarketSplit =
        /environmental|aemo|eec|ess|lrec|stc|eec charge|aec|greens?power|climate/i.test(tariffRaw);

    if (supplySeparate || envOrMarketSplit) {
        cAndSignals += 1;
        if (supplySeparate) reasons.push('+1 C&I: separated supply charges present');
        if (envOrMarketSplit) reasons.push('+1 C&I: tariff text includes environmental/market split terms');
    }

    // Bundled / single-stack usage charge dominating ex-GST
    if (
        tex != null &&
        tex > 0 &&
        usageCharges != null &&
        usageCharges > 0 &&
        (net == null || net <= 25)
    ) {
        const usageRatio = usageCharges / tex;
        if (usageRatio >= 0.82) {
            smeSignals += 2;
            reasons.push(`+2 SME: usage charges dominate total (ratio=${(usageRatio * 100).toFixed(1)}%)`);
        } else if (usageRatio >= 0.72) {
            smeSignals += 1;
            reasons.push(`+1 SME: usage-heavy bundled profile (ratio=${(usageRatio * 100).toFixed(1)}%)`);
        }
    }

    if (/\bbundled\b|\bsingle\s+rate\b|\bflat\s+rate\b/.test(tariff)) {
        smeSignals += 1;
        reasons.push('+1 SME: tariff text indicates bundled/single/flat rate');
    }
    if (/\bunbundl\b|network\s+fee|distribution\s+network/i.test(tariff)) {
        cAndSignals += 1;
        reasons.push('+1 C&I: tariff text indicates unbundled/network-fee');
    }

    // Demand magnitude (charges alone deliberately ignored — SME can carry demand rows)
    const demandKw = inv.demand_kw ?? null;
    if (demandKw != null && Number.isFinite(demandKw)) {
        if (demandKw >= 150) {
            cAndSignals += 4;
            reasons.push(`+4 C&I: demand magnitude ${demandKw.toFixed(2)} >= 150`);
        } else if (demandKw >= 100) {
            cAndSignals += 3;
            reasons.push(`+3 C&I: demand magnitude ${demandKw.toFixed(2)} >= 100`);
        } else if (demandKw >= 50) {
            cAndSignals += 1;
            reasons.push(`+1 C&I: demand magnitude ${demandKw.toFixed(2)} >= 50`);
        }
    }

    if (annualUsage != null && Number.isFinite(annualUsage)) {
        if (annualUsage >= 550_000) {
            cAndSignals += 4;
            reasons.push(`+4 C&I: annual usage ${Math.round(annualUsage).toLocaleString('en-AU')} kWh >= 550k`);
        } else if (annualUsage >= 260_000) {
            cAndSignals += 3;
            reasons.push(`+3 C&I: annual usage ${Math.round(annualUsage).toLocaleString('en-AU')} kWh >= 260k`);
        } else if (annualUsage >= 160_000) {
            cAndSignals += 2;
            reasons.push(`+2 C&I: annual usage ${Math.round(annualUsage).toLocaleString('en-AU')} kWh >= 160k`);
        } else if (annualUsage >= 120_000) {
            cAndSignals += 1;
            reasons.push(`+1 C&I: annual usage ${Math.round(annualUsage).toLocaleString('en-AU')} kWh >= 120k`);
        }
    }

    const decide = (): ElectricityClassificationDebug['classification'] => {
        const margin = 1;
        if (cAndSignals >= 5 && cAndSignals - smeSignals >= margin) return 'c_and_i';
        if (smeSignals >= 6 && smeSignals - cAndSignals >= margin) return 'sme';
        if (smeSignals >= 5 && smeSignals > cAndSignals) return 'sme';
        if (cAndSignals > smeSignals) return 'c_and_i';
        return 'sme';
    };

    return { classification: decide(), cAndSignals, smeSignals, reasons };
}

function classifyElectricityCustomerType(inv: ExtractedInvoice): 'c_and_i' | 'sme' {
    return evaluateElectricityCustomerType(inv).classification;
}

export function getElectricityClassificationDebug(inv: ExtractedInvoice): ElectricityClassificationDebug {
    return evaluateElectricityCustomerType(inv);
}

function parseSavingsNumber(value: string | null | undefined): number | null {
    if (!value) return null;
    const match = value.match(/[\d,]+\.?\d*/);
    if (!match) return null;
    const parsed = Number.parseFloat(match[0].replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
}

function electricityGroupingKey(inv: ExtractedInvoice): string {
    const nmi = normalizeText(inv.nmi);
    if (nmi) return `nmi:${nmi}`;
    const site = normalizeText(inv.site_address);
    if (site) return `site:${site}`;
    return `fallback:${normalizeText(inv.business_name)}|${normalizeText(inv.account_number)}`;
}

export function buildSavingsEligibleInvoiceIndexSet(invoices: ExtractedInvoice[]): Set<number> {
    const eligible = new Set<number>();
    const electricityGroups = new Map<string, number[]>();

    /** If any electricity invoice in this run is C&I, drop all SME electricity from savings (report-wide, not per NMI only). */
    const portfolioHasCAndIElectricity = invoices.some(
        (inv) => inv.utility_type === 'Electricity' && classifyElectricityCustomerType(inv) === 'c_and_i',
    );

    invoices.forEach((inv, index) => {
        if (inv.utility_type !== 'Electricity') {
            eligible.add(index);
            return;
        }
        const key = electricityGroupingKey(inv);
        const group = electricityGroups.get(key) || [];
        group.push(index);
        electricityGroups.set(key, group);
    });

    electricityGroups.forEach((indices) => {
        const latestByNmi = new Map<string, number>();
        const withoutNmi: number[] = [];

        indices.forEach((idx) => {
            const inv = invoices[idx];
            if (portfolioHasCAndIElectricity && classifyElectricityCustomerType(inv) === 'sme') return;
            const nmi = normalizeText(inv.nmi);
            if (!nmi) {
                withoutNmi.push(idx);
                return;
            }
            const current = latestByNmi.get(nmi);
            if (current == null) {
                latestByNmi.set(nmi, idx);
                return;
            }
            const currentDate = parseAuDateToEpoch(invoices[current].invoice_date);
            const candidateDate = parseAuDateToEpoch(inv.invoice_date);
            if (candidateDate >= currentDate) latestByNmi.set(nmi, idx);
        });

        latestByNmi.forEach((idx) => eligible.add(idx));
        withoutNmi.forEach((idx) => eligible.add(idx));
    });

    return eligible;
}

export function getSavingsEligibleOpportunities(
    invoices: ExtractedInvoice[],
    options: SavingsFilterOptions = {},
): InvoiceOpportunity[] {
    const eligibleIndexes = buildSavingsEligibleInvoiceIndexSet(invoices);
    const hideWaste = options.hideWasteForMemberReport ?? false;
    const opportunities: InvoiceOpportunity[] = [];

    invoices.forEach((inv, idx) => {
        if (!eligibleIndexes.has(idx)) return;
        if (hideWaste && inv.utility_type === 'Waste') return;
        (inv.low_hanging_fruit || []).forEach((opp) => {
            const savings = parseSavingsNumber(opp.potential_savings);
            if (savings === null) return;
            opportunities.push({
                type: opp.type,
                issue: opp.message,
                savings,
                severity: opp.severity,
                utilityType: inv.utility_type,
                invoiceIndex: idx,
            });
        });
    });

    return opportunities;
}

/**
 * Calculate savings summary from invoices
 */
export function calculateSavingsSummary(
    invoices: ExtractedInvoice[],
    options: SavingsFilterOptions = { hideWasteForMemberReport: true },
): SavingsSummary {
    let totalSavings = 0;
    const criticalIssues: Array<{ issue: string; savings: number; severity: 'high' | 'medium' | 'low' }> = [];

    getSavingsEligibleOpportunities(invoices, options).forEach((opp) => {
        totalSavings += opp.savings;
        if (opp.severity === 'high') {
            criticalIssues.push({
                issue: opp.issue,
                savings: opp.savings,
                severity: opp.severity,
            });
        }
    });

    return {
        conservative: totalSavings * 0.8,
        moderate: totalSavings,
        optimistic: totalSavings,
        criticalIssues,
    };
}

