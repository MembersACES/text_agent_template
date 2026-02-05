import { google } from 'googleapis';
import { getGoogleAuthWrite } from './google-auth';
import { Readable } from 'stream';

/**
 * Uploads a file buffer to Google Drive in the specified folder
 * @param fileBuffer - The file buffer
 * @param fileName - The name for the file
 * @param mimeType - The MIME type of the file
 * @param folderId - The Google Drive folder ID to upload to
 * @returns File ID and URL
 */
export async function uploadFileToDrive(
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string,
    folderId: string
): Promise<{ fileId: string; url: string }> {
    const auth = getGoogleAuthWrite();
    await auth.authorize();
    const drive = google.drive({ version: 'v3', auth });

    console.log('[Drive Uploader] Uploading file to Drive...');
    console.log('[Drive Uploader] File name:', fileName);
    console.log('[Drive Uploader] MIME type:', mimeType);
    console.log('[Drive Uploader] Folder ID:', folderId);
    console.log('[Drive Uploader] File size:', fileBuffer.length, 'bytes');

    try {
        // Convert Buffer to Stream (googleapis requires a stream for media.body)
        const stream = Readable.from(fileBuffer);

        // Upload file to Drive
        // Try with supportsAllDrives for Shared Drives support
        const file = await drive.files.create({
            requestBody: {
                name: fileName,
                parents: [folderId], // Upload directly to the folder
            },
            media: {
                mimeType: mimeType,
                body: stream,
            },
            fields: 'id, name, webViewLink, webContentLink',
            supportsAllDrives: true,
        });

        const fileId = file.data.id!;
        const url = file.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;

        console.log('[Drive Uploader] File uploaded successfully');
        console.log('[Drive Uploader] File ID:', fileId);
        console.log('[Drive Uploader] URL:', url);

        return { fileId, url };
    } catch (error: any) {
        console.error('[Drive Uploader] Upload failed:', error?.message || error);
        if (error?.response) {
            console.error('[Drive Uploader] Response data:', JSON.stringify(error.response.data, null, 2));
        }
        throw error;
    }
}

/**
 * Uploads an Excel file buffer to Google Drive (convenience wrapper)
 */
export async function uploadExcelToDrive(
    fileBuffer: Buffer,
    fileName: string,
    folderId: string
): Promise<{ fileId: string; url: string }> {
    return uploadFileToDrive(
        fileBuffer,
        fileName,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        folderId
    );
}

/**
 * Uploads multiple files to Google Drive
 * @param files - Array of files to upload
 * @param folderId - The Google Drive folder ID to upload to
 * @returns Array of uploaded file info
 */
export async function uploadFilesToDrive(
    files: Array<{ buffer: Buffer; fileName: string; mimeType: string }>,
    folderId: string
): Promise<Array<{ fileId: string; url: string; fileName: string }>> {
    const results = [];
    
    for (const file of files) {
        try {
            const result = await uploadFileToDrive(file.buffer, file.fileName, file.mimeType, folderId);
            results.push({
                ...result,
                fileName: file.fileName,
            });
        } catch (error: any) {
            console.error(`[Drive Uploader] Failed to upload ${file.fileName}:`, error?.message || error);
            // Continue with other files even if one fails
        }
    }
    
    return results;
}

