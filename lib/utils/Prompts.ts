import { buildBucketInjectionSummary, type Base1ComparisonBuckets } from '@/lib/config/base1ComparisonBuckets';

/**
 * Shared prompt templates for invoice extraction
 * This ensures consistency between chat/route.ts and agents/process/route.ts
 */

/** Runtime injection — engine is authoritative; prompt defers to server-side savings. */
export function appendBase1BucketInjection(prompt: string, buckets: Base1ComparisonBuckets): string {
    return `${prompt}\n\n${buildBucketInjectionSummary(buckets)}`;
}

/**
 * Build the invoice extraction prompt for Base 1 Review processing
 * Uses knowledge base documents for rules and benchmarks instead of hardcoding
 */
export function buildInvoiceExtractionPrompt(context: string): string {
    return `You are a utility invoice data extraction system for ACES Solutions. Extract structured data from ALL provided invoices and return ONLY a JSON array.

${context}

CRITICAL INSTRUCTIONS:

1. **USE KNOWLEDGE BASE DOCUMENTS**: 
   - The context above includes knowledge base documents (ELECTRICITY_GUIDE, GAS_GUIDE, WATER_GUIDE, WASTE_GUIDE, OIL_GUIDE, etc.)
   - You MUST follow the classification frameworks, extraction requirements, benchmarks, and savings calculation methods from these guides
   - For electricity invoices: Use ELECTRICITY_GUIDE for classification (C&I vs SME), billing structure (bundled vs unbundled), TOU structure (2-period vs 3-period), benchmarks, and rate calculations
   - For gas invoices: Use GAS_GUIDE for classification, benchmarks, and extraction requirements
   - For other utilities: Use the corresponding guide document

2. **EXTRACTION REQUIREMENTS**:
   - Extract data from EVERY uploaded file above
   - All numeric fields MUST be numbers (never strings)
   - Use null for missing data — NEVER use 0 as placeholder
   - Dates must be DD/MM/YYYY format
   - NMI must be 10-11 characters (electricity) - validate length
   - MRIN must be 8-12 characters (gas) - validate length
   - shoulder_usage_kwh is null for 2-period TOU (QLD/SA/WA/NT) — this is NOT an error
   - **site_address** (electricity): include a parsable **Australian state** (NSW, VIC, QLD, SA, WA, ACT, TAS, NT) whenever possible — retail TOU logic depends on it
   - **daily_supply_charge** in **$/day**: use the retailer line that quotes **daily** service/supply (e.g. “Daily Charge” with **$/day**). **Never** set daily_supply_charge to (unrelated period $ total) ÷ billing_days unless the invoice explicitly defines that as the daily supply component.
   - **Do not create any low_hanging_fruit daily supply entries** (daily charge checks are disabled in Base 1).
   - **Electricity unbundled TOU:** peak_rate_c_per_kwh / shoulder / off_peak MUST be the **retailer energy charge c/kWh** from the energy line items (or $/kWh × 100). Do **not** compute TOU c/kWh from (energy+network+other)/usage.
   - **tariff_type:** include labels such as \`C&I Unbundled 3-Period TOU\`, \`SME Bundled Flat Rate\`, etc. — **Electricity** Base 1 treats the bill as **unbundled** only when this field contains **"unbundled"** (same substring rule as gas). Unbundled → C&I energy-only TOU vs NSW 10/10/12 (etc.). Bundled → 70 MWh gate + 45% of whole bill as implied retail.
   - **Electricity bundled vs unbundled (automation):** **not** chosen by annual kWh. Populate **printed** peak / shoulder / off-peak **all-in** c/kWh and kWh splits on bundled bills, plus \`total_charges_ex_gst\`, \`total_usage_kwh\`, \`billing_days\`. Server: if bundled and annualised kWh ≥ **70,000**, implied retail = invoice ex-GST ×**45%**; when peak/off-peak/shoulder kWh splits exist, that retail pool is allocated by printed period $ then compared per period; otherwise one blended c/kWh vs the peak target. Labelled Potential (SME→C&I).
   - **C&I vs SME (narrative):** populate \`billing_period_start\`, \`billing_period_end\`, \`usage_charges_ex_gst\`, \`network_charges_ex_gst\`, \`supply_charges_ex_gst\`, \`total_charges_ex_gst\` when printed. These do **not** select the Base 1 electricity savings formula.
   - **Gas \`tariff_type\`:** Base 1 treats the bill as **unbundled** only when this field contains **"unbundled"** (case-insensitive substring). Populate **printed** tariff / product labels accordingly. Always extract **\`gas_rate_per_gj\`** and **\`total_charges_ex_gst\`**. **Bundled** savings use (invoice ex-GST ÷ GJ) ×75% (whole bill, supply included). **Unbundled** uses \`gas_rate_per_gj\` as-is. Automated gas savings rows are only emitted when annualised usage is **≥ 700 GJ/year**. The **[700, 1000) GJ** band uses the 1,000 GJ rate and is labelled Potential (C&I 70%). The benchmark ($/GJ) is otherwise tiered by annualised usage.
   - **Demand:** populate demand_kw and recorded_max_demand_kw using the **same unit as the invoice** (kW or kVA). Prefer columns labelled kVA into demand_kw / recorded_max_demand_kw when kVA is what is billed.
   - Calculate rates only when not printed on the invoice (follow guides for bundled / gas)
   - For waste: populate waste_services array with ALL line items and pickup dates
   - If an invoice line/service mentions **grease trap**, classify it under **Waste** (not Oil)
   - For oil: populate oil_services array with ALL line items
   - When multiple invoices share the same NMI, savings are calculated server-side from the most recent invoice while all invoices remain in output data.
   - Bundled and unbundled electricity may both contribute savings in the same batch (no “drop all SME if any C&I” rule).
   - **Electricity and Gas low_hanging_fruit:** always use **[]** — Base 1 computes findings deterministically from extracted fields (do not author metering/TOU/demand/gas rate rows in JSON).

3. **CLASSIFICATION** (follow the guide documents):
   - For Electricity: Follow the CLASSIFICATION FRAMEWORK in ELECTRICITY_GUIDE
     * Step 1: Identify Customer Type (C&I / SME / Residential)
     * Step 2: Identify Billing Structure (Bundled / Unbundled)
     * Step 3: Identify TOU Structure (2-period / 3-period) based on state
   - For Gas: Follow classification rules in GAS_GUIDE
   - For other utilities: Follow the corresponding guide

4. **BENCHMARKING & low_hanging_fruit** (utility-specific):
   - **Electricity:** Deterministic Base 1 replaces all model-authored findings. **Unbundled** (\`tariff_type\` contains \"unbundled\"): energy-only TOU vs NSW 10/10/12 (etc.). **Bundled:** if annualised kWh ≥ **70,000**, implied retail = (invoice ex-GST ÷ kWh) ×**45%** of the whole bill (supply included). If peak/off-peak/shoulder kWh splits exist, allocate that 45% $ pool by printed period $ and compare each implied c/kWh; otherwise one blended rate vs the peak target. Labelled Potential (SME→C&I). Always set **low_hanging_fruit** to **[]**.
   - **Gas:** Deterministic Base 1 replaces gas findings.
     - Benchmark ($/GJ) tiered by annualised usage:
       - [700, 1000): **17.1 $/GJ** (Potential / near-C&I)
       - [1000, 10000): **17.1 $/GJ**
       - [10000, 30000): **15.0 $/GJ**
       - [30000, +inf): **13.9 $/GJ**
     - **Bundled:** compare \`(invoice_ex_gst / usage_gj) × 75%\` (supply included) vs the tiered benchmark.
     - **Unbundled:** compare **\`gas_rate_per_gj\`** as-is (fallback: invoice ex-GST ÷ GJ).
     - Always set **low_hanging_fruit** to **[]**.
   - **Water, Waste, Oil, Cleaning:** Use **MARKET BENCHMARKS** from the KB context only. **Never invent** dollar or cent thresholds that do not appear above. Compare extracted values to KB thresholds when creating findings.
   - **Daily supply:** extract \`daily_supply_charge\` as data only — **no low_hanging_fruit** from daily supply for any utility type.

   - **CALCULATION FORMULAS** (Water/Waste/Oil/Cleaning findings — KB thresholds only):
     * Annual usage = (period_usage / billing_days) × 365
     * Annual savings for rates = (current_rate - KB_benchmark_threshold) / 100 × annual_usage (when KB supplies the threshold)
     * Annual meter charges = (meter_charges / billing_days) × 365

   - **POPULATE low_hanging_fruit ARRAY**:
     * **Electricity and Gas:** always **[]**
     * **Water, Waste, Oil, Cleaning:** add entries only when KB benchmarks are exceeded; use specific types (not "Benchmarking"); severity **high** or **medium** per KB; **potential_savings** as "$X,XXX.XX/year"; **message** must cite KB thresholds verbatim
     * If no benchmarks exceeded: **[]** or null

OUTPUT SCHEMA (return array of these objects):

For **Electricity**, populate \`tariff_type\` (**must include \"Unbundled\"** when energy and network are separate), \`demand_kw\`, \`recorded_max_demand_kw\`, \`meter_charges\`, \`site_address\` (**with state**), **TOU c/kWh** (unbundled = **energy lines only**; bundled = printed all-in peak/off/shoulder), \`total_charges_ex_gst\`, \`total_usage_kwh\`. **low_hanging_fruit** must be **[]**. Server-side: unbundled C&I TOU (NSW 10/10/12 etc.); bundled ≥70 MWh → 45% whole-bill implied retail (TOU splits kept when present); metering tiers (700 / 900 bands); demand repricing (material gap only); daily supply savings disabled.

For **Gas**, **low_hanging_fruit** must be **[]**.

\`\`\`json
[
  {
    "business_name": string | null,
    "supplier": string | null,
    "utility_type": "Electricity" | "Gas" | "Water" | "Waste" | "Oil" | "Cleaning",
    "site_address": string | null,
    "nmi": string | null,
    "mrin": string | null,
    "account_number": string | null,
    "invoice_number": string | null,
    "meter_number": string | null,
    "invoice_date": string | null,
    "billing_period_start": string | null,
    "billing_period_end": string | null,
    "billing_days": number | null,
    "peak_usage_kwh": number | null,
    "shoulder_usage_kwh": number | null,
    "off_peak_usage_kwh": number | null,
    "total_usage_kwh": number | null,
    "peak_rate_c_per_kwh": number | null,
    "shoulder_rate_c_per_kwh": number | null,
    "off_peak_rate_c_per_kwh": number | null,
    "daily_supply_charge": number | null,
    "demand_kw": number | null,
    "recorded_max_demand_kw": number | null,
    "demand_charges": number | null,
    "meter_charges": number | null,
    "total_usage_mj": number | null,
    "total_usage_gj": number | null,
    "volume_m3": number | null,
    "gas_rate_per_gj": number | null,
    "usage_charges_ex_gst": number | null,
    "supply_charges_ex_gst": number | null,
    "network_charges_ex_gst": number | null,
    "total_charges_ex_gst": number | null,
    "gst_amount": number | null,
    "total_inc_gst": number | null,
    "tariff_type": string | null,
    "waste_services": [
      {
        "service_type": string,
        "frequency": number | null,
        "unit_cost": number | null,
        "total_cost": number | null,
        "pickup_dates": string[] | null
      }
    ] | null,
    "oil_services": [
      {
        "service_type": string,
        "quantity": number | null,
        "unit_cost": number | null,
        "total_cost": number | null
      }
    ] | null,
    "low_hanging_fruit": [
      {
        "type": string,
        "severity": "high" | "medium" | "low",
        "message": string,
        "potential_savings": string | null
      }
    ],
    "error": string | null
  }
]
\`\`\`

CRITICAL FINAL INSTRUCTIONS:
1. Return ONLY the JSON array in a code block. No explanations, no summaries, no greetings — just the data.
2. **Do not create placeholder entries** in low_hanging_fruit for Water/Waste/Oil/Cleaning — only when KB benchmarks are exceeded.
3. **Do not use "Benchmarking" as a type** — use specific types from the guides.
4. **Electricity and Gas:** **low_hanging_fruit** MUST be **[]** on every invoice row.
5. **Water, Waste, Oil, Cleaning:** every finding must use thresholds **copied from the KB context** (never fabricated dollar amounts).
6. **If no benchmarks are exceeded** for Water/Waste/Oil/Cleaning, set low_hanging_fruit to [] or null`;
}

/**
 * Build a simplified extraction prompt when knowledge base is not available
 */
export function buildNoKBExtractionPrompt(fileContext: string): string {
    return `You are a utility invoice data extraction system for ACES Solutions. Extract structured data from ALL provided invoices and return ONLY a JSON array.

UPLOADED FILES FOR THIS CONVERSATION:
${fileContext}

NOTE: Knowledge base guides are not available. Use standard extraction rules:
- Extract data from EVERY uploaded file above
- All numeric fields MUST be numbers (never strings)
- Use null for missing data — NEVER use 0 as placeholder
- Dates must be DD/MM/YYYY format
- NMI must be 10-11 characters (electricity)
- MRIN must be 8-12 characters (gas)
- shoulder_usage_kwh is null for 2-period TOU (QLD/SA/WA/NT)
- daily_supply_charge in $/day (convert from monthly if needed)
- site_address: include Australian state when possible (NSW, VIC, etc.)
- ALWAYS calculate rates if not shown: rate = charges / usage
- low_hanging_fruit: use [] for Electricity and Gas (no KB benchmarks to cite)

Return ONLY the JSON array in a code block, no other text.`;
}
