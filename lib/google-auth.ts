import { google } from 'googleapis';
import { Storage } from '@google-cloud/storage';

// Initialize Google Auth from environment variables (read-only for KB)
export function getGoogleAuth() {
    const credentials = {
        client_email: process.env.GCP_CLIENT_EMAIL,
        private_key: process.env.GCP_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    };

    return new google.auth.GoogleAuth({
        credentials,
        scopes: [
            'https://www.googleapis.com/auth/documents.readonly',
            'https://www.googleapis.com/auth/drive.readonly',
            'https://www.googleapis.com/auth/spreadsheets.readonly',
        ],
    });
}

// Google Auth with write permissions for creating Google Sheets
// Uses JWT instead of GoogleAuth to avoid token caching issues with readonly scopes
export function getGoogleAuthWrite() {
    return new google.auth.JWT({
        email: process.env.GCP_CLIENT_EMAIL,
        key: process.env.GCP_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive', // Use full drive scope instead of drive.file for creating new files
        ],
    });
}

// Initialize Cloud Storage client
export function getStorageClient() {
    return new Storage({
        credentials: {
            client_email: process.env.GCP_CLIENT_EMAIL,
            private_key: process.env.GCP_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        },
        projectId: process.env.GCP_PROJECT_ID,
    });
}
