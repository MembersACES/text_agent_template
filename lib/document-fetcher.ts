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
