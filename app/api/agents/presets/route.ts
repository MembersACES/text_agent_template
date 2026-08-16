import { NextResponse } from 'next/server';
import { GvacaPresetRegistry } from '@/lib/agents/gvaca/GvacaPresetRegistry';

/**
 * GET /api/agents/presets
 * Returns built-in agent templates (e.g. GVACA domain-separated agents) for the dashboard UI.
 */
export async function GET() {
    const gvaca = GvacaPresetRegistry.list().map((p) => ({
        presetId: p.id,
        shortLabel: p.shortLabel,
        description: p.description,
        suggestedAgentId: p.suggestedAgentId,
        suggestedDisplayName: p.suggestedDisplayName,
    }));

    return NextResponse.json({
        presets: [
            {
                group: 'GVACA — Gaming venue compliance co-pilot',
                items: gvaca,
            },
        ],
    });
}
