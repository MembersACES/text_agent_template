import { getLogger } from '@/lib/config/logger';
import { settings } from '@/lib/config/settings';
import { googleAuthService } from '@/lib/services/google/GoogleAuthService';

const logger = getLogger('ReportCleanupService');

const RETENTION_HOURS = 48;

export class ReportCleanupService {
    private readonly bucketName: string;

    constructor() {
        this.bucketName = settings.gcs.bucketName;
    }

    async cleanupOldReports(): Promise<{ deleted: number; errors: number; total: number }> {
        try {
            const storage = googleAuthService.getStorageClient();
            const bucket = storage.bucket(this.bucketName);
            const [files] = await bucket.getFiles({ prefix: 'reports/' });

            const now = Date.now();
            const retentionMs = RETENTION_HOURS * 60 * 60 * 1000;
            let deletedCount = 0;
            let errorCount = 0;

            for (const file of files) {
                try {
                    const [metadata] = await file.getMetadata();
                    const created = metadata.timeCreated ? new Date(metadata.timeCreated).getTime() : null;
                    const expiresAtStr = metadata.metadata?.expiresAt;
                    const expiresAt = (typeof expiresAtStr === 'string' && expiresAtStr)
                        ? new Date(expiresAtStr).getTime()
                        : null;

                    const shouldDelete =
                        (expiresAt && now >= expiresAt) ||
                        (created && now - created >= retentionMs);

                    if (shouldDelete) {
                        await file.delete();
                        deletedCount++;
                        logger.info(`Deleted old report: ${file.name}`);
                    }
                } catch (error: any) {
                    logger.error(`Error processing file ${file.name}: ${error.message}`);
                    errorCount++;
                }
            }

            if (deletedCount > 0) {
                logger.info(`Cleaned up ${deletedCount} file(s) older than 2 days`);
            }

            return { deleted: deletedCount, errors: errorCount, total: files.length };
        } catch (error: any) {
            logger.error(`Cleanup error: ${error}`);
            // Don't throw — cleanup failures shouldn't break KB indexing
            return { deleted: 0, errors: 1, total: 0 };
        }
    }
}

export const reportCleanupService = new ReportCleanupService();
