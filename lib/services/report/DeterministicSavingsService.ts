import { getLogger } from '@/lib/config/logger';
import { ExtractedInvoice } from '@/lib/types/ReportTypes';

const logger = getLogger('DeterministicSavingsService');

type Severity = 'high' | 'medium';

interface Thresholds {
    base: number;
    medium: number;
    high: number;
}

interface ElectricityBenchmarks {
    peak: Thresholds;
    shoulder: Thresholds;
    offPeak: Thresholds;
    dailySupply: Thresholds;
    meteringAnnual: Thresholds;
}

/**
 * Deterministic benchmarking/savings calculator.
 * Replaces model-authored low_hanging_fruit to keep repeated runs stable.
 */
export class DeterministicSavingsService {
    private readonly ciBenchmarks3p: ElectricityBenchmarks = {
        peak: { base: 28, medium: 32, high: 35 },
        shoulder: { base: 24, medium: 28, high: 30 },
        offPeak: { base: 18, medium: 24, high: 26 },
        dailySupply: { base: 2.0, medium: 4.0, high: 5.0 },
        meteringAnnual: { base: 700, medium: 1000, high: 1200 },
    };

    private readonly smeBenchmarks3p: ElectricityBenchmarks = {
        peak: { base: 25, medium: 30, high: 32 },
        shoulder: { base: 22, medium: 26, high: 28 },
        offPeak: { base: 16, medium: 22, high: 24 },
        dailySupply: { base: 1.2, medium: 1.6, high: 1.8 },
        meteringAnnual: { base: 700, medium: 800, high: 900 },
    };

    // 2-period thresholds are not explicitly defined in the guide; use same warning/critical as 3-period.
    private readonly ciBenchmarks2p: ElectricityBenchmarks = this.ciBenchmarks3p;
    private readonly smeBenchmarks2p: ElectricityBenchmarks = this.smeBenchmarks3p;

    applyDeterministicFindings(invoices: ExtractedInvoice[]): ExtractedInvoice[] {
        return invoices.map((invoice) => this.applyOne(invoice));
    }

    private applyOne(invoice: ExtractedInvoice): ExtractedInvoice {
        if (!this.isElectricityInvoice(invoice)) {
            return invoice;
        }

        const billingDays = this.positive(invoice.billing_days);
        const annualUsage = this.annualize(invoice.total_usage_kwh, billingDays);
        const customerType = this.classifyCustomerType(invoice, annualUsage);
        const isThreePeriod = this.positive(invoice.shoulder_usage_kwh) !== null;
        const bm = this.getBenchmarks(customerType, isThreePeriod);
        const findings: NonNullable<ExtractedInvoice['low_hanging_fruit']> = [];

        this.maybeAddRateFinding(
            findings,
            'High Peak Rate',
            invoice.peak_rate_c_per_kwh,
            bm.peak,
            this.annualize(invoice.peak_usage_kwh, billingDays),
        );
        if (isThreePeriod) {
            this.maybeAddRateFinding(
                findings,
                'High Shoulder Rate',
                invoice.shoulder_rate_c_per_kwh,
                bm.shoulder,
                this.annualize(invoice.shoulder_usage_kwh, billingDays),
            );
        }
        this.maybeAddRateFinding(
            findings,
            'High Off-Peak Rate',
            invoice.off_peak_rate_c_per_kwh,
            bm.offPeak,
            this.annualize(invoice.off_peak_usage_kwh, billingDays),
        );

        this.maybeAddDailySupplyFinding(findings, invoice.daily_supply_charge, bm.dailySupply);

        const annualMeter = this.annualize(invoice.meter_charges, billingDays);
        if (annualMeter !== null) {
            this.maybeAddAnnualFinding(
                findings,
                'High Meter Charges',
                annualMeter,
                bm.meteringAnnual,
                'Annual meter charges',
                '/year',
            );
        }

        logger.info(
            `Deterministic findings for invoice ${invoice.invoice_number ?? 'unknown'}: ${findings.length}`,
        );

        return { ...invoice, low_hanging_fruit: findings };
    }

    private maybeAddRateFinding(
        findings: NonNullable<ExtractedInvoice['low_hanging_fruit']>,
        type: string,
        currentRateCPerKwh: number | null,
        thresholds: Thresholds,
        annualUsageKwh: number | null,
    ): void {
        const rate = this.positive(currentRateCPerKwh);
        const annualUsage = this.positive(annualUsageKwh);
        if (rate === null || annualUsage === null) return;
        if (rate <= thresholds.medium) return;

        const severity: Severity = rate > thresholds.high ? 'high' : 'medium';
        const savings = ((rate - thresholds.medium) / 100) * annualUsage;
        if (savings < 200) return;

        findings.push({
            type,
            severity,
            message:
                `${type.replace('High ', '')} ${rate.toFixed(2)} c/kWh exceeds KB benchmark of ` +
                `${thresholds.base.toFixed(2)} c/kWh and ` +
                `${severity === 'high' ? 'critical' : 'warning'} threshold of ` +
                `${(severity === 'high' ? thresholds.high : thresholds.medium).toFixed(2)} c/kWh.`,
            potential_savings: this.moneyPerYear(savings),
        });
    }

    private maybeAddDailySupplyFinding(
        findings: NonNullable<ExtractedInvoice['low_hanging_fruit']>,
        dailySupply: number | null,
        thresholds: Thresholds,
    ): void {
        const current = this.positive(dailySupply);
        if (current === null || current <= thresholds.medium) return;

        const severity: Severity = current > thresholds.high ? 'high' : 'medium';
        const savings = (current - thresholds.base) * 365;
        if (savings < 200) return;

        findings.push({
            type: 'High Daily Supply',
            severity,
            message:
                `Daily supply charge ${this.money(current)}/day exceeds KB benchmark of ${this.money(thresholds.base)}/day ` +
                `and ${severity === 'high' ? 'critical' : 'warning'} threshold of ` +
                `${this.money(severity === 'high' ? thresholds.high : thresholds.medium)}/day.`,
            potential_savings: this.moneyPerYear(savings),
        });
    }

    private maybeAddAnnualFinding(
        findings: NonNullable<ExtractedInvoice['low_hanging_fruit']>,
        type: string,
        annualValue: number,
        thresholds: Thresholds,
        label: string,
        unit: string,
    ): void {
        if (annualValue <= thresholds.medium) return;
        const severity: Severity = annualValue > thresholds.high ? 'high' : 'medium';
        const savings = annualValue - thresholds.base;
        if (savings < 200) return;

        findings.push({
            type,
            severity,
            message:
                `${label} ${this.money(annualValue)}${unit} exceed KB benchmark of ${this.money(thresholds.base)}${unit} ` +
                `and ${severity === 'high' ? 'critical' : 'warning'} threshold of ` +
                `${this.money(severity === 'high' ? thresholds.high : thresholds.medium)}${unit}.`,
            potential_savings: this.moneyPerYear(savings),
        });
    }

    private classifyCustomerType(
        invoice: ExtractedInvoice,
        annualUsageKwh: number | null,
    ): 'c_and_i' | 'sme' {
        const demandKw = this.positive(invoice.demand_kw);
        const demandCharges = this.positive(invoice.demand_charges);
        if (demandCharges !== null && demandCharges > 0) return 'c_and_i';
        if (demandKw !== null && demandKw >= 100) return 'c_and_i';
        if (annualUsageKwh !== null && annualUsageKwh >= 160_000) return 'c_and_i';
        return 'sme';
    }

    private getBenchmarks(customerType: 'c_and_i' | 'sme', isThreePeriod: boolean): ElectricityBenchmarks {
        if (customerType === 'c_and_i') {
            return isThreePeriod ? this.ciBenchmarks3p : this.ciBenchmarks2p;
        }
        return isThreePeriod ? this.smeBenchmarks3p : this.smeBenchmarks2p;
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
