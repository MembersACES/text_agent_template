import { NextResponse } from 'next/server';
import { gcsClient } from '@/lib/services/storage/GcsClient';

export async function GET() {
    try {
        const settings = await gcsClient.getSystemSettings();
        return NextResponse.json(settings);
    } catch (error) {
        console.error('Error fetching system settings:', error);
        return NextResponse.json(
            { error: 'Failed to fetch system settings' },
            { status: 500 }
        );
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { globalSystemPrompt } = body;

        if (typeof globalSystemPrompt !== 'string') {
            return NextResponse.json(
                { error: 'globalSystemPrompt must be a string' },
                { status: 400 }
            );
        }

        await gcsClient.saveSystemSettings({ globalSystemPrompt });
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error saving system settings:', error);
        return NextResponse.json(
            { error: 'Failed to save system settings' },
            { status: 500 }
        );
    }
}
