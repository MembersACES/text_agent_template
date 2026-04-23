import { google } from 'googleapis';
import { getLogger } from '@/lib/config/logger';
import { settings } from '@/lib/config/settings';
import { googleAuthService } from '@/lib/services/google/GoogleAuthService';

const logger = getLogger('DocumentFetcherService');

/** Shared to both Team Drive content and items shared *into* the service account (e.g. My Drive folders). */
const DRIVE_LIST_BASE = {
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
} as const;

const CORPORA_MODES = ['user', 'allDrives'] as const;

const SHARED_DRIVE_GET_OPTS = { supportsAllDrives: true } as const;

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
            ...SHARED_DRIVE_GET_OPTS,
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
        const q = `'${folderId}' in parents and trashed = false`;
        const fileFields = 'id, name, mimeType, modifiedTime, webViewLink, shortcutDetails';

        const byId = new Map<
            string,
            { id: string; name?: string | null; mimeType?: string | null; modifiedTime?: string | null; webViewLink?: string | null; shortcutDetails?: { targetId?: string | null } | null }
        >();

        for (const corpora of CORPORA_MODES) {
            let pageToken: string | undefined;
            do {
                const res = await drive.files.list({
                    q,
                    fields: `nextPageToken, files(${fileFields}), incompleteSearch`,
                    pageSize: 100,
                    pageToken,
                    corpora,
                    ...DRIVE_LIST_BASE,
                });
                for (const f of res.data.files || []) {
                    if (f.id) {
                        byId.set(f.id, {
                            id: f.id,
                            name: f.name,
                            mimeType: f.mimeType,
                            modifiedTime: f.modifiedTime,
                            webViewLink: f.webViewLink,
                            shortcutDetails: f.shortcutDetails
                                ? { targetId: f.shortcutDetails.targetId }
                                : null,
                        });
                    }
                }
                if (res.data.incompleteSearch) {
                    logger.warn(`Drive files.list (corpora=${corpora}) incompleteSearch; some files may be missing.`);
                }
                pageToken = res.data.nextPageToken || undefined;
            } while (pageToken);
        }

        const raw = [...byId.values()];
        logger.info(`Found ${raw.length} total files in folder ${folderId} (merged user + allDrives corpora)`);
        if (raw.length) {
            logger.debug(`File types: ${raw.map(f => `${f.name}: ${f.mimeType}`).join(', ')}`);
        } else {
            try {
                const folderMeta = await drive.files.get({
                    fileId: folderId,
                    fields: 'id, name, driveId, mimeType',
                    ...SHARED_DRIVE_GET_OPTS,
                });
                const sa = settings.gcs.clientEmail || '';
                logger.warn(
                    `Folder is readable (name="${folderMeta.data.name}", driveId=${folderMeta.data.driveId ?? 'n/a'}) but has 0 children. ` +
                        `Share with ${sa} and ensure *files* inherit access, or list may miss shortcuts (next step: resolve if added).`,
                );
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                const sa = settings.gcs.clientEmail || '(set GCP_CLIENT_EMAIL in .env)';
                logger.error(
                    `Service account cannot read folder ${folderId} (${msg}). ` +
                        `Share this folder (or the Shared Drive) with ${sa} as Viewer+ (or add that account to the Shared Drive). ` +
                        `If "File not found", verify the id from: drive.google.com/drive/folders/…`,
                );
            }
        }

        const SUPPORTED = new Set([
            'application/vnd.google-apps.document',
            'application/vnd.google-apps.spreadsheet',
            'application/pdf',
            'image/jpeg',
            'image/png',
            'image/webp',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/csv',
            'text/plain',
        ]);

        const resolved: Array<{
            id: string;
            name: string;
            modifiedTime: string;
            webViewLink: string;
            mimeType: string;
        }> = [];

        for (const f of raw) {
            if (f.mimeType === 'application/vnd.google-apps.shortcut' && f.shortcutDetails?.targetId) {
                try {
                    const t = await drive.files.get({
                        fileId: f.shortcutDetails.targetId,
                        fields: 'id, name, mimeType, modifiedTime, webViewLink',
                        ...SHARED_DRIVE_GET_OPTS,
                    });
                    const data = t.data;
                    if (!data.id || !data.mimeType) continue;
                    if (!SUPPORTED.has(data.mimeType)) continue;
                    resolved.push({
                        id: data.id,
                        name: (f.name || data.name || 'file') as string,
                        modifiedTime: data.modifiedTime || '',
                        webViewLink: data.webViewLink || '',
                        mimeType: data.mimeType,
                    });
                } catch (e: unknown) {
                    logger.warn(`Could not resolve shortcut ${f.id} → ${f.shortcutDetails?.targetId}: ${e instanceof Error ? e.message : e}`);
                }
                continue;
            }
            if (!f.mimeType || !SUPPORTED.has(f.mimeType)) continue;
            resolved.push({
                id: f.id,
                name: f.name || '',
                modifiedTime: f.modifiedTime || '',
                webViewLink: f.webViewLink || '',
                mimeType: f.mimeType,
            });
        }

        logger.info(`Found ${resolved.length} supported files after filter / shortcut resolution`);

        return resolved;
    }

    async getFolderMetadata(folderId: string): Promise<{ name: string }> {
        const auth = googleAuthService.getReadAuth();
        const drive = google.drive({ version: 'v3', auth });

        const response = await drive.files.get({ fileId: folderId, fields: 'name', ...SHARED_DRIVE_GET_OPTS });
        return { name: response.data.name || 'Knowledge Base' };
    }

    async downloadFile(fileId: string): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
        const auth = googleAuthService.getReadAuth();
        const drive = google.drive({ version: 'v3', auth });

        const metadata = await drive.files.get({ fileId, fields: 'name,mimeType', ...SHARED_DRIVE_GET_OPTS });
        const name = metadata.data.name || 'document';
        const mimeType = metadata.data.mimeType || 'application/octet-stream';

        const response = await drive.files.get(
            { fileId, alt: 'media', ...SHARED_DRIVE_GET_OPTS },
            { responseType: 'arraybuffer' },
        );

        return { buffer: Buffer.from(response.data as ArrayBuffer), mimeType, name };
    }
}

export const documentFetcherService = new DocumentFetcherService();
