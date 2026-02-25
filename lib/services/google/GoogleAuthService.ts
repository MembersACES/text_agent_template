import { google } from 'googleapis';
import { Storage } from '@google-cloud/storage';
import { settings } from '@/lib/config/settings';

export class GoogleAuthService {
    private readonly credentials: { client_email: string; private_key: string };

    constructor() {
        this.credentials = {
            client_email: settings.gcs.clientEmail,
            private_key: settings.gcs.privateKey,
        };
    }

    /** Read-only auth for Docs, Drive, and Sheets. */
    getReadAuth() {
        return new google.auth.GoogleAuth({
            credentials: this.credentials,
            scopes: [
                'https://www.googleapis.com/auth/documents.readonly',
                'https://www.googleapis.com/auth/drive.readonly',
                'https://www.googleapis.com/auth/spreadsheets.readonly',
            ],
        });
    }

    /**
     * JWT auth with write permissions for creating Sheets and uploading to Drive.
     * Uses JWT instead of GoogleAuth to avoid token caching issues with readonly scopes.
     */
    getWriteAuth() {
        return new google.auth.JWT({
            email: this.credentials.client_email,
            key: this.credentials.private_key,
            scopes: [
                'https://www.googleapis.com/auth/spreadsheets',
                'https://www.googleapis.com/auth/drive',
            ],
        });
    }

    getStorageClient() {
        return new Storage({
            credentials: this.credentials,
            projectId: settings.gcs.projectId,
        });
    }
}

export const googleAuthService = new GoogleAuthService();
