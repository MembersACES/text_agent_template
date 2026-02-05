import { NextResponse } from 'next/server';
import { generateBase1Workbook } from '@/lib/excel-generator';
import { getStorageClient } from '@/lib/google-auth';
import { ReportData, ExtractedInvoice, BusinessInfo } from '@/lib/report-types';

const BUCKET_NAME = process.env.GCS_BUCKET_NAME!;

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { invoices, businessInfo, agentId } = body;

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

        await file.save(excelBuffer, {
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            metadata: {
                cacheControl: 'public, max-age=3600',
            },
        });

        // Generate signed URL (valid for 1 hour)
        const [downloadUrl] = await file.getSignedUrl({
            action: 'read',
            expires: Date.now() + 3600000, // 1 hour
        });

        // Note: Service accounts cannot upload files to Google Drive (no storage quota)
        // The Excel file is available for download, and users can manually upload it to Drive if needed
        // To enable automatic Drive uploads, you would need to:
        // 1. Use OAuth delegation to impersonate a user account with quota, OR
        // 2. Use Google Workspace Shared Drives (requires Shared Drive setup)
        // For now, we only provide the Excel download
        console.log('[Report API] Excel file generated and available for download');
        console.log('[Report API] Note: Service accounts cannot upload to Drive. Users can download and manually upload if needed.');

        return NextResponse.json({
            success: true,
            downloadUrl,
            fileName,
            note: 'Excel file is available for download. Service accounts cannot upload to Google Drive. You can download and manually upload to your Drive folder if needed.',
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

