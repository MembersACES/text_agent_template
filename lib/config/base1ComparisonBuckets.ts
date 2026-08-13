/**
 * Base 1 deterministic comparison buckets — single source of truth for benchmark figures.
 * Gas tier minGj/maxGj are ANNUAL GJ/year (annualised usage), not period GJ on the invoice.
 */

export interface Base1ComparisonBuckets {
    version: number;
    updatedAt: string;
    updatedBy?: string;

    thresholds: {
        minAnnualSavingsAud: number;
        highSeverityMinSavingsAud: number;
        highSeverityRateGapCPerKwh: number;
    };

    gas: {
        minAnnualUsageGj: number;
        bundledEnergyMultiplier: number;
        tiers: Array<{ minGj: number; maxGj: number | null; benchmarkPerGj: number }>;
    };

    electricity: {
        retailTou: {
            nsw: { peakCPerKwh: number; shoulderCPerKwh: number; offPeakCPerKwh: number };
            other: {
                peakCPerKwh: number;
                offPeakCPerKwh: number;
                shoulderDefaultCPerKwh: number;
                shoulderWhenSameAsOffPeakCPerKwh: number;
                shoulderSameAsOffPeakTolerance: number;
            };
        };
        metering: {
            noFindingMaxAnnual: number;
            midTierMaxAnnual: number;
            midTierComparisonAnnual: number;
            highTierComparisonAnnual: number;
            highSeverityMinAnnual: number;
        };
        demand: {
            minRelativeOverstatement: number;
        };
    };
}

export const FORMULAS_VERIFIED_AT = '2026-06-09T00:00:00.000Z';

export const DEFAULT_BASE1_COMPARISON_BUCKETS: Base1ComparisonBuckets = {
    version: 1,
    updatedAt: FORMULAS_VERIFIED_AT,
    thresholds: {
        minAnnualSavingsAud: 200,
        highSeverityMinSavingsAud: 2000,
        highSeverityRateGapCPerKwh: 5,
    },
    gas: {
        minAnnualUsageGj: 1000,
        bundledEnergyMultiplier: 0.75,
        tiers: [
            { minGj: 1000, maxGj: 10000, benchmarkPerGj: 17.1 },
            { minGj: 10000, maxGj: 30000, benchmarkPerGj: 15.0 },
            { minGj: 30000, maxGj: null, benchmarkPerGj: 13.9 },
        ],
    },
    electricity: {
        retailTou: {
            nsw: { peakCPerKwh: 10, shoulderCPerKwh: 10, offPeakCPerKwh: 12 },
            other: {
                peakCPerKwh: 9,
                offPeakCPerKwh: 7,
                shoulderDefaultCPerKwh: 9,
                shoulderWhenSameAsOffPeakCPerKwh: 7,
                shoulderSameAsOffPeakTolerance: 0.01,
            },
        },
        metering: {
            noFindingMaxAnnual: 700,
            midTierMaxAnnual: 1200,
            midTierComparisonAnnual: 700,
            highTierComparisonAnnual: 900,
            highSeverityMinAnnual: 1200,
        },
        demand: {
            minRelativeOverstatement: 0.02,
        },
    },
};

export function gasBenchmarkPerGj(annualUsageGj: number, buckets: Base1ComparisonBuckets): number {
    const tiers = buckets.gas.tiers;
    for (let i = tiers.length - 1; i >= 0; i--) {
        if (annualUsageGj >= tiers[i].minGj) {
            return tiers[i].benchmarkPerGj;
        }
    }
    return tiers[0]?.benchmarkPerGj ?? 17.1;
}

export interface BucketValidationError {
    path: string;
    message: string;
}

export function validateBase1ComparisonBuckets(
    data: unknown,
): { success: true; data: Base1ComparisonBuckets } | { success: false; errors: BucketValidationError[] } {
    const errors: BucketValidationError[] = [];

    if (!data || typeof data !== 'object') {
        return { success: false, errors: [{ path: '', message: 'Buckets must be an object' }] };
    }

    const b = data as Record<string, unknown>;

    const num = (path: string, v: unknown, min?: number, max?: number) => {
        if (typeof v !== 'number' || !Number.isFinite(v)) {
            errors.push({ path, message: 'Must be a finite number' });
            return;
        }
        if (min !== undefined && v < min) errors.push({ path, message: `Must be >= ${min}` });
        if (max !== undefined && v > max) errors.push({ path, message: `Must be <= ${max}` });
    };

    num('version', b.version, 1);
    if (typeof b.updatedAt !== 'string' || !b.updatedAt) {
        errors.push({ path: 'updatedAt', message: 'Required ISO date string' });
    }

    const th = b.thresholds as Record<string, unknown> | undefined;
    if (!th) {
        errors.push({ path: 'thresholds', message: 'Required' });
    } else {
        num('thresholds.minAnnualSavingsAud', th.minAnnualSavingsAud, 0);
        num('thresholds.highSeverityMinSavingsAud', th.highSeverityMinSavingsAud, 0);
        num('thresholds.highSeverityRateGapCPerKwh', th.highSeverityRateGapCPerKwh, 0);
    }

    const gas = b.gas as Record<string, unknown> | undefined;
    if (!gas) {
        errors.push({ path: 'gas', message: 'Required' });
    } else {
        num('gas.minAnnualUsageGj', gas.minAnnualUsageGj, 0);
        num('gas.bundledEnergyMultiplier', gas.bundledEnergyMultiplier, 0, 1);
        const tiers = gas.tiers;
        if (!Array.isArray(tiers) || tiers.length === 0) {
            errors.push({ path: 'gas.tiers', message: 'At least one tier required' });
        } else {
            tiers.forEach((tier, i) => {
                const t = tier as Record<string, unknown>;
                num(`gas.tiers[${i}].minGj`, t.minGj, 0);
                num(`gas.tiers[${i}].benchmarkPerGj`, t.benchmarkPerGj, 0);
                if (t.maxGj !== null && typeof t.maxGj !== 'number') {
                    errors.push({ path: `gas.tiers[${i}].maxGj`, message: 'Must be number or null' });
                }
            });
            for (let i = 0; i < tiers.length - 1; i++) {
                const cur = tiers[i] as { maxGj: number | null; minGj: number };
                const next = tiers[i + 1] as { minGj: number };
                if (cur.maxGj !== next.minGj) {
                    errors.push({
                        path: `gas.tiers[${i}]`,
                        message: `Tier maxGj (${cur.maxGj}) must equal next tier minGj (${next.minGj})`,
                    });
                }
            }
            const last = tiers[tiers.length - 1] as { maxGj: number | null };
            if (last.maxGj !== null) {
                errors.push({ path: 'gas.tiers[last].maxGj', message: 'Last tier maxGj must be null' });
            }
        }
    }

    const elec = b.electricity as Record<string, unknown> | undefined;
    if (!elec) {
        errors.push({ path: 'electricity', message: 'Required' });
    } else {
        const nsw = (elec.retailTou as Record<string, unknown>)?.nsw as Record<string, number> | undefined;
        const other = (elec.retailTou as Record<string, unknown>)?.other as Record<string, number> | undefined;
        if (nsw) {
            num('electricity.retailTou.nsw.peakCPerKwh', nsw.peakCPerKwh, 0);
            num('electricity.retailTou.nsw.shoulderCPerKwh', nsw.shoulderCPerKwh, 0);
            num('electricity.retailTou.nsw.offPeakCPerKwh', nsw.offPeakCPerKwh, 0);
        }
        if (other) {
            num('electricity.retailTou.other.peakCPerKwh', other.peakCPerKwh, 0);
            num('electricity.retailTou.other.offPeakCPerKwh', other.offPeakCPerKwh, 0);
            num('electricity.retailTou.other.shoulderDefaultCPerKwh', other.shoulderDefaultCPerKwh, 0);
            num('electricity.retailTou.other.shoulderWhenSameAsOffPeakCPerKwh', other.shoulderWhenSameAsOffPeakCPerKwh, 0);
            num('electricity.retailTou.other.shoulderSameAsOffPeakTolerance', other.shoulderSameAsOffPeakTolerance, 0);
        }
        const metering = elec.metering as Record<string, unknown> | undefined;
        if (metering) {
            num('electricity.metering.noFindingMaxAnnual', metering.noFindingMaxAnnual, 0);
            num('electricity.metering.midTierMaxAnnual', metering.midTierMaxAnnual, 0);
            num('electricity.metering.midTierComparisonAnnual', metering.midTierComparisonAnnual, 0);
            num('electricity.metering.highTierComparisonAnnual', metering.highTierComparisonAnnual, 0);
            num('electricity.metering.highSeverityMinAnnual', metering.highSeverityMinAnnual, 0);
        }
        const demand = elec.demand as Record<string, unknown> | undefined;
        if (demand) {
            num('electricity.demand.minRelativeOverstatement', demand.minRelativeOverstatement, 0);
        }
    }

    if (errors.length > 0) return { success: false, errors };
    return { success: true, data: b as unknown as Base1ComparisonBuckets };
}

export function buildBucketInjectionSummary(buckets: Base1ComparisonBuckets): string {
    const { nsw } = buckets.electricity.retailTou;
    const { other } = buckets.electricity.retailTou;
    const gasTiers = buckets.gas.tiers
        .map((t) => `[${t.minGj}, ${t.maxGj ?? '∞'}) → ${t.benchmarkPerGj} $/GJ (annual GJ)`)
        .join('; ');
    return `BASE 1 COMPARISON ENGINE (authoritative — server-side only; extract fields accurately; always low_hanging_fruit [] for Electricity/Gas):
- Retail TOU savings are computed server-side from extracted energy-only c/kWh. NSW: peak ${nsw.peakCPerKwh}, shoulder ${nsw.shoulderCPerKwh}, off-peak ${nsw.offPeakCPerKwh} c/kWh. Other states: peak ${other.peakCPerKwh}, off-peak ${other.offPeakCPerKwh} c/kWh; shoulder uses off-peak comparison when billed same as off-peak (±${other.shoulderSameAsOffPeakTolerance}), else ${other.shoulderDefaultCPerKwh}.
- Metering tiers: annual ≤${buckets.electricity.metering.noFindingMaxAnnual} no flag; (${buckets.electricity.metering.noFindingMaxAnnual}, ${buckets.electricity.metering.midTierMaxAnnual}] vs $${buckets.electricity.metering.midTierComparisonAnnual}/yr; >${buckets.electricity.metering.midTierMaxAnnual} vs $${buckets.electricity.metering.highTierComparisonAnnual}/yr.
- Gas: min annual ${buckets.gas.minAnnualUsageGj} GJ; tiers ${gasTiers}; prefer gas_rate_per_gj / usage charges / ex-supply rate; bundled all-in ×${buckets.gas.bundledEnergyMultiplier} only when no energy-only rate exists.
- Emission gate: savings ≥ $${buckets.thresholds.minAnnualSavingsAud}/yr. Do not restate these figures as your own calculations — defer to the engine output.`;
}
