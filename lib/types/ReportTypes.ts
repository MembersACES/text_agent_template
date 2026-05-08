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

interface SavingsFilterOptions {
    hideWasteForMemberReport?: boolean;
}

interface InvoiceOpportunity {
    type: string;
    issue: string;
    savings: number;
    severity: 'high' | 'medium' | 'low';
    utilityType: ExtractedInvoice['utility_type'];
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

function parseSavingsNumber(value: string | null | undefined): number | null {
    if (!value) return null;
    const match = value.match(/[\d,]+\.?\d*/);
    if (!match) return null;
    const parsed = Number.parseFloat(match[0].replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
}

function classifyElectricityCustomerType(inv: ExtractedInvoice): 'c_and_i' | 'sme' {
    const tariff = normalizeText(inv.tariff_type);
    if (/c\s*&\s*i|commercial.*industrial|large\s*business/.test(tariff)) {
        return 'c_and_i';
    }
    const demandCharges = inv.demand_charges ?? null;
    if (demandCharges !== null && Number.isFinite(demandCharges) && demandCharges > 0) {
        return 'c_and_i';
    }
    const demandKw = inv.demand_kw ?? null;
    if (demandKw !== null && Number.isFinite(demandKw) && demandKw >= 100) {
        return 'c_and_i';
    }
    const usage = inv.total_usage_kwh ?? null;
    const days = inv.billing_days ?? null;
    if (
        usage !== null &&
        days !== null &&
        Number.isFinite(usage) &&
        Number.isFinite(days) &&
        days > 0
    ) {
        const annualUsage = (usage / days) * 365;
        if (annualUsage >= 160_000) return 'c_and_i';
    }
    return 'sme';
}

function electricityGroupingKey(inv: ExtractedInvoice): string {
    const nmi = normalizeText(inv.nmi);
    if (nmi) return `nmi:${nmi}`;
    const site = normalizeText(inv.site_address);
    if (site) return `site:${site}`;
    return `fallback:${normalizeText(inv.business_name)}|${normalizeText(inv.account_number)}`;
}

function buildSavingsEligibleInvoiceIndexSet(invoices: ExtractedInvoice[]): Set<number> {
    const eligible = new Set<number>();
    const electricityGroups = new Map<string, number[]>();

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
        const hasCAndI = indices.some((idx) => classifyElectricityCustomerType(invoices[idx]) === 'c_and_i');
        const mixedGroup = hasCAndI && indices.some((idx) => classifyElectricityCustomerType(invoices[idx]) === 'sme');

        const latestByNmi = new Map<string, number>();
        const withoutNmi: number[] = [];

        indices.forEach((idx) => {
            const inv = invoices[idx];
            if (mixedGroup && classifyElectricityCustomerType(inv) === 'sme') return;
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
        conservative: totalSavings * 0.7,
        moderate: totalSavings * 0.85,
        optimistic: totalSavings,
        criticalIssues,
    };
}

