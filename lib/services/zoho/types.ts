/**
 * Shared types for the Zoho Desk KB integration.
 */

export interface ZohoArticle {
    id: string;
    categoryId: string;
    title: string;
    snippet: string;
    bodyText: string;
    tags: string[];
    lastUpdated: string;
    kbName: string;
    visibility: string;
}

export interface ZohoCategory {
    id: string;
    name: string;
    kbId: string;
}

export interface ZohoPortalConfig {
    portalId: string;
    kbId: string;
    allowedCategoryIds: string[];
    kbName: string;
}

export interface ZohoKBConfig {
    enabled: boolean;
    portalConfigs: ZohoPortalConfig[];
}
