import type { CrossCheckFindingRow } from '@/lib/types/SavingsCrossCheckTypes';

export interface FindingSheetRow {
    findingId: string;
    type: string;
    utility: string;
    invoiceNumber: string;
    accountId: string;
    formula: string;
    current: number | string;
    currentUnit: string;
    comparison: string;
    comparisonValue: number | string;
    comparisonUnit: string;
    gap: number | string;
    gapUnit: string;
    periodUsage: string;
    annualUsage: string;
    annualSaving: number | string;
    severity: string;
    inTotal: string;
    inCritical: string;
    relatedCharges: string;
}

/** Narrow cross-check input/step values to sheet-safe scalars (excludes boolean). */
function asSheetValue(value: unknown): number | string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean') return '';
    if (typeof value === 'number' || typeof value === 'string') return value;
    return String(value);
}

function fmtQty(value: unknown, unit?: string | null): string {
    const scalar = asSheetValue(value);
    if (scalar === '') return '';
    const label = unit ? ` ${unit}` : '';
    return `${scalar}${label}`;
}

function fmtPct(ratio: number | null | undefined): string {
    if (ratio == null || !Number.isFinite(ratio)) return '';
    return `${(ratio * 100).toFixed(2)}%`;
}

/** Map a cross-check finding to staff-facing sheet columns (current vs bucket comparison). */
export function formatFindingForSheet(f: CrossCheckFindingRow): FindingSheetRow {
    const comp = f.comparisonsUsed.map((c) => `${c.bucketKey}=${c.value} ${c.unit}`).join('; ');
    const compFirst = f.comparisonsUsed[0];
    const base = {
        findingId: f.findingId,
        type: f.type,
        utility: f.utility ?? '',
        invoiceNumber: f.invoiceRef.invoice_number ?? '',
        accountId: f.invoiceRef.nmi ?? f.invoiceRef.mrin ?? '',
        formula: f.formula,
        annualSaving: f.steps.annualSaving ?? '',
        severity: f.severity ?? '',
        inTotal: f.includedInTotal ? 'Y' : 'N',
        inCritical: f.includedInCriticalIssues ? 'Y' : 'N',
        relatedCharges: f.clientSheetRelatedCharges ?? '',
    };

    if (f.type.includes('Retail') && f.steps.currentRate != null) {
        return {
            ...base,
            current: f.steps.currentRate,
            currentUnit: f.steps.gapUnit ?? 'c/kWh',
            comparison: comp,
            comparisonValue: f.steps.comparisonRate ?? compFirst?.value ?? '',
            comparisonUnit: compFirst?.unit ?? 'c/kWh',
            gap: f.steps.gap ?? '',
            gapUnit: f.steps.gapUnit ?? 'c/kWh',
            periodUsage: fmtQty(f.steps.periodValue, f.steps.periodUnit),
            annualUsage: fmtQty(f.steps.annualizedValue, f.steps.annualUnit),
        };
    }

    if (f.type === 'Metering charges above Base 1 comparison') {
        const annualMeterRaw = f.steps.annualizedValue ?? f.inputs.annual_meter;
        const annualMeter = asSheetValue(annualMeterRaw);
        const comparison = f.steps.comparisonRate ?? compFirst?.value;
        return {
            ...base,
            current: annualMeter,
            currentUnit: '$/year',
            comparison: comp,
            comparisonValue: comparison ?? '',
            comparisonUnit: compFirst?.unit ?? '$/year',
            gap:
                typeof annualMeter === 'number' && typeof comparison === 'number'
                    ? annualMeter - comparison
                    : f.steps.annualSaving ?? '',
            gapUnit: '$/year',
            periodUsage: fmtQty(f.inputs.meter_charges, '$ (period)'),
            annualUsage: fmtQty(annualMeterRaw, '$/year'),
        };
    }

    if (f.type === 'Gas energy rate above Base 1 comparison') {
        const currentRaw =
            f.steps.currentRate ??
            f.inputs.retail_rate_per_gj ??
            f.inputs.energy_charge_per_gj;
        const current = asSheetValue(currentRaw);
        const comparisonValue = f.steps.comparisonRate ?? compFirst?.value ?? '';
        const gap =
            f.steps.gap ??
            (typeof current === 'number' && typeof comparisonValue === 'number'
                ? current - comparisonValue
                : '');
        return {
            ...base,
            current,
            currentUnit: '$/GJ',
            comparison: comp,
            comparisonValue,
            comparisonUnit: compFirst?.unit ?? '$/GJ',
            gap,
            gapUnit: f.steps.gapUnit ?? '$/GJ',
            periodUsage: fmtQty(f.inputs.total_usage_gj, 'GJ'),
            annualUsage: fmtQty(f.steps.annualizedValue, f.steps.annualUnit ?? 'GJ/year'),
        };
    }

    if (f.type === 'Demand charge vs recorded maximum demand') {
        const relativeOverstatement =
            typeof f.inputs.relative_overstatement === 'number'
                ? f.inputs.relative_overstatement
                : null;
        return {
            ...base,
            current: asSheetValue(f.inputs.demand_kw),
            currentUnit: 'kW (billed)',
            comparison: comp,
            comparisonValue: asSheetValue(f.inputs.recorded_max_demand_kw),
            comparisonUnit: 'kW (recorded max)',
            gap: fmtPct(relativeOverstatement),
            gapUnit: 'overstatement vs billed',
            periodUsage: fmtQty(f.inputs.demand_charges, '$ (period)'),
            annualUsage: fmtQty(f.steps.annualSaving, '$/year'),
        };
    }

    return {
        ...base,
        current: f.steps.currentRate ?? '',
        currentUnit: f.steps.gapUnit ?? '',
        comparison: comp,
        comparisonValue: f.steps.comparisonRate ?? compFirst?.value ?? '',
        comparisonUnit: compFirst?.unit ?? '',
        gap: f.steps.gap ?? '',
        gapUnit: f.steps.gapUnit ?? '',
        periodUsage: fmtQty(f.steps.periodValue, f.steps.periodUnit),
        annualUsage: fmtQty(f.steps.annualizedValue, f.steps.annualUnit),
    };
}
