import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { settings } from '@/lib/config/settings';
import { googleAuthService } from '@/lib/services/google/GoogleAuthService';

/**
 * Maintenance endpoint to clean up files owned by the service account in Google Drive
 * 
 * GET /api/maintenance/cleanup-drive?dryRun=true - List files without deleting
 * GET /api/maintenance/cleanup-drive?dryRun=false - List and delete files
 * POST /api/maintenance/cleanup-drive - Same as GET, accepts body with { dryRun: boolean }
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const dryRun = searchParams.get('dryRun') !== 'false'; // Default to true (safe mode)

    return handleCleanup(dryRun);
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const dryRun = body.dryRun !== false; // Default to true (safe mode)
        return handleCleanup(dryRun);
    } catch (error) {
        return NextResponse.json(
            { error: 'Invalid request body', details: String(error) },
            { status: 400 }
        );
    }
}

async function handleCleanup(dryRun: boolean) {
    try {
        const auth = googleAuthService.getWriteAuth();
        await auth.authorize();
        const drive = google.drive({ version: 'v3', auth });

        console.log('[Drive Cleanup] Starting cleanup...');
        console.log('[Drive Cleanup] Service account:', settings.gcs.clientEmail);
        console.log('[Drive Cleanup] Dry run mode:', dryRun);

        // List all files owned by the service account (not in trash)
        const filesResponse = await drive.files.list({
            q: 'trashed = false',
            fields: 'files(id, name, mimeType, size, createdTime, modifiedTime, owners)',
            pageSize: 1000,
            orderBy: 'createdTime asc', // Oldest first
        });

        const files = filesResponse.data.files || [];
        console.log(`[Drive Cleanup] Found ${files.length} files (not in trash)`);

        // Also check for files in trash
        const trashResponse = await drive.files.list({
            q: 'trashed = true',
            fields: 'files(id, name, mimeType, size, createdTime, modifiedTime, owners)',
            pageSize: 1000,
            orderBy: 'createdTime asc',
        });

        const trashFiles = trashResponse.data.files || [];
        console.log(`[Drive Cleanup] Found ${trashFiles.length} files in trash`);

        // Filter to only files owned by the service account
        const serviceAccountEmail = settings.gcs.clientEmail;
        const ownedFiles = files.filter(file => 
            file.owners?.some(owner => owner.emailAddress === serviceAccountEmail)
        );

        const ownedTrashFiles = trashFiles.filter(file => 
            file.owners?.some(owner => owner.emailAddress === serviceAccountEmail)
        );

        console.log(`[Drive Cleanup] ${ownedFiles.length} files owned by service account (not in trash)`);
        console.log(`[Drive Cleanup] ${ownedTrashFiles.length} files owned by service account (in trash)`);

        // Calculate total size including trash
        const trashTotalSize = ownedTrashFiles.reduce((sum, file) => {
            return sum + (parseInt(file.size || '0', 10));
        }, 0);
        const trashTotalSizeMB = (trashTotalSize / (1024 * 1024)).toFixed(2);
        console.log(`[Drive Cleanup] Trash contains ${trashTotalSizeMB} MB of service account files`);

        // Calculate total size
        const totalSize = ownedFiles.reduce((sum, file) => {
            return sum + (parseInt(file.size || '0', 10));
        }, 0);
        const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(2);

        const result: {
            dryRun: boolean;
            serviceAccountEmail: string | undefined;
            totalFiles: number;
            totalSizeBytes: number;
            totalSizeMB: number;
            trashFiles: number;
            trashSizeBytes: number;
            trashSizeMB: number;
            files: Array<{
                id: string | null | undefined;
                name: string | null | undefined;
                mimeType: string | null | undefined;
                size: number;
                sizeMB: string;
                createdTime: string | null | undefined;
                modifiedTime: string | null | undefined;
            }>;
            deleted: string[];
            errors: Array<{ fileId: string; error: string }>;
            trashEmptied?: boolean;
            trashError?: string;
        } = {
            dryRun,
            serviceAccountEmail,
            totalFiles: ownedFiles.length,
            totalSizeBytes: totalSize,
            totalSizeMB: parseFloat(totalSizeMB),
            trashFiles: ownedTrashFiles.length,
            trashSizeBytes: trashTotalSize,
            trashSizeMB: parseFloat(trashTotalSizeMB),
            files: ownedFiles.map(file => ({
                id: file.id,
                name: file.name,
                mimeType: file.mimeType,
                size: file.size ? parseInt(file.size, 10) : 0,
                sizeMB: file.size ? (parseInt(file.size, 10) / (1024 * 1024)).toFixed(2) : '0',
                createdTime: file.createdTime,
                modifiedTime: file.modifiedTime,
            })),
            deleted: [],
            errors: [],
        };

        if (!dryRun) {
            // Delete files if any exist
            if (ownedFiles.length > 0) {
                console.log('[Drive Cleanup] Deleting files...');
                
                // Delete files one by one (batch delete might be faster but less safe)
                for (const file of ownedFiles) {
                    try {
                        await drive.files.delete({
                            fileId: file.id!,
                        });
                        result.deleted.push(file.id!);
                        console.log(`[Drive Cleanup] Deleted: ${file.name} (${file.id})`);
                    } catch (error: any) {
                        const errorMsg = error?.message || String(error);
                        result.errors.push({ fileId: file.id!, error: errorMsg });
                        console.error(`[Drive Cleanup] Failed to delete ${file.name} (${file.id}):`, errorMsg);
                    }
                }
            }

            // Always empty trash (even if no files were deleted, trash may contain old files)
            // Deleted files still count against quota until trash is emptied
            try {
                console.log('[Drive Cleanup] Emptying trash...');
                await drive.files.emptyTrash({});
                console.log('[Drive Cleanup] Trash emptied successfully');
                result.trashEmptied = true;
            } catch (trashError: any) {
                console.error('[Drive Cleanup] Failed to empty trash:', trashError?.message || trashError);
                result.trashError = trashError?.message || String(trashError);
            }
        } else {
            console.log('[Drive Cleanup] Dry run mode - no files deleted, trash not emptied');
        }

        const message = dryRun 
            ? `Found ${ownedFiles.length} files (${totalSizeMB} MB) and ${ownedTrashFiles.length} files in trash (${trashTotalSizeMB} MB). Run with dryRun=false to delete and empty trash.`
            : `Deleted ${result.deleted.length} files. ${result.errors.length} errors. Trash emptied: ${result.trashEmptied ? 'Yes' : 'No'}.`;

        return NextResponse.json({
            success: true,
            message,
            ...result,
        });
    } catch (error: any) {
        console.error('[Drive Cleanup] Error:', error);
        return NextResponse.json(
            { 
                error: 'Failed to cleanup Drive', 
                details: error?.message || String(error),
                stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
            },
            { status: 500 }
        );
    }
}

