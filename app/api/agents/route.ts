import { NextResponse } from 'next/server';

/**
 * Available agents - hard-coded list.
 * To add a new agent, simply add an entry here.
 */
const AGENTS: { id: string; name: string; description?: string }[] = [
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
];

export async function GET() {
    return NextResponse.json({ agents: AGENTS });
}
