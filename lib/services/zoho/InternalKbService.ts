/**
 * InternalKbService — the Systems Support knowledge base Iri built for the agent.
 *
 * Different from the public help centre in three ways that drive the design here,
 * all measured against the live KB on 23 Sep 2026 (scripts/zoho-kb-analyse.mjs):
 *
 *  1. It is SMALL. 50 articles, 74k characters, and 42k of that is two postcode
 *     lists. With those lifted out it is roughly 7k tokens of prose. So the whole
 *     thing is fetched once and held, rather than searched per question. That
 *     removes the dependency on Zoho's keyword search, which is what produced the
 *     "is your product kosher" miss in the first place.
 *
 *  2. Articles CROSS-REFERENCE each other by exact title:
 *       SHIPPING OPTIONS AND COSTS -> 'SHIPPING OPTION FOR RETAIL CUSTOMER'
 *                                  -> '$150 minimum' ...
 *     Eight such links, all resolving. Because the whole KB is in memory, following
 *     them is a map lookup. An answer that is only a pointer is useless on its own,
 *     so a matched article always drags its referenced articles along with it.
 *
 *  3. The four '$N minimum' articles are POSTCODE TABLES, not prose: 9,087 codes
 *     across whole state ranges. Handing those to a model and asking "is 3029
 *     eligible" invites a confident guess. They are parsed into a lookup instead,
 *     and answered by membership rather than by reading.
 *
 * Six articles are written as instructions to the agent ("please refer to the
 * article X") rather than answers to a customer. Those are marked `guidance` so
 * the caller can feed them as context and never quote them.
 *
 * Auth is the existing Desk OAuth client. It needs Desk.articles.READ, added
 * 22 Sep 2026; without it every /articles call returns 403 SCOPE_MISMATCH.
 */

import { getLogger } from '@/lib/config/logger';
import { settings } from '@/lib/config/settings';
import { zohoAuthService } from './ZohoAuthService';

const logger = getLogger('InternalKbService');

/** How long a loaded snapshot is served before a refresh is attempted. */
const CACHE_TTL_MS = 30 * 60 * 1000;

/** Zoho rejects limit=100 on /articles with 422; 50 is accepted. */
const PAGE_SIZE = 50;

/** Guard against a runaway pager. 10 pages is 20x the current KB. */
const MAX_PAGES = 10;

/** Written as direction to the agent rather than as an answer to a customer. */
const GUIDANCE_MARKERS =
    /(please refer to the article|refer to the articles|the agent (?:will |need|should)|please ask the customer|check the article titled|in subsection|sub-?category)/i;

/** '$150 minimum', ' $300 minimum' — the postcode tier articles. */
const TIER_TITLE = /^\s*\$\s*(\d+)\s*minimum\s*$/i;

/** Quoted article names inside a body, straight or curly quotes. */
const QUOTED_TITLE = /['‘’"“”]([^'‘’"“”]{3,80})['‘’"“”]/g;

/** Words that carry no discriminating power when ranking. */
const STOP = new Set([
    'a', 'about', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'could', 'do', 'does',
    'for', 'from', 'get', 'have', 'how', 'i', 'if', 'in', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or',
    'our', 'please', 'so', 'that', 'the', 'their', 'them', 'there', 'they', 'this', 'to', 'us', 'was', 'we',
    'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'you', 'your', 'hi', 'hello', 'hey',
    'item', 'items', 'order', 'orders', 'product', 'products', 'thing', 'things', 'stuff',
]);

export interface InternalKbArticle {
    id: string;
    title: string;
    body: string;
    category: string;
    /** Instruction to the agent rather than an answer for a customer. */
    guidance: boolean;
    /** Titles of articles this one points at, resolved against the snapshot. */
    references: string[];
    /** Raw postcode list, kept off `body` so it never reaches a prompt. Only set
     *  on the '$N minimum' articles, and only used to build the lookup table. */
    postcodeSource?: string;
}

export interface InternalKbSnapshot {
    articles: InternalKbArticle[];
    /** postcode -> minimum order value in dollars for free shipping. */
    postcodeTiers: Map<string, number>;
    /** Postcodes listed under more than one tier; ambiguous, so never answered. */
    conflictedPostcodes: Set<string>;
    loadedAt: number;
}

export interface InternalKbMatch {
    article: InternalKbArticle;
    score: number;
    /** True when this came in because a matched article referenced it. */
    viaReference: boolean;
}

/** Injected in tests so no network or credentials are needed. */
export type KbFetcher = (path: string) => Promise<{ ok: boolean; status: number; json: unknown }>;

export class InternalKbService {
    private snapshot: InternalKbSnapshot | null = null;
    private inFlight: Promise<InternalKbSnapshot | null> | null = null;
    private readonly fetcher: KbFetcher;
    private readonly departmentId: string;

    constructor(fetcher?: KbFetcher, departmentId?: string) {
        this.fetcher = fetcher ?? ((path) => this.deskGet(path));
        this.departmentId = departmentId ?? settings.zohoDesk.systemsSupportDepartmentId ?? '';
    }

    // ── loading ─────────────────────────────────────────────────────────────

    /** Cached snapshot, refreshed past the TTL. Never throws: a failed refresh
     *  serves the previous snapshot rather than dropping the KB mid-conversation. */
    async load(): Promise<InternalKbSnapshot | null> {
        if (this.snapshot && Date.now() - this.snapshot.loadedAt < CACHE_TTL_MS) return this.snapshot;
        if (this.inFlight) return this.inFlight;

        this.inFlight = this.build()
            .then((snap) => {
                if (snap) this.snapshot = snap;
                return this.snapshot;
            })
            .catch((err) => {
                logger.error(`internal KB refresh failed: ${err}`);
                return this.snapshot; // stale is better than nothing
            })
            .finally(() => { this.inFlight = null; });

        return this.inFlight;
    }

    private async build(): Promise<InternalKbSnapshot | null> {
        if (!this.departmentId) {
            logger.info('no Systems Support department configured; internal KB disabled');
            return null;
        }

        const roots = await this.fetcher(`/kbRootCategories?departmentId=${encodeURIComponent(this.departmentId)}`);
        if (!roots.ok) {
            logger.error(`kbRootCategories failed (${roots.status})`);
            return null;
        }
        const categories = (this.data(roots.json) ?? []).map((c) => ({
            id: String((c as Record<string, unknown>).id ?? ''),
            name: String((c as Record<string, unknown>).name ?? ''),
        })).filter((c) => c.id);

        const raw: Array<{ id: string; title: string; category: string }> = [];
        for (const cat of categories) {
            let from = 1;
            for (let page = 0; page < MAX_PAGES; page++) {
                const res = await this.fetcher(`/articles?categoryId=${encodeURIComponent(cat.id)}&from=${from}&limit=${PAGE_SIZE}`);
                if (!res.ok) break;
                const rows = this.data(res.json) ?? [];
                for (const r of rows) {
                    const o = r as Record<string, unknown>;
                    raw.push({ id: String(o.id ?? ''), title: String(o.title ?? '').trim(), category: cat.name });
                }
                if (rows.length < PAGE_SIZE) break;
                from += PAGE_SIZE;
            }
        }

        const articles: InternalKbArticle[] = [];
        for (const r of raw) {
            if (!r.id) continue;
            const full = await this.fetcher(`/articles/${encodeURIComponent(r.id)}`);
            const o = (full.ok ? full.json : null) as Record<string, unknown> | null;
            const rawBody = stripHtml(String(o?.answer ?? o?.summary ?? ''));
            // A tier article is 20k characters of postcodes. Its codes go into the
            // lookup table; its BODY is replaced with a one-line description, so a
            // shipping question never posts four thousand numbers into the prompt
            // and the model is never in a position to guess at membership.
            const tier = r.title.match(TIER_TITLE);
            const body = tier
                ? `Free shipping applies to orders over $${tier[1]} for eligible postcodes, where the order weight does not exceed 24kg. Eligibility is checked against the postcode list rather than quoted.`
                : rawBody;
            articles.push({
                id: r.id,
                title: r.title,
                body,
                category: r.category,
                guidance: GUIDANCE_MARKERS.test(body),
                references: [],
                postcodeSource: tier ? rawBody : undefined,
            });
        }

        if (articles.length === 0) {
            logger.warn('internal KB returned no articles');
            return null;
        }

        resolveReferences(articles);
        const { postcodeTiers, conflictedPostcodes } = buildPostcodeTable(articles);

        logger.info(
            `internal KB loaded: ${articles.length} article(s), ${postcodeTiers.size} postcode(s), ` +
            `${conflictedPostcodes.size} conflicted, ${articles.filter((a) => a.guidance).length} guidance`,
        );

        return { articles, postcodeTiers, conflictedPostcodes, loadedAt: Date.now() };
    }

    // ── querying ────────────────────────────────────────────────────────────

    /** Ranked articles for a customer question, with referenced articles pulled
     *  in behind them. An article that only points elsewhere is no use alone. */
    async search(query: string, limit = 4): Promise<InternalKbMatch[]> {
        const snap = await this.load();
        if (!snap) return [];

        // A postcode in the question is answered from the table, not from prose.
        // Put it first so the model sees a decided answer rather than a list.
        const postcodeInQuery = (query.match(/\b\d{4}\b/g) ?? []).find((c) => snap.postcodeTiers.has(c) || snap.conflictedPostcodes.has(c));
        const decided: InternalKbMatch[] = [];
        if (postcodeInQuery) {
            const minimum = snap.conflictedPostcodes.has(postcodeInQuery) ? null : snap.postcodeTiers.get(postcodeInQuery) ?? null;
            decided.push({
                article: {
                    id: `postcode-${postcodeInQuery}`,
                    title: `Free shipping for postcode ${postcodeInQuery}`,
                    body: minimum === null
                        ? `The free shipping threshold for postcode ${postcodeInQuery} is not settled in the knowledge base, so it must not be quoted. Ask the customer to contact the team for this postcode.`
                        : `Postcode ${postcodeInQuery} qualifies for free shipping on retail orders of $${minimum} or more, provided the order weight does not exceed 24kg.`,
                    category: 'Derived',
                    guidance: false,
                    references: [],
                },
                score: 100,
                viaReference: false,
            });
        }

        const terms = tokenise(query);
        if (terms.length === 0) return decided;

        const scored = snap.articles
            .map((article) => ({ article, score: scoreArticle(article, terms), viaReference: false }))
            .filter((m) => m.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        const byTitle = new Map(snap.articles.map((a) => [a.title.toLowerCase().trim(), a]));
        const out: InternalKbMatch[] = [...decided];
        const seen = new Set<string>();

        for (const m of scored) {
            if (seen.has(m.article.id)) continue;
            seen.add(m.article.id);
            out.push(m);
            // One hop is enough for this KB: the deepest chain is
            // SHIPPING OPTIONS AND COSTS -> RETAIL -> $150 minimum, and a customer
            // question matches the middle or the end of that chain, not the top.
            for (const refTitle of m.article.references) {
                const ref = byTitle.get(refTitle.toLowerCase().trim());
                if (!ref || seen.has(ref.id)) continue;
                seen.add(ref.id);
                out.push({ article: ref, score: m.score / 2, viaReference: true });
            }
        }

        return out;
    }

    /** Minimum order value for free shipping at a postcode, or null when unknown
     *  or listed under more than one tier. Never guesses: an ambiguous postcode
     *  returns null so the caller falls back to asking a person. */
    async freeShippingMinimumFor(postcode: string): Promise<number | null> {
        const snap = await this.load();
        if (!snap) return null;
        const code = String(postcode ?? '').trim();
        if (!/^\d{4}$/.test(code)) return null;
        if (snap.conflictedPostcodes.has(code)) {
            logger.info('postcode is listed under more than one tier; refusing to answer');
            return null;
        }
        return snap.postcodeTiers.get(code) ?? null;
    }

    /** The guidance articles, for injecting as context rather than quoting. */
    async guidance(): Promise<InternalKbArticle[]> {
        const snap = await this.load();
        return snap ? snap.articles.filter((a) => a.guidance) : [];
    }

    // ── plumbing ────────────────────────────────────────────────────────────

    private data(json: unknown): unknown[] | null {
        const d = (json as Record<string, unknown>)?.data;
        return Array.isArray(d) ? d : null;
    }

    private async deskGet(path: string): Promise<{ ok: boolean; status: number; json: unknown }> {
        const token = await zohoAuthService.getAccessToken();
        const res = await fetch(`https://${settings.zohoDesk.deskApiHost}/api/v1${path}`, {
            headers: { Authorization: `Zoho-oauthtoken ${token}`, orgId: settings.zohoDesk.orgId },
        });
        const text = await res.text();
        let json: unknown = null;
        try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
        return { ok: res.ok, status: res.status, json };
    }
}

// ── helpers, exported for tests ─────────────────────────────────────────────

export function stripHtml(html: string): string {
    return String(html ?? '')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
}

export function tokenise(text: string): string[] {
    return String(text ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9$]+/g, ' ')
        .split(' ')
        .filter((w) => w.length > 1 && !STOP.has(w));
}

/** Title matches count for more than body matches: these titles are questions,
 *  so a title hit is usually the article the customer is actually asking for. */
export function scoreArticle(article: InternalKbArticle, terms: string[]): number {
    const title = ` ${article.title.toLowerCase()} `;
    const body = ` ${article.body.toLowerCase()} `;
    let score = 0;
    for (const t of terms) {
        if (title.includes(t)) score += 3;
        else if (body.includes(t)) score += 1;
    }
    return score;
}

/** Fill in `references` from the quoted titles in each body. Only names that
 *  match a real article title count; quoted sub-category names ("Retail
 *  Customer") are navigation for a human and are ignored. */
export function resolveReferences(articles: InternalKbArticle[]): void {
    const byTitle = new Map(articles.map((a) => [a.title.toLowerCase().trim(), a.title]));
    for (const a of articles) {
        const found: string[] = [];
        for (const m of a.body.matchAll(QUOTED_TITLE)) {
            const real = byTitle.get(m[1].toLowerCase().trim());
            if (real && real.toLowerCase() !== a.title.toLowerCase() && !found.includes(real)) found.push(real);
        }
        a.references = found;
    }
}

/** Parse the '$N minimum' articles into postcode -> N. A postcode appearing in
 *  two tiers is recorded as conflicted and answered for by neither: on 23 Sep
 *  2026 that was 2280, 2487 and 2533-2540, all NSW. */
export function buildPostcodeTable(articles: InternalKbArticle[]): {
    postcodeTiers: Map<string, number>;
    conflictedPostcodes: Set<string>;
} {
    const postcodeTiers = new Map<string, number>();
    const conflictedPostcodes = new Set<string>();

    for (const a of articles) {
        const m = a.title.match(TIER_TITLE);
        if (!m) continue;
        const minimum = Number(m[1]);
        if (!minimum) continue;
        const source = a.postcodeSource ?? a.body;
        for (const code of new Set(source.match(/\b\d{4}\b/g) ?? [])) {
            const existing = postcodeTiers.get(code);
            if (existing !== undefined && existing !== minimum) conflictedPostcodes.add(code);
            else postcodeTiers.set(code, minimum);
        }
    }

    for (const code of conflictedPostcodes) postcodeTiers.delete(code);
    return { postcodeTiers, conflictedPostcodes };
}

export const internalKbService = new InternalKbService();
