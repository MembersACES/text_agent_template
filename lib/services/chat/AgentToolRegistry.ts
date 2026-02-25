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
import { ContextService } from './ContextService';
import { InvoiceToolService } from './InvoiceToolService';

const logger = getLogger('AgentToolRegistry');

type ToolFactory = (contextService: ContextService) => AgentTool;

const AGENT_TOOLS: Record<string, ToolFactory[]> = {
    'base-1-review': [
        (ctx) => new InvoiceToolService(ctx),
    ],
};

export class AgentToolRegistry {
    static getTools(agentId: string | undefined, contextService: ContextService): AgentTool[] {
        if (!agentId) return [];
        const factories = AGENT_TOOLS[agentId] ?? [];
        logger.info(`Loaded ${factories.length} tool(s) for agent "${agentId}"`);
        return factories.map((factory) => factory(contextService));
    }
}
