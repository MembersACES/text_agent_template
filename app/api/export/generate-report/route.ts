import { NextResponse } from 'next/server';
import { settings } from '@/lib/config/settings';
import { googleAuthService } from '@/lib/services/google/GoogleAuthService';
import { excelGeneratorService } from '@/lib/services/report/ExcelGeneratorService';
import { emailGeneratorService } from '@/lib/services/report/EmailGeneratorService';
import { runDeterministicSavingsPipelineAsync } from '@/lib/services/report/deterministicSavingsPipeline';
import { gcsClient } from '@/lib/services/storage/GcsClient';
import { ReportData, BusinessInfo, calculateSavingsSummary } from '@/lib/types/ReportTypes';

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

        const bucketsSnapshot = await gcsClient.getBase1ComparisonBuckets();
        const pipeline = await runDeterministicSavingsPipelineAsync(invoices, {
            buckets: bucketsSnapshot.data,
            configGeneration: bucketsSnapshot.generation,
        });
        const normalizedInvoices = pipeline.invoices;

        const reportData: ReportData = {
            businessInfo: businessInfo as BusinessInfo,
            invoices: normalizedInvoices,
            generatedAt: new Date().toISOString(),
            savingsSummary: calculateSavingsSummary(normalizedInvoices),
        };

        const excelBuffer = await excelGeneratorService.generateWorkbook(reportData);

        const storage = googleAuthService.getStorageClient();
        const bucket = storage.bucket(settings.gcs.bucketName);
        const fileName = `base1-review-${businessInfo.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Date.now()}.xlsx`;
        const file = bucket.file(`reports/${fileName}`);

        await file.save(excelBuffer, {
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            metadata: {
                cacheControl: 'public, max-age=3600',
                created: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
            },
        });

        const [downloadUrl] = await file.getSignedUrl({
            action: 'read',
            expires: Date.now() + 3600000,
        });

        let driveUploads: Array<{ fileId: string; url: string; fileName: string }> = [];
        const driveUploadError: string | null = null;

        const htmlEmail = emailGeneratorService.generateEmail(reportData);

        const includeStaffCrossCheck =
            request.headers.get('x-base1-admin-key') === settings.auth.base1AdminKey;

        const response: Record<string, unknown> = {
            success: true,
            downloadUrl,
            fileName,
            htmlEmail,
            note: 'Excel file is available for download. Drive upload feature is currently disabled.',
            metadata: { runId: pipeline.runId },
        };

        if (includeStaffCrossCheck) {
            try {
                await gcsClient.saveBase1CrossCheckArtifacts(
                    pipeline.runId,
                    pipeline.crossCheck,
                    pipeline.crossCheckXlsx,
                );
            } catch (gcsErr) {
                console.warn('[Report API] Cross-check GCS persist failed:', gcsErr);
            }
            response.savingsCrossCheck = pipeline.crossCheck;
            response.savingsCrossCheckXlsx = {
                base64: pipeline.crossCheckXlsx.toString('base64'),
                fileName: `${pipeline.runId}-savings-crosscheck.xlsx`,
            };
        }

        return NextResponse.json(response);
    } catch (error) {
        console.error('Error generating report:', error);
        return NextResponse.json(
            { error: 'Failed to generate report', details: String(error) },
            { status: 500 }
        );
    }
}
