
import { NextResponse } from 'next/server';
import { gcsClient, PromptConfig } from '@/lib/services/storage/GcsClient';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const agentId = searchParams.get('agentId') || undefined;
        const config = await gcsClient.getPromptConfig(agentId || undefined);
        return NextResponse.json(config);
    } catch (error) {
        console.error('Error fetching prompt config:', error);
        return NextResponse.json({ error: 'Failed to fetch prompt config' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const data = await request.json();

        // Basic validation
        if (!data.systemPrompt) {
            return NextResponse.json({ error: 'System prompt is required' }, { status: 400 });
        }

        const agentId = data.agentId || undefined;

        const config: PromptConfig = {
            systemPrompt: data.systemPrompt,
            welcomeMessage: data.welcomeMessage,
            agentName: data.agentName,
            config: data.config
        };

        await gcsClient.savePromptConfig(config, agentId);
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error saving prompt config:', error);
        return NextResponse.json({ error: 'Failed to save prompt config' }, { status: 500 });
    }
}
