import { getLogger } from '@/lib/config/logger';
import { settings } from '@/lib/config/settings';
import { DotWmsReferenceResolver } from './DotWmsReferenceResolver';
import type { FreightReferenceResolver } from './types';

const logger = getLogger('FreightReferenceResolverFactory');

/**
 * Returns the freight-reference resolver for the configured provider.
 *
 * This is the single place the Odoo cut-over happens. At Odoo go-live
 * (end Oct 2026) build an OdooReferenceResolver implementing
 * FreightReferenceResolver, register it in the switch below, and set
 * FREIGHT_PROVIDER=odoo. No caller (OrderTrackingService, the chat route)
 * changes.
 */
export class FreightReferenceResolverFactory {
    static create(): FreightReferenceResolver {
        const provider = settings.freight.provider;
        switch (provider) {
            case 'dotwms':
                return new DotWmsReferenceResolver();
            // case 'odoo':
            //     return new OdooReferenceResolver(); // TODO: build for Odoo go-live (end Oct 2026)
            default:
                logger.warn(`unknown freight provider "${provider}" — falling back to dotWMS`);
                return new DotWmsReferenceResolver();
        }
    }
}
