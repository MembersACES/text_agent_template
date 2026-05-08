# WASTE ANALYSIS GUIDE — ACES Solutions

**Version:** 3.2 (Doc copy in repo) — Text Agent  
**Last updated (source KB):** February 2026  
**Doc sync:** May 2026  

---

## Usage instructions

1. Identify bin types and sizes  
2. Extract **pickup dates** for each service where possible  
3. Calculate bin utilization if data is available  
4. Check for multiple providers at the same site  
5. Apply benchmarks from **indexed KB** content — do not invent thresholds  
6. **Grease trap** services: classify as **Waste** (not Oil), per ACES extraction rules  

---

## Bin types and specifications

**Front lift bins**

- Steel bins, colour-coded by waste type  
- Suitable for large storage areas  
- Common sizes: **1.5 M3, 2.8 M3, 3 M3, 4.5 M3, 6 M3**  

**Rear lift bins**

- Plastic wheelie bins  
- Suitable for limited storage  
- Common sizes: **120 L, 240 L, 360 L, 660 L, 1100 L**  

---

## Data extraction requirements (JSON)

| Field | Notes |
|--------|--------|
| `utility_type` | `"Waste"` |
| `account_number`, `site_address` | As on invoice |
| `waste_services` | Array |
| `waste_services[].service_type` | e.g. `"3M3 Frontlift General"` |
| `waste_services[].frequency` | Collections per period (**number \| null** in schema) |
| `waste_services[].unit_cost`, `total_cost` | number \| null |
| `waste_services[].pickup_dates` | `DD/MM/YYYY` array when available |
| `low_hanging_fruit` | KB-backed findings when benchmarks exceeded  

---

## Pickup date extraction

**Priority**

1. Explicit dates on invoice — extract exactly  
2. Schedule pattern — derive from billing period  
3. Frequency only — derive evenly spaced dates if appropriate  
4. No data — `pickup_dates` may be omitted or empty  

---

## Benchmarks and trigger conditions

**Bin utilization**

- **<50%** utilised → high — oversized bin  
- **50–70%** → optimal  
- **70–95%** → acceptable  
- **>95%** → medium — undersized bin  

**Collection frequency**

- **>12 collections/month** with **<70%** utilisation → medium  
- Multiple providers at same site → high  

---

## Savings patterns (reference)

| Pattern | Trigger | Typical severity | Typical savings band |
|---------|---------|------------------|------------------------|
| Oversized bins | Utilization **<50%** | High | 20–40% of bin service costs |
| High collection frequency | **>12**/month with **<70%** utilisation | Medium | 15–25% of service costs |
| Multiple providers | **>1** provider at same site | High | 10–15% consolidation |

---

## Quality checklist

- [ ] All `waste_services` entries populated  
- [ ] Pickup dates extracted or inferred per rules  
- [ ] Bin sizes identified  
- [ ] Utilization calculated when data allows  
- [ ] Multiple providers detected  
- [ ] Frequency analysis performed  

---

## Alignment with the Base 1 app (this repository)

| Topic | Guideline |
|--------|-----------|
| **Excel “Waste Data”** | Uses service-level rows with ex-GST / GST / inc-GST where breakdown exists (`ExcelGeneratorService`). |
| **Benchmark groups** | Waste oil / waste rows in **Base 1 Analysis** can be **hidden for member reports** via `hideWasteForMemberReport` in `getBase1BenchmarkGroups` — export variant, not a KB change. |
| **Findings** | Waste remains **`low_hanging_fruit` from extraction**, compared to KB thresholds (not deterministic like electricity/gas). |
| **Indexed KB** | Live behaviour follows **WASTE_GUIDE** chunks after indexing; keep Drive source and this Doc mirror aligned. |
