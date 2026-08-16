# OIL ANALYSIS GUIDE — ACES Solutions

**Version:** 3.2 (Doc copy in repo) — Text Agent  
**Last updated (source KB):** February 2026  
**Doc sync:** May 2026  

---

## Usage instructions

1. Identify service types  
2. Extract quantities and unit costs  
3. Analyze service frequency (where line items support it)  
4. Apply benchmarks from this guide **only when they appear in the indexed knowledge base context** used for extraction — do not invent dollar thresholds that are not in the KB  

---

## Data extraction requirements (JSON / tool output)

Align with the app schema (`ExtractedInvoice`):

| Field | Notes |
|--------|--------|
| `utility_type` | `"Oil"` |
| `account_number`, `site_address`, `invoice_number`, `supplier` | As on invoice |
| `oil_services` | Array of line items |
| `oil_services[].service_type` | string |
| `oil_services[].quantity` | number \| null |
| `oil_services[].unit_cost` | number \| null |
| `oil_services[].total_cost` | number \| null |
| Cost totals at invoice level | `usage_charges_ex_gst`, `total_charges_ex_gst`, `gst_amount`, `total_inc_gst` as applicable |
| `low_hanging_fruit` | Populate from **KB benchmarks** when exceeded; severity and messages must cite KB thresholds (see Base 1 agent prompt) |

---

## Service types (reference)

- Waste Oil Collection  
- Grease Trap Service — **if the line is grease-trap related, classify under Waste, not Oil** (ACES extraction rule)  
- Oil Delivery (cooking oil, fuel)  
- Oil Filter Replacement  

---

## Benchmarks — Victoria 2026 (typical ranges)

**Typical service costs**

- Waste Oil Collection: **$50–$100** per service  
- Grease Trap Service: **$150–$300** per service  
- Flag if unit costs exceed typical range by **>20%** (when using this guide as the KB source for that analysis)  

---

## Quality checklist

- [ ] All `oil_services` entries populated where the invoice has a breakdown  
- [ ] Service types identified  
- [ ] Quantities extracted  
- [ ] Unit costs captured  
- [ ] Frequency / pattern analyzed when data allows  

---

## Alignment with the Base 1 app (this repository)

| Topic | Guideline |
|--------|-----------|
| **Grease trap** | Product rule: grease trap services belong under **`utility_type: "Waste"`**, not Oil. This guide’s list should not override that. |
| **`low_hanging_fruit`** | Oil/Cleaning-style findings are **model-issued from KB benchmarks** in extraction — not replaced by a deterministic TypeScript calculator (unlike electricity/gas). |
| **Excel “Oil Data” sheet** | Workbook columns: Invoice Date, Invoice Number, Supplier, Site Address, Service Type, Quantity, Unit Cost, ex-GST, GST, inc GST (per `ExcelGeneratorService`). |
| **Benchmarks in production** | Whatever is **indexed in GCS KB** for `OIL_GUIDE` is authoritative at runtime. This file is the Doc mirror; keep KB text in sync when benchmarks change. |
