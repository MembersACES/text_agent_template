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

export type GuideUtility = 'electricity' | 'gas' | 'water' | 'waste' | 'oil';

export function chunkSourceMatchesGuide(source: string | undefined): boolean {
    const s = (source || '').toUpperCase();
    return (GUIDE_SOURCE_MARKERS as readonly string[]).some((m) => s.includes(m.toUpperCase()));
}

/**
 * Map a guide chunk's source (file name) to a single utility. Order matters: WASTE before GAS is not
 * needed; WASTE has no "GAS" token. OIL_ before WATER — "WATER" not in "OIL".
 */
export function parseGuideUtilityFromSource(source: string | undefined): GuideUtility | null {
    const s = (source || '').toUpperCase();
    if (s.includes('ELECTRICITY')) return 'electricity';
    if (s.includes('WASTE')) return 'waste';
    if (s.includes('OIL')) return 'oil';
    if (s.includes('WATER')) return 'water';
    if (s.includes('GAS')) return 'gas';
    return null;
}

export function chunkSourceIsElectricityGuide(source: string | undefined): boolean {
    return parseGuideUtilityFromSource(source) === 'electricity';
}

export type GuideFilter = 'all' | Set<GuideUtility>;

/**
 * When filter is "all" or the set is empty, returns every guide chunk.
 * Otherwise keeps only chunks whose source maps to a utility in the set.
 */
export function filterGuideChunksByUtilities<T extends { source?: string }>(
    guideChunks: T[],
    filter: GuideFilter,
): T[] {
    if (filter === 'all' || (filter instanceof Set && filter.size === 0)) {
        return guideChunks;
    }
    const allowed = filter as Set<GuideUtility>;
    return guideChunks.filter((chunk) => {
        const u = parseGuideUtilityFromSource(chunk.source);
        if (u == null) return false;
        return allowed.has(u);
    });
}

const MAX_INFER_LEN = 120_000;

/**
 * Heuristic: scan raw invoice / PDF text to guess which utility guides are relevant.
 * Returns `null` when nothing matches — caller should treat that as "load all guides" (safe default).
 */
export function inferUtilitiesFromInvoiceText(text: string | null | undefined): Set<GuideUtility> | null {
    if (text == null || text.length === 0) return null;
    const t = text.length > MAX_INFER_LEN ? text.slice(0, MAX_INFER_LEN) : text;
    const s = t.toLowerCase();
    const found = new Set<GuideUtility>();

    if (
        /\bnmi\b/.test(s) ||
        /kwh|kilowatt/i.test(s) ||
        /electricity.{0,40}account|account.{0,40}electricity/i.test(s) ||
        /time\s*of\s*use|off[\s-]?peak|shoulder\s*period|\bc\/kwh\b/i.test(s) ||
        /demand.{0,20}kva|kva\/?\s*month|daily\s*supply(?!.+\bgj\b)/i.test(s) ||
        /(powercor|ausnet|ergon|endeavour|essential\s*energy|aemo)/i.test(s)
    ) {
        found.add('electricity');
    }

    if (/\b(gj|gj\/)\b|megajoule|\b(mj|mj\/)\b/i.test(s) || /\bmrin\b/i.test(s) || /gas(?!\s*oline).{0,30}(gj|commodity|usage|charge|rate)/i.test(s) || /[\$]?\s*\/\s*g?j/i.test(s)) {
        found.add('gas');
    }

    if (
        /m³|m3(?!\s*front)/i.test(s) ||
        /\bkl\b|kilolitre|kilo\.?\s*litre|\/kl/i.test(s) ||
        /water.{0,30}(account|usage|service|charge)/i.test(s) ||
        /sewer(age)?|storm\s*water|trade\s*waste(?!.+\/oil)/i.test(s)
    ) {
        found.add('water');
    }

    if (
        /front\s*lift|general\s*waste|landfill|recycl|wheelie|bin\s*(size|service)|waste(?!.+\/oil).{0,20}(service|charge|removal|collection)/i.test(s) ||
        /per\s*collection|pickup.{0,20}date/i.test(s) && /waste|bin/i.test(s)
    ) {
        found.add('waste');
    }

    if (/waste\s*oil|used\s*oil|lubrication\s*oil|oil.{0,30}(removal|collection|service|litre)/i.test(s)) {
        found.add('oil');
    }

    if (found.size === 0) return null;
    return found;
}

/**
 * `inferUtilitiesFromInvoiceText` over multiple file names (extra signal from filenames e.g. "ELECTRICITY").
 */
export function inferUtilitiesFromFilesContentAndNames(
    fileContext: string,
    fileNames: string[] = [],
): Set<GuideUtility> | null {
    const fromText = inferUtilitiesFromInvoiceText(fileContext);
    const fromNames = inferUtilitiesFromInvoiceText(fileNames.join(' '));
    if (fromText && fromNames) {
        return new Set([...fromText, ...fromNames]);
    }
    return fromText ?? fromNames;
}

/**
 * Chunks with benchmark / metering / DMA text sort first. On equal priority, prefer the guide
 * family that matches `inferred` (from invoice heuristics); if `inferred` is null, prefer electricity
 * (legacy). Stable order for remaining ties.
 *
 * We **no longer drop** non-matching utilities — that removed too much cross-guide context and
 * produced worse extractions. Inference only affects **sort order** + logging.
 */
export function sortGuideChunksForExtraction<T extends { text?: string; source?: string }>(
    chunks: T[],
    inferred: Set<GuideUtility> | null,
): T[] {
    const benchmarkPriority = (text: string | undefined): number => {
        if (!text) return 0;
        const t = text.toLowerCase();
        return t.includes('benchmark') ||
            t.includes('metering') ||
            t.includes('dma') ||
            t.includes('market benchmark')
            ? 1
            : 0;
    };

    return chunks
        .map((chunk, i) => ({ chunk, i, p: benchmarkPriority(chunk.text) }))
        .sort((a, b) => {
            if (b.p !== a.p) return b.p - a.p;
            if (inferred && inferred.size > 0) {
                const ua = parseGuideUtilityFromSource(a.chunk.source);
                const ub = parseGuideUtilityFromSource(b.chunk.source);
                const aIn = ua != null && inferred.has(ua);
                const bIn = ub != null && inferred.has(ub);
                if (aIn && !bIn) return -1;
                if (!aIn && bIn) return 1;
            } else {
                const aE = parseGuideUtilityFromSource(a.chunk.source) === 'electricity';
                const bE = parseGuideUtilityFromSource(b.chunk.source) === 'electricity';
                if (aE && !bE) return -1;
                if (!aE && bE) return 1;
            }
            return a.i - b.i;
        })
        .map((x) => x.chunk);
}
