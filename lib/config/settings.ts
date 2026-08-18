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

    /**
     * dotWMS — the Syspro-era warehouse lookup that translates a BigCommerce
     * order number into a Syspro sales-order (freight) reference and enforces
     * the delivery-email match. Retired at Odoo go-live (end Oct 2026) — see
     * `freight.provider`. Creds re-used from the existing dotWMS key (limited
     * blast radius: every call needs order# + email).
     */
    dotwms: {
        baseUrl: envTrim(process.env.DOTWMS_BASE_URL, 'https://f.dotwms.com/api/1.0/GetFileExport/'),
        apiKey: envTrim(process.env.DOTWMS_API_KEY),
        instanceCode: envTrim(process.env.DOTWMS_INSTANCE_CODE, 'H2G'),
        exportFileType: envTrim(process.env.DOTWMS_EXPORT_FILE_TYPE, 'GenericSQL_1323'),
        /**
         * Prefix dotWMS expects on a 6-digit BigCommerce order number (default "BC-").
         * ASSUMPTION flagged for Welly ("is that prefix always there?") — kept
         * configurable so it can change without a code edit.
         */
        orderPrefix: envTrim(process.env.DOTWMS_ORDER_PREFIX, 'BC-'),
        /**
         * Prefix dotWMS expects on an 8-digit Syspro number (default "SO"). Confirmed
         * 4 Aug 2026: dotWMS resolves an 8-digit key ONLY when SO-prefixed, and
         * enforces the email on it — so 8-digit orders route through dotWMS too.
         */
        sysproPrefix: envTrim(process.env.DOTWMS_SYSPRO_PREFIX, 'SO'),
    },

    /**
     * MachShip — freight/consignment lookup by reference (boxes, courier, ETA,
     * tracking link). Read-only tracking use. A dedicated read-only API user was
     * agreed at the 16 Jul meeting but is not yet provisioned; until then the
     * existing token is used.
     */
    machship: {
        baseUrl: envTrim(process.env.MACHSHIP_BASE_URL, 'https://live.machship.com'),
        token: envTrim(process.env.MACHSHIP_TOKEN),
        /**
         * When true, MachShipService returns a bundled fixture in the known
         * response shape instead of calling live MachShip. For development before
         * a real order that exists in BOTH dotWMS and MachShip is available
         * (blocked on Iri's example orders). Unset / "false" => live calls.
         */
        useFixture: envTrim(process.env.MACHSHIP_USE_FIXTURE) === 'true',
    },

    /**
     * Freight-reference resolution — the swappable seam of phase-1 order tracking.
     * Switch `provider` to 'odoo' at Odoo go-live (end Oct 2026) once an
     * OdooReferenceResolver is registered in FreightReferenceResolverFactory.
     */
    freight: {
        provider: envTrim(process.env.FREIGHT_PROVIDER, 'dotwms'),
        /** Confirmed with Iri (28 Jul 2026): only surface orders from the last 60 days. */
        lookbackDays: Number(envTrim(process.env.FREIGHT_LOOKBACK_DAYS, '60')),
        /**
         * Refuse to show shipment status unless the delivery email was verified.
         * Defence in depth: a direct 8-digit Syspro-number lookup bypasses dotWMS
         * and therefore the email gate, so it resolves `verified:false`.
         */
        requireVerifiedEmail: envTrim(process.env.FREIGHT_REQUIRE_VERIFIED_EMAIL, 'true') !== 'false',
        /**
         * Master switch for LIVE order tracking in the chat gate. Stays FALSE until
         * the API hardening lands (see API-Hardening-Plan.md). While false, the
         * OrderStatusGate rewrite's tracking path is inert and the existing
         * "can't look up your order" deflection continues to serve.
         */
        trackingEnabled: envTrim(process.env.ORDER_TRACKING_ENABLED) === 'true',
    },

    /**
     * Internal CS/WH team alert emails. SERVER-SIDE ONLY, and a SIDE-EFFECTING
     * action — kept OFF until the API hardening lands (an open endpoint could
     * spam the HTG Helpdesk). `fromAddress` is deliberately swappable (Morgan's
     * choice, likely to change).
     *
     * TRANSPORT (`ALERTS_TRANSPORT`): the CHOSEN path is `webhook` → posts the
     * alert JSON to an n8n webhook, which validates the shared secret and sends
     * the email. This SUPERSEDES the Workspace-SMTP / app-password route (`smtp`,
     * retained as a selectable fallback). `log` (default) is the safe no-send.
     */
    alerts: {
        enabled: envTrim(process.env.ALERTS_ENABLED) === 'true',
        transport: envTrim(process.env.ALERTS_TRANSPORT, 'log'), // 'log' | 'webhook' | 'smtp'
        fromAddress: envTrim(process.env.ALERTS_FROM, 'members@acesolutions.com.au'),
        toAddress: envTrim(process.env.ALERTS_TO, 'info@goodness.com.au'),
        dedupTtlMinutes: Number(envTrim(process.env.ALERTS_DEDUP_TTL_MIN, '60')),
        maxPerHour: Number(envTrim(process.env.ALERTS_MAX_PER_HOUR, '50')),
        /**
         * n8n webhook (chosen transport). URL is not a secret (endpoint only) so
         * it carries a default; the SHARED SECRET is env-only, never committed.
         */
        webhook: {
            url: envTrim(process.env.ALERTS_WEBHOOK_URL, 'https://membersaces.app.n8n.cloud/webhook/htg'),
            secret: envTrim(process.env.ALERTS_WEBHOOK_SECRET),
        },
        /** Retained SMTP fallback (superseded by webhook). Creds env-only. */
        smtp: {
            host: envTrim(process.env.ALERTS_SMTP_HOST),
            port: Number(envTrim(process.env.ALERTS_SMTP_PORT, '587')),
            user: envTrim(process.env.ALERTS_SMTP_USER),
            pass: envTrim(process.env.ALERTS_SMTP_PASS),
        },
    },

    /**
     * /api/chat hardening (API-Hardening-Plan.md). Cloud Run is NOT behind a load
     * balancer (confirmed 5 Aug) → app-level rate limiting. Tier 1 (error hygiene,
     * payload caps, frame-ancestors) is always on. Origin check enforces only when
     * `allowedOrigins` is set. Token enforcement is behind `requireToken` (default
     * OFF until the browser round-trip is smoke-tested), then flip it on.
     */
    chatSecurity: {
        // Comma-separated exact origins, e.g. "https://goodness.com.au,https://www.goodness.com.au".
        // ⚠️ CONFIRM the production storefront domain(s) with Welly before enforcing.
        allowedOrigins: envTrim(process.env.CHAT_ALLOWED_ORIGINS)
            .split(',').map((s) => s.trim()).filter(Boolean),
        requireOrigin: envTrim(process.env.CHAT_REQUIRE_ORIGIN, 'true') !== 'false',
        requireToken: envTrim(process.env.CHAT_REQUIRE_TOKEN) === 'true',
        tokenSecret: envTrim(process.env.CHAT_TOKEN_SECRET),
        tokenTtlMinutes: Number(envTrim(process.env.CHAT_TOKEN_TTL_MIN, '60')),
        rateLimit: {
            windowMs: Number(envTrim(process.env.CHAT_RATE_WINDOW_MS, '60000')),
            perIpMax: Number(envTrim(process.env.CHAT_RATE_PER_IP, '20')),
            globalMax: Number(envTrim(process.env.CHAT_RATE_GLOBAL, '300')),
        },
        limits: {
            maxMessageChars: Number(envTrim(process.env.CHAT_MAX_MESSAGE_CHARS, '8000')),
            maxHistory: Number(envTrim(process.env.CHAT_MAX_HISTORY, '50')),
            maxUploads: Number(envTrim(process.env.CHAT_MAX_UPLOADS, '10')),
            maxUploadBytes: Number(envTrim(process.env.CHAT_MAX_UPLOAD_BYTES, '10485760')),
        },
    },
};
