# GAS ANALYSIS GUIDE — ACES Solutions

**Version:** 3.2 (Doc copy in repo) — Text Agent  
**Last updated (source KB):** February 2026  
**Doc sync:** May 2026  

---

## Usage instructions

1. Follow **extraction** steps (MRIN, usage, charges, `tariff_type`, `gas_rate_per_gj`, daily supply as data).  
2. Use the **classification framework below** for **customer narrative and context** (Large C&I / C&I / SME / Residential).  
3. For **Base 1 automated savings**, use **bundled vs unbundled** from `tariff_type` and the **server-side rules** in the alignment section — **not** the legacy “excess rate vs SME/C&I band” worked example by itself.  

---

## Classification framework (context / narrative)

**Large C&I**

- Annual consumption **≥ 10,000 GJ**  
- Industrial premises (factory, hospital)  

**C&I**

- Annual consumption **1,000–10,000 GJ**  
- Commercial premises (hotel, large office)  

**SME**

- Annual consumption **100–1,000 GJ**  
- Small commercial (restaurant, small office)  

**Residential**

- Annual consumption **< 100 GJ**  

> **Important:** These **GJ bands do not select** the automated Base 1 gas formula. They remain useful for prose and for comparing against the **market benchmark tables** below as **context**, not as the deterministic savings engine.

---

## Bundled vs unbundled (Base 1 automation)

- **Unbundled:** `tariff_type` contains the substring **“unbundled”** (case-insensitive).  
- **Bundled:** otherwise (including missing/blank labels — extraction should still aim to label correctly).  

**Automated savings (implemented in `DeterministicSavingsService`):**

- Annualised usage must be **≥ 700 GJ/year** (otherwise no gas savings row).
- **Near-C&I [700, 1000) GJ/year:** same **17.1 $/GJ** as the 1,000 GJ C&I tier (70% of the C&I usage cut). Included in Expected/Conservative totals; labelled **Potential (C&I 70%)** on email and Base 1 Analysis.
- **Bundled** (no “unbundled” in `tariff_type`): **`(invoice ex-GST ÷ period GJ) × 75%`** — whole bill including supply. Do **not** strip daily supply or use `gas_rate_per_gj` for the comparison (`gas_rate_per_gj` remains a data field).
- **Unbundled:** compare `gas_rate_per_gj` (or usage charges ÷ GJ, or invoice ex-GST ÷ GJ) as-is.
- Tiered benchmark (annualised usage):
  - [700, 1000): **17.1 $/GJ** (Potential / near-C&I)
  - [1000, 10000): **17.1 $/GJ**
  - [10000, 30000): **15.0 $/GJ**
  - [30000, +inf): **13.9 $/GJ**
  (thresholds **>$200/year** etc. apply on the server).

**Daily supply:** extract `daily_supply_charge` ($/day) as data only — **no** Base 1 gas savings row from daily supply.

---

## Data extraction requirements

**Critical fields**

| Field | Notes |
|--------|--------|
| `mrin` | string, **8–12 characters** — validate length |
| `account_number` | string |
| `total_usage_mj`, `total_usage_gj` | **GJ = MJ ÷ 1000** |
| `volume_m3` | number \| null |
| `gas_rate_per_gj` | **Always extract or calculate** (usage charges excl. supply ÷ GJ) — preferred input for Base 1 gas savings even on bundled retail plans |
| `daily_supply_charge` | $/day |
| `tariff_type` | Must include **“Unbundled”** when the bill is unbundled (substring match drives automation) |
| `low_hanging_fruit` | Use **`[]`** in extraction JSON — **gas findings are computed deterministically** after extraction |

---

## Rate calculation (when not shown)

```
gas_rate_per_gj = usage_charges_ex_gst / total_usage_gj
```

**Example**

- Usage charges: **$4,793.10**  
- Consumption: **245.8 GJ**  
- Rate: **$4,793.10 / 245.8 = $19.50/GJ**  

---

## Market benchmarks — Victoria 2026 (narrative / severity bands)

These bands are **contextual** (messaging, non-automated review). **Automated Base 1 gas** uses the **tiered** benchmark above (17.1 / 15.0 / 13.9 $/GJ).

**Large C&I gas rates**

- Gas rate: **$15.50–$17.50/GJ** — medium if **>$16.50/GJ**, high if **>$17.50/GJ**  
- Daily supply: **$1.50–$2.00/day** — medium if **>$1.50/day**, high if **>$2.00/day**  

**C&I gas rates**

- Gas rate: **$16.50–$19.00/GJ** — medium if **>$18.00/GJ**, high if **>$19.00/GJ**  
- Daily supply: **$1.00–$1.50/day** — medium if **>$1.20/day**, high if **>$1.50/day**  

**SME gas rates**

- Gas rate: **$18.00–$20.50/GJ** — medium if **>$19.50/GJ**, high if **>$20.50/GJ**  
- Daily supply: **$0.90–$1.20/day** — medium if **>$1.00/day**, high if **>$1.20/day**  

**Residential gas rates**

- Gas rate: **$18.50–$22.00/GJ** — medium if **>$20.50/GJ**, high if **>$22.00/GJ**  
- Daily supply: **$0.70–$0.90/day** — medium if **>$0.75/day**, high if **>$0.90/day**  

---

## Legacy worked example (manual / training only)

The following **does not** replace server-side Base 1 gas:

```
excess_rate = current_rate - warning_threshold
annual_usage = (total_usage_gj / billing_days) * 365
annual_savings = excess_rate * annual_usage
```

**Example (old C&I framing):** current **$19.50/GJ**, threshold **$18.00/GJ**, excess **$1.50/GJ**, annual usage **2,894 GJ** → **$4,341/year**.  

Use this style only for **manual** checks; automated exports use **bundled vs unbundled** and the **tiered** $/GJ benchmark.

---

## Quality checklist

- [ ] MRIN validated (8–12 characters)  
- [ ] Customer segment understood for narrative (GJ framework)  
- [ ] **Bundled vs unbundled** reflected in `tariff_type`  
- [ ] Usage in GJ (converted from MJ if needed)  
- [ ] Rate extracted or calculated  
- [ ] Daily supply in $/day  
- [ ] `low_hanging_fruit` left **`[]`** for gas in extraction output  

---

## Alignment with the Base 1 app (this repository)

| Original KB instruction | Update |
|-------------------------|--------|
| “Populate `low_hanging_fruit` array” for gas | **Incorrect for this app.** Extraction must use **`[]`**; `DeterministicSavingsService` adds gas findings. |
| Savings from SME/C&I benchmark tables | **Not** how automated savings are calculated. Bands are **narrative**; automation uses the **tiered** $/GJ benchmark (17.1 / 15.0 / 13.9), **bundled (invoice ex-GST ÷ GJ) ×75%**, **≥ 700 GJ/year gate**, and **[700, 1000) near-C&I** labelled Potential (C&I 70%). |
| Customer size by annual GJ | Still valid for **human classification** and tables — **does not** switch bundled vs unbundled. |
