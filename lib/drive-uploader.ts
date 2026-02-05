import { google } from 'googleapis';
import { getGoogleAuthWrite } from './google-auth';
import { Readable } from 'stream';

/**
 * Uploads an Excel file buffer to Google Drive in the specified folder
 * @param fileBuffer - The Excel file buffer
 * @param fileName - The name for the file
 * @param folderId - The Google Drive folder ID to upload to
 * @returns File ID and URL
 */
export async function uploadExcelToDrive(
    fileBuffer: Buffer,
    fileName: string,
    folderId: string
): Promise<{ fileId: string; url: string }> {
    const auth = getGoogleAuthWrite();
    await auth.authorize();
    const drive = google.drive({ version: 'v3', auth });

    console.log('[Drive Uploader] Uploading Excel file to Drive...');
    console.log('[Drive Uploader] File name:', fileName);
    console.log('[Drive Uploader] Folder ID:', folderId);
    console.log('[Drive Uploader] File size:', fileBuffer.length, 'bytes');

    try {
        // Convert Buffer to Stream (googleapis requires a stream for media.body)
        const stream = Readable.from(fileBuffer);

        // Upload file to Drive
        const file = await drive.files.create({
            requestBody: {
                name: fileName,
                parents: [folderId], // Upload directly to the folder
            },
            media: {
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                body: stream,
            },
            fields: 'id, name, webViewLink, webContentLink',
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

