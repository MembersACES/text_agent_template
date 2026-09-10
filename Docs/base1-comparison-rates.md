# Base 1 Comparison Rates (Deterministic Savings)

Generated: `2026-06-08`

This document lists the exact **comparison figures** used by the deterministic Base 1 savings engine in `lib/services/report/DeterministicSavingsService.ts`.

---

## Shared annualisation

Most comparisons are annualised using:

`annual_value = (period_value / billing_days) * 365`

The engine only emits gas findings when **annualised gas usage >= 700 GJ**.

---

## Gas (Utility Type: `Gas`)

### Emission gate

No automated gas savings rows when:
- annualised usage is `null` or `< 700 GJ/year`

### Tiered benchmark ($/GJ)

Based on **annualised** gas consumption:

- `[700, 1,000)` GJ/year: compare with **17.1 $/GJ** (near-C&I — labelled **Potential (C&I 70%)**, included in Expected)
- `[1,000, 10,000)` GJ/year: compare with **17.1 $/GJ**
- `[10,000, 30,000)` GJ/year: compare with **15.0 $/GJ**
- `>= 30,000` GJ/year: compare with **13.9 $/GJ**

### Bundled vs Unbundled (from `tariff_type`)

`tariff_type` contains substring `"unbundled"` (case-insensitive) labels the bill; rate resolution is shared:

1. **Bundled** (no `"unbundled"` in `tariff_type`): `(invoice_ex_gst / usage_gj) × 75%` (whole bill, supply included).
2. **Unbundled:** prefer **`gas_rate_per_gj`**, else usage charges ÷ GJ, else invoice ex-GST ÷ GJ (no 75% haircut).

### Emission + severity rules (gas)

For both bundled/unbundled:
- Annualised savings must be `>= $200/year` to emit.
- `severity = high` when `annualSavings >= $2,000/year`, else `medium`.

Savings maths:
- `annualSavings = annualUsageGj * (comparison_per_gj - benchmark_per_gj)`

---

## Electricity (Utility Type: `Electricity`)

Path is **bundled vs unbundled** from `tariff_type` (substring `"unbundled"`), **not** SME/C&I by usage.

### Unbundled — C&I retail TOU

Applied when `tariff_type` contains `"unbundled"`, and the bill is **not** flat/single-rate.

State detection:
- If `site_address` contains `NSW` ⇒ use NSW targets.
- Otherwise ⇒ use the “All states other than NSW” targets.

#### NSW (Peak/Shoulder/Off-Peak)

All values are **comparison rates** (c/kWh):
- Peak comparison: **10 c/kWh**
- Shoulder comparison: **10 c/kWh** (when 3-period)
- Off-peak comparison: **12 c/kWh**

#### All states other than NSW (VIC/ACT/QLD/SA/WA/TAS/NT)

- Peak comparison: **9 c/kWh**
- Off-peak comparison: **7 c/kWh**
- Shoulder comparison (3-period only):
  - if shoulder is billed identically to off-peak (within `0.01 c/kWh`), comparison is **7 c/kWh**
  - otherwise comparison is **9 c/kWh**

Compare **energy-only** printed c/kWh (no 45% haircut).

### Bundled — SME → C&I (45% of whole bill)

No `"unbundled"` in `tariff_type`.

1. Annualise `total_usage_kwh`. If `< 70,000 kWh/year`, **no retail finding**.
2. `retail_pool = invoice_ex_gst × 0.45` (supply included).
3. **TOU splits** (peak and off-peak and/or shoulder kWh, with printed all-in rates):  
   `implied_c = printed_c × (retail_pool / tou_period_charges)` where `tou_period_charges = Σ (printed_c/100 × period_kWh)`.  
   Compare each implied c/kWh to the same NSW/other targets as unbundled.
4. **Otherwise** (flat / anytime / missing splits):  
   `implied_c = (invoice_ex_gst / period_kWh) × 100 × 0.45` vs the **peak** target (NSW 10 / other 9).

Findings are labelled **Potential (SME→C&I)**. Formula, implied rates, 0.45, and annual $ go to the staff **Findings / Skipped** cross-check sheet.

#### TOU / bundled emission + severity rules

For each TOU bucket (peak/shoulder/off-peak):
- Only emit when `rate > comparison`.
- Annualised savings must be `>= $200/year`.
- `severity = high` when:
  - `rate >= comparison + 5 c/kWh`, OR
  - savings `>= $2,000/year`

Savings maths:
- `savings = ((rate - comparison) / 100) * annualUsageKwh`

---

## Electricity metering comparison (Metering Charges only)

The engine computes:
- `annualMeter = (meter_charges / billing_days) * 365`

Metering findings are emitted only when:
- `annualMeter > 700`

### Comparison amounts

- `annualMeter <= 700`: no finding
- `(700, 1,200]`: compare with **$700/year**
- `> 1,200`: compare with **$900/year**

Annualised savings maths:
- `savings = annualMeter - comparison`

Emission + severity:
- only emit when `savings >= $200/year`
- `severity = high` when `annualMeter > 1,200` OR `savings >= $2,000/year`

---

## Electricity demand repricing

There is no fixed “comparison rate” table. Instead, the engine checks whether demand charges appear overstated.

It emits when ALL are true:
- `demand_charges`, `demand_kw`, and `recorded_max_demand_kw` are present and positive
- `billed_demand_kw > 0`
- `recorded_max_demand_kw < billed_demand_kw`
- relative overstatement `>= 0.02` (2%)
- computed `annualSavings >= $200/year`

Where:
- `periodSavings = demand_charges * (1 - recorded / billed)`
- `annualSavings = periodSavings * (365 / billing_days)`

Severity:
- `high` when `annualSavings >= $2,000/year`, else `medium`

