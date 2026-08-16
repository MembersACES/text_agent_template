import {
    GAS_NEAR_CI_OPTION_KIND,
    isGasNearCiFindingType,
} from '@/lib/config/base1ComparisonBuckets';
import {
    getSavingsEligibleOpportunities,
    type ExtractedInvoice,
    type SavingsFilterOptions,
} from '@/lib/types/ReportTypes';

export type Base1OptionKind = 'Profile Reset' | 'Discrepancy' | typeof GAS_NEAR_CI_OPTION_KIND;

/** Label shown in Base 1 Analysis — Waste uses Discrepancy; near-C&I gas uses Potential (C&I 70%). */
export function base1OptionKind(
    utilityType: ExtractedInvoice['utility_type'],
    findingType?: string,
): Base1OptionKind {
    if (utilityType === 'Gas' && findingType && isGasNearCiFindingType(findingType)) {
        return GAS_NEAR_CI_OPTION_KIND;
    }
    return utilityType === 'Waste' ? 'Discrepancy' : 'Profile Reset';
}

/** Related charges column derived from finding type + utility (Excel / Sheets Base 1 Analysis). */
export function base1RelatedChargesLabel(
    findingType: string,
    utilityType: ExtractedInvoice['utility_type'],
): string {
    const t = findingType.toLowerCase();
    if (utilityType === 'Gas') return 'Energy Charges';
    if (utilityType === 'Waste') return 'Adjustment';
    if (utilityType === 'Water') return 'Usage Charges';
    if (utilityType === 'Oil' || utilityType === 'Cleaning') return 'Service Charges';
    if (t.includes('meter')) return 'Metering Charges';
    if (t.includes('demand')) return 'Demand Charges';
    return 'Energy Charges';
}

export interface Base1BenchmarkGroupRow {
    utilityType: ExtractedInvoice['utility_type'];
    optionKind: Base1OptionKind;
    relatedCharges: string;
    /** Distinct invoices contributing at least one opportunity in this bucket */
    invoiceCount: number;
    totalSavings: number;
}

/**
 * Groups eligible savings opportunities by utility + related-charges bucket.
 * Counts distinct invoices (not raw opportunity rows) per bucket.
 */
export function getBase1BenchmarkGroups(
    invoices: ExtractedInvoice[],
    options?: SavingsFilterOptions,
): Base1BenchmarkGroupRow[] {
    type Agg = {
        utilityType: ExtractedInvoice['utility_type'];
        optionKind: Base1OptionKind;
        relatedCharges: string;
        invoiceIndexes: Set<number>;
        totalSavings: number;
    };

    const map = new Map<string, Agg>();

    getSavingsEligibleOpportunities(invoices, options).forEach((opp) => {
        const relatedCharges = base1RelatedChargesLabel(opp.type, opp.utilityType);
        const optionKind = base1OptionKind(opp.utilityType, opp.type);
        const key = `${opp.utilityType}|${optionKind}|${relatedCharges}`;
        if (!map.has(key)) {
            map.set(key, {
                utilityType: opp.utilityType,
                optionKind,
                relatedCharges,
                invoiceIndexes: new Set(),
                totalSavings: 0,
            });
        }
        const g = map.get(key)!;
        if (opp.invoiceIndex !== undefined) {
            g.invoiceIndexes.add(opp.invoiceIndex);
        }
        g.totalSavings += opp.savings;
    });

    return [...map.values()]
        .map((v) => ({
            utilityType: v.utilityType,
            optionKind: v.optionKind,
            relatedCharges: v.relatedCharges,
            invoiceCount: v.invoiceIndexes.size,
            totalSavings: v.totalSavings,
        }))
        .sort((a, b) => b.totalSavings - a.totalSavings);
}
