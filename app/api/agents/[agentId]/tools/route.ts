import { NextResponse } from 'next/server';
import { AgentToolRegistry } from '@/lib/services/tools/AgentToolRegistry';
import { ContextService } from '@/lib/services/chat/ContextService';

/**
 * GET /api/agents/[agentId]/tools
 *
 * Returns the list of tool metadata objects registered for the given agent.
 * Used by the frontend to display the available tools in the chat UI.
 */
export async function GET(
    _request: Request,
    { params }: { params: Promise<{ agentId: string }> },
) {
    const { agentId } = await params;
    const tools = AgentToolRegistry.getTools(agentId, new ContextService());
    return NextResponse.json({ tools: tools.map((t) => t.metadata) });
}
