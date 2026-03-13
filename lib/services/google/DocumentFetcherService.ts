import { google } from 'googleapis';
import { getLogger } from '@/lib/config/logger';
import { googleAuthService } from '@/lib/services/google/GoogleAuthService';

const logger = getLogger('DocumentFetcherService');

export class DocumentFetcherService {
    async fetchDoc(documentId: string): Promise<string> {
        const auth = googleAuthService.getReadAuth();
        const docs = google.docs({ version: 'v1', auth });

        const response = await docs.documents.get({ documentId });
        const document = response.data;

        let text = '';
        if (document.body?.content) {
            for (const element of document.body.content) {
                if (element.paragraph?.elements) {
                    for (const elem of element.paragraph.elements) {
                        if (elem.textRun?.content) {
                            text += elem.textRun.content;
                        }
                    }
                }
            }
        }

        return text.trim();
    }

    async getDocumentMetadata(documentId: string): Promise<{ modifiedTime: string; name: string }> {
        const auth = googleAuthService.getReadAuth();
        const drive = google.drive({ version: 'v3', auth });

        const response = await drive.files.get({
            fileId: documentId,
            fields: 'modifiedTime,name',
        });

        return {
            modifiedTime: response.data.modifiedTime || '',
            name: response.data.name || '',
        };
    }

    async fetchSheet(spreadsheetId: string): Promise<string> {
        const auth = googleAuthService.getReadAuth();
        const sheets = google.sheets({ version: 'v4', auth });

        const meta = await sheets.spreadsheets.get({ spreadsheetId });
        const sheetTitles =
            meta.data.sheets?.map(s => s.properties?.title).filter((t): t is string => !!t) || [];

        if (sheetTitles.length === 0) return '';

        let result = '';

        for (const title of sheetTitles) {
            const range = `${title}!A1:Z200`;
            const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
            const rows = res.data.values || [];

            if (rows.length === 0) continue;

            result += `Sheet: ${title}\n`;
            for (const row of rows) {
                const line = (row as string[]).join('\t');
                if (line.trim().length > 0) result += `${line}\n`;
            }
            result += '\n';
        }

        return result.trim();
    }

    async listFilesInFolder(folderId: string): Promise<Array<{
        id: string; name: string; modifiedTime: string; webViewLink: string; mimeType: string;
    }>> {
        const auth = googleAuthService.getReadAuth();
        const drive = google.drive({ version: 'v3', auth });

        const debugResponse = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: 'files(id, name, mimeType)',
            pageSize: 100,
        });

        logger.info(`Found ${debugResponse.data.files?.length || 0} total files in folder ${folderId}`);
        if (debugResponse.data.files?.length) {
            logger.debug(`File types: ${debugResponse.data.files.map(f => `${f.name}: ${f.mimeType}`).join(', ')}`);
        }

        const response = await drive.files.list({
            q: `'${folderId}' in parents and (
                mimeType = 'application/vnd.google-apps.document' or
                mimeType = 'application/vnd.google-apps.spreadsheet' or
                mimeType = 'application/pdf' or
                mimeType = 'image/jpeg' or
                mimeType = 'image/png' or
                mimeType = 'image/webp' or
                mimeType = 'application/msword' or
                mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' or
                mimeType = 'text/csv' or
                mimeType = 'text/plain'
            ) and trashed = false`,
            fields: 'files(id, name, modifiedTime, webViewLink, mimeType)',
            pageSize: 100,
        });

        logger.info(`Found ${response.data.files?.length || 0} supported files after filtering`);

        return (response.data.files || []).map(f => ({
            id: f.id || '',
            name: f.name || '',
            modifiedTime: f.modifiedTime || '',
            webViewLink: f.webViewLink || '',
            mimeType: f.mimeType || '',
        }));
    }

    async getFolderMetadata(folderId: string): Promise<{ name: string }> {
        const auth = googleAuthService.getReadAuth();
        const drive = google.drive({ version: 'v3', auth });

        const response = await drive.files.get({ fileId: folderId, fields: 'name' });
        return { name: response.data.name || 'Knowledge Base' };
    }

    async downloadFile(fileId: string): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
        const auth = googleAuthService.getReadAuth();
        const drive = google.drive({ version: 'v3', auth });

        const metadata = await drive.files.get({ fileId, fields: 'name,mimeType' });
        const name = metadata.data.name || 'document';
        const mimeType = metadata.data.mimeType || 'application/octet-stream';

        const response = await drive.files.get(
            { fileId, alt: 'media' },
            { responseType: 'arraybuffer' },
        );

        return { buffer: Buffer.from(response.data as ArrayBuffer), mimeType, name };
    }
}

export const documentFetcherService = new DocumentFetcherService();
