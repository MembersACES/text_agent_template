/**
 * AgentToolRegistry
 *
 * Maps agent IDs to their available tools. To add a tool to an agent, add a
 * factory entry in AGENT_TOOLS — GeminiChatService never needs to change.
 *
 * Factory functions receive ContextService (the shared dependency) and return
 * an AgentTool instance. Add more parameters to the factory signature if
 * future tools require different dependencies.
 */

import { getLogger } from '@/lib/config/logger';
import { AgentTool } from './AgentTool';
import { ContextService } from '../chat/ContextService';
import { InvoiceToolService } from './InvoiceToolService';
import { ZohoKbToolService } from './ZohoKbToolService';

const logger = getLogger('AgentToolRegistry');

type ToolFactory = (contextService: ContextService) => AgentTool;

/** Tools available to every agent regardless of agent ID. */
const GLOBAL_TOOLS: ToolFactory[] = [
    () => new ZohoKbToolService(),
];

const AGENT_TOOLS: Record<string, ToolFactory[]> = {
    'base-1-review': [
        (ctx) => new InvoiceToolService(ctx),
    ],
};

export class AgentToolRegistry {
    static getTools(agentId: string | undefined, contextService: ContextService): AgentTool[] {
        if (!agentId) return [];
        const agentSpecific = AGENT_TOOLS[agentId] ?? [];
        const all = [...GLOBAL_TOOLS, ...agentSpecific].map((factory) => factory(contextService));
        logger.info(`Loaded ${all.length} tool(s) for agent "${agentId}"`);
        return all;
    }
}
