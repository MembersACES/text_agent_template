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

    // First, list ALL files to debug
    const debugResponse = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'files(id, name, mimeType)',
        pageSize: 100,
    });

    console.log(`[Document Fetcher] Found ${debugResponse.data.files?.length || 0} total files in folder ${folderId}`);
    if (debugResponse.data.files && debugResponse.data.files.length > 0) {
        console.log('[Document Fetcher] File types:', debugResponse.data.files.map(f => `${f.name}: ${f.mimeType}`));
    }

    const response = await drive.files.list({
        // Include common document and image types
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

    console.log(`[Document Fetcher] Found ${response.data.files?.length || 0} supported files after filtering`);

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

/**
 * Download a file from Google Drive as a Buffer
 */
export async function downloadDriveFile(fileId: string): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
    const auth = getGoogleAuth();
    const drive = google.drive({ version: 'v3', auth });

    // Get metadata first
    const metadata = await drive.files.get({
        fileId: fileId,
        fields: 'name,mimeType',
    });

    const name = metadata.data.name || 'document';
    const mimeType = metadata.data.mimeType || 'application/octet-stream';

    // Download content
    const response = await drive.files.get(
        { fileId: fileId, alt: 'media' },
        { responseType: 'arraybuffer' }
    );

    return {
        buffer: Buffer.from(response.data as ArrayBuffer),
        mimeType,
        name,
    };
}
