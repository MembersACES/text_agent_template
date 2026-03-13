import { google } from 'googleapis';
import { Readable } from 'stream';
import { getLogger } from '@/lib/config/logger';
import { googleAuthService } from '@/lib/services/google/GoogleAuthService';

const logger = getLogger('DriveUploaderService');

export class DriveUploaderService {
    async uploadFile(
        fileBuffer: Buffer,
        fileName: string,
        mimeType: string,
        folderId: string,
    ): Promise<{ fileId: string; url: string }> {
        const auth = googleAuthService.getWriteAuth();
        await auth.authorize();
        const drive = google.drive({ version: 'v3', auth });

        logger.info(`Uploading file to Drive: ${fileName} (${fileBuffer.length} bytes) → folder ${folderId}`);

        try {
            const stream = Readable.from(fileBuffer);

            const file = await drive.files.create({
                requestBody: { name: fileName, parents: [folderId] },
                media: { mimeType, body: stream },
                fields: 'id, name, webViewLink, webContentLink',
                supportsAllDrives: true,
            });

            const fileId = file.data.id!;
            const url = file.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;

            logger.info(`File uploaded successfully: ${fileId} — ${url}`);
            return { fileId, url };
        } catch (error: any) {
            logger.error(`Upload failed: ${error?.message || error}`);
            if (error?.response) {
                logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
            }
            throw error;
        }
    }

    async uploadExcel(
        fileBuffer: Buffer,
        fileName: string,
        folderId: string,
    ): Promise<{ fileId: string; url: string }> {
        return this.uploadFile(
            fileBuffer,
            fileName,
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            folderId,
        );
    }

    async uploadFiles(
        files: Array<{ buffer: Buffer; fileName: string; mimeType: string }>,
        folderId: string,
    ): Promise<Array<{ fileId: string; url: string; fileName: string }>> {
        const results = [];

        for (const file of files) {
            try {
                const result = await this.uploadFile(file.buffer, file.fileName, file.mimeType, folderId);
                results.push({ ...result, fileName: file.fileName });
            } catch (error: any) {
                logger.error(`Failed to upload ${file.fileName}: ${error?.message || error}`);
                // Continue with remaining files
            }
        }

        return results;
    }
}

export const driveUploaderService = new DriveUploaderService();
