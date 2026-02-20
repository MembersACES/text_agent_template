import { getStorageClient } from './google-auth';

const BUCKET_NAME = process.env.GCS_BUCKET_NAME!;
const RETENTION_HOURS = 48; // Delete files older than 2 days (48 hours)

/**
 * Clean up old report files from GCS bucket
 * Deletes files older than 2 days
 * Returns cleanup statistics
 */
export async function cleanupOldReports(): Promise<{
    deleted: number;
    errors: number;
    total: number;
}> {
    try {
        const storage = getStorageClient();
        const bucket = storage.bucket(BUCKET_NAME);
        
        // List all files in the reports/ prefix
        const [files] = await bucket.getFiles({ prefix: 'reports/' });
        
        const now = Date.now();
        const retentionMs = RETENTION_HOURS * 60 * 60 * 1000;
        let deletedCount = 0;
        let errorCount = 0;
        
        for (const file of files) {
            try {
                // Get file metadata
                const [metadata] = await file.getMetadata();
                const created = metadata.timeCreated ? new Date(metadata.timeCreated).getTime() : null;
                const expiresAtStr = metadata.metadata?.expiresAt;
                const expiresAt = (typeof expiresAtStr === 'string' && expiresAtStr) 
                    ? new Date(expiresAtStr).getTime() 
                    : null;
                
                // Check if file should be deleted
                let shouldDelete = false;
                
                if (expiresAt && now >= expiresAt) {
                    // File has expiration metadata and it's expired
                    shouldDelete = true;
                } else if (created && (now - created) >= retentionMs) {
                    // File is older than retention period (2 days)
                    shouldDelete = true;
                }
                
                if (shouldDelete) {
                    await file.delete();
                    deletedCount++;
                    console.log(`[Report Cleanup] Deleted old report: ${file.name}`);
                }
            } catch (error: any) {
                console.error(`[Report Cleanup] Error processing file ${file.name}:`, error.message);
                errorCount++;
            }
        }
        
        if (deletedCount > 0) {
            console.log(`[Report Cleanup] Cleaned up ${deletedCount} file(s) older than 2 days`);
        }
        
        return {
            deleted: deletedCount,
            errors: errorCount,
            total: files.length,
        };
    } catch (error: any) {
        console.error('[Report Cleanup] Error:', error);
        // Don't throw - cleanup failures shouldn't break KB indexing
        return {
            deleted: 0,
            errors: 1,
            total: 0,
        };
    }
}

