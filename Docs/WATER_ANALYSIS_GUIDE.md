# WATER ANALYSIS GUIDE — ACES Solutions

**Version:** 3.2 (Doc copy in repo) — Text Agent  
**Last updated (source KB):** February 2026  
**Doc sync:** May 2026  

---

## Usage instructions

1. Extract volume (see schema: `volume_m3` in **cubic metres**; **kL = m³** numerically for water, i.e. 1 m³ = 1 kL)  
2. Derive **cost per kL** for analysis where totals and volume support it  
3. Check for trade waste charges  
4. Apply benchmarks from this guide when present in the indexed KB context  

---

## Data extraction requirements

Minimum fields called out in the original KB, extended to match the app:

| Field | Notes |
|--------|--------|
| `utility_type` | `"Water"` |
| `account_number`, `site_address`, `supplier`, `invoice_number` | As on invoice |
| `volume_m3` | number — **cubic metres** (1 m³ = 1 kL) |
| `usage_charges_ex_gst`, `total_charges_ex_gst` | As extracted |
| `billing_days`, `tariff_type`, meter fields | Populate when present for downstream use (even if Excel summary is minimal) |

---

## Tier structure (reference)

Water is often charged in tiers:

- **Tier 1:** 0–50 kL (lowest rate)  
- **Tier 2:** 50–100 kL (medium rate)  
- **Tier 3:** 100+ kL (highest rate)  

---

## Benchmarks — Victoria 2026

**Average water costs (illustrative — use KB-indexed text for automated messaging)**

- Tier 1: **$2.50–$3.50 / kL**  
- Tier 2: **$3.00–$4.00 / kL**  
- Tier 3: **$3.50–$4.50 / kL**  

**Trade waste**

- Should be **<50%** of total water bill  
- If **>50%** → treat as **medium** severity flag in narrative/benchmark style (when this guide is the KB source)  

---

## Quality checklist

- [ ] Volume captured (`volume_m3` / kL consistent with invoice)  
- [ ] Cost per kL calculated when possible  
- [ ] Trade waste identified if present  
- [ ] Supplier identified  

---

## Alignment with the Base 1 app (this repository)

| Topic | Guideline |
|--------|-----------|
| **m³ × 1000 → kL** | The original KB line “m³ × 1000” applies when converting **litres** or non-standard units — for standard water billing, **1 m³ = 1 kL**. Use invoice units carefully. |
| **Excel “Water Data” sheet** | Currently outputs: Invoice Date, Supplier, Site Address, **Usage (kL)**, Total (inc GST) — the code passes **`volume_m3`** into the usage column; ensure extraction stores the value the retailer means (m³ vs kL) consistently. **Worth validating** against real bills if headers should read “m³” instead of “kL”. |
| **`low_hanging_fruit`** | Water findings are **KB-driven** in extraction (not deterministic electricity/gas). |
| **Indexed KB** | Runtime prompts use whatever is in **WATER_GUIDE** chunks in GCS; update the Drive/KB document when Victoria 2026 bands change, then re-index. |
