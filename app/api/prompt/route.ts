
import { NextResponse } from 'next/server';
import { getPromptConfig, savePromptConfig, PromptConfig } from '@/lib/gcs-client';

export async function GET() {
    try {
        const config = await getPromptConfig();
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

        const config: PromptConfig = {
            systemPrompt: data.systemPrompt,
            welcomeMessage: data.welcomeMessage,
            agentName: data.agentName,
            config: data.config
        };

        await savePromptConfig(config);
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error saving prompt config:', error);
        return NextResponse.json({ error: 'Failed to save prompt config' }, { status: 500 });
    }
}
