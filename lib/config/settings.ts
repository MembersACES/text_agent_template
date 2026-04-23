function trimTrailingSlashes(s: string): string {
    return s.replace(/\/+$/, '');
}

export const settings = {
    /**
     * Public site URL (no trailing slash), e.g. for server-side `fetch` to this app's API routes.
     * Set `NEXT_PUBLIC_APP_URL` in production so tools can POST back (e.g. RGR persistence).
     */
    app: {
        publicBaseUrl: trimTrailingSlashes(process.env.NEXT_PUBLIC_APP_URL ?? ''),
    },
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
        clientId: process.env.ZOHO_CLIENT_ID!,
        clientSecret: process.env.ZOHO_CLIENT_SECRET!,
        refreshToken: process.env.ZOHO_REFRESH_TOKEN!,
        orgId: process.env.ZOHO_ORG_ID!,
        datacenter: process.env.ZOHO_DATACENTER || 'com.au',
    },
    /** GVACA (Responsible Gambling Register) — fallback venue when the request has none. */
    gvaca: {
        defaultVenueId: process.env.GVACA_DEFAULT_VENUE_ID ?? '',
    },
};
