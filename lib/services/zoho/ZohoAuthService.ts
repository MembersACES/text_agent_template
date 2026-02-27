/**
 * ZohoAuthService
 *
 * Manages OAuth 2.0 access tokens for Zoho Desk API. Tokens are cached
 * in memory and refreshed automatically before expiry.
 */

import { getLogger } from '@/lib/config/logger';
import { settings } from '@/lib/config/settings';

const logger = getLogger('ZohoAuthService');

/** Refresh the token 5 minutes before it expires. */
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export class ZohoAuthService {
    private readonly clientId: string;
    private readonly clientSecret: string;
    private readonly refreshToken: string;
    private readonly tokenUrl: string;

    private cachedAccessToken: string | null = null;
    private tokenExpiresAt = 0;

    constructor() {
        this.clientId = settings.zohoDesk.clientId;
        this.clientSecret = settings.zohoDesk.clientSecret;
        this.refreshToken = settings.zohoDesk.refreshToken;
        this.tokenUrl = `https://accounts.zoho.${settings.zohoDesk.datacenter}/oauth/v2/token`;
    }

    /**
     * Return a valid access token, refreshing if necessary.
     */
    async getAccessToken(): Promise<string> {
        if (this.cachedAccessToken && Date.now() < this.tokenExpiresAt) {
            return this.cachedAccessToken;
        }

        logger.info('Refreshing Zoho OAuth access token');

        const params = new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: this.clientId,
            client_secret: this.clientSecret,
            refresh_token: this.refreshToken,
        });

        const response = await fetch(this.tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        });

        if (!response.ok) {
            const body = await response.text();
            logger.error(`Token refresh failed (${response.status}): ${body}`);
            throw new Error(`Zoho OAuth token refresh failed: ${response.status}`);
        }

        const data = await response.json();

        if (!data.access_token) {
            logger.error('Token response missing access_token field');
            throw new Error('Zoho OAuth response missing access_token');
        }

        this.cachedAccessToken = data.access_token as string;
        const expiresInMs = ((data.expires_in as number) || 3600) * 1000;
        this.tokenExpiresAt = Date.now() + expiresInMs - TOKEN_REFRESH_BUFFER_MS;

        logger.info('Zoho access token refreshed successfully');
        return this.cachedAccessToken;
    }
}

export const zohoAuthService = new ZohoAuthService();
