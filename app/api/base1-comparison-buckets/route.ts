import { NextResponse } from 'next/server';
import { validateBase1ComparisonBuckets } from '@/lib/config/base1ComparisonBuckets';
import { settings } from '@/lib/config/settings';
import { gcsClient } from '@/lib/services/storage/GcsClient';

function verifyAdminKey(request: Request): boolean {
    const key = settings.auth.base1AdminKey;
    if (!key) return false;
    return request.headers.get('x-base1-admin-key') === key;
}

export async function GET(request: Request) {
    if (!verifyAdminKey(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    try {
        const result = await gcsClient.getBase1ComparisonBuckets();
        return NextResponse.json({
            buckets: result.data,
            generation: result.generation,
        });
    } catch (error) {
        console.error('[base1-comparison-buckets] GET', error);
        return NextResponse.json({ error: 'Failed to load buckets' }, { status: 500 });
    }
}

export async function PUT(request: Request) {
    if (!verifyAdminKey(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    try {
        const body = await request.json();
        const generation = typeof body.generation === 'string' ? body.generation : undefined;
        const validated = validateBase1ComparisonBuckets(body.buckets ?? body);
        if (!validated.success) {
            return NextResponse.json({ error: 'Validation failed', details: validated.errors }, { status: 400 });
        }

        const payload = {
            ...validated.data,
            updatedAt: new Date().toISOString(),
            updatedBy: typeof body.updatedBy === 'string' ? body.updatedBy : validated.data.updatedBy,
        };

        try {
            const saved = await gcsClient.saveBase1ComparisonBuckets(payload, generation);
            return NextResponse.json({
                success: true,
                buckets: saved.data,
                generation: saved.generation,
            });
        } catch (err: unknown) {
            const code = (err as { code?: number })?.code;
            if (code === 412) {
                return NextResponse.json(
                    { error: 'Conflict — buckets were updated elsewhere. Reload and retry.' },
                    { status: 409 },
                );
            }
            throw err;
        }
    } catch (error) {
        console.error('[base1-comparison-buckets] PUT', error);
        return NextResponse.json({ error: 'Failed to save buckets' }, { status: 500 });
    }
}
