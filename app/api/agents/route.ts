import { NextResponse } from 'next/server';
import { gcsClient } from '@/lib/services/storage/GcsClient';

/**
 * Hard-coded baseline agents.
 * To add a new permanent agent to the list, add an entry here.
 * Agents can also be created dynamically via POST /api/agents and are
 * stored in GCS under agents/{id}/settings.json.
 */
const HARDCODED_AGENTS: { id: string; name: string; description?: string }[] = [
    {
        id: 'pudu-chatbot-test',
        name: 'Pudu Chatbot Test Agent',
        description: 'Test agent for the Pudu chatbot integration',
    },
    {
        id: 'base-1-review',
        name: 'Base 1 Review',
        description: 'Analyses utility invoices and generates an Excel savings report',
    },
    {
        id: 'honest-to-goodness',
        name: 'Honest to Goodness',
        description: 'Customer support agent backed by Zoho Desk knowledge base',
    },
];

export async function GET() {
    // Merge hard-coded agents with any agents stored in GCS
    let agents = [...HARDCODED_AGENTS];

    try {
        const gcsAgentIds = await gcsClient.listAgents();
        const hardcodedIds = new Set(HARDCODED_AGENTS.map((a) => a.id));

        for (const id of gcsAgentIds) {
            if (!hardcodedIds.has(id)) {
                // Fetch name / description from GCS settings
                const config = await gcsClient.getPromptConfig(id);
                agents.push({
                    id,
                    name: config.agentName || id,
                    description: undefined,
                });
            }
        }
    } catch (err) {
        console.warn('[Agents API] Could not list GCS agents, returning hard-coded list only.', err);
    }

    return NextResponse.json({ agents });
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { id, name, description } = body as {
            id?: string;
            name?: string;
            description?: string;
        };

        if (!id || !name) {
            return NextResponse.json(
                { error: 'Agent ID and name are required.' },
                { status: 400 }
            );
        }

        // Validate agent ID (URL-friendly, no spaces or special chars)
        if (!/^[a-z0-9-]+$/.test(id)) {
            return NextResponse.json(
                {
                    error:
                        'Agent ID must only contain lowercase letters, numbers, and hyphens (e.g. "my-agent-1").',
                },
                { status: 400 }
            );
        }

        // Build a minimal config from scratch — intentionally do NOT read from the
        // default agent so that no kbFolderId or other inherited settings leak in.
        // The user must configure the knowledge base folder themselves after creation.
        await gcsClient.savePromptConfig(
            {
                systemPrompt: `You are a helpful AI assistant. Answer questions clearly, concisely, and accurately.

If you have been provided with knowledge base documents or uploaded files, use them to inform your responses and cite the source where relevant.

If you are unsure about something, say so honestly rather than guessing.`,
                welcomeMessage: `Hello! I'm your AI assistant. How can I help you today?`,
                agentName: name,
                config: {
                    // kbFolderId = '' signals "new agent, not yet configured"
                    // (undefined would fall back to the global env folder for existing agents)
                    kbFolderId: '',
                    ...(description ? ({ description } as any) : {}),
                },
            },
            id
        );

        return NextResponse.json(
            { success: true, agent: { id, name, description } },
            { status: 201 }
        );
    } catch (err: any) {
        console.error('[Agents API] Error creating agent:', err);
        return NextResponse.json(
            { error: err.message || 'Failed to create agent.' },
            { status: 500 }
        );
    }
}
