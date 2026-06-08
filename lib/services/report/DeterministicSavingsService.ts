import { getLogger } from '@/lib/config/logger';
import { ExtractedInvoice } from '@/lib/types/ReportTypes';

const logger = getLogger('DeterministicSavingsService');

type Severity = 'high' | 'medium';

/** Billed demand must exceed recorded by at least this fraction to flag repricing. */
const DEMAND_REPRICE_MIN_RELATIVE_OVER = 0.02;

/**
 * Deterministic benchmarking/savings calculator.
 * Replaces model-authored low_hanging_fruit to keep repeated runs stable.
 *
 * Retail TOU (NSW 10/10/12, other states 9/9/7): applies to **TOU c/kWh** for bundled and **unbundled**
 * (use per-period **energy-only** extracted rates — never blended energy+network). Skipped only for
 * **flat / single-rate** tariffs.
 *
 * Daily supply checks are disabled for Base 1 savings.
 *
 * Metering: annual ≤700 no flag; (700,1200] vs $700; >1200 vs $900.
 *
 * Demand repricing: only when recorded max is materially below billed (≥2% gap) and annual savings >$200.
 *
 * **Gas:** bundled vs unbundled (from `tariff_type`) selects the formula.
 * Base 1 gas comparison is tiered by annualised usage:
 * - [1000, 10000): **17.1 $/GJ**
 * - [10000, 30000): **15.0 $/GJ**
 * - [30000, +inf): **13.9 $/GJ**
 *
 * Bundled compares (invoice ex-GST / period GJ) × 75% vs the tiered benchmark.
 * Unbundled compares commodity **$/GJ** directly vs the tiered benchmark.
 */
export class DeterministicSavingsService {
    applyDeterministicFindings(invoices: ExtractedInvoice[]): ExtractedInvoice[] {
        return invoices.map((invoice) => this.applyOne(invoice));
    }

    private applyOne(invoice: ExtractedInvoice): ExtractedInvoice {
        if (this.isGasInvoice(invoice)) {
            return this.applyGas(invoice);
        }
        if (!this.isElectricityInvoice(invoice)) {
            return invoice;
        }

        const billingDays = this.positive(invoice.billing_days);
        const isThreePeriod = this.hasThreePeriodTou(invoice);
        const state = this.inferRetailState(invoice.site_address);
        const findings: NonNullable<ExtractedInvoice['low_hanging_fruit']> = [];

        const skipRetailTou = this.isFlatOrSingleRateElectricity(invoice);
        if (!skipRetailTou) {
            this.addRetailTouFindings(findings, invoice, state, isThreePeriod, billingDays);
        }

        const annualMeter = this.annualize(invoice.meter_charges, billingDays);
        if (annualMeter !== null) {
            this.maybeAddMeteringTierFinding(findings, annualMeter);
        }

        this.maybeAddDemandRepricingFinding(findings, invoice, billingDays);

        logger.info(
            `Deterministic findings for invoice ${invoice.invoice_number ?? 'unknown'}: ${findings.length}` +
                (skipRetailTou ? ' (retail TOU skipped: flat/single-rate)' : ''),
        );

        return { ...invoice, low_hanging_fruit: findings };
    }

    private applyGas(invoice: ExtractedInvoice): ExtractedInvoice {
        const billingDays = this.positive(invoice.billing_days);
        const usageGjPeriod = this.positive(invoice.total_usage_gj);
        const annualUsageGj = this.annualize(usageGjPeriod, billingDays);
        // Base 1 automation only emits gas savings for meaningful annualised usage.
        if (annualUsageGj === null || annualUsageGj < 1000) {
            return { ...invoice, low_hanging_fruit: [] };
        }

        const bundledGas = this.isGasBundledInvoice(invoice);
        const invoiceIncGst = this.positive(invoice.total_inc_gst);
        const gst = this.positive(invoice.gst_amount);
        const invoiceExGst =
            this.positive(invoice.total_charges_ex_gst) ??
            (invoiceIncGst !== null && gst !== null ? invoiceIncGst - gst : null);
        const benchmark = this.gasBenchmarkPerGj(annualUsageGj);
        let annualSavings: number | null = null;
        let message: string | null = null;

        if (bundledGas) {
            if (invoiceExGst === null || usageGjPeriod === null || usageGjPeriod <= 0) {
                return { ...invoice, low_hanging_fruit: [] };
            }
            const bundledRate = invoiceExGst / usageGjPeriod;
            const energyCharge = bundledRate * 0.75;
            annualSavings = annualUsageGj * (energyCharge - benchmark);
            message =
                `Calculated bundled gas energy charge ${energyCharge.toFixed(2)} $/GJ exceeds Base 1 comparison of ${benchmark.toFixed(2)} $/GJ ` +
                `(bundled ${bundledRate.toFixed(2)} $/GJ × 75%).`;
        } else {
            const retailRate = this.positive(invoice.gas_rate_per_gj) ??
                (invoiceExGst !== null && usageGjPeriod !== null && usageGjPeriod > 0
                    ? invoiceExGst / usageGjPeriod
                    : null);
            if (retailRate === null) {
                return { ...invoice, low_hanging_fruit: [] };
            }
            annualSavings = annualUsageGj * (retailRate - benchmark);
            message =
                `Unbundled gas retail rate ${retailRate.toFixed(2)} $/GJ exceeds Base 1 comparison of ${benchmark.toFixed(2)} $/GJ.`;
        }

        if (annualSavings === null) {
            return { ...invoice, low_hanging_fruit: [] };
        }
        if (annualSavings < 200) {
            return { ...invoice, low_hanging_fruit: [] };
        }

        const severity: Severity = annualSavings >= 2000 ? 'high' : 'medium';
        const findings: NonNullable<ExtractedInvoice['low_hanging_fruit']> = [
            {
                type: 'Gas energy rate above Base 1 comparison',
                severity,
                message: message!,
                potential_savings: this.moneyPerYear(annualSavings),
            },
        ];

        return { ...invoice, low_hanging_fruit: findings };
    }

    /**
     * Flat / single-rate / all-in-one usage bucket — not TOU retail (e.g. SME Bundled Flat Rate).
     */
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
        state: 'NSW' | 'OTHER' | null,
        isThreePeriod: boolean,
        billingDays: number | null,
    ): void {
        if (state === null) return;

        if (state === 'NSW') {
            this.maybeAddRetailRateFinding(
                findings,
                'Retail peak rate (NSW)',
                invoice.peak_rate_c_per_kwh,
                10,
                this.annualize(invoice.peak_usage_kwh, billingDays),
            );
            if (isThreePeriod) {
                this.maybeAddRetailRateFinding(
                    findings,
                    'Retail shoulder rate (NSW)',
                    invoice.shoulder_rate_c_per_kwh,
                    10,
                    this.annualize(invoice.shoulder_usage_kwh, billingDays),
                );
            }
            this.maybeAddRetailRateFinding(
                findings,
                'Retail off-peak rate (NSW)',
                invoice.off_peak_rate_c_per_kwh,
                12,
                this.annualize(invoice.off_peak_usage_kwh, billingDays),
            );
            return;
        }

        const shoulderComparison = this.shoulderRetailComparisonCPerKwh(invoice, isThreePeriod);

        this.maybeAddRetailRateFinding(
            findings,
            'Retail peak rate',
            invoice.peak_rate_c_per_kwh,
            9,
            this.annualize(invoice.peak_usage_kwh, billingDays),
        );
        if (isThreePeriod && shoulderComparison !== null) {
            this.maybeAddRetailRateFinding(
                findings,
                'Retail shoulder rate',
                invoice.shoulder_rate_c_per_kwh,
                shoulderComparison,
                this.annualize(invoice.shoulder_usage_kwh, billingDays),
            );
        }
        this.maybeAddRetailRateFinding(
            findings,
            'Retail off-peak rate',
            invoice.off_peak_rate_c_per_kwh,
            7,
            this.annualize(invoice.off_peak_usage_kwh, billingDays),
        );
    }

    private shoulderRetailComparisonCPerKwh(
        invoice: ExtractedInvoice,
        isThreePeriod: boolean,
    ): number | null {
        if (!isThreePeriod) return null;
        const sh = this.positive(invoice.shoulder_rate_c_per_kwh);
        const off = this.positive(invoice.off_peak_rate_c_per_kwh);
        if (sh !== null && off !== null && Math.abs(sh - off) < 0.01) {
            return 7;
        }
        return 9;
    }

    private maybeAddRetailRateFinding(
        findings: NonNullable<ExtractedInvoice['low_hanging_fruit']>,
        type: string,
        currentRateCPerKwh: number | null,
        comparisonCPerKwh: number,
        annualUsageKwh: number | null,
    ): void {
        const rate = this.positive(currentRateCPerKwh);
        const annualUsage = this.positive(annualUsageKwh);
        if (rate === null || annualUsage === null) return;
        if (rate <= comparisonCPerKwh) return;

        const savings = ((rate - comparisonCPerKwh) / 100) * annualUsage;
        if (savings < 200) return;

        const severity: Severity =
            rate >= comparisonCPerKwh + 5 || savings >= 2000 ? 'high' : 'medium';

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
    ): void {
        if (annualMeter <= 700) return;

        let comparison: number;
        if (annualMeter <= 1200) {
            comparison = 700;
        } else {
            comparison = 900;
        }

        const savings = annualMeter - comparison;
        if (savings < 200) return;

        const severity: Severity = annualMeter > 1200 || savings >= 2000 ? 'high' : 'medium';

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
    ): void {
        const charges = this.positive(invoice.demand_charges);
        const billed = this.positive(invoice.demand_kw);
        const recorded = this.positive(invoice.recorded_max_demand_kw);
        if (charges === null || billed === null || recorded === null) return;
        if (billed <= 0 || recorded >= billed) return;
        if (billingDays === null || billingDays <= 0) return;

        const relativeOverstatement = (billed - recorded) / billed;
        if (relativeOverstatement < DEMAND_REPRICE_MIN_RELATIVE_OVER) return;

        const periodSavings = charges * (1 - recorded / billed);
        const annualSavings = periodSavings * (365 / billingDays);
        if (annualSavings < 200) return;

        const severity: Severity = annualSavings >= 2000 ? 'high' : 'medium';

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

    /**
     * **Unbundled** only when `tariff_type` mentions "unbundled"; otherwise **bundled** (including empty labels).
     * The emission gate (annualised usage >= 1,000 GJ/year) is applied in `applyGas` (not in this selector).
     */
    private isGasBundledInvoice(invoice: ExtractedInvoice): boolean {
        const t = (invoice.tariff_type || '').trim();
        // Substring match (case-insensitive) — \bunbundl\b fails on "unbundled" (trailing "ed").
        return !/unbundl/i.test(t);
    }

    /**
     * Tiered Base 1 benchmark ($/GJ) based on annualised usage.
     * Assumes annualUsageGj >= 1,000.
     */
    private gasBenchmarkPerGj(annualUsageGj: number): number {
        if (annualUsageGj >= 30000) return 13.9;
        if (annualUsageGj >= 10000) return 15;
        return 17.1;
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

export const deterministicSavingsService = new DeterministicSavingsService();
