import { NextResponse } from 'next/server';
import { generateBase1Workbook } from '@/lib/excel-generator';
import { getStorageClient } from '@/lib/google-auth';
// import { uploadExcelToDrive, uploadFilesToDrive } from '@/lib/drive-uploader'; // Drive upload feature disabled
import { ReportData, ExtractedInvoice, BusinessInfo } from '@/lib/report-types';

const BUCKET_NAME = process.env.GCS_BUCKET_NAME!;

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { invoices, businessInfo, agentId, uploadedFiles } = body;

        if (!Array.isArray(invoices) || invoices.length === 0) {
            return NextResponse.json(
                { error: 'At least one invoice is required' },
                { status: 400 }
            );
        }

        if (!businessInfo || !businessInfo.name) {
            return NextResponse.json(
                { error: 'Business information with name is required' },
                { status: 400 }
            );
        }

        // Build report data
        const reportData: ReportData = {
            businessInfo: businessInfo as BusinessInfo,
            invoices: invoices as ExtractedInvoice[],
            generatedAt: new Date().toISOString(),
            savingsSummary: calculateSavingsSummary(invoices as ExtractedInvoice[]),
        };

        // Generate Excel workbook
        const excelBuffer = await generateBase1Workbook(reportData);

        // Upload to GCS and get signed URL
        const storage = getStorageClient();
        const bucket = storage.bucket(BUCKET_NAME);
        const fileName = `base1-review-${businessInfo.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Date.now()}.xlsx`;
        const file = bucket.file(`reports/${fileName}`);

        // Save file with metadata including creation timestamp for cleanup
        await file.save(excelBuffer, {
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            metadata: {
                cacheControl: 'public, max-age=3600',
                created: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), // 2 days from now
            },
        });

        // Generate signed URL (valid for 1 hour)
        const [downloadUrl] = await file.getSignedUrl({
            action: 'read',
            expires: Date.now() + 3600000, // 1 hour
        });

        // Drive upload feature is currently disabled
        // Upload to Google Drive if folder is specified (for Base 1 Review agent)
        // const BASE1_REPORTS_FOLDER_ID = '1wZpdNFOIYPQ1Bl9FHaVsBqRj4KUEG3LK';
        // const folderId = agentId === 'base-1-review' ? BASE1_REPORTS_FOLDER_ID : undefined;
        
        let driveUploads: Array<{ fileId: string; url: string; fileName: string }> = [];
        let driveUploadError: string | null = null;

        // Drive upload feature is currently disabled
        // if (folderId) {
        //     try {
        //         console.log('[Report API] Attempting to upload files to Google Drive folder:', folderId);
        //         
        //         // Prepare files to upload
        //         const filesToUpload: Array<{ buffer: Buffer; fileName: string; mimeType: string }> = [
        //             {
        //                 buffer: excelBuffer,
        //                 fileName: fileName,
        //                 mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        //             },
        //         ];

        //         // Add uploaded invoice files if provided
        //         if (uploadedFiles && Array.isArray(uploadedFiles)) {
        //             for (const uploadedFile of uploadedFiles) {
        //                 if (uploadedFile.name && uploadedFile.fileBufferBase64) {
        //                     // Convert base64 back to buffer (original file)
        //                     const fileBuffer = Buffer.from(uploadedFile.fileBufferBase64, 'base64');
        //                     
        //                     // Use MIME type from upload, or determine from extension
        //                     let mimeType = uploadedFile.mimeType || 'application/octet-stream';
        //                     if (mimeType === 'application/octet-stream') {
        //                         const extension = uploadedFile.name.split('.').pop()?.toLowerCase();
        //                         const mimeTypes: Record<string, string> = {
        //                             'pdf': 'application/pdf',
        //                             'jpg': 'image/jpeg',
        //                             'jpeg': 'image/jpeg',
        //                             'png': 'image/png',
        //                             'xls': 'application/vnd.ms-excel',
        //                             'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        //                             'doc': 'application/msword',
        //                             'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        //                             'txt': 'text/plain',
        //                         };
        //                         if (extension && mimeTypes[extension]) {
        //                             mimeType = mimeTypes[extension];
        //                         }
        //                     }

        //                     filesToUpload.push({
        //                         buffer: fileBuffer,
        //                         fileName: `Invoice - ${uploadedFile.name}`,
        //                         mimeType: mimeType,
        //                     });
        //                 }
        //             }
        //         }

        //         // Upload all files to Drive
        //         driveUploads = await uploadFilesToDrive(filesToUpload, folderId);
        //         console.log(`[Report API] Successfully uploaded ${driveUploads.length} file(s) to Drive`);
        //     } catch (uploadError: any) {
        //         console.error('[Report API] Drive upload failed:', uploadError?.message || uploadError);
        //         driveUploadError = uploadError?.message || 'Failed to upload files to Google Drive';
        //         // Continue - Excel file is still available for download
        //     }
        // }

        return NextResponse.json({
            success: true,
            downloadUrl,
            fileName,
            note: 'Excel file is available for download. Drive upload feature is currently disabled.',
        });
    } catch (error) {
        console.error('Error generating report:', error);
        return NextResponse.json(
            { error: 'Failed to generate report', details: String(error) },
            { status: 500 }
        );
    }
}

function calculateSavingsSummary(invoices: ExtractedInvoice[]) {
    let totalSavings = 0;
    const criticalIssues: Array<{ issue: string; savings: number; severity: 'high' | 'medium' | 'low' }> = [];

    invoices.forEach(inv => {
        if (inv.low_hanging_fruit) {
            inv.low_hanging_fruit.forEach(opp => {
                if (opp.potential_savings) {
                    // Extract number from string like "$1,234.56/year"
                    const match = opp.potential_savings.match(/[\d,]+\.?\d*/);
                    if (match) {
                        const savings = parseFloat(match[0].replace(/,/g, ''));
                        totalSavings += savings;
                        
                        if (opp.severity === 'high') {
                            criticalIssues.push({
                                issue: opp.message,
                                savings,
                                severity: opp.severity,
                            });
                        }
                    }
                }
            });
        }
    });

    return {
        conservative: totalSavings * 0.7,
        moderate: totalSavings * 0.85,
        optimistic: totalSavings,
        criticalIssues,
    };
}

