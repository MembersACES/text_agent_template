# ELECTRICITY ANALYSIS GUIDE — ACES Solutions

**Version:** 3.6 — Text Agent  
**Last updated:** May 2026  

---

## Usage instructions

When analyzing electricity invoices:

1. Follow classification steps to determine customer type  
2. Identify billing structure (bundled vs unbundled)  
3. Detect TOU structure (2-period vs 3-period)  
4. Extract all required fields  
5. Apply appropriate benchmarks from this guide **where they apply** (see scope below)  
6. **Base 1 electricity `low_hanging_fruit` is computed server-side** from extracted JSON — focus extraction quality; use **`low_hanging_fruit: []`** in tool extraction output for electricity.

Downstream Excel/API applies deterministic retail TOU, metering tiers, and demand repricing after extraction; this guide ensures correct extraction and alignment.

---

## Scope: MARKET BENCHMARKS vs Base 1 automation

| Topic | Role of this guide | Base 1 app behaviour |
|--------|---------------------|-------------------------|
| **Retail TOU c/kWh** | **BASE 1 RETAIL TOU COMPARISON** block below is source of truth for comparison targets | Applied automatically from extracted **energy-only** TOU rates |
| **Legacy peak bands** (e.g. 28–35 c/kWh tables) | Context / narrative only | **Not** used for automated retail TOU savings rows |
| **Daily supply** ($/day tables) | Extract **`daily_supply_charge`** only | **No** Base 1 electricity savings rows from daily supply |
| **Demand $/kVA/month bands** | Context / messaging | Automated demand row uses **billed vs recorded max** (≥2% gap, annual savings >$200), not the table alone |
| **Metering $700 / 🟡$1000 / 🔴$1200** | Narrative severity | Savings math uses annual combined metering: **≤$700** no flag; **($700,$1200]** savings vs **$700**; **>$1200** savings vs **$900** |

---

## Classification framework

### Step 1: Identify customer type

**Commercial & Industrial (C&I)**

- Peak demand ≥100 kW **OR**
- Annual usage ≥160,000 kWh **OR**
- Multiple meters at same site **OR**
- Demand charges present on invoice **OR**
- Tariff contains “C&I”, “Large Business”, “Commercial” **OR**
- Industrial premises (factory, warehouse, processing)

**Small-Medium Enterprise (SME)**

- Annual usage 40,000–110,000 kWh **AND**
- Peak demand <100 kW **AND**
- Single meter **AND**
- Tariff contains “SME”, “Small Business”, “Business” **AND**
- Commercial premises (shop, office, restaurant, hotel)

**Residential**

- Annual usage <40,000 kWh **AND**
- Residential address **AND**
- Tariff contains “Residential”, “Home”, “Domestic”

**Decision priority**

1. If demand charges present → C&I  
2. If peak demand shown and ≥100 kW → C&I  
3. If annual usage ≥160,000 kWh → C&I  
4. Otherwise use tariff name and premises type  

### Step 2: Identify billing structure

**Bundled invoice**

- Single rate per kWh that includes ALL costs (energy + network)  
- Example: “Supply charge: 28.5 c/kWh” (all-in rate)  
- No separate line items for energy vs network  
- Common with: SME customers, basic tariffs, some retailers  

**Unbundled invoice**

- Separate line items for energy (retailer), network (distributor), environmental (sometimes)  
- Example: “Energy: 18.2 c/kWh” + “Network: 8.5 c/kWh”  
- Common with: C&I customers, competitive retailers  

### Step 3: Identify TOU structure (state-dependent)

**CRITICAL:** Shoulder periods are optional by state.

**3-period TOU (Peak / Shoulder / Off-Peak)**

- Typical states: NSW, VIC, ACT  
- Backend fields: `peak_usage_kwh`, `shoulder_usage_kwh`, `off_peak_usage_kwh`  

**2-period TOU (Peak / Off-Peak only)**

- Typical states: QLD, SA, WA, NT  
- Backend fields: `peak_usage_kwh`, `off_peak_usage_kwh` (`shoulder_usage_kwh` **NULL**)  

**Detection logic**

```
if shoulder_usage_kwh is not None and shoulder_usage_kwh > 0:
    tou_structure = "3-period"
else:
    tou_structure = "2-period"
```

---

## Data extraction requirements

### Critical fields (always extract)

**Account identifiers**

- `nmi`: string (10–11 characters) — validate length  
- `account_number`, `meter_number`  

**Usage (kWh)**

- `peak_usage_kwh`, `off_peak_usage_kwh`, `total_usage_kwh`  
- `shoulder_usage_kwh`: number **or null** if 2-period TOU  

**Rates (c/kWh)** — always extract or calculate per guide  

- `peak_rate_c_per_kwh`, `off_peak_rate_c_per_kwh`  
- `shoulder_rate_c_per_kwh`: number **or null** if 2-period  

**Demand (C&I)**

- `demand_kw`, `recorded_max_demand_kw`, `demand_charges` (same **kW or kVA** unit as invoice)  

**Other**

- `meter_charges`: period total of metering-related lines (meter, DMA, VAS tied to metering) — sum for the bill period  
- `network_charges_ex_gst` where applicable  

**`site_address`**

- Include **Australian state** (NSW, VIC, QLD, etc.) in the text whenever possible. Retail TOU logic infers state from `site_address`; missing state can prevent retail TOU findings.  

**Daily supply**

- `daily_supply_charge` = **$/day** from the line that is explicitly daily (e.g. “Daily Charge … $/day”).  
- **Do not** set it to (some unrelated period total $) ÷ billing_days unless the invoice defines that as daily supply.  
- If only monthly supply is shown and the invoice defines it as convertible: you may derive daily consistent with the guide — prefer explicit $/day lines first.  

---

## BASE 1 RETAIL TOU COMPARISON (ACES app — source of truth)

Applies to **TOU** (2- or 3-period), **bundled or unbundled**. Use peak / shoulder / off-peak **energy** c/kWh from **retailer energy lines only** — never blend energy + network into those TOU fields.

| Region | Peak | Shoulder | Off-peak | Notes |
|--------|------|----------|----------|--------|
| **NSW** | **10** c/kWh | **10** c/kWh | **12** c/kWh | Peak and shoulder share **10**; off-peak **12** |
| **All other states** (VIC, ACT, QLD, SA, WA, TAS, NT) | **9** | **9** or **7** | **7** | Shoulder uses **9** unless shoulder rate equals off-peak on the bill (within ~0.01 c/kWh), then **7** |

**Flat / single-rate / anytime:** do **not** apply this TOU retail block — Base 1 skips retail TOU comparisons.

**Severity (matches product):** once annual savings > **$200**, **high** if rate exceeds comparison by **≥5 c/kWh** **or** annual savings ≥ **$2,000**; otherwise **medium**.

Downstream Excel/API applies these numbers deterministically after extraction.

---

## MARKET BENCHMARKS — 2026

These tables support classification, narrative context, and **Water/Waste/Oil** style benchmarking where still used. **Automated Base 1 electricity retail TOU rows use § BASE 1 RETAIL TOU COMPARISON above**, not the legacy bundled peak bands below.

### C&I bundled rates (3-period TOU — NSW/VIC/ACT)

- Peak: 28–35 c/kWh (🟡 >32, 🔴 >35)  
- Shoulder: 24–30 c/kWh (🟡 >28, 🔴 >30)  
- Off-peak: 18–26 c/kWh (🟡 >24, 🔴 >26)  
- Daily supply: $2.00–$5.00/day (context — **no Base 1 electricity savings row**)  
- Demand: $12–$18/kVA/month (context — automated row uses billed vs recorded max)  
- Metering: $700/year base; 🟡 >$1,000/year; 🔴 >$1,200/year (**automated savings** vs **$700** / **$900** tiers as in scope table)  

### C&I bundled rates (2-period TOU — QLD/SA/WA/NT)

- Peak: 28–35 c/kWh  
- Off-peak: 18–26 c/kWh  
- Daily supply, demand, metering as above (no shoulder)  

### C&I unbundled rates (3-period TOU)

- Energy: 16–22 c/kWh (🟡 >20, 🔴 >22)  
- Network: 8–12 c/kWh (🟡 >10, 🔴 >12)  
- Combined total band 24–34 c/kWh  
- Daily supply: $1.50–$3.00/day  

### SME bundled / unbundled tables

- Use guide bands as printed for SME sections (peak/shoulder/off, metering $700–$900 bands, etc.) — **still contextual** for retail TOU automation; retail TOU comparison c/kWh remain § BASE 1 RETAIL TOU COMPARISON.  

---

## Rate calculation (if not shown on invoice)

**Bundled**

`peak_rate_c_per_kwh = (peak_charges / peak_usage_kwh) * 100`

**Unbundled TOU**

Per period: energy charges ex GST ÷ period kWh × 100 — **retailer energy only**.

---

## Savings calculation (manual / narrative)

For components **outside** deterministic electricity rows:

1. Compare current rate to KB benchmark where applicable  
2. Annualize: `(period_usage / billing_days) * 365`  
3. **Base 1 retail TOU:** use **BASE 1 RETAIL TOU COMPARISON** (comparison c/kWh), **not** legacy bundled warning bands for automated outputs  

Example (illustrative peak excess vs a KB warning threshold — not the automated NSW 10/12 targets):

- Current: 33.5 c/kWh; KB warning: 32.0 c/kWh  
- Excess per kWh: (33.5 − 32.0) / 100  
- × annual peak kWh → annual $  

---

## Quality checklist

**Classification:** customer type; bundled/unbundled; 3- vs 2-period TOU; **state** on address  

**Data:** NMI length; rates extracted; shoulder null if 2-period; daily supply $/day; demand fields when C&I; **`site_address` includes state**  

**Benchmarking:** correct table for narrative context; Base 1 retail TOU uses § BASE 1 RETAIL TOU COMPARISON  

**Findings:** For **electricity** invoices in JSON tooling, **`low_hanging_fruit: []`** — server fills findings; potential savings format `"$X,XXX.XX/year"` where applicable elsewhere  
