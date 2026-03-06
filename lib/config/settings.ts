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
        clientId: process.env.ZOHO_CLIENT_ID!,
        clientSecret: process.env.ZOHO_CLIENT_SECRET!,
        refreshToken: process.env.ZOHO_REFRESH_TOKEN!,
        orgId: process.env.ZOHO_ORG_ID!,
        datacenter: process.env.ZOHO_DATACENTER || 'com.au',
        portalId: process.env.ZOHO_PORTAL_ID!,
    },
};
