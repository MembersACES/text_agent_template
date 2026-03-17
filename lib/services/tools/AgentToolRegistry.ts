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
import { gcsClient } from '@/lib/services/storage/GcsClient';
import { AgentTool } from './AgentTool';
import { ContextService } from '../chat/ContextService';
import { InvoiceToolService } from './InvoiceToolService';
import { ZohoKbToolService } from './ZohoKbToolService';

const logger = getLogger('AgentToolRegistry');

type ToolFactory = (contextService: ContextService) => AgentTool;

const AGENT_TOOLS: Record<string, ToolFactory[]> = {
    'base-1-review': [
        (ctx) => new InvoiceToolService(ctx),
    ],
};

export class AgentToolRegistry {
    static async getTools(agentId: string | undefined, contextService: ContextService): Promise<AgentTool[]> {
        if (!agentId) return [];

        const agentSpecific = AGENT_TOOLS[agentId] ?? [];
        const tools: AgentTool[] = agentSpecific.map((factory) => factory(contextService));

        // Only attach the Zoho KB tool when the agent has zohoDesk.enabled = true in its config
        const agentConfig = await gcsClient.getPromptConfig(agentId);
        if (agentConfig.config?.zohoDesk?.enabled) {
            tools.unshift(new ZohoKbToolService());
            logger.info(`Zoho KB tool enabled for agent "${agentId}"`);
        }

        logger.info(`Loaded ${tools.length} tool(s) for agent "${agentId}"`);
        return tools;
    }
}
