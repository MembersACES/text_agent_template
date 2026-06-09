import { NextResponse } from 'next/server';
import { settings } from '@/lib/config/settings';
import { gcsClient } from '@/lib/services/storage/GcsClient';

function verifyAdminKey(request: Request): boolean {
    const key = settings.auth.base1AdminKey;
    if (!key) return false;
    return request.headers.get('x-base1-admin-key') === key;
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ runId: string }> },
) {
    if (!verifyAdminKey(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { runId } = await params;
    if (!runId) {
        return NextResponse.json({ error: 'runId required' }, { status: 400 });
    }

    try {
        const buffer = await gcsClient.getBase1CrossCheckXlsx(runId);
        if (!buffer) {
            return NextResponse.json({ error: 'Cross-check not found' }, { status: 404 });
        }

        return new NextResponse(new Uint8Array(buffer), {
            status: 200,
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="${runId}-savings-crosscheck.xlsx"`,
            },
        });
    } catch (error) {
        console.error('[base1-crosscheck] GET', error);
        return NextResponse.json({ error: 'Failed to load cross-check' }, { status: 500 });
    }
}
