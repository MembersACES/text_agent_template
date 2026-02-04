import { google } from 'googleapis';
import { getGoogleAuth } from './google-auth';

// Fetch document content from Google Docs
export async function fetchGoogleDoc(documentId: string): Promise<string> {
    const auth = getGoogleAuth();
    const docs = google.docs({ version: 'v1', auth });

    const response = await docs.documents.get({ documentId });
    const document = response.data;

    // Extract text from document structure
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

// Get document metadata (for checking last modified time)
export async function getDocumentMetadata(documentId: string) {
    const auth = getGoogleAuth();
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

// Fetch spreadsheet content from Google Sheets
export async function fetchGoogleSheet(spreadsheetId: string): Promise<string> {
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    // Get metadata to discover sheet names
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetTitles =
        meta.data.sheets?.map(s => s.properties?.title).filter((t): t is string => !!t) || [];

    if (sheetTitles.length === 0) return '';

    let result = '';

    for (const title of sheetTitles) {
        // Read a reasonable range; adjust if needed
        const range = `${title}!A1:Z200`;
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range,
        });
        const rows = res.data.values || [];

        if (rows.length === 0) continue;

        result += `Sheet: ${title}\n`;
        for (const row of rows) {
            const line = (row as string[]).join('\t');
            if (line.trim().length > 0) {
                result += `${line}\n`;
            }
        }
        result += '\n';
    }

    return result.trim();
}

// List files in a Google Drive folder (Docs + Sheets)
export async function listFilesInFolder(folderId: string): Promise<Array<{ id: string; name: string; modifiedTime: string; webViewLink: string; mimeType: string }>> {
    const auth = getGoogleAuth();
    const drive = google.drive({ version: 'v3', auth });

    const response = await drive.files.list({
        q: `'${folderId}' in parents and (mimeType = 'application/vnd.google-apps.document' or mimeType = 'application/vnd.google-apps.spreadsheet') and trashed = false`,
        fields: 'files(id, name, modifiedTime, webViewLink, mimeType)',
        pageSize: 100, // Limit to 100 files to avoid overwhelming
    });

    return (response.data.files || []).map(f => ({
        id: f.id || '',
        name: f.name || '',
        modifiedTime: f.modifiedTime || '',
        webViewLink: f.webViewLink || '',
        mimeType: f.mimeType || '',
    }));
}

// Get folder metadata
export async function getFolderMetadata(folderId: string) {
    const auth = getGoogleAuth();
    const drive = google.drive({ version: 'v3', auth });

    const response = await drive.files.get({
        fileId: folderId,
        fields: 'name',
    });

    return {
        name: response.data.name || 'Knowledge Base',
    };
}
