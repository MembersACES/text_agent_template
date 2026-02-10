/**
 * Agent Process API
 * 
 * This endpoint processes multiple invoice files and returns an Excel report.
 * It combines file upload, invoice extraction, and report generation into a single API call.
 * 
 * Supports TWO formats:
 * 1. Multipart form-data (standard file upload)
 * 2. JSON with base64-encoded files (n8n-friendly)
 * 
 * Usage:
 * POST /api/agents/process
 * 
 * Format 1 - Multipart Form-Data:
 * Content-Type: multipart/form-data
 * - files: File[] (multiple files can be uploaded)
 * - agentId: string (optional, e.g., 'base-1-review')
 * 
 * Format 2 - JSON with Base64:
 * Content-Type: application/json
 * {
 *   "files": [
 *     {
 *       "fileName": "invoice1.pdf",
 *       "mimeType": "application/pdf",
 *       "dataBase64": "base64-encoded-file-content"
 *     }
 *   ],
 *   "agentId": "base-1-review" // optional
 * }
 * 
 * Returns:
 * - Excel file (.xlsx) as binary response with Content-Disposition header
 * 
 * Example (curl - multipart):
 * curl -X POST http://localhost:3000/api/agents/process \
 *   -F "files=@invoice1.pdf" \
 *   -F "files=@invoice2.pdf" \
 *   -F "agentId=base-1-review" \
 *   --output report.xlsx
 * 
 * Example (curl - JSON):
 * curl -X POST http://localhost:3000/api/agents/process \
 *   -H "Content-Type: application/json" \
 *   -d '{"files":[{"fileName":"invoice1.pdf","mimeType":"application/pdf","dataBase64":"..."}],"agentId":"base-1-review"}' \
 *   --output report.xlsx
 * 
 * Example (JavaScript - multipart):
 * const formData = new FormData();
 * formData.append('files', file1);
 * formData.append('files', file2);
 * formData.append('agentId', 'base-1-review');
 * 
 * const response = await fetch('/api/agents/process', {
 *   method: 'POST',
 *   body: formData
 * });
 * 
 * Example (JavaScript - JSON):
 * const response = await fetch('/api/agents/process', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({
 *     files: [
 *       { fileName: 'invoice1.pdf', mimeType: 'application/pdf', dataBase64: base64String }
 *     ],
 *     agentId: 'base-1-review'
 *   })
 * });
 */

import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { generateBase1Workbook } from '@/lib/excel-generator';
import { generateReportEmail } from '@/lib/email-generator';
import { getPromptConfig } from '@/lib/gcs-client';
import { getSystemSettings } from '@/lib/gcs-client';
import { getPromptTemplate } from '@/lib/gcs-client';
import { generateEmbedding } from '@/lib/embeddings';
import { getCachedKnowledgeBase } from '@/lib/knowledge-base-storage';
import { findSimilarChunks } from '@/lib/document-chunker';
import { ExtractedInvoice, BusinessInfo, ReportData, calculateSavingsSummary } from '@/lib/report-types';
import {
    listFilesInFolder,
    downloadDriveFile,
    fetchGoogleDoc,
    fetchGoogleSheet
} from '@/lib/document-fetcher';

interface ProcessedFile {
    name: string;
    content: string;
    mimeType: string;
}

/**
 * Process a single file - extract text content
 * Reuses logic from /api/uploads
 */
async function processFile(file: File): Promise<ProcessedFile> {
    const fileName = file.name || 'uploaded-file';
    const mimeType = file.type || 'application/octet-stream';

    // Check if file type is allowed
    const allowed =
        mimeType.startsWith('text/') ||
        mimeType.startsWith('image/') ||
        mimeType === 'application/json' ||
        mimeType === 'application/pdf' ||
        mimeType === 'application/msword' ||
        mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mimeType === 'application/vnd.ms-excel' ||
        mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    if (!allowed) {
        throw new Error(`Unsupported file type: ${mimeType}`);
    }

    // Check if file is text-based
    const isTextBased = mimeType.startsWith('text/') ||
        mimeType === 'application/json' ||
        mimeType === 'text/csv' ||
        fileName.endsWith('.md') ||
        fileName.endsWith('.txt') ||
        fileName.endsWith('.csv') ||
        fileName.endsWith('.json');

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    let content: string;

    if (isTextBased) {
        content = fileBuffer.toString('utf-8');
    } else {
        // Binary files: use Gemini Vision to extract text
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY not configured');
        }

        const base64Data = fileBuffer.toString('base64');
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        const result = await model.generateContent([
            {
                inlineData: {
                    mimeType: mimeType,
                    data: base64Data,
                },
            },
            {
                text: `Extract ALL text from this document exactly as written. 
Include every number, date, address, account number, rate, charge, and total.
Preserve the structure (tables, sections, line items).
If this is an invoice, make sure to capture:
- Business name, supplier, account numbers
- All usage figures and rates
- All charges and totals
- Dates, billing periods, meter numbers
Return ONLY the extracted text, no commentary.`
            },
        ]);

        const response = await result.response;
        content = response.text();
        console.log(`[Agent Process API] Extracted ${content.length} chars from ${fileName} (${mimeType})`);
        console.log(`[Agent Process API] Preview: ${content.substring(0, 200)}...`);
    }

    if (!content || !content.trim()) {
        throw new Error('File is empty or could not be read');
    }

    console.log(`[Agent Process API] Successfully processed ${fileName}: ${content.length} characters`);

    return {
        name: fileName,
        content,
        mimeType,
    };
}

/**
 * Call chat API logic internally to process invoices
 * This replicates the chat API logic but without making an HTTP call
 */
async function processInvoicesWithChat(
    files: ProcessedFile[],
    agentId?: string
): Promise<ExtractedInvoice[]> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY not configured');
    }

    // Build file context from uploaded files
    const TOTAL_FILE_BUDGET = 200000; // 200K chars for all uploaded files combined
    const maxLengthPerFile = Math.max(
        4000, // minimum per file
        Math.floor(TOTAL_FILE_BUDGET / files.length)
    );

    const fileContext = files
        .map((f, i) => {
            let content = f.content;
            if (content.length > maxLengthPerFile) {
                content = content.substring(0, maxLengthPerFile) + '\n\n[... content truncated for length ...]';
            }
            return `Uploaded File ${i + 1}: ${f.name}\n${content}`;
        })
        .join('\n\n---\n\n');

    // Get system prompt and agent-specific prompt
    const systemSettings = await getSystemSettings();
    const agentPrompt = await getPromptTemplate(agentId);
    const fullPrompt = `${systemSettings.globalSystemPrompt}\n\n---\n\n${agentPrompt}`;

    // Check if knowledge base should be used
    const config = await getPromptConfig(agentId);
    const useKnowledgeBase = true; // Always use KB if available

    let finalMessage = '';
    let kbContext = '';

    if (useKnowledgeBase) {
        const kb = await getCachedKnowledgeBase(agentId);
        if (kb) {
            const message = 'Run these invoices for a Base 1 Review';
            let similarChunks: any[] = [];
            let useKBContext = false;

            // Try to get embeddings, but don't fail if embedding model is unavailable
            try {
                const queryEmbedding = await generateEmbedding(message);
                similarChunks = findSimilarChunks(queryEmbedding, kb.chunks, 3);
                useKBContext = true;
            } catch (embeddingError: any) {
                // Embedding model not available - skip KB context entirely
                console.warn(`[Agent Process API] Embedding generation failed (${embeddingError.message}), skipping KB context and using only uploaded files`);
                useKBContext = false;
                similarChunks = [];
            }

            // Only use KB context if embeddings worked
            if (useKBContext && similarChunks && similarChunks.length > 0) {
                kbContext = similarChunks
                    .map((chunk: any, i: number) => {
                        const sourceInfo = chunk.source ? ` (File: ${chunk.source})` : '';
                        return `[Source ${i + 1}${sourceInfo}]:\n${chunk.text}`;
                    })
                    .join('\n\n---\n\n');
            }

            // Build context - only include KB if embeddings worked
            const combinedContextParts = [];

            if (useKBContext) {
                // Build file list metadata only if KB is working
                let fileListContext = '';
                if (kb.fileMetadata && Object.keys(kb.fileMetadata).length > 0) {
                    const fileList = Object.entries(kb.fileMetadata)
                        .map(([id, meta]: [string, any]) => {
                            const fileName = meta.name || 'Unknown File';
                            const chunkCount = meta.chunkCount || 0;
                            return `- ${fileName} (${chunkCount} chunks)`;
                        })
                        .join('\n');
                    fileListContext = `KNOWLEDGE BASE FILES AVAILABLE:\n${fileList}\n\n`;
                }

                if (fileListContext) {
                    combinedContextParts.push(fileListContext);
                }
                if (kbContext) {
                    combinedContextParts.push(`RELEVANT CONTENT FROM KNOWLEDGE BASE:\n${kbContext}`);
                }
            }

            combinedContextParts.push(`UPLOADED FILES FOR THIS CONVERSATION:\n${fileContext}`);

            const combinedContext = combinedContextParts.join('\n\n---\n\n');

            // Dedicated extraction prompt for batch processing
            finalMessage = `You are a utility invoice data extraction system for ACES Solutions. Extract structured data from ALL provided invoices and return ONLY a JSON array.

${combinedContext}

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
   - daily_supply_charge in $/day (convert from monthly if needed)
   - ALWAYS calculate rates if not shown: rate = charges / usage (follow rate calculation methods from the guides)
   - For waste: populate waste_services array with ALL line items and pickup dates
   - For oil: populate oil_services array with ALL line items

3. **CLASSIFICATION** (follow the guide documents):
   - For Electricity: Follow the CLASSIFICATION FRAMEWORK in ELECTRICITY_GUIDE
     * Step 1: Identify Customer Type (C&I / SME / Residential)
     * Step 2: Identify Billing Structure (Bundled / Unbundled)
     * Step 3: Identify TOU Structure (2-period / 3-period) based on state
   - For Gas: Follow classification rules in GAS_GUIDE
   - For other utilities: Follow the corresponding guide

4. **BENCHMARKING & SAVINGS** (MANDATORY - use values from knowledge base):
   - **YOU MUST CHECK EVERY BENCHMARK** from the MARKET BENCHMARKS section in the guide document
   - Apply the correct benchmark table based on: customer type + billing structure + TOU structure
   - **FOR EACH INVOICE, CHECK ALL OF THESE:**
     
     a) **RATE BENCHMARKS** (from guide):
        - Peak rate: Compare peak_rate_c_per_kwh to benchmark (e.g., C&I: 🟡 >32 c/kWh, 🔴 >35 c/kWh)
        - Shoulder rate: Compare shoulder_rate_c_per_kwh (if 3-period TOU)
        - Off-peak rate: Compare off_peak_rate_c_per_kwh
        - Gas rate: Compare gas_rate_per_gj (for gas invoices)
        - Calculate savings: (current_rate - warning_threshold) / 100 × annual_usage
     
     b) **DAILY SUPPLY CHARGE** (from guide):
        - Compare daily_supply_charge directly to benchmark (e.g., C&I: 🟡 >$4.00/day, 🔴 >$5.00/day)
        - Calculate savings: (current_daily_supply - warning_threshold) × 365
     
     c) **METER CHARGES** (CRITICAL - MUST CHECK):
        - Step 1: Calculate annual meter charges = (meter_charges / billing_days) × 365
        - Step 2: Compare annual meter charges to benchmark from guide:
          * C&I: 🟡 >$1,000/year, 🔴 >$1,200/year
          * SME: 🟡 >$800/year, 🔴 >$900/year
        - Step 3: If exceeds threshold, calculate savings = annual_meter_charges - warning_threshold
        - Step 4: Add to low_hanging_fruit with type: "High Meter Charges"
        - Example: If meter_charges = $132.49, billing_days = 31:
          * Annual = ($132.49 / 31) × 365 = $1,560/year
          * Exceeds C&I 🔴 threshold of $700/year
          * Savings = $1,560 - $700 = $860/year
          * Add: { type: "High Meter Charges", severity: "high", message: "Annual meter charges $1,560/year exceed benchmark", potential_savings: "$560/year" }
     
     d) **DEMAND CHARGES** (C&I only, if present):
        - Annualize: (demand_charges / billing_days) × 365
        - Compare to benchmark (e.g., 🟡 >$15/kVA/month, 🔴 >$18/kVA/month)
   
   - **CALCULATION FORMULAS** (from guide):
     * Annual usage = (period_usage / billing_days) × 365
     * Annual savings for rates = (current_rate - warning_threshold) / 100 × annual_usage
     * Annual meter charges = (meter_charges / billing_days) × 365
     * Annual demand charges = (demand_charges / billing_days) × 365
   
   - **POPULATE low_hanging_fruit ARRAY**:
     * For EVERY finding that exceeds benchmarks, add an entry
     * Use severity: "high" for 🔴, "medium" for 🟡
     * Include potential_savings in format "$X,XXX.XX/year"
     * Only include if savings >$200/year
     * Example types: "High Peak Rate", "High Meter Charges", "High Daily Supply", "High Demand Charges", "High Gas Rate"

OUTPUT SCHEMA (return array of these objects):

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

CRITICAL: Return ONLY the JSON array in a code block. No explanations, no summaries, no greetings — just the data.`;
        } else {
            // No KB, just use uploaded files
            finalMessage = `You are a utility invoice data extraction system for ACES Solutions. Extract structured data from ALL provided invoices and return ONLY a JSON array.

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
- ALWAYS calculate rates if not shown: rate = charges / usage

Return ONLY the JSON array in a code block, no other text.`;
        }
    } else {
        finalMessage = `You are a utility invoice data extraction system for ACES Solutions. Extract structured data from ALL provided invoices and return ONLY a JSON array.

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
- ALWAYS calculate rates if not shown: rate = charges / usage

Return ONLY the JSON array in a code block, no other text.`;
    }

    // Initialize Gemini AI
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: {
            maxOutputTokens: 65536,
            temperature: 0.1,
        },
    });

    // Generate response
    const result = await model.generateContent(finalMessage);
    const response = await result.response;
    const text = response.text();

    console.log(`[Agent Process API] Gemini response length: ${text.length} characters`);
    console.log(`[Agent Process API] Response preview: ${text.substring(0, 500)}...`);

    // Extract JSON from response
    let extractedData: ExtractedInvoice[] = [];
    const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
    const jsonBlockMatches = [...text.matchAll(jsonBlockRegex)];

    console.log(`[Agent Process API] Found ${jsonBlockMatches.length} JSON blocks in response`);

    if (jsonBlockMatches.length > 0) {
        try {
            const parsedBlocks = jsonBlockMatches
                .map(match => {
                    try {
                        let jsonContent = match[1].trim();

                        if (!jsonContent.startsWith('{') && !jsonContent.startsWith('[')) {
                            const jsonObjectMatch = jsonContent.match(/\{[\s\S]*\}/);
                            const jsonArrayMatch = jsonContent.match(/\[[\s\S]*\]/);

                            if (jsonObjectMatch) {
                                jsonContent = jsonObjectMatch[0];
                            } else if (jsonArrayMatch) {
                                jsonContent = jsonArrayMatch[0];
                            } else {
                                return null;
                            }
                        }

                        try {
                            return JSON.parse(jsonContent);
                        } catch (parseError) {
                            const startChar = jsonContent[0];
                            const endChar = startChar === '{' ? '}' : ']';

                            let depth = 0;
                            let jsonStart = -1;
                            let jsonEnd = -1;

                            for (let i = 0; i < jsonContent.length; i++) {
                                if (jsonContent[i] === startChar) {
                                    if (jsonStart === -1) jsonStart = i;
                                    depth++;
                                } else if (jsonContent[i] === endChar) {
                                    depth--;
                                    if (depth === 0 && jsonStart !== -1) {
                                        jsonEnd = i;
                                        break;
                                    }
                                }
                            }

                            if (jsonStart !== -1 && jsonEnd !== -1) {
                                const extractedJson = jsonContent.substring(jsonStart, jsonEnd + 1);
                                return JSON.parse(extractedJson);
                            }

                            throw parseError;
                        }
                    } catch (e) {
                        console.error('Failed to parse JSON block:', e);
                        return null;
                    }
                })
                .filter(block => block !== null);

            if (parsedBlocks.length > 0) {
                extractedData = parsedBlocks.length === 1
                    ? (Array.isArray(parsedBlocks[0]) ? parsedBlocks[0] : [parsedBlocks[0]])
                    : parsedBlocks;
            }
        } catch (e) {
            console.error('Failed to parse extracted JSON:', e);
        }
    }

    if (extractedData.length === 0) {
        throw new Error('No invoice data could be extracted from the uploaded files. Please ensure the files contain valid invoice information.');
    }

    return extractedData;
}


// Add GET handler for testing/debugging
export async function GET() {
    return NextResponse.json({
        message: 'Agent Process API is available',
        endpoint: '/api/agents/process',
        method: 'POST',
        description: 'Upload invoice files and receive Excel report',
    });
}

/**
 * Convert base64 string to File object (Node.js compatible)
 */
function base64ToFile(base64Data: string, fileName: string, mimeType: string): File {
    // Remove data URL prefix if present (e.g., "data:image/png;base64,")
    const base64Content = base64Data.includes(',')
        ? base64Data.split(',')[1]
        : base64Data;

    // Convert base64 to Uint8Array
    const buffer = Buffer.from(base64Content, 'base64');
    const uint8Array = new Uint8Array(buffer);

    // Create File object (File constructor is available in Next.js runtime)
    return new File([uint8Array], fileName, { type: mimeType });
}

export async function POST(request: Request) {
    try {
        const contentType = request.headers.get('content-type') || '';
        let files: File[] = [];
        let agentId: string | undefined;

        // Extract folder ID if provided
        let googleDriveFolderId: string | undefined;

        // Check if request is JSON (base64 files) or multipart form-data
        if (contentType.includes('application/json')) {
            // JSON payload with base64 files (n8n-friendly)
            const body = await request.json();
            agentId = body.agentId || body.agentid || undefined; // Support both camelCase and lowercase
            googleDriveFolderId = body.googleDriveFolderId || body.googledrivefolderid || undefined;

            if (!googleDriveFolderId && (!body.files || !Array.isArray(body.files) || body.files.length === 0)) {
                return NextResponse.json(
                    { error: 'At least one file is required in the files array (or provide googleDriveFolderId)' },
                    { status: 400 }
                );
            }

            // Convert base64 files to File objects with validation (only if files exist)
            if (body.files && Array.isArray(body.files)) {
                files = body.files.map((fileData: any, index: number) => {
                    if (!fileData.dataBase64 || !fileData.fileName) {
                        throw new Error(`File at index ${index}: Each file must have dataBase64 and fileName properties`);
                    }

                    // Validate that dataBase64 is actual base64 content, not a reference
                    const base64Str = String(fileData.dataBase64).trim();

                    // Check for filesystem references
                    if (base64Str === 'filesystem-v2' || base64Str.startsWith('filesystem-') || base64Str.length < 100) {
                        throw new Error(
                            `File at index ${index} (${fileData.fileName}): dataBase64 appears to be a filesystem reference, not actual base64 content. ` +
                            `Length: ${base64Str.length}, First 50 chars: ${base64Str.substring(0, 50)}`
                        );
                    }

                    // Remove data URL prefix if present (e.g., "data:image/png;base64,")
                    let cleanBase64 = base64Str;
                    if (base64Str.includes(',')) {
                        cleanBase64 = base64Str.split(',')[1];
                    }

                    // Basic base64 validation (should be alphanumeric + / + = padding, and whitespace)
                    const base64Regex = /^[A-Za-z0-9+/=\s]*$/;
                    if (!base64Regex.test(cleanBase64)) {
                        throw new Error(
                            `File at index ${index} (${fileData.fileName}): dataBase64 contains invalid characters. ` +
                            `First 100 chars: ${cleanBase64.substring(0, 100)}... (total length: ${cleanBase64.length})`
                        );
                    }

                    // Remove whitespace from base64
                    cleanBase64 = cleanBase64.replace(/\s/g, '');

                    // Validate minimum length (even a tiny file should be > 50 chars base64)
                    if (cleanBase64.length < 50) {
                        throw new Error(
                            `File at index ${index} (${fileData.fileName}): dataBase64 is too short (${cleanBase64.length} chars). ` +
                            `This suggests the file content is empty or not properly encoded.`
                        );
                    }

                    const mimeType = fileData.mimeType || 'application/octet-stream';

                    try {
                        // Try to decode base64 to verify it's valid
                        const testBuffer = Buffer.from(cleanBase64, 'base64');
                        if (testBuffer.length === 0) {
                            throw new Error('Decoded buffer is empty - base64 may be invalid or file is empty');
                        }

                        console.log(`[Agent Process API] File ${index}: ${fileData.fileName}, size: ${testBuffer.length} bytes, mimeType: ${mimeType}`);

                        return base64ToFile(cleanBase64, fileData.fileName, mimeType);
                    } catch (error: any) {
                        throw new Error(
                            `File at index ${index} (${fileData.fileName}): Failed to convert base64 to file. ` +
                            `Error: ${error.message}. Base64 length: ${cleanBase64.length}, First 20 chars: ${cleanBase64.substring(0, 20)}`
                        );
                    }
                });
            }
        } else if (contentType.includes('multipart/form-data')) {
            // Multipart form-data (original implementation)
            const formData = await request.formData();
            agentId = (formData.get('agentId') as string) || undefined;
            googleDriveFolderId = (formData.get('googleDriveFolderId') as string) || (formData.get('googledrivefolderid') as string) || undefined;

            // Get all files from form data
            // FormData can have multiple files with the same key name
            const filesField = formData.getAll('files');
            for (const file of filesField) {
                if (file instanceof File) {
                    files.push(file);
                }
            }

            // Also check for 'file' (singular) - for single file uploads
            const fileField = formData.getAll('file');
            for (const file of fileField) {
                if (file instanceof File) {
                    files.push(file);
                }
            }

            // Also check for any field that starts with 'file' (e.g., 'file0', 'file1', etc.)
            for (const [key, value] of formData.entries()) {
                if (key.startsWith('file') && value instanceof File && !files.includes(value)) {
                    files.push(value);
                }
            }
        }

        // If Google Drive folder ID is provided, fetch all files from that folder
        if (googleDriveFolderId) {
            console.log(`[Agent Process API] Fetching files from Google Drive folder: ${googleDriveFolderId}`);
            try {
                const driveFiles = await listFilesInFolder(googleDriveFolderId);
                console.log(`[Agent Process API] Found ${driveFiles.length} files in folder`);

                const fetchedFiles = await Promise.all(driveFiles.map(async (f) => {
                    try {
                        if (f.mimeType === 'application/vnd.google-apps.document') {
                            const text = await fetchGoogleDoc(f.id);
                            return new File([text], f.name, { type: 'text/plain' });
                        } else if (f.mimeType === 'application/vnd.google-apps.spreadsheet') {
                            const text = await fetchGoogleSheet(f.id);
                            return new File([text], f.name, { type: 'text/plain' });
                        } else {
                            // Binary file (PDF, Image, etc.)
                            const { buffer, mimeType } = await downloadDriveFile(f.id);
                            return new File([new Uint8Array(buffer)], f.name, { type: mimeType });
                        }
                    } catch (err: any) {
                        console.error(`[Agent Process API] Failed to fetch file ${f.name} (${f.id}):`, err);
                        return null;
                    }
                }));

                // Add successfully fetched files to the files array
                for (const file of fetchedFiles) {
                    if (file) files.push(file);
                }
            } catch (err: any) {
                console.error(`[Agent Process API] Error listing files in folder ${googleDriveFolderId}:`, err);
                return NextResponse.json(
                    { error: `Failed to fetch files from Google Drive folder: ${err.message}` },
                    { status: 500 }
                );
            }
        }

        // Check agent configuration for upload permission
        if (agentId) {
            const config = await getPromptConfig(agentId);
            const allowUploads = config.config?.allowFileUploads === true;

            if (!allowUploads) {
                return NextResponse.json(
                    { error: 'File uploads are disabled for this agent' },
                    { status: 403 }
                );
            }
        }

        if (files.length === 0 && !googleDriveFolderId) {
            return NextResponse.json(
                { error: 'At least one file or a googleDriveFolderId is required' },
                { status: 400 }
            );
        }

        console.log(`[Agent Process API] Processing ${files.length} file(s) for agent: ${agentId || 'default'}`);

        // Process all files in parallel
        const processedFiles = await Promise.all(
            files.map(file => processFile(file))
        );

        console.log(`[Agent Process API] Files processed, extracting invoice data...`);

        // Process invoices using chat logic
        const extractedInvoices = await processInvoicesWithChat(processedFiles, agentId);

        console.log(`[Agent Process API] Extracted ${extractedInvoices.length} invoice(s)`);

        if (extractedInvoices.length === 0) {
            return NextResponse.json(
                { error: 'No invoice data could be extracted from the uploaded files' },
                { status: 400 }
            );
        }

        // Extract business info from first invoice
        const businessInfo: BusinessInfo = {
            name: extractedInvoices[0].business_name || 'Unknown Business',
            address: extractedInvoices[0].site_address || undefined,
        };

        // Build report data
        const reportData: ReportData = {
            businessInfo,
            invoices: extractedInvoices,
            generatedAt: new Date().toISOString(),
            savingsSummary: calculateSavingsSummary(extractedInvoices),
        };

        // Generate Excel workbook
        console.log(`[Agent Process API] Generating Excel report...`);
        const excelBuffer = await generateBase1Workbook(reportData);

        // Check if JSON format is requested (query param or Accept header)
        const url = new URL(request.url);
        const formatParam = url.searchParams.get('format');
        const acceptHeader = request.headers.get('accept') || '';
        const wantsJson = formatParam === 'json' || acceptHeader.includes('application/json');

        // Return Excel file as response
        const fileName = `base1-review-${businessInfo.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Date.now()}.xlsx`;

        // If JSON format requested, return JSON with Excel base64 and HTML email
        if (wantsJson) {
            const excelBase64 = excelBuffer.toString('base64');
            const htmlEmail = generateReportEmail(reportData);

            return NextResponse.json({
                excelBase64,
                htmlEmail,
                businessInfo,
                metadata: {
                    fileName,
                    invoiceCount: extractedInvoices.length,
                    generatedAt: reportData.generatedAt,
                    savingsSummary: reportData.savingsSummary,
                },
            });
        }

        // Otherwise, return binary Excel (backward-compatible)
        const uint8Array = new Uint8Array(excelBuffer);

        return new NextResponse(uint8Array, {
            status: 200,
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="${fileName}"`,
            },
        });
    } catch (error: any) {
        console.error('[Agent Process API] Error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to process files and generate report' },
            { status: 500 }
        );
    }
}


