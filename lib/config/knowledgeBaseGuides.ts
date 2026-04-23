/**
 * Substrings that identify "guide" benchmark docs in the KB (matched against chunk.source).
 * File names in Drive often look like "ELECTRICITY ANALYSIS GUIDE" and do **not** contain
 * the legacy token `ELECTRICITY_GUIDE`, so we include analysis-style names too. Matching is
 * case-insensitive.
 */
export const GUIDE_SOURCE_MARKERS = [
    'ELECTRICITY_GUIDE',
    'ELECTRICITY_ANALYSIS',
    'GAS_GUIDE',
    'GAS_ANALYSIS',
    'WATER_GUIDE',
    'WATER_ANALYSIS',
    'WASTE_GUIDE',
    'WASTE_ANALYSIS',
    'OIL_GUIDE',
    'OIL_ANALYSIS',
] as const;

export function chunkSourceMatchesGuide(source: string | undefined): boolean {
    const s = (source || '').toUpperCase();
    return (GUIDE_SOURCE_MARKERS as readonly string[]).some((m) => s.includes(m.toUpperCase()));
}

export function chunkSourceIsElectricityGuide(source: string | undefined): boolean {
    const s = (source || '').toUpperCase();
    return s.includes('ELECTRICITY_GUIDE') || s.includes('ELECTRICITY_ANALYSIS');
}
