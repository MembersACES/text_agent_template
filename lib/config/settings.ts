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
        clientId: process.env.ZOHO_CLIENT_ID!.trim(),
        clientSecret: process.env.ZOHO_CLIENT_SECRET!.trim(),
        refreshToken: process.env.ZOHO_REFRESH_TOKEN!.trim(),
        orgId: process.env.ZOHO_ORG_ID!.trim(),
        datacenter: (process.env.ZOHO_DATACENTER || 'com.au').trim(),
        /**
         * Hostname only (no https). Defaults to accounts.zoho.${datacenter}.
         * Set ZOHO_ACCOUNTS_HOST=accounts.zoho.com when OAuth tokens show api_domain www.zohoapis.com.
         */
        accountsHost: (
            process.env.ZOHO_ACCOUNTS_HOST?.trim()
            || `accounts.zoho.${(process.env.ZOHO_DATACENTER || 'com.au').trim()}`
        ).trim(),
        /**
         * Hostname only. Defaults to desk.zoho.${datacenter}.
         * Set ZOHO_DESK_HOST=desk.zoho.com if Desk REST is on the global host (not desk.zoho.com.au).
         */
        deskApiHost: (
            process.env.ZOHO_DESK_HOST?.trim()
            || `desk.zoho.${(process.env.ZOHO_DATACENTER || 'com.au').trim()}`
        ).trim(),
        /** Web-based Zoho clients: same redirect_uri as API Console when exchanging / refreshing tokens */
        oauthRedirectUri: process.env.ZOHO_REDIRECT_URI?.trim() || '',
    },
};
