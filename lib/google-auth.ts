import { google } from 'googleapis';
import { Storage } from '@google-cloud/storage';

// Initialize Google Auth from environment variables
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
