
import { NextResponse } from 'next/server';
import { getPromptTemplate, savePromptTemplate } from '@/lib/gcs-client';

export async function GET() {
    try {
        const template = await getPromptTemplate();
        return NextResponse.json({ template });
    } catch (error) {
        console.error('Error fetching prompt:', error);
        return NextResponse.json({ error: 'Failed to fetch prompt' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const { template } = await request.json();

        if (!template) {
            return NextResponse.json({ error: 'Template is required' }, { status: 400 });
        }

        await savePromptTemplate(template);
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error saving prompt:', error);
        return NextResponse.json({ error: 'Failed to save prompt' }, { status: 500 });
    }
}
