import {
    Base1ComparisonBuckets,
    DEFAULT_BASE1_COMPARISON_BUCKETS,
    GAS_NEAR_CI_FINDING_TYPE,
    gasBenchmarkPerGj,
    isGasNearCiUsage,
    normalizeBase1ComparisonBuckets,
} from '@/lib/config/base1ComparisonBuckets';
import { getLogger } from '@/lib/config/logger';
import { base1RelatedChargesLabel } from '@/lib/utils/base1AnalysisLabels';
import { SavingsCrossCheckRecorder } from '@/lib/services/report/SavingsCrossCheckRecorder';
import { ExtractedInvoice } from '@/lib/types/ReportTypes';
import { buildSavingsEligibleInvoiceIndexSet } from '@/lib/types/ReportTypes';

const logger = getLogger('DeterministicSavingsService');

type Severity = 'high' | 'medium';

export interface ApplyDeterministicOptions {
    buckets?: Base1ComparisonBuckets;
    recorder?: SavingsCrossCheckRecorder;
    /** Invoice index in batch for cross-check refs */
    invoiceIndex?: number;
    eligibleForRollUp?: boolean;
}

export interface DeterministicPipelineResult {
    invoices: ExtractedInvoice[];
    recorder: SavingsCrossCheckRecorder;
}

export class DeterministicSavingsService {
    private readonly buckets: Base1ComparisonBuckets;

    constructor(buckets: Base1ComparisonBuckets = DEFAULT_BASE1_COMPARISON_BUCKETS) {
        this.buckets = normalizeBase1ComparisonBuckets(buckets);
    }

    applyDeterministicFindings(
        invoices: ExtractedInvoice[],
        options?: ApplyDeterministicOptions,
    ): ExtractedInvoice[] {
        return this.runPipeline(invoices, options).invoices;
    }

    runPipeline(
        invoices: ExtractedInvoice[],
        options?: ApplyDeterministicOptions,
    ): DeterministicPipelineResult {
        const buckets = normalizeBase1ComparisonBuckets(options?.buckets ?? this.buckets);
        const recorder = options?.recorder ?? new SavingsCrossCheckRecorder();
        const eligible = buildSavingsEligibleInvoiceIndexSet(invoices);

        const processed = invoices.map((invoice, invoiceIndex) =>
            this.applyOne(invoice, {
                buckets,
                recorder,
                invoiceIndex,
                eligibleForRollUp: eligible.has(invoiceIndex),
            }),
        );

        return { invoices: processed, recorder };
    }

    private applyOne(
        invoice: ExtractedInvoice,
        ctx: {
            buckets: Base1ComparisonBuckets;
            recorder: SavingsCrossCheckRecorder;
            invoiceIndex: number;
            eligibleForRollUp: boolean;
        },
    ): ExtractedInvoice {
        if (this.isGasInvoice(invoice)) {
            return this.applyGas(invoice, ctx);
        }
        if (!this.isElectricityInvoice(invoice)) {
            return invoice;
        }

        const { buckets, recorder, invoiceIndex, eligibleForRollUp } = ctx;
        const billingDays = this.positive(invoice.billing_days);
        const isThreePeriod = this.hasThreePeriodTou(invoice);
        const state = this.inferRetailState(invoice.site_address);
        const ref = recorder.invoiceRef(invoice, invoiceIndex, state, eligibleForRollUp);
        const findings: NonNullable<ExtractedInvoice['low_hanging_fruit']> = [];

        const skipRetailTou = this.isFlatOrSingleRateElectricity(invoice);
        if (skipRetailTou) {
            recorder.recordSkipped({
                type: 'Retail TOU',
                utility: 'Electricity',
                invoiceRef: ref,
                reason: 'Flat/single-rate tariff — TOU retail comparisons skipped',
                inputs: { tariff_type: invoice.tariff_type ?? null },
            });
        } else if (state === null) {
            recorder.recordSkipped({
                type: 'Retail TOU',
                utility: 'Electricity',
                invoiceRef: ref,
                reason: 'State unknown from site_address — TOU retail skipped',
                inputs: { site_address: invoice.site_address ?? null },
            });
        } else {
            this.addRetailTouFindings(findings, invoice, state, isThreePeriod, billingDays, buckets, recorder, ref);
        }

        const annualMeter = this.annualize(invoice.meter_charges, billingDays);
        if (annualMeter !== null) {
            this.maybeAddMeteringTierFinding(findings, annualMeter, invoice, buckets, recorder, ref);
        }

        this.maybeAddDemandRepricingFinding(findings, invoice, billingDays, buckets, recorder, ref);

        logger.info(
            `Deterministic findings for invoice ${invoice.invoice_number ?? 'unknown'}: ${findings.length}` +
                (skipRetailTou ? ' (retail TOU skipped: flat/single-rate)' : ''),
        );

        return { ...invoice, low_hanging_fruit: findings };
    }

    private applyGas(
        invoice: ExtractedInvoice,
        ctx: {
            buckets: Base1ComparisonBuckets;
            recorder: SavingsCrossCheckRecorder;
            invoiceIndex: number;
            eligibleForRollUp: boolean;
        },
    ): ExtractedInvoice {
        const { buckets, recorder } = ctx;
        const ref = recorder.invoiceRef(invoice, ctx.invoiceIndex, null, ctx.eligibleForRollUp);
        const billingDays = this.positive(invoice.billing_days);
        const usageGjPeriod = this.positive(invoice.total_usage_gj);
        const annualUsageGj = this.annualize(usageGjPeriod, billingDays);
        const minGate = buckets.gas.minAnnualUsageGj;

        if (annualUsageGj === null || annualUsageGj < minGate) {
            recorder.recordSkipped({
                type: 'Gas energy rate',
                utility: 'Gas',
                invoiceRef: ref,
                reason: `Annualised usage below ${minGate} GJ/year gate`,
                inputs: {
                    total_usage_gj: usageGjPeriod,
                    billing_days: billingDays,
                    annual_usage_gj: annualUsageGj,
                },
                formula: 'annual_usage_gj = (period_gj / billing_days) × 365',
            });
            return { ...invoice, low_hanging_fruit: [] };
        }

        const bundledGas = this.isGasBundledInvoice(invoice);
        const invoiceIncGst = this.positive(invoice.total_inc_gst);
        const gst = this.positive(invoice.gst_amount);
        const invoiceExGst =
            this.positive(invoice.total_charges_ex_gst) ??
            (invoiceIncGst !== null && gst !== null ? invoiceIncGst - gst : null);
        const benchmark = gasBenchmarkPerGj(annualUsageGj, buckets);
        const benchmarkKey = `gas.tiers (annual GJ ${annualUsageGj.toFixed(2)})`;
        const inputs: Record<string, number | string | boolean | null> = {
            annual_usage_gj: annualUsageGj,
            total_usage_gj: usageGjPeriod,
            billing_days: billingDays,
            bundled: bundledGas,
            tariff_type: invoice.tariff_type ?? null,
            invoice_ex_gst: invoiceExGst,
        };

        const resolved = this.resolveGasEffectiveRatePerGj({
            invoice,
            invoiceExGst,
            usageGjPeriod,
            bundledGas,
            bundledMultiplier: buckets.gas.bundledEnergyMultiplier,
        });

        if (resolved === null) {
            recorder.recordSkipped({
                type: bundledGas ? 'Gas energy rate (bundled)' : 'Gas energy rate (unbundled)',
                utility: 'Gas',
                invoiceRef: ref,
                reason: bundledGas
                    ? 'Missing energy $/GJ (gas_rate / usage charges / invoice ex-GST) or period GJ'
                    : 'Missing retail $/GJ',
                inputs,
            });
            return { ...invoice, low_hanging_fruit: [] };
        }

        const { rate: effectiveRatePerGj, source, formula, messagePrefix, extras } = resolved;
        Object.assign(inputs, extras);
        inputs.rate_source = source;
        inputs.energy_rate_per_gj = effectiveRatePerGj;

        const nearCi = isGasNearCiUsage(annualUsageGj, buckets);
        inputs.near_ci = nearCi;
        const findingType = nearCi
            ? GAS_NEAR_CI_FINDING_TYPE
            : 'Gas energy rate above Base 1 comparison';

        const annualSavings = annualUsageGj * (effectiveRatePerGj - benchmark);
        let message =
            source === 'bundled_all_in_x_mult'
                ? `Calculated bundled gas energy charge ${effectiveRatePerGj.toFixed(2)} $/GJ exceeds Base 1 comparison of ${benchmark.toFixed(2)} $/GJ ` +
                  `(all-in ${Number(extras.bundled_rate_per_gj).toFixed(2)} $/GJ × ${buckets.gas.bundledEnergyMultiplier * 100}%).`
                : `${messagePrefix} ${effectiveRatePerGj.toFixed(2)} $/GJ exceeds Base 1 comparison of ${benchmark.toFixed(2)} $/GJ.`;
        if (nearCi) {
            const near = buckets.gas.nearCi;
            message +=
                ` Potential: annualised usage ${annualUsageGj.toFixed(0)} GJ is in the ${near.minGj}–${near.maxGj - 1} GJ near-C&I band ` +
                `(70% of the ${near.maxGj} GJ C&I threshold); compared at the ${near.maxGj} GJ rate.`;
        }

        const savingsFormula = `${formula}; annual_saving = annual_gj × (energy_rate - benchmark)`;
        const minSavings = buckets.thresholds.minAnnualSavingsAud;
        if (annualSavings < minSavings) {
            recorder.recordSkipped({
                type: findingType,
                utility: 'Gas',
                invoiceRef: ref,
                reason: `Annual saving $${annualSavings.toFixed(2)} below $${minSavings} gate`,
                inputs,
                formula: savingsFormula,
                computedAnnualSaving: annualSavings,
            });
            return { ...invoice, low_hanging_fruit: [] };
        }

        const highTh = buckets.thresholds.highSeverityMinSavingsAud;
        const severity: Severity = annualSavings >= highTh ? 'high' : 'medium';

        recorder.recordEmitted({
            type: findingType,
            utility: 'Gas',
            invoiceRef: ref,
            inputs,
            comparisonsUsed: [{ bucketKey: benchmarkKey, value: benchmark, unit: '$/GJ' }],
            formula: savingsFormula,
            steps: {
                currentRate: effectiveRatePerGj,
                comparisonRate: benchmark,
                gap: effectiveRatePerGj - benchmark,
                gapUnit: '$/GJ',
                periodValue: usageGjPeriod,
                periodUnit: 'GJ',
                annualSaving: annualSavings,
                annualizationFormula: '(period_gj / billing_days) × 365',
                annualizedValue: annualUsageGj,
                annualUnit: 'GJ/year',
            },
            minAnnualSavingsGate: minSavings,
            passedMinSavingsGate: true,
            severity,
            severityRule: `high if annual_saving >= $${highTh}`,
            clientSheetRelatedCharges: base1RelatedChargesLabel(findingType, 'Gas'),
        });

        const findings: NonNullable<ExtractedInvoice['low_hanging_fruit']> = [
            {
                type: findingType,
                severity,
                message,
                potential_savings: this.moneyPerYear(annualSavings),
            },
        ];

        return { ...invoice, low_hanging_fruit: findings };
    }

    /**
     * Prefer an explicit/derived energy-only $/GJ over the bundled all-in ×75% haircut.
     * ×75% applies only when the bill is bundled and we only have an all-in invoice total.
     */
    private resolveGasEffectiveRatePerGj(params: {
        invoice: ExtractedInvoice;
        invoiceExGst: number | null;
        usageGjPeriod: number | null;
        bundledGas: boolean;
        bundledMultiplier: number;
    }): {
        rate: number;
        source: string;
        formula: string;
        messagePrefix: string;
        extras: Record<string, number | string | boolean | null>;
    } | null {
        const { invoice, invoiceExGst, usageGjPeriod, bundledGas, bundledMultiplier } = params;
        const extras: Record<string, number | string | boolean | null> = {};

        const explicit = this.positive(invoice.gas_rate_per_gj);
        if (explicit !== null) {
            extras.gas_rate_per_gj = explicit;
            return {
                rate: explicit,
                source: 'gas_rate_per_gj',
                formula: 'energy_rate = gas_rate_per_gj',
                messagePrefix: bundledGas
                    ? 'Bundled gas energy rate'
                    : 'Unbundled gas retail rate',
                extras,
            };
        }

        const usageCharges = this.positive(invoice.usage_charges_ex_gst);
        if (usageCharges !== null && usageGjPeriod !== null && usageGjPeriod > 0) {
            const rate = usageCharges / usageGjPeriod;
            extras.usage_charges_ex_gst = usageCharges;
            extras.derived_rate_per_gj = rate;
            return {
                rate,
                source: 'usage_charges_ex_gst',
                formula: 'energy_rate = usage_charges_ex_gst / period_gj',
                messagePrefix: 'Gas usage charge rate',
                extras,
            };
        }

        const supply = this.positive(invoice.supply_charges_ex_gst);
        if (
            invoiceExGst !== null &&
            supply !== null &&
            usageGjPeriod !== null &&
            usageGjPeriod > 0
        ) {
            const energyPortion = invoiceExGst - supply;
            if (energyPortion > 0) {
                const rate = energyPortion / usageGjPeriod;
                extras.supply_charges_ex_gst = supply;
                extras.energy_portion_ex_gst = energyPortion;
                extras.derived_rate_per_gj = rate;
                return {
                    rate,
                    source: 'invoice_ex_gst_minus_supply',
                    formula: 'energy_rate = (invoice_ex_gst - supply_charges_ex_gst) / period_gj',
                    messagePrefix: 'Gas energy rate (ex-supply)',
                    extras,
                };
            }
        }

        if (invoiceExGst === null || usageGjPeriod === null || usageGjPeriod <= 0) {
            return null;
        }

        const allIn = invoiceExGst / usageGjPeriod;
        extras.bundled_rate_per_gj = allIn;

        if (bundledGas) {
            const rate = allIn * bundledMultiplier;
            extras.energy_charge_per_gj = rate;
            return {
                rate,
                source: 'bundled_all_in_x_mult',
                formula: `energy_rate = (invoice_ex_gst / period_gj) × ${bundledMultiplier}`,
                messagePrefix: 'Calculated bundled gas energy charge',
                extras,
            };
        }

        return {
            rate: allIn,
            source: 'invoice_ex_gst',
            formula: 'energy_rate = invoice_ex_gst / period_gj',
            messagePrefix: 'Unbundled gas retail rate',
            extras,
        };
    }

    private isFlatOrSingleRateElectricity(invoice: ExtractedInvoice): boolean {
        const raw = invoice.tariff_type || '';
        const t = raw.toLowerCase();
        if (/\bflat\b|single\s*rate|anytime|all[- ]?time/i.test(t)) return true;
        if (/tou|time[- ]?of[- ]?use|2[- ]?period|3[- ]?period/i.test(t)) return false;

        const p = this.positive(invoice.peak_usage_kwh);
        const tot = this.positive(invoice.total_usage_kwh);
        const sh = this.positive(invoice.shoulder_usage_kwh);
        const off = this.positive(invoice.off_peak_usage_kwh);
        const noSh = sh == null || sh === 0;
        const noOff = off == null || off === 0;
        if (!noSh || !noOff) return false;
        if (p == null || tot == null || tot <= 0) return false;
        return Math.abs(p - tot) <= Math.max(1, tot * 0.001);
    }

    private hasThreePeriodTou(invoice: ExtractedInvoice): boolean {
        const s = this.positive(invoice.shoulder_usage_kwh);
        return s != null && s > 0;
    }

    private inferRetailState(siteAddress: string | null | undefined): 'NSW' | 'OTHER' | null {
        if (siteAddress == null || typeof siteAddress !== 'string') return null;
        const u = siteAddress.toUpperCase();
        if (/\bNSW\b|\bNEW SOUTH WALES\b/.test(u)) return 'NSW';
        if (
            /\bVIC\b|\bVICTORIA\b|\bQLD\b|\bQUEENSLAND\b|\bWA\b|\bWESTERN AUSTRALIA\b|\bSA\b|\bSOUTH AUSTRALIA\b|\bTAS\b|\bTASMANIA\b|\bACT\b|\bNT\b|\bNORTHERN TERRITORY\b/.test(
                u,
            )
        ) {
            return 'OTHER';
        }
        return null;
    }

    private addRetailTouFindings(
        findings: NonNullable<ExtractedInvoice['low_hanging_fruit']>,
        invoice: ExtractedInvoice,
        state: 'NSW' | 'OTHER',
        isThreePeriod: boolean,
        billingDays: number | null,
        buckets: Base1ComparisonBuckets,
        recorder: SavingsCrossCheckRecorder,
        ref: ReturnType<SavingsCrossCheckRecorder['invoiceRef']>,
    ): void {
        const tou = buckets.electricity.retailTou;

        if (state === 'NSW') {
            this.maybeAddRetailRateFinding(
                findings,
                'Retail peak rate (NSW)',
                invoice.peak_rate_c_per_kwh,
                tou.nsw.peakCPerKwh,
                this.annualize(invoice.peak_usage_kwh, billingDays),
                invoice.peak_usage_kwh,
                buckets,
                recorder,
                ref,
                'electricity.retailTou.nsw.peakCPerKwh',
            );
            if (isThreePeriod) {
                this.maybeAddRetailRateFinding(
                    findings,
                    'Retail shoulder rate (NSW)',
                    invoice.shoulder_rate_c_per_kwh,
                    tou.nsw.shoulderCPerKwh,
                    this.annualize(invoice.shoulder_usage_kwh, billingDays),
                    invoice.shoulder_usage_kwh,
                    buckets,
                    recorder,
                    ref,
                    'electricity.retailTou.nsw.shoulderCPerKwh',
                );
            }
            this.maybeAddRetailRateFinding(
                findings,
                'Retail off-peak rate (NSW)',
                invoice.off_peak_rate_c_per_kwh,
                tou.nsw.offPeakCPerKwh,
                this.annualize(invoice.off_peak_usage_kwh, billingDays),
                invoice.off_peak_usage_kwh,
                buckets,
                recorder,
                ref,
                'electricity.retailTou.nsw.offPeakCPerKwh',
            );
            return;
        }

        const shoulderComparison = this.shoulderRetailComparisonCPerKwh(invoice, isThreePeriod, buckets);

        this.maybeAddRetailRateFinding(
            findings,
            'Retail peak rate',
            invoice.peak_rate_c_per_kwh,
            tou.other.peakCPerKwh,
            this.annualize(invoice.peak_usage_kwh, billingDays),
            invoice.peak_usage_kwh,
            buckets,
            recorder,
            ref,
            'electricity.retailTou.other.peakCPerKwh',
        );
        if (isThreePeriod && shoulderComparison !== null) {
            const shoulderKey =
                shoulderComparison === tou.other.shoulderWhenSameAsOffPeakCPerKwh
                    ? 'electricity.retailTou.other.shoulderWhenSameAsOffPeakCPerKwh'
                    : 'electricity.retailTou.other.shoulderDefaultCPerKwh';
            this.maybeAddRetailRateFinding(
                findings,
                'Retail shoulder rate',
                invoice.shoulder_rate_c_per_kwh,
                shoulderComparison,
                this.annualize(invoice.shoulder_usage_kwh, billingDays),
                invoice.shoulder_usage_kwh,
                buckets,
                recorder,
                ref,
                shoulderKey,
            );
        }
        this.maybeAddRetailRateFinding(
            findings,
            'Retail off-peak rate',
            invoice.off_peak_rate_c_per_kwh,
            tou.other.offPeakCPerKwh,
            this.annualize(invoice.off_peak_usage_kwh, billingDays),
            invoice.off_peak_usage_kwh,
            buckets,
            recorder,
            ref,
            'electricity.retailTou.other.offPeakCPerKwh',
        );
    }

    private shoulderRetailComparisonCPerKwh(
        invoice: ExtractedInvoice,
        isThreePeriod: boolean,
        buckets: Base1ComparisonBuckets,
    ): number | null {
        if (!isThreePeriod) return null;
        const other = buckets.electricity.retailTou.other;
        const sh = this.positive(invoice.shoulder_rate_c_per_kwh);
        const off = this.positive(invoice.off_peak_rate_c_per_kwh);
        if (sh !== null && off !== null && Math.abs(sh - off) < other.shoulderSameAsOffPeakTolerance) {
            return other.shoulderWhenSameAsOffPeakCPerKwh;
        }
        return other.shoulderDefaultCPerKwh;
    }

    private maybeAddRetailRateFinding(
        findings: NonNullable<ExtractedInvoice['low_hanging_fruit']>,
        type: string,
        currentRateCPerKwh: number | null,
        comparisonCPerKwh: number,
        annualUsageKwh: number | null,
        periodUsageKwh: number | null | undefined,
        buckets: Base1ComparisonBuckets,
        recorder: SavingsCrossCheckRecorder,
        ref: ReturnType<SavingsCrossCheckRecorder['invoiceRef']>,
        bucketKey: string,
    ): void {
        const rate = this.positive(currentRateCPerKwh);
        const annualUsage = this.positive(annualUsageKwh);
        const minSavings = buckets.thresholds.minAnnualSavingsAud;
        const gapTh = buckets.thresholds.highSeverityRateGapCPerKwh;
        const highSav = buckets.thresholds.highSeverityMinSavingsAud;
        const formula =
            'annual_saving = ((current_c/kWh - comparison_c/kWh) / 100) × annual_kWh; annual_kWh = (period_kWh / billing_days) × 365';

        const inputs: Record<string, number | string | null> = {
            current_rate_c_per_kwh: rate,
            period_usage_kwh: this.positive(periodUsageKwh),
            billing_days: ref.billing_days,
            annual_usage_kwh: annualUsage,
        };

        if (rate === null || annualUsage === null) {
            recorder.recordSkipped({
                type,
                utility: 'Electricity',
                invoiceRef: ref,
                reason: 'Missing rate or usage',
                inputs,
                formula,
            });
            return;
        }
        if (rate <= comparisonCPerKwh) {
            recorder.recordSkipped({
                type,
                utility: 'Electricity',
                invoiceRef: ref,
                reason: `Rate ${rate.toFixed(2)} c/kWh not above comparison ${comparisonCPerKwh} c/kWh`,
                inputs: { ...inputs, comparison_c_per_kwh: comparisonCPerKwh },
                formula,
                computedAnnualSaving: 0,
            });
            return;
        }

        const gap = rate - comparisonCPerKwh;
        const savings = (gap / 100) * annualUsage;
        if (savings < minSavings) {
            recorder.recordSkipped({
                type,
                utility: 'Electricity',
                invoiceRef: ref,
                reason: `Annual saving $${savings.toFixed(2)} below $${minSavings} gate`,
                inputs: { ...inputs, comparison_c_per_kwh: comparisonCPerKwh, gap_c_per_kwh: gap },
                formula,
                computedAnnualSaving: savings,
            });
            return;
        }

        const severity: Severity = rate >= comparisonCPerKwh + gapTh || savings >= highSav ? 'high' : 'medium';

        recorder.recordEmitted({
            type,
            utility: 'Electricity',
            invoiceRef: ref,
            inputs: { ...inputs, comparison_c_per_kwh: comparisonCPerKwh, gap_c_per_kwh: gap },
            comparisonsUsed: [{ bucketKey, value: comparisonCPerKwh, unit: 'c/kWh' }],
            formula,
            steps: {
                currentRate: rate,
                comparisonRate: comparisonCPerKwh,
                gap,
                gapUnit: 'c/kWh',
                periodValue: this.positive(periodUsageKwh),
                periodUnit: 'kWh',
                annualizedValue: annualUsage,
                annualUnit: 'kWh/year',
                annualSaving: savings,
                annualizationFormula: '(period_kWh / billing_days) × 365',
            },
            minAnnualSavingsGate: minSavings,
            passedMinSavingsGate: true,
            severity,
            severityRule: `high if rate >= comparison + ${gapTh} c/kWh OR saving >= $${highSav}`,
            clientSheetRelatedCharges: base1RelatedChargesLabel(type, 'Electricity'),
        });

        findings.push({
            type,
            severity,
            message:
                `${type.replace('Retail ', '').replace(' (NSW)', '')} at ${rate.toFixed(2)} c/kWh exceeds Base 1 retail comparison of ${comparisonCPerKwh.toFixed(2)} c/kWh.`,
            potential_savings: this.moneyPerYear(savings),
        });
    }

    private maybeAddMeteringTierFinding(
        findings: NonNullable<ExtractedInvoice['low_hanging_fruit']>,
        annualMeter: number,
        invoice: ExtractedInvoice,
        buckets: Base1ComparisonBuckets,
        recorder: SavingsCrossCheckRecorder,
        ref: ReturnType<SavingsCrossCheckRecorder['invoiceRef']>,
    ): void {
        const m = buckets.electricity.metering;
        const minSavings = buckets.thresholds.minAnnualSavingsAud;
        const highSav = buckets.thresholds.highSeverityMinSavingsAud;
        const formula = 'annual_meter = (meter_charges / billing_days) × 365; annual_saving = annual_meter - comparison';

        if (annualMeter <= m.noFindingMaxAnnual) {
            recorder.recordSkipped({
                type: 'Metering charges above Base 1 comparison',
                utility: 'Electricity',
                invoiceRef: ref,
                reason: `Annual metering $${annualMeter.toFixed(2)} <= $${m.noFindingMaxAnnual} — no finding`,
                inputs: {
                    meter_charges: invoice.meter_charges ?? null,
                    billing_days: ref.billing_days,
                    annual_meter: annualMeter,
                },
                formula,
            });
            return;
        }

        let comparison: number;
        let bucketKey: string;
        if (annualMeter <= m.midTierMaxAnnual) {
            comparison = m.midTierComparisonAnnual;
            bucketKey = 'electricity.metering.midTierComparisonAnnual';
        } else {
            comparison = m.highTierComparisonAnnual;
            bucketKey = 'electricity.metering.highTierComparisonAnnual';
        }

        const savings = annualMeter - comparison;
        if (savings < minSavings) {
            recorder.recordSkipped({
                type: 'Metering charges above Base 1 comparison',
                utility: 'Electricity',
                invoiceRef: ref,
                reason: `Annual saving $${savings.toFixed(2)} below $${minSavings} gate`,
                inputs: { annual_meter: annualMeter, comparison_annual: comparison },
                formula,
                computedAnnualSaving: savings,
            });
            return;
        }

        const severity: Severity =
            annualMeter > m.highSeverityMinAnnual || savings >= highSav ? 'high' : 'medium';

        recorder.recordEmitted({
            type: 'Metering charges above Base 1 comparison',
            utility: 'Electricity',
            invoiceRef: ref,
            inputs: {
                meter_charges: invoice.meter_charges ?? null,
                billing_days: ref.billing_days,
                annual_meter: annualMeter,
            },
            comparisonsUsed: [{ bucketKey, value: comparison, unit: '$/year' }],
            formula,
            steps: {
                currentRate: annualMeter,
                comparisonRate: comparison,
                gap: savings,
                gapUnit: '$/year',
                periodValue: this.positive(invoice.meter_charges),
                periodUnit: '$ (period)',
                annualizedValue: annualMeter,
                annualUnit: '$/year',
                annualSaving: savings,
                annualizationFormula: '(meter_charges / billing_days) × 365',
            },
            minAnnualSavingsGate: minSavings,
            passedMinSavingsGate: true,
            severity,
            severityRule: `high if annual_meter > ${m.highSeverityMinAnnual} OR saving >= $${highSav}`,
            clientSheetRelatedCharges: base1RelatedChargesLabel(
                'Metering charges above Base 1 comparison',
                'Electricity',
            ),
        });

        findings.push({
            type: 'Metering charges above Base 1 comparison',
            severity,
            message:
                `Annual metering (combined) ${this.money(annualMeter)}/year exceeds Base 1 comparison of ${this.money(comparison)}/year.`,
            potential_savings: this.moneyPerYear(savings),
        });
    }

    private maybeAddDemandRepricingFinding(
        findings: NonNullable<ExtractedInvoice['low_hanging_fruit']>,
        invoice: ExtractedInvoice,
        billingDays: number | null,
        buckets: Base1ComparisonBuckets,
        recorder: SavingsCrossCheckRecorder,
        ref: ReturnType<SavingsCrossCheckRecorder['invoiceRef']>,
    ): void {
        const minRel = buckets.electricity.demand.minRelativeOverstatement;
        const minSavings = buckets.thresholds.minAnnualSavingsAud;
        const highSav = buckets.thresholds.highSeverityMinSavingsAud;
        const formula =
            'relative = (billed - recorded) / billed; period_saving = demand_charges × (1 - recorded/billed); annual_saving = period_saving × (365/billing_days)';

        const charges = this.positive(invoice.demand_charges);
        const billed = this.positive(invoice.demand_kw);
        const recorded = this.positive(invoice.recorded_max_demand_kw);

        if (charges === null || billed === null || recorded === null) {
            recorder.recordSkipped({
                type: 'Demand charge vs recorded maximum demand',
                utility: 'Electricity',
                invoiceRef: ref,
                reason: 'Missing demand_charges, demand_kw, or recorded_max_demand_kw',
                inputs: {
                    demand_charges: charges,
                    demand_kw: billed,
                    recorded_max_demand_kw: recorded,
                },
                formula,
            });
            return;
        }
        if (billed <= 0 || recorded >= billed) {
            recorder.recordSkipped({
                type: 'Demand charge vs recorded maximum demand',
                utility: 'Electricity',
                invoiceRef: ref,
                reason: 'Recorded demand not below billed demand',
                inputs: { demand_kw: billed, recorded_max_demand_kw: recorded },
                formula,
            });
            return;
        }
        if (billingDays === null || billingDays <= 0) {
            recorder.recordSkipped({
                type: 'Demand charge vs recorded maximum demand',
                utility: 'Electricity',
                invoiceRef: ref,
                reason: 'Invalid billing_days',
                inputs: { billing_days: billingDays },
                formula,
            });
            return;
        }

        const relativeOverstatement = (billed - recorded) / billed;
        if (relativeOverstatement < minRel) {
            recorder.recordSkipped({
                type: 'Demand charge vs recorded maximum demand',
                utility: 'Electricity',
                invoiceRef: ref,
                reason: `Relative overstatement ${(relativeOverstatement * 100).toFixed(2)}% below ${minRel * 100}% minimum`,
                inputs: { relative_overstatement: relativeOverstatement, demand_kw: billed, recorded_max_demand_kw: recorded },
                formula,
            });
            return;
        }

        const periodSavings = charges * (1 - recorded / billed);
        const annualSavings = periodSavings * (365 / billingDays);
        if (annualSavings < minSavings) {
            recorder.recordSkipped({
                type: 'Demand charge vs recorded maximum demand',
                utility: 'Electricity',
                invoiceRef: ref,
                reason: `Annual saving $${annualSavings.toFixed(2)} below $${minSavings} gate`,
                inputs: {
                    demand_charges: charges,
                    period_saving: periodSavings,
                    relative_overstatement: relativeOverstatement,
                },
                formula,
                computedAnnualSaving: annualSavings,
            });
            return;
        }

        const severity: Severity = annualSavings >= highSav ? 'high' : 'medium';

        recorder.recordEmitted({
            type: 'Demand charge vs recorded maximum demand',
            utility: 'Electricity',
            invoiceRef: ref,
            inputs: {
                demand_charges: charges,
                demand_kw: billed,
                recorded_max_demand_kw: recorded,
                billing_days: billingDays,
                relative_overstatement: relativeOverstatement,
            },
            comparisonsUsed: [
                { bucketKey: 'electricity.demand.minRelativeOverstatement', value: minRel, unit: 'ratio' },
            ],
            formula,
            steps: {
                currentRate: billed,
                comparisonRate: recorded,
                periodValue: charges,
                periodUnit: '$ (period)',
                periodSaving: periodSavings,
                annualSaving: annualSavings,
                annualizationFormula: 'period_saving × (365 / billing_days)',
            },
            minAnnualSavingsGate: minSavings,
            passedMinSavingsGate: true,
            severity,
            severityRule: `high if annual_saving >= $${highSav}`,
            clientSheetRelatedCharges: base1RelatedChargesLabel(
                'Demand charge vs recorded maximum demand',
                'Electricity',
            ),
        });

        findings.push({
            type: 'Demand charge vs recorded maximum demand',
            severity,
            message:
                `Demand charges appear based on ${billed.toFixed(2)} kW/kVA while the highest demand shown on the invoice is ${recorded.toFixed(2)}. Repricing at the same effective rate reduces demand charges by approximately ${this.money(periodSavings)} for this period.`,
            potential_savings: this.moneyPerYear(annualSavings),
        });
    }

    private isElectricityInvoice(invoice: ExtractedInvoice): boolean {
        if (invoice.utility_type === 'Electricity') return true;
        if (invoice.nmi != null) return true;
        return (
            this.positive(invoice.total_usage_kwh) !== null ||
            this.positive(invoice.peak_usage_kwh) !== null ||
            this.positive(invoice.off_peak_usage_kwh) !== null
        );
    }

    private isGasInvoice(invoice: ExtractedInvoice): boolean {
        if (invoice.utility_type === 'Gas') return true;
        if (invoice.mrin != null) return true;
        return this.positive(invoice.total_usage_gj) !== null;
    }

    private isGasBundledInvoice(invoice: ExtractedInvoice): boolean {
        const t = (invoice.tariff_type || '').trim();
        return !/unbundl/i.test(t);
    }

    private positive(v: number | null | undefined): number | null {
        if (v == null || Number.isNaN(v) || !Number.isFinite(v)) return null;
        return v;
    }

    private annualize(periodValue: number | null | undefined, billingDays: number | null): number | null {
        const v = this.positive(periodValue);
        if (v === null || billingDays === null || billingDays <= 0) return null;
        return (v / billingDays) * 365;
    }

    private money(n: number): string {
        return `$${n.toFixed(2)}`;
    }

    private moneyPerYear(n: number): string {
        const formatted = n.toLocaleString('en-AU', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
        return `$${formatted}/year`;
    }
}

export function createDeterministicSavingsService(
    buckets: Base1ComparisonBuckets = DEFAULT_BASE1_COMPARISON_BUCKETS,
): DeterministicSavingsService {
    return new DeterministicSavingsService(buckets);
}

export const deterministicSavingsService = createDeterministicSavingsService();
