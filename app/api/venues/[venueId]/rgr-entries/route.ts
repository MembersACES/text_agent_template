import { NextRequest, NextResponse } from 'next/server';
import { isGvacaRgrEntryV1 } from '@/lib/agents/gvaca/rgrEntrySchema';
import { gcsClient } from '@/lib/services/storage/GcsClient';

function rgrPath(venueId: string, date: string): string {
    return `venues/${venueId}/rgr/${date}.jsonl`;
}

/** POST /api/venues/[venueId]/rgr-entries — append one validated RGR line to GCS JSONL. */
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ venueId: string }> },
) {
    try {
        const { venueId: venueIdParam } = await params;
        const venueId = decodeURIComponent(venueIdParam ?? '').trim();
        if (!venueId) {
            return NextResponse.json({ error: 'venueId path segment is required' }, { status: 400 });
        }

        const body: unknown = await req.json();

        if (!isGvacaRgrEntryV1(body)) {
            return NextResponse.json(
                { error: 'Invalid RGR entry — failed schema validation' },
                { status: 400 },
            );
        }

        if (body.venue_id !== venueId) {
            return NextResponse.json(
                { error: 'venue_id in body does not match URL' },
                { status: 400 },
            );
        }

        const path = rgrPath(venueId, body.entry_date);
        await gcsClient.appendJsonlLine(path, body);

        return NextResponse.json({ stored: true, path });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

/** GET /api/venues/[venueId]/rgr-entries?date=2026-04-09 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ venueId: string }> },
) {
    try {
        const { venueId: venueIdParam } = await params;
        const venueId = decodeURIComponent(venueIdParam ?? '').trim();
        if (!venueId) {
            return NextResponse.json({ error: 'venueId path segment is required' }, { status: 400 });
        }

        const { searchParams } = new URL(req.url);
        const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
        const path = rgrPath(venueId, date);
        const entries = await gcsClient.readJsonlFile(path);

        return NextResponse.json({ date, venue_id: venueId, entries });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
