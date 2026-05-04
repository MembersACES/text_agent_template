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

/**
 * Calculate savings summary from invoices
 */
export function calculateSavingsSummary(invoices: ExtractedInvoice[]): SavingsSummary {
    let totalSavings = 0;
    const criticalIssues: Array<{ issue: string; savings: number; severity: 'high' | 'medium' | 'low' }> = [];

    invoices.forEach(inv => {
        if (inv.low_hanging_fruit) {
            inv.low_hanging_fruit.forEach((opp: any) => {
                if (opp.potential_savings) {
                    // Extract number from string like "$1,234.56/year"
                    const match = opp.potential_savings.match(/[\d,]+\.?\d*/);
                    if (match) {
                        const savings = parseFloat(match[0].replace(/,/g, ''));
                        totalSavings += savings;

                        if (opp.severity === 'high') {
                            criticalIssues.push({
                                issue: opp.message,
                                savings,
                                severity: opp.severity,
                            });
                        }
                    }
                }
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

