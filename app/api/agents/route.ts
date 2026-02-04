import { NextResponse } from 'next/server';
import { listAgents } from '@/lib/gcs-client';

export async function GET() {
    try {
        const agents = await listAgents();
        return NextResponse.json({ agents });
    } catch (error) {
        console.error('Error listing agents:', error);
        return NextResponse.json({ error: 'Failed to list agents' }, { status: 500 });
    }
}

