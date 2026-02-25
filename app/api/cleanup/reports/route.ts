import { NextResponse } from 'next/server';
import { settings } from '@/lib/config/settings';
import { googleAuthService } from '@/lib/services/google/GoogleAuthService';

const RETENTION_HOURS = 48; // Delete files older than 2 days (48 hours)

export async function POST(request: Request) {
    try {
        const storage = googleAuthService.getStorageClient();
        const bucket = storage.bucket(settings.gcs.bucketName);
        
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
                    // File is older than retention period
                    shouldDelete = true;
                }
                
                if (shouldDelete) {
                    await file.delete();
                    deletedCount++;
                    console.log(`[Cleanup] Deleted old report: ${file.name}`);
                }
            } catch (error: any) {
                console.error(`[Cleanup] Error processing file ${file.name}:`, error.message);
                errorCount++;
            }
        }
        
        return NextResponse.json({
            success: true,
            deleted: deletedCount,
            errors: errorCount,
            total: files.length,
            message: `Cleaned up ${deletedCount} file(s) older than 2 days`,
        });
    } catch (error: any) {
        console.error('[Cleanup] Error:', error);
        return NextResponse.json(
            { error: 'Failed to cleanup reports', details: error.message },
            { status: 500 }
        );
    }
}

// GET endpoint to check status without deleting
export async function GET() {
    try {
        const storage = googleAuthService.getStorageClient();
        const bucket = storage.bucket(settings.gcs.bucketName);
        
        const [files] = await bucket.getFiles({ prefix: 'reports/' });
        
        const now = Date.now();
        const retentionMs = RETENTION_HOURS * 60 * 60 * 1000;
        
        const oldFiles = [];
        
        for (const file of files) {
            try {
                const [metadata] = await file.getMetadata();
                const created = metadata.timeCreated ? new Date(metadata.timeCreated).getTime() : null;
                const expiresAtStr = metadata.metadata?.expiresAt;
                const expiresAt = (typeof expiresAtStr === 'string' && expiresAtStr) 
                    ? new Date(expiresAtStr).getTime() 
                    : null;
                
                let age = null;
                let isExpired = false;
                
                if (expiresAt) {
                    age = Math.floor((now - expiresAt) / (60 * 60 * 1000)); // hours
                    isExpired = now >= expiresAt;
                } else if (created) {
                    age = Math.floor((now - created) / (60 * 60 * 1000)); // hours
                    isExpired = (now - created) >= retentionMs;
                }
                
                if (isExpired || (age !== null && age >= RETENTION_HOURS)) {
                    oldFiles.push({
                        name: file.name,
                        age: age !== null ? `${age} hours` : 'unknown',
                        created: metadata.timeCreated,
                        expiresAt: metadata.metadata?.expiresAt || null,
                    });
                }
            } catch (error: any) {
                console.error(`[Cleanup] Error checking file ${file.name}:`, error.message);
            }
        }
        
        return NextResponse.json({
            total: files.length,
            oldFiles: oldFiles.length,
            files: oldFiles,
        });
    } catch (error: any) {
        console.error('[Cleanup] Error:', error);
        return NextResponse.json(
            { error: 'Failed to check reports', details: error.message },
            { status: 500 }
        );
    }
}

