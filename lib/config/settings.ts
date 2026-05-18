/** Safe at build time when env vars are not injected yet. */
function envTrim(value: string | undefined, fallback = ''): string {
    return (value ?? fallback).trim();
}

export const settings = {
    gemini: {
        apiKey: process.env.GEMINI_API_KEY!,
        model: 'gemini-2.5-flash' as const,
        embeddingModel: 'gemini-embedding-001' as const,
        temperature: 0.1,
        maxOutputTokens: 65_536,
    },
    gcs: {
        bucketName: process.env.GCS_BUCKET_NAME!,
        projectId: process.env.GCP_PROJECT_ID!,
        clientEmail: process.env.GCP_CLIENT_EMAIL!,
        privateKey: (process.env.GCP_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
    },
    googleDrive: {
        defaultFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
    },
    auth: {
        sitePassword: process.env.SITE_PASSWORD!,
    },
    zohoDesk: {
        clientId: envTrim(process.env.ZOHO_CLIENT_ID),
        clientSecret: envTrim(process.env.ZOHO_CLIENT_SECRET),
        refreshToken: envTrim(process.env.ZOHO_REFRESH_TOKEN),
        orgId: envTrim(process.env.ZOHO_ORG_ID),
        datacenter: envTrim(process.env.ZOHO_DATACENTER, 'com.au'),
        /**
         * Hostname only (no https). Defaults to accounts.zoho.${datacenter}.
         * Set ZOHO_ACCOUNTS_HOST=accounts.zoho.com when OAuth tokens show api_domain www.zohoapis.com.
         */
        accountsHost: envTrim(
            process.env.ZOHO_ACCOUNTS_HOST,
            `accounts.zoho.${envTrim(process.env.ZOHO_DATACENTER, 'com.au')}`,
        ),
        /**
         * Hostname only. Defaults to desk.zoho.${datacenter}.
         * Set ZOHO_DESK_HOST=desk.zoho.com if Desk REST is on the global host (not desk.zoho.com.au).
         */
        deskApiHost: envTrim(
            process.env.ZOHO_DESK_HOST,
            `desk.zoho.${envTrim(process.env.ZOHO_DATACENTER, 'com.au')}`,
        ),
        /** Web-based Zoho clients: same redirect_uri as API Console when exchanging / refreshing tokens */
        oauthRedirectUri: envTrim(process.env.ZOHO_REDIRECT_URI),
    },
};
