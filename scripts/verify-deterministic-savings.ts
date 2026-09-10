/**
 * Step 0: verify unconfirmed DeterministicSavingsService paths against synthetic invoices.
 * Run: npx tsx scripts/verify-deterministic-savings.ts
 */
import {
    DEFAULT_BASE1_COMPARISON_BUCKETS,
    ELEC_SME_TO_CI_OPTION_KIND,
    GAS_NEAR_CI_FINDING_TYPE,
    GAS_NEAR_CI_OPTION_KIND,
} from '../lib/config/base1ComparisonBuckets';
import { createDeterministicSavingsService } from '../lib/services/report/DeterministicSavingsService';
import type { ExtractedInvoice } from '../lib/types/ReportTypes';
import { getBase1BenchmarkGroups } from '../lib/utils/base1AnalysisLabels';

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
    tariff_type: 'C&I Unbundled 3-Period TOU',
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

// Press Metal-style bundled retail plan WITH gas_rate_per_gj — still ×0.75 (21.077×0.75 < 17.1 → skip)
const pressMetal: ExtractedInvoice = {
    ...bundledGas,
    business_name: 'Press Metal Aluminium (Australia) Pty Ltd',
    supplier: 'EnergyAustralia',
    site_address: '32 Southeast BVD Pakenham, VIC 3810',
    mrin: '53203347912',
    invoice_number: '155881053372',
    billing_days: 63,
    total_usage_gj: 399.48665,
    gas_rate_per_gj: 21.077,
    total_charges_ex_gst: 8500,
    gst_amount: 850,
    total_inc_gst: 9350,
    tariff_type: 'Business Balance Plan 24',
    low_hanging_fruit: [],
};
const pressResult = service.runPipeline([pressMetal]);
const [pressOut] = pressResult.invoices;
assert((pressOut.low_hanging_fruit?.length ?? 0) === 0, 'Press Metal bundled ×0.75 below 17.1 → no finding');
assert(
    pressResult.recorder.skipped.some((s) => (s.computedAnnualSaving ?? 0) < 0),
    'Press Metal records negative computed saving after ×0.75',
);

// Same Press Metal totals WITHOUT gas_rate — bundled all-in ×0.75 should also skip
const pressMetalAllInOnly: ExtractedInvoice = {
    ...pressMetal,
    invoice_number: '155881053372-ALLIN',
    gas_rate_per_gj: null,
};
const pressAllInResult = service.runPipeline([pressMetalAllInOnly]);
assert(
    (pressAllInResult.invoices[0].low_hanging_fruit?.length ?? 0) === 0,
    'All-in bundled ×0.75 below benchmark → no finding',
);
assert(
    pressAllInResult.recorder.skipped.some((s) => (s.computedAnnualSaving ?? 0) < 0),
    'All-in path records negative computed saving',
);

const gasBase = bundledGas;

// Below 700 GJ — still skip
const below700: ExtractedInvoice = {
    ...gasBase,
    invoice_number: 'GAS-699',
    billing_days: 365,
    total_usage_gj: 699,
    gas_rate_per_gj: 25.453,
    total_charges_ex_gst: null,
    tariff_type: 'Business Select',
};
const below700Result = service.runPipeline([below700]);
assert((below700Result.invoices[0].low_hanging_fruit?.length ?? 0) === 0, '699 GJ must skip');
assert(
    below700Result.recorder.skipped.some((s) => String(s.reason).includes('700')),
    '699 GJ skip reason cites 700 gate',
);

// TJAJH-style near-C&I 820 GJ at $25.453 vs 17.1
const tjajh: ExtractedInvoice = {
    ...gasBase,
    business_name: 'TJAJH ENTERPRISES PTY LTD',
    supplier: 'Origin',
    site_address: '348 Bridge RD Richmond VIC 3121',
    mrin: '53214118733',
    invoice_number: '133775323',
    billing_days: 61,
    total_usage_gj: 137.011,
    gas_rate_per_gj: 25.453,
    total_charges_ex_gst: 3896.54 / 1.1,
    gst_amount: 3896.54 - 3896.54 / 1.1,
    total_inc_gst: 3896.54,
    tariff_type: 'Business Select',
    low_hanging_fruit: [],
};
const [tjajhOut] = service.applyDeterministicFindings([tjajh]);
const tjajhF = tjajhOut.low_hanging_fruit?.[0];
assert(!!tjajhF, 'TJAJH near-C&I finding expected');
assert(tjajhF!.type === GAS_NEAR_CI_FINDING_TYPE, 'TJAJH finding type is potential near-C&I');
const annualGjTj = (137.011 / 61) * 365;
assert(annualGjTj >= 700 && annualGjTj < 1000, 'TJAJH annual GJ in near-C&I band');
const tjAllIn = 3896.54 / 1.1 / 137.011;
const expectedTj = annualGjTj * (tjAllIn * 0.75 - 17.1);
assert(approx(parseFloat(tjajhF!.potential_savings!.replace(/[^0-9.]/g, '')), expectedTj, 1), 'TJAJH whole-bill ×0.75 ~$1878');
assert(/Potential:/.test(tjajhF!.message), 'TJAJH message flags Potential');
const tjGroups = getBase1BenchmarkGroups([tjajhOut]);
assert(tjGroups[0]?.optionKind === GAS_NEAR_CI_OPTION_KIND, 'TJAJH option is Potential (C&I 70%)');
assert(approx(tjGroups[0]!.totalSavings, expectedTj, 1), 'TJAJH included in Expected grouping');

const pressGroups = getBase1BenchmarkGroups([pressOut]);
assert(pressGroups.length === 0, 'Press Metal has no savings row after bundled ×0.75');

// Bundled SME electricity TOU — 70 MWh, allocate 45% pool by printed period $
const bundledTou: ExtractedInvoice = {
    ...nswInvoice,
    business_name: 'SME Bundled TOU',
    invoice_number: 'SME-TOU-70',
    nmi: 'NMI0000070',
    tariff_type: 'SME Bundled 3-Period TOU',
    billing_days: 365,
    peak_usage_kwh: 20_000,
    shoulder_usage_kwh: 15_000,
    off_peak_usage_kwh: 35_000,
    total_usage_kwh: 70_000,
    peak_rate_c_per_kwh: 32,
    shoulder_rate_c_per_kwh: 28,
    off_peak_rate_c_per_kwh: 22,
    total_charges_ex_gst: 20_300,
    gst_amount: null,
    total_inc_gst: null,
    network_charges_ex_gst: null,
};
const bundledTouPipeline = service.runPipeline([bundledTou]);
const [bundledTouOut] = bundledTouPipeline.invoices;
const touCharges = (32 / 100) * 20_000 + (28 / 100) * 15_000 + (22 / 100) * 35_000;
const retailPool = 20_300 * 0.45;
const impliedPeak = 32 * (retailPool / touCharges);
const impliedShoulder = 28 * (retailPool / touCharges);
const impliedOff = 22 * (retailPool / touCharges);
const bundledPeak = bundledTouOut.low_hanging_fruit?.find((f) => /peak rate/i.test(f.type) && !/off-peak/i.test(f.type));
const bundledSh = bundledTouOut.low_hanging_fruit?.find((f) => /shoulder/i.test(f.type));
assert(!!bundledPeak, 'Bundled SME peak finding');
assert(!!bundledSh, 'Bundled SME shoulder finding');
assert(/SME bundled 45%/.test(bundledPeak!.type), 'Peak type tagged SME bundled 45%');
assert(approx(parseFloat(bundledPeak!.potential_savings!.replace(/[^0-9.]/g, '')), ((impliedPeak - 10) / 100) * 20_000), 'Bundled peak 45% allocation');
assert(approx(parseFloat(bundledSh!.potential_savings!.replace(/[^0-9.]/g, '')), ((impliedShoulder - 10) / 100) * 15_000), 'Bundled shoulder 45% allocation');
assert(impliedOff <= 12, 'Implied off-peak at or below NSW 12 — no off-peak finding expected');
assert(
    !bundledTouOut.low_hanging_fruit?.some((f) => /off-peak/i.test(f.type)),
    'Bundled off-peak below comparison is skipped',
);
assert(
    bundledTouPipeline.recorder.findings.some((f) => String(f.formula).includes('0.45')),
    'Cross-check Findings include 0.45 formula',
);
const smeGroups = getBase1BenchmarkGroups([bundledTouOut]);
assert(smeGroups[0]?.optionKind === ELEC_SME_TO_CI_OPTION_KIND, 'Bundled SME option is Potential (SME→C&I)');

// Below 70 MWh bundled — skip retail
const below70: ExtractedInvoice = {
    ...bundledTou,
    invoice_number: 'SME-69999',
    nmi: 'NMI0000069',
    total_usage_kwh: 69_999,
    peak_usage_kwh: 20_000,
    shoulder_usage_kwh: 15_000,
    off_peak_usage_kwh: 34_999,
};
const below70Result = service.runPipeline([below70]);
assert(
    (below70Result.invoices[0].low_hanging_fruit?.length ?? 0) === 0,
    '69,999 kWh bundled must skip retail',
);
assert(
    below70Result.recorder.skipped.some((s) => String(s.reason).includes('70000')),
    'Below 70 MWh skip cites 70000 gate',
);

// Bundled flat — one blended 45% rate vs NSW 10
const bundledFlat: ExtractedInvoice = {
    ...nswInvoice,
    invoice_number: 'SME-FLAT',
    nmi: 'NMI0000080',
    tariff_type: 'SME Bundled Flat Rate',
    billing_days: 365,
    peak_usage_kwh: 80_000,
    shoulder_usage_kwh: null,
    off_peak_usage_kwh: null,
    total_usage_kwh: 80_000,
    peak_rate_c_per_kwh: 35,
    shoulder_rate_c_per_kwh: null,
    off_peak_rate_c_per_kwh: null,
    total_charges_ex_gst: 28_000,
};
const [flatOut] = service.applyDeterministicFindings([bundledFlat]);
const flatF = flatOut.low_hanging_fruit?.find((f) => /blended/i.test(f.type));
assert(!!flatF, 'Bundled flat blended finding');
const expectedFlat = ((28_000 / 80_000) * 100 * 0.45 - 10) / 100 * 80_000;
assert(approx(parseFloat(flatF!.potential_savings!.replace(/[^0-9.]/g, '')), expectedFlat), 'Bundled flat whole-bill ×0.45');

// Mixed unbundled C&I + bundled SME — both roll up (no portfolio SME drop)
const mixed = service.applyDeterministicFindings([nswInvoice, bundledTou]);
const mixedGroups = getBase1BenchmarkGroups(mixed);
assert(mixedGroups.some((g) => g.optionKind === 'Profile Reset'), 'Unbundled C&I still in Expected');
assert(mixedGroups.some((g) => g.optionKind === ELEC_SME_TO_CI_OPTION_KIND), 'Bundled SME still in Expected alongside C&I');

console.log('Step 0 verification: all paths passed.');
console.log('- NSW TOU (10/10/12)');
console.log('- Shoulder logic (7 when ≈ off-peak)');
console.log('- Bundled gas (invoice ex-GST / GJ) ×0.75 including supply');
console.log('- Gas tier 17.1 / 15.0');
console.log('- Press Metal bundled ×0.75 below 17.1 → skip');
console.log('- Gas <700 GJ skipped');
console.log('- Near-C&I 700–999 GJ at 17.1 labelled Potential (C&I 70%)');
console.log('- Bundled SME electricity ≥70 MWh ×0.45 with TOU allocation');
console.log('- Bundled SME <70 MWh skipped');
console.log('- Bundled flat 45% blended vs peak target');
console.log('- Mixed unbundled C&I + bundled SME both eligible');
