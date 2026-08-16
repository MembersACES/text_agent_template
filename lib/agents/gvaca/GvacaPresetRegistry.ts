import type { PromptConfig } from '@/lib/services/storage/GcsClient';
import { COMPLIANCE_SYSTEM_PROMPT, COMPLIANCE_WELCOME_MESSAGE } from './prompts/ComplianceDomainPrompt';
import { OPERATIONS_SYSTEM_PROMPT, OPERATIONS_WELCOME_MESSAGE } from './prompts/OperationsAdvisoryPrompt';
import { RGR_SYSTEM_PROMPT, RGR_WELCOME_MESSAGE } from './prompts/ResponsibleGamblingPrompt';

export type GvacaPresetId = 'gvaca-compliance' | 'gvaca-rgr' | 'gvaca-operations';

export interface GvacaPresetDefinition {
    id: GvacaPresetId;
    suggestedAgentId: string;
    suggestedDisplayName: string;
    shortLabel: string;
    description: string;
    systemPrompt: string;
    welcomeMessage: string;
}

const PRESETS: Record<GvacaPresetId, GvacaPresetDefinition> = {
    'gvaca-rgr': {
        id: 'gvaca-rgr',
        suggestedAgentId: 'gvaca-rgr',
        suggestedDisplayName: 'GVACA — RGR Assistant',
        shortLabel: 'GVACA — Responsible Gambling Register',
        description:
            'Pilot-first assistant: draft RGR entries, daily checklist lines, and shift follow-up delegation from staff input (Phase 1: no venue APIs).',
        systemPrompt: RGR_SYSTEM_PROMPT,
        welcomeMessage: RGR_WELCOME_MESSAGE,
    },
    'gvaca-compliance': {
        id: 'gvaca-compliance',
        suggestedAgentId: 'gvaca-compliance',
        suggestedDisplayName: 'GVACA — Compliance',
        shortLabel: 'GVACA — Compliance domain',
        description:
            'Statutory compliance only (AML/CTF, RG frameworks, WHS, privacy). Isolated from commercial advisory logic; Victorian pilot context by default.',
        systemPrompt: COMPLIANCE_SYSTEM_PROMPT,
        welcomeMessage: COMPLIANCE_WELCOME_MESSAGE,
    },
    'gvaca-operations': {
        id: 'gvaca-operations',
        suggestedAgentId: 'gvaca-operations',
        suggestedDisplayName: 'GVACA — Operations',
        shortLabel: 'GVACA — Operations (non-compliance)',
        description:
            'Commercial and operational productivity. Must redirect statutory compliance questions to the Compliance or RGR agents.',
        systemPrompt: OPERATIONS_SYSTEM_PROMPT,
        welcomeMessage: OPERATIONS_WELCOME_MESSAGE,
    },
};

export class GvacaPresetRegistry {
    static list(): GvacaPresetDefinition[] {
        return [PRESETS['gvaca-rgr'], PRESETS['gvaca-compliance'], PRESETS['gvaca-operations']];
    }

    static get(id: GvacaPresetId): GvacaPresetDefinition {
        return PRESETS[id];
    }

    static isValidPresetId(value: string): value is GvacaPresetId {
        return value === 'gvaca-rgr' || value === 'gvaca-compliance' || value === 'gvaca-operations';
    }

    /** RGR structured-entry tool: preset id or default agent slug. */
    static shouldAttachRgrEntryTool(agentId: string | undefined, agentConfig?: PromptConfig): boolean {
        if (!agentId) return false;
        if (agentId === 'gvaca-rgr') return true;
        return agentConfig?.config?.templatePresetId === 'gvaca-rgr';
    }
}
