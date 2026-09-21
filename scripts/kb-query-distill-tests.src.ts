/* ─────────────────────────────────────────────────────────────────────────
 * kb-query-distill-tests — ZohoKbToolService.buildKeywordFallbackQueries.
 *
 * From the Cloud Run logs, 21 Sep 2026 (Iri's sweep):
 *
 *   Searching Zoho KB for: "Hi is your product kosher"
 *   Zoho API returned 5 article(s): Is your packaging recyclable? | What is your
 *   returns policy? | Is your Coconut Cream homogenised? | Is your Nutritional
 *   Yeast fortified? | What is the shelf life on your products?
 *   Relevance check for portal 1 articles: "no"
 *
 * Zoho matched "is your" and never scored "kosher". The same customer asking
 * "are you kosher certified" got the right article on the first hit.
 *
 * This tests the DISTILLATION only. Whether Zoho then returns the right article
 * can only be proven against the live KB, so that is a sandbox check, not a
 * unit test. What is asserted here: the distinctive word survives, filler does
 * not, and we never fire a retry that is identical to the query we just ran.
 *
 * Run:  node scripts/kb-query-distill-tests.mjs
 * Rebuild: npx esbuild scripts/kb-query-distill-tests.src.ts --bundle \
 *   --platform=node --format=esm --packages=external --alias:@=. \
 *   --outfile=scripts/kb-query-distill-tests.mjs
 * ───────────────────────────────────────────────────────────────────────── */
import { ZohoKbToolService } from '@/lib/services/tools/ZohoKbToolService';

const svc = new ZohoKbToolService();

interface Case {
    query: string;
    /** Every one of these must appear somewhere in the fallback list. */
    mustContain?: string[];
    /** None of these may appear in any fallback. */
    mustNotContain?: string[];
    /** Exact expected list, when it is worth pinning. */
    exact?: string[];
    because: string;
}

const CASES: Case[] = [
    {
        query: 'Hi is your product kosher',
        exact: ['kosher'],
        because: "the live failure. 'kosher' is the whole question; 'product' is noise that matched every 'Is your ...' article",
    },
    {
        // Guards the bug in the FIRST cut of this function, which searched for the
        // longest remaining word and so retried on "product" rather than "kosher".
        query: 'Hi is your product kosher',
        mustNotContain: ['product', 'product kosher'],
        because: 'a retry on the generic word is worse than no retry at all',
    },
    {
        query: 'are you kosher certified',
        mustContain: ['kosher certified'],
        mustNotContain: ['are you kosher certified', 'certified'],
        because: 'this one already works; the retry must not repeat it or degrade it to a generic word',
    },
    {
        query: 'what is the shelf life on your products',
        exact: ['shelf life'],
        because: "'products' carries nothing in a food catalogue",
    },
    {
        query: 'do you have any gluten free oats',
        exact: ['gluten free oats'],
        because: 'three real content words, all kept, in order',
    },
    {
        query: 'is my order kosher certified',
        exact: ['kosher certified'],
        because: "'order' is filler here even though it is a real word elsewhere in the system",
    },
    {
        query: 'kosher',
        exact: [],
        because: 'nothing to strip, so no retry; re-running the identical query is a wasted API call',
    },
    {
        query: 'hi',
        exact: [],
        because: 'filler only, nothing left to search on',
    },
    {
        query: 'hello there',
        exact: [],
        because: 'still nothing worth a search',
    },
    {
        query: 'is your packaging recyclable',
        exact: ['packaging recyclable'],
        because: 'both words are discriminating, so both stay',
    },
];

(() => {
    let pass = 0, fail = 0;
    for (const c of CASES) {
        const got = svc.buildKeywordFallbackQueries(c.query);
        const notes: string[] = [];
        let ok = true;

        if (c.exact) {
            if (JSON.stringify(got) !== JSON.stringify(c.exact)) {
                ok = false;
                notes.push(`expected exactly ${JSON.stringify(c.exact)}, got ${JSON.stringify(got)}`);
            }
        }
        for (const want of c.mustContain ?? []) {
            if (!got.includes(want)) {
                ok = false;
                notes.push(`missing "${want}" in ${JSON.stringify(got)}`);
            }
        }
        for (const avoid of c.mustNotContain ?? []) {
            if (got.includes(avoid)) {
                ok = false;
                notes.push(`should not contain "${avoid}" in ${JSON.stringify(got)}`);
            }
        }
        // A retry identical to the original search is always wasted.
        const normalised = c.query.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
        if (got.includes(normalised)) {
            ok = false;
            notes.push(`retry is identical to the original query: "${normalised}"`);
        }
        // Bounded, so one weak search can never fan out.
        if (got.length > 1) {
            ok = false;
            notes.push(`${got.length} fallbacks; at most 1 extra Zoho call per portal`);
        }

        if (ok) pass++;
        else fail++;
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${JSON.stringify(c.query)} -> ${JSON.stringify(got)}`);
        if (!ok) {
            for (const nte of notes) console.log(`        ${nte}`);
            console.log(`        why it matters: ${c.because}`);
        }
    }
    console.log(`\n${pass} passed, ${fail} failed, ${CASES.length} total`);
    process.exit(fail ? 1 : 0);
})();
