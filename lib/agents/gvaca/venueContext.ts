import { settings } from '@/lib/config/settings';

/**
 * Resolves the active venue for GVACA requests.
 *
 * Precedence: explicit request value → `GVACA_DEFAULT_VENUE_ID` from settings.
 * Phase 1 pilot: set the env var for single-venue. Later: JWT, subdomain, or path.
 */
export function resolveVenueIdForRequest(explicitVenueId?: string | null): string {
    const trimmed = explicitVenueId?.trim();
    if (trimmed) return trimmed;
    return (settings.gvaca.defaultVenueId ?? '').trim();
}
