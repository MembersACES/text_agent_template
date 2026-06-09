/**
 * Step 0: verify unconfirmed DeterministicSavingsService paths against synthetic invoices.
 * Run: npx tsx scripts/verify-deterministic-savings.ts
 */
import { DEFAULT_BASE1_COMPARISON_BUCKETS } from '../lib/config/base1ComparisonBuckets';
import { createDeterministicSavingsService } from '../lib/services/report/DeterministicSavingsService';
import type { ExtractedInvoice } from '../lib/types/ReportTypes';

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

function approx(a: number, b: number, tol = 0.02): boolean {
    return Math.abs(a - b) <= tol;
}

const service = createDeterministicSavingsService(DEFAULT_BASE1_COMPARISON_BUCKETS);

// NSW 3-period TOU — peak 15 vs 10, annual peak 10000 kWh over 30 days
const nswInvoice: ExtractedInvoice = {
    business_name: 'NSW Test',
    supplier: 'Origin',
    utility_type: 'Electricity',
    site_address: '1 George St, Sydney NSW 2000',
    nmi: '1234567890',
    mrin: null,
    account_number: null,
    invoice_date: '01/01/2026',
    invoice_number: 'NSW-1',
    billing_period_start: '01/12/2025',
    billing_period_end: '31/12/2025',
    billing_days: 31,
    peak_usage_kwh: 1000,
    shoulder_usage_kwh: 500,
    off_peak_usage_kwh: 2000,
    total_usage_kwh: 3500,
    peak_rate_c_per_kwh: 15,
    shoulder_rate_c_per_kwh: 14,
    off_peak_rate_c_per_kwh: 13,
    daily_supply_charge: null,
    demand_kw: null,
    recorded_max_demand_kw: null,
    demand_charges: null,
    meter_charges: null,
    total_usage_mj: null,
    total_usage_gj: null,
    volume_m3: null,
    gas_rate_per_gj: null,
    usage_charges_ex_gst: null,
    supply_charges_ex_gst: null,
    network_charges_ex_gst: null,
    total_charges_ex_gst: null,
    gst_amount: null,
    total_inc_gst: null,
    tariff_type: '3-Period TOU',
    meter_number: null,
    low_hanging_fruit: [],
};

const [nswOut] = service.applyDeterministicFindings([nswInvoice]);
const nswPeak = nswOut.low_hanging_fruit?.find((f) => f.type.includes('peak'));
assert(!!nswPeak, 'NSW peak finding expected');
const annualPeakKwh = (1000 / 31) * 365;
const expectedNswPeak = ((15 - 10) / 100) * annualPeakKwh;
assert(approx(parseFloat(nswPeak!.potential_savings!.replace(/[^0-9.]/g, '')), expectedNswPeak), 'NSW peak savings');

// Shoulder logic OTHER — shoulder rate equals off-peak → comparison 7
const vicShoulderSame: ExtractedInvoice = {
    ...nswInvoice,
    site_address: '1 Collins St, Melbourne VIC 3000',
    invoice_number: 'VIC-SH-1',
    shoulder_rate_c_per_kwh: 12,
    off_peak_rate_c_per_kwh: 12.005,
    shoulder_usage_kwh: 8000,
    peak_rate_c_per_kwh: 8,
    peak_usage_kwh: 100,
    off_peak_usage_kwh: 100,
};
const [vicOut] = service.applyDeterministicFindings([vicShoulderSame]);
const shFinding = vicOut.low_hanging_fruit?.find((f) => f.type.includes('shoulder'));
assert(!!shFinding, 'VIC shoulder finding (same as off-peak → 7)');
assert(shFinding!.message.includes('7.00'), 'Shoulder comparison 7 c/kWh');

// Bundled gas ×0.75
const bundledGas: ExtractedInvoice = {
    business_name: 'Gas Bundled',
    supplier: 'AGL',
    utility_type: 'Gas',
    site_address: 'Brisbane QLD',
    nmi: null,
    mrin: '12345678',
    account_number: null,
    invoice_date: '01/01/2026',
    invoice_number: 'GAS-B-1',
    billing_period_start: null,
    billing_period_end: null,
    billing_days: 30,
    peak_usage_kwh: null,
    shoulder_usage_kwh: null,
    off_peak_usage_kwh: null,
    total_usage_kwh: null,
    peak_rate_c_per_kwh: null,
    shoulder_rate_c_per_kwh: null,
    off_peak_rate_c_per_kwh: null,
    daily_supply_charge: null,
    demand_kw: null,
    recorded_max_demand_kw: null,
    demand_charges: null,
    meter_charges: null,
    total_usage_mj: null,
    total_usage_gj: 500,
    volume_m3: null,
    gas_rate_per_gj: null,
    usage_charges_ex_gst: null,
    supply_charges_ex_gst: null,
    network_charges_ex_gst: null,
    total_charges_ex_gst: 15000,
    gst_amount: null,
    total_inc_gst: 11000,
    tariff_type: 'Bundled Gas',
    meter_number: null,
    low_hanging_fruit: [],
};
const [gasB] = service.applyDeterministicFindings([bundledGas]);
const gasBF = gasB.low_hanging_fruit?.[0];
assert(!!gasBF, 'Bundled gas finding');
const annualGjB = (500 / 30) * 365;
const benchmarkB = 17.1;
const energyCharge = (15000 / 500) * 0.75;
const expectedGasB = annualGjB * (energyCharge - benchmarkB);
assert(approx(parseFloat(gasBF!.potential_savings!.replace(/[^0-9.]/g, '')), expectedGasB), 'Bundled gas ×0.75');

// Gas tier 15.0 — annual ~15k GJ
const gasMid: ExtractedInvoice = {
    ...bundledGas,
    tariff_type: 'unbundled',
    invoice_number: 'GAS-U-15',
    total_usage_gj: 1200,
    gas_rate_per_gj: 18,
    total_charges_ex_gst: null,
};
const [gasMidOut] = service.applyDeterministicFindings([gasMid]);
const gasMidF = gasMidOut.low_hanging_fruit?.[0];
assert(!!gasMidF, 'Unbundled 15.0 tier finding');
const annualGjMid = (1200 / 30) * 365;
assert(annualGjMid >= 10000 && annualGjMid < 30000, 'Mid tier annual GJ');
const expectedMid = annualGjMid * (18 - 15);
assert(approx(parseFloat(gasMidF!.potential_savings!.replace(/[^0-9.]/g, '')), expectedMid), '15.0 tier');

console.log('Step 0 verification: all paths passed.');
console.log('- NSW TOU (10/10/12)');
console.log('- Shoulder logic (7 when ≈ off-peak)');
console.log('- Bundled gas ×0.75');
console.log('- Gas tier 17.1 / 15.0');
