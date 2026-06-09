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
 * - Or with ?format=json or Accept: application/json: JSON with excelBase64, htmlEmail, businessInfo, invoices (full extracted row per invoice), metadata
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
import { settings } from '@/lib/config/settings';
import { gcsClient } from '@/lib/services/storage/GcsClient';
import { knowledgeBaseStorage } from '@/lib/services/storage/KnowledgeBaseStorage';
import { documentFetcherService } from '@/lib/services/google/DocumentFetcherService';
import { excelGeneratorService } from '@/lib/services/report/ExcelGeneratorService';
import { emailGeneratorService } from '@/lib/services/report/EmailGeneratorService';
import type { Base1ComparisonBuckets } from '@/lib/config/base1ComparisonBuckets';
import {
    runDeterministicSavingsPipelineAsync,
    type DeterministicPipelineOutput,
} from '@/lib/services/report/deterministicSavingsPipeline';
import {
    ExtractedInvoice,
    BusinessInfo,
    ReportData,
    calculateSavingsSummary,
    getElectricityClassificationDebug,
} from '@/lib/types/ReportTypes';
import { appendBase1BucketInjection, buildInvoiceExtractionPrompt, buildNoKBExtractionPrompt } from '@/lib/utils/Prompts';
import { extractJsonFromResponse } from '@/lib/utils/JsonParser';
import {
    chunkSourceMatchesGuide,
    inferUtilitiesFromFilesContentAndNames,
    sortGuideChunksForExtraction,
} from '@/lib/config/knowledgeBaseGuides';

interface ProcessedFile {
    name: string;
    content: string;
    mimeType: string;
}

/**
 * Process a single file - extract text content
 * Reuses logic from /api/uploads
 * @param file - The file to process
 * @param model - Optional shared Gemini model instance (for efficiency when processing multiple files)
 */
async function processFile(file: File, model?: any): Promise<ProcessedFile> {
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
    let content: string = '';

    if (isTextBased) {
        content = fileBuffer.toString('utf-8');
    } else {
        // Binary files: use Gemini Vision to extract text
        // Check file size (Gemini has limits - base64 increases size by ~33%)
        const fileSizeMB = fileBuffer.length / (1024 * 1024);
        const maxSizeMB = 20; // Gemini typically supports up to 20MB files
        if (fileSizeMB > maxSizeMB) {
            throw new Error(`File size (${fileSizeMB.toFixed(2)}MB) exceeds maximum allowed size (${maxSizeMB}MB) for Gemini Vision API`);
        }

        const base64Data = fileBuffer.toString('base64');
        
        // Use shared model if provided, otherwise create a new one
        let geminiModel = model;
        if (!geminiModel) {
            const genAI = new GoogleGenerativeAI(settings.gemini.apiKey);
            geminiModel = genAI.getGenerativeModel({ 
                model: 'gemini-2.5-flash',
                generationConfig: {
                    maxOutputTokens: 8192,
                    temperature: 0.1,
                },
            });
        }

        // Retry logic for network failures
        const maxRetries = 3;
        let extractionSuccessful = false;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`[Agent Process API] Attempting to extract text from ${fileName} (attempt ${attempt}/${maxRetries}, size: ${fileSizeMB.toFixed(2)}MB)...`);
                
                const result = await geminiModel.generateContent([
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
                extractionSuccessful = true;
                console.log(`[Agent Process API] Extracted ${content.length} chars from ${fileName} (${mimeType})`);
                console.log(`[Agent Process API] Preview: ${content.substring(0, 200)}...`);
                break; // Success, exit retry loop
            } catch (error: any) {
                const errorMessage = error.message || String(error);
                console.error(`[Agent Process API] Attempt ${attempt}/${maxRetries} failed for ${fileName}:`, errorMessage);
                
                // If it's the last attempt, throw the error
                if (attempt === maxRetries) {
                    throw new Error(
                        `Failed to extract text from ${fileName} after ${maxRetries} attempts. ` +
                        `Last error: ${errorMessage}. ` +
                        `This may be due to network issues, API rate limits, or file size. ` +
                        `File size: ${fileSizeMB.toFixed(2)}MB`
                    );
                }
                
                // Wait before retrying (exponential backoff)
                const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Max 10 seconds
                console.log(`[Agent Process API] Waiting ${waitTime}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
        
        if (!extractionSuccessful) {
            throw new Error(`Failed to extract text from ${fileName} - all retry attempts exhausted`);
        }
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
    agentId?: string,
    buckets?: Base1ComparisonBuckets,
    configGeneration?: string,
): Promise<{ invoices: ExtractedInvoice[]; pipeline: DeterministicPipelineOutput }> {
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
    const systemSettings = await gcsClient.getSystemSettings();
    const agentPrompt = await gcsClient.getPromptTemplate(agentId);
    const fullPrompt = `${systemSettings.globalSystemPrompt}\n\n---\n\n${agentPrompt}`;

    // Always use KB if available
    const useKnowledgeBase = true;

    let finalMessage = '';
    let kbContext = '';

    if (useKnowledgeBase) {
        const kb = await knowledgeBaseStorage.getCached(agentId);
        if (kb) {
            // All guide chunks, sorted by benchmark keywords + optional utility inference (we do not drop
            // other utilities — that removed too much context vs the previous 20-chunk mix).
            const allGuideChunks = kb.chunks.filter((chunk: any) => chunkSourceMatchesGuide(chunk.source));
            const utilityHint = inferUtilitiesFromFilesContentAndNames(
                fileContext,
                files.map((f) => f.name),
            );
            if (utilityHint && utilityHint.size > 0) {
                console.log(
                    `[Agent Process API] Guide utility hint: ${[...utilityHint].join(', ')} (sort tie-break; all guide families still in pool)`,
                );
            }
            
            let similarChunks: any[] = [];
            let useKBContext = false;

            if (allGuideChunks.length > 0) {
                similarChunks = sortGuideChunksForExtraction(allGuideChunks, utilityHint).slice(0, 20);
                useKBContext = true;
                console.log(
                    `[Agent Process API] Found ${allGuideChunks.length} guide document chunks, using ${similarChunks.length} for benchmarking (top 20 by priority)`,
                );
            } else {
                console.warn(`[Agent Process API] No guide document chunks found. Available sources: ${[...new Set(kb.chunks.map((c: any) => c.source))].join(', ')}`);
            }

            // Only use KB context if embeddings worked
            if (useKBContext && similarChunks && similarChunks.length > 0) {
                kbContext = similarChunks
                    .map((chunk: any, i: number) => {
                        const sourceInfo = chunk.source ? ` (File: ${chunk.source})` : '';
                        return `[Source ${i + 1}${sourceInfo}]:\n${chunk.text}`;
                    })
                    .join('\n\n---\n\n');
                
                // Log KB context being used for debugging
                console.log(`[Agent Process API] Using ${similarChunks.length} KB chunks for benchmarking`);
                similarChunks.forEach((chunk: any, i: number) => {
                    console.log(`  KB Chunk ${i + 1}: ${chunk.source || 'Unknown'} (${chunk.text.substring(0, 100)}...)`);
                });
            } else {
                console.warn(`[Agent Process API] No KB context available - benchmarks may not be accurate`);
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

            // Use shared extraction prompt
            finalMessage = buildInvoiceExtractionPrompt(combinedContext);
        } else {
            // No KB, just use uploaded files - use shared no-KB prompt
            finalMessage = buildNoKBExtractionPrompt(fileContext);
        }
    } else {
        // KB disabled - use shared no-KB prompt
        finalMessage = buildNoKBExtractionPrompt(fileContext);
    }

    if (agentId === 'base-1-review' && buckets) {
        finalMessage = appendBase1BucketInjection(finalMessage, buckets);
    }

    // Initialize Gemini AI
    const genAI = new GoogleGenerativeAI(settings.gemini.apiKey);
    const model = genAI.getGenerativeModel({
        model: settings.gemini.model,
        generationConfig: {
            maxOutputTokens: settings.gemini.maxOutputTokens,
            temperature: settings.gemini.temperature,
        },
    });

    // Generate response
    const result = await model.generateContent(finalMessage);
    const response = await result.response;
    const text = response.text();

    console.log(`[Agent Process API] Gemini response length: ${text.length} characters`);
    console.log(`[Agent Process API] Response preview: ${text.substring(0, 500)}...`);

    const pipeline = await runDeterministicSavingsPipelineAsync(extractJsonFromResponse(text), {
        buckets,
        configGeneration,
    });
    const extractedData = pipeline.invoices;

    if (extractedData.length === 0) {
        throw new Error('No invoice data could be extracted from the uploaded files. Please ensure the files contain valid invoice information.');
    }

    console.log(
        `[Agent Process API] Full extracted invoices (normalized JSON):\n${JSON.stringify(extractedData, null, 2)}`,
    );

    // Log detailed benchmarking information for debugging
    console.log(`[Agent Process API] Extracted ${extractedData.length} invoice(s)`);

    const electricityWithClass = extractedData
        .map((inv, index) => ({ index, inv, dbg: inv.utility_type === 'Electricity' ? getElectricityClassificationDebug(inv) : null }))
        .filter((x) => x.dbg !== null) as Array<{
            index: number;
            inv: ExtractedInvoice;
            dbg: ReturnType<typeof getElectricityClassificationDebug>;
        }>;
    const portfolioHasCAndI = electricityWithClass.some((x) => x.dbg.classification === 'c_and_i');
    if (electricityWithClass.length > 0) {
        console.log(`\n[Agent Process API] Electricity classification diagnostics:`);
        console.log(`  - Portfolio has C&I electricity: ${portfolioHasCAndI}`);
        electricityWithClass.forEach(({ index, inv, dbg }) => {
            const excludedByPortfolioRule = portfolioHasCAndI && dbg.classification === 'sme';
            console.log(
                `  - Invoice ${index + 1} (${inv.invoice_number || 'N/A'} | NMI ${inv.nmi || 'N/A'}): ` +
                `class=${dbg.classification.toUpperCase()} (C&I=${dbg.cAndSignals}, SME=${dbg.smeSignals}) ` +
                `excludedByPortfolioRule=${excludedByPortfolioRule}`,
            );
            if (dbg.reasons.length > 0) {
                dbg.reasons.forEach((r) => console.log(`      * ${r}`));
            } else {
                console.log(`      * no heuristic signals fired (default fallback)`);
            }
        });
    }

    extractedData.forEach((invoice, index) => {
        console.log(`\n[Agent Process API] Invoice ${index + 1} Details:`);
        console.log(`  - Business: ${invoice.business_name || 'N/A'}`);
        console.log(`  - NMI: ${invoice.nmi || 'N/A'}`);
        console.log(`  - Meter Charges: $${invoice.meter_charges || 0}`);
        console.log(`  - Billing Days: ${invoice.billing_days || 0}`);
        
        if (invoice.meter_charges && invoice.billing_days) {
            const annualMeterCharges = (invoice.meter_charges / invoice.billing_days) * 365;
            // Note: Actual benchmark should come from KB - this is just for logging comparison
            // The LLM uses KB values, so this log may not match if KB benchmark differs
            console.log(`  - Annual Meter Charges: $${annualMeterCharges.toFixed(2)}/year`);
            console.log(`  - Note: DMA Benchmark should be extracted from KB (not logged here to avoid hardcoding)`);
        }
        
        if (invoice.low_hanging_fruit && invoice.low_hanging_fruit.length > 0) {
            console.log(`  - Savings Opportunities: ${invoice.low_hanging_fruit.length}`);
            invoice.low_hanging_fruit.forEach((opp: any, oppIndex: number) => {
                console.log(`    ${oppIndex + 1}. ${opp.type}: ${opp.potential_savings || 'N/A'} - ${opp.message || 'N/A'}`);
            });
        } else {
            console.log(`  - Savings Opportunities: None found`);
        }
    });

    return { invoices: extractedData, pipeline };
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
                const driveFiles = await documentFetcherService.listFilesInFolder(googleDriveFolderId);
                console.log(`[Agent Process API] Found ${driveFiles.length} files in folder`);

                const fetchedFiles = await Promise.all(driveFiles.map(async (f) => {
                    try {
                        if (f.mimeType === 'application/vnd.google-apps.document') {
                            const text = await documentFetcherService.fetchDoc(f.id);
                            return new File([text], f.name, { type: 'text/plain' });
                        } else if (f.mimeType === 'application/vnd.google-apps.spreadsheet') {
                            const text = await documentFetcherService.fetchSheet(f.id);
                            return new File([text], f.name, { type: 'text/plain' });
                        } else {
                            // Binary file (PDF, Image, etc.)
                            const { buffer, mimeType } = await documentFetcherService.downloadFile(f.id);
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

        if (files.length === 0 && !googleDriveFolderId) {
            return NextResponse.json(
                { error: 'At least one file or a googleDriveFolderId is required' },
                { status: 400 }
            );
        }

        console.log(`[Agent Process API] Processing ${files.length} file(s) for agent: ${agentId || 'default'}`);

        // Create shared Gemini model instance for file processing (if needed for binary files)
        let sharedModel: any = undefined;
        // Check if we have any binary files that need Gemini Vision
        const hasBinaryFiles = files.some(file => {
            const mimeType = file.type || 'application/octet-stream';
            return !mimeType.startsWith('text/') &&
                   mimeType !== 'application/json' &&
                   !file.name.endsWith('.md') &&
                   !file.name.endsWith('.txt') &&
                   !file.name.endsWith('.csv') &&
                   !file.name.endsWith('.json');
        });

        if (hasBinaryFiles) {
            sharedModel = new GoogleGenerativeAI(settings.gemini.apiKey).getGenerativeModel({
                model: settings.gemini.model,
                generationConfig: { maxOutputTokens: 8192, temperature: settings.gemini.temperature },
            });
        }

        // Process all files in parallel
        const processedFiles = await Promise.all(
            files.map(file => processFile(file, sharedModel))
        );

        console.log(`[Agent Process API] Files processed, extracting invoice data...`);

        const bucketsSnapshot = await gcsClient.getBase1ComparisonBuckets();

        // Process invoices using chat logic
        const { invoices: extractedInvoices, pipeline } = await processInvoicesWithChat(
            processedFiles,
            agentId,
            bucketsSnapshot.data,
            bucketsSnapshot.generation,
        );

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
        const savingsSummary = calculateSavingsSummary(extractedInvoices);
        
        // Log savings summary calculation details
        console.log(`\n[Agent Process API] Savings Summary Calculation:`);
        console.log(`  - Total Raw Savings (100%): $${savingsSummary.moderate.toFixed(2)}`);
        console.log(`  - Conservative (80%): $${savingsSummary.conservative.toFixed(2)}`);
        console.log(`  - Expected (100%): $${savingsSummary.moderate.toFixed(2)}`);
        console.log(`  - Critical Issues: ${savingsSummary.criticalIssues.length}`);
        savingsSummary.criticalIssues.forEach((issue, idx) => {
            console.log(`    ${idx + 1}. ${issue.issue}: $${issue.savings.toFixed(2)}/year (${issue.severity})`);
        });
        
        const reportData: ReportData = {
            businessInfo,
            invoices: extractedInvoices,
            generatedAt: new Date().toISOString(),
            savingsSummary,
        };

        // Generate Excel workbook
        console.log(`[Agent Process API] Generating Excel report...`);
        const excelBuffer = await excelGeneratorService.generateWorkbook(reportData);

        // Check if additional metadata is requested (query param or Accept header)
        const url = new URL(request.url);
        const formatParam = url.searchParams.get('format');
        const acceptHeader = request.headers.get('accept') || '';
        const includeMetadata = formatParam === 'json' || acceptHeader.includes('application/json');

        // Return Excel file as response
        const fileName = `base1-review-${businessInfo.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Date.now()}.xlsx`;

        // If metadata requested, return JSON with Excel as base64 + HTML email + metadata
        // Note: Using base64 for n8n compatibility (multipart is not easily parsed by n8n)
        const includeStaffCrossCheck =
            url.searchParams.get('includeStaffCrossCheck') === '1' ||
            request.headers.get('x-base1-admin-key') === settings.auth.base1AdminKey;

        if (includeMetadata) {
            const htmlEmail = emailGeneratorService.generateEmail(reportData);
            const excelBase64 = excelBuffer.toString('base64');

            const jsonBody: Record<string, unknown> = {
                excelBase64,
                htmlEmail,
                businessInfo,
                invoices: extractedInvoices,
                metadata: {
                    fileName,
                    invoiceCount: extractedInvoices.length,
                    generatedAt: reportData.generatedAt,
                    savingsSummary: reportData.savingsSummary,
                    runId: pipeline.runId,
                },
            };

            if (includeStaffCrossCheck) {
                try {
                    await gcsClient.saveBase1CrossCheckArtifacts(
                        pipeline.runId,
                        pipeline.crossCheck,
                        pipeline.crossCheckXlsx,
                    );
                } catch (gcsErr) {
                    console.warn('[Agent Process API] Cross-check GCS persist failed:', gcsErr);
                }
                jsonBody.savingsCrossCheck = pipeline.crossCheck;
                jsonBody.savingsCrossCheckXlsx = {
                    base64: pipeline.crossCheckXlsx.toString('base64'),
                    fileName: `${pipeline.runId}-savings-crosscheck.xlsx`,
                };
            }

            return NextResponse.json(jsonBody);
        }

        // Otherwise, return binary Excel only (backward-compatible)
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


