/* ─────────────────────────────────────────────────────────────────────────
 * internal-kb-tests — InternalKbService, the Systems Support KB.
 *
 * Fixtures are shaped from the real articles as measured on 23 Sep 2026
 * (scripts/zoho-kb-analyse.mjs): the shipping routing chain, the four postcode
 * tier articles including the NSW postcodes that appear in two tiers, the
 * guidance articles, and a plain customer FAQ.
 *
 * No network and no credentials: the service takes its fetcher by injection.
 *
 * Run:  node scripts/internal-kb-tests.mjs
 * Rebuild: npx esbuild scripts/internal-kb-tests.src.ts --bundle \
 *   --platform=node --format=esm --alias:@=. --outfile=scripts/internal-kb-tests.mjs
 * ───────────────────────────────────────────────────────────────────────── */
import { InternalKbService, buildPostcodeTable, resolveReferences, stripHtml, tokenise } from '@/lib/services/zoho/InternalKbService';
import type { InternalKbArticle, KbFetcher } from '@/lib/services/zoho/InternalKbService';

const DEPT = '493989000054808139';

const FIXTURES: Array<{ id: string; title: string; answer: string; category: string; status?: string }> = [
    {
        id: '1', title: 'SHIPPING OPTIONS AND COSTS', category: 'Instructions for Agent',
        answer: "<p>Does the customer have a wholesale account or not? IF the customer has a wholesale account, please refer to the article 'SHIPPING OPTION FOR WHOLESALE CUSTOMER'. IF the customer does not have a wholesale account, please refer to the article 'SHIPPING OPTION FOR RETAIL CUSTOMER'</p>",
    },
    {
        id: '2', title: 'SHIPPING OPTION FOR RETAIL CUSTOMER', category: 'Instructions for Agent',
        answer: "Free shipping depends on postcode, order value and a 24kg weight limit. Please check the article titled '$150 minimum' or '$400 minimum' for the details.",
    },
    {
        id: '3', title: 'SHIPPING OPTION FOR WHOLESALE CUSTOMER', category: 'Instructions for Agent',
        answer: "Please confirm the state. Check the article titled 'New South Wales (NSW)' or 'Victoria (VIC)'. The agent will need to ask the customer whether their address is residential or commercial.",
    },
    { id: '4', title: 'New South Wales (NSW)', category: 'Wholesale Customer', answer: 'Wholesale customers with a commercial address in Sydney Metro are eligible for free shipping via the H2G Run.' },
    { id: '5', title: 'Victoria (VIC)', category: 'Wholesale Customer', answer: 'Melbourne Metropolitan, Ballarat, Geelong and Apollo Bay can be eligible for free shipping.' },
    { id: '6', title: '$150 minimum', category: 'Retail Customer', answer: 'Eligible postcodes: 2487,3029,2137,2600,2601' },
    // 2534 and 2536 are still in two tiers on the live KB as at 5 Oct 2026.
    { id: '7', title: '$300 minimum', category: 'Retail Customer', answer: 'Eligible postcodes: 2280,2533,2534,2536' },
    { id: '8', title: '$400 minimum', category: 'Retail Customer', answer: 'Eligible postcodes: 2280,2487,2533,2534,2536,6000,6001' },
    { id: '9', title: 'Are you Kosher certified?', category: 'Product Knowledge', answer: 'Yes, we are Kosher certified. Please email info@goodness.com.au for a copy of the certification.' },
    { id: '10', title: 'AI Agent High Level Instructions', category: 'Instructions for Agent', answer: 'There are 6 types of customer enquiries that the agent need to deal with. For each enquiry type, please refer to the specific subsection.' },

    // Measured on the live KB, 5 Oct 2026. In the instruction folder, but written
    // plainly enough that the wording heuristic alone does not catch it.
    {
        id: '11', title: 'New Supplier Interest', category: 'Instructions for Agent',
        answer: 'To respond to anyone interested to become a supplier for us, please ask them to fill the prospect supplier form on the link below: https://goodness.com.au/become-a-supplier/',
    },
    // Unpublished on the live KB, 5 Oct 2026, and was being served to customers.
    {
        id: '12', title: 'Do you ship internationally?', category: 'Product Knowledge', status: 'Draft',
        answer: 'We are still working out which countries we can ship to.',
    },
    // The reverse case: instruction wording filed outside the folder. The wording
    // check stays in place so this is still caught.
    {
        id: '13', title: 'Greeting note', category: 'Product Knowledge',
        answer: 'The agent should greet the customer by name before answering.',
    },
];

function fakeFetcher(): KbFetcher {
    return async (path: string) => {
        if (path.startsWith('/kbRootCategories')) {
            // The live KB has one populated root. The instruction FOLDER is a
            // sub-category under it, and only the detail call reveals it.
            return { ok: true, status: 200, json: { data: [{ id: 'cat1', name: 'AI Agent Knowledge Base' }] } };
        }
        if (path.startsWith('/articles?')) {
            const from = Number(new URLSearchParams(path.split('?')[1]).get('from') ?? '1');
            const page = from === 1 ? FIXTURES.map((f) => ({ id: f.id, title: f.title })) : [];
            return { ok: true, status: 200, json: { data: page } };
        }
        const m = path.match(/^\/articles\/(\d+)$/);
        if (m) {
            const f = FIXTURES.find((x) => x.id === m[1]);
            return f
                ? { ok: true, status: 200, json: { answer: f.answer, status: f.status ?? 'Published', category: { id: `sub-${f.id}`, name: f.category } } }
                : { ok: false, status: 404, json: null };
        }
        return { ok: false, status: 404, json: null };
    };
}

/** A fetcher that fails, to prove a bad refresh never takes the KB away. */
function brokenFetcher(): KbFetcher {
    return async () => ({ ok: false, status: 403, json: { errorCode: 'SCOPE_MISMATCH' } });
}

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = '', because = '') {
    if (ok) pass++;
    else {
        fail++;
        console.log(`FAIL  ${name}`);
        if (detail) console.log(`        ${detail}`);
        if (because) console.log(`        why it matters: ${because}`);
        return;
    }
    console.log(`PASS  ${name}`);
}

(async () => {
    // ── pure helpers ────────────────────────────────────────────────────────
    check('stripHtml removes tags and entities',
        stripHtml('<p>Yes &amp; no&nbsp;here</p>') === 'Yes & no here');

    check('tokenise drops filler and generic nouns',
        JSON.stringify(tokenise('Hi is your product kosher')) === JSON.stringify(['kosher']),
        `got ${JSON.stringify(tokenise('Hi is your product kosher'))}`,
        'the same distillation that fixed the public KB search');

    // ── references ──────────────────────────────────────────────────────────
    const arts: InternalKbArticle[] = FIXTURES.map((f) => ({
        id: f.id, title: f.title, body: stripHtml(f.answer), category: 'c', guidance: false, references: [],
    }));
    resolveReferences(arts);
    const costs = arts.find((a) => a.title === 'SHIPPING OPTIONS AND COSTS')!;
    check('an article resolves the articles it names',
        costs.references.length === 2
        && costs.references.includes('SHIPPING OPTION FOR WHOLESALE CUSTOMER')
        && costs.references.includes('SHIPPING OPTION FOR RETAIL CUSTOMER'),
        `got ${JSON.stringify(costs.references)}`,
        'this article is a pointer with no answer in it; alone it is useless');

    const wholesale = arts.find((a) => a.title === 'SHIPPING OPTION FOR WHOLESALE CUSTOMER')!;
    check('quoted names that are not articles are ignored',
        !wholesale.references.includes('Retail Customer'),
        `got ${JSON.stringify(wholesale.references)}`,
        'sub-category names are navigation for a human, not something to fetch');

    // ── postcode table ──────────────────────────────────────────────────────
    const { postcodeTiers, conflictedPostcodes } = buildPostcodeTable(arts);
    check('a clean postcode maps to its tier', postcodeTiers.get('3029') === 150,
        `got ${postcodeTiers.get('3029')}`);
    check('a postcode only in the top tier maps to it', postcodeTiers.get('6000') === 400,
        `got ${postcodeTiers.get('6000')}`);
    check('postcodes in two tiers are recorded as conflicted',
        ['2280', '2487', '2533', '2534', '2536'].every((c) => conflictedPostcodes.has(c)),
        `got ${JSON.stringify([...conflictedPostcodes])}`,
        'four real postcodes are still in two tiers on the live KB');
    check('a conflicted postcode is in NO tier',
        ['2280', '2487', '2533'].every((c) => !postcodeTiers.has(c)),
        '',
        'answering $150 or $400 at random is worse than not answering');

    // ── the service ─────────────────────────────────────────────────────────
    const svc = new InternalKbService(fakeFetcher(), DEPT);
    const snap = await svc.load();
    const published = FIXTURES.filter((f) => (f.status ?? 'Published') === 'Published');
    check('loads every published article', snap?.articles.length === published.length,
        `got ${snap?.articles.length}, expected ${published.length} of ${FIXTURES.length}`);

    check('an unpublished article is not loaded at all',
        !snap!.articles.some((a) => a.title === 'Do you ship internationally?'),
        `got ${JSON.stringify(snap!.articles.map((a) => a.title))}`,
        'this one is Draft on the live KB and was being read out to customers');
    check('marks guidance articles',
        snap!.articles.filter((a) => a.guidance).map((a) => a.title).sort().join('|')
        === ['AI Agent High Level Instructions', 'Greeting note', 'New Supplier Interest', 'SHIPPING OPTION FOR RETAIL CUSTOMER', 'SHIPPING OPTION FOR WHOLESALE CUSTOMER', 'SHIPPING OPTIONS AND COSTS'].sort().join('|'),
        `got ${JSON.stringify(snap!.articles.filter((a) => a.guidance).map((a) => a.title))}`,
        'guidance must never be quoted at a customer');

    check('the real sub-category is stored, not the root',
        snap!.articles.find((a) => a.title === 'Are you Kosher certified?')?.category === 'Product Knowledge',
        `got ${snap!.articles.find((a) => a.title === 'Are you Kosher certified?')?.category}`,
        'the listing is done per root, so every article used to carry the root name');

    check('the instruction folder catches what the wording misses',
        snap!.articles.find((a) => a.title === 'New Supplier Interest')?.guidance === true,
        '',
        'it is in the folder but reads as plain prose; wording alone let it through');

    check('instruction wording outside the folder is still caught',
        snap!.articles.find((a) => a.title === 'Greeting note')?.guidance === true,
        '',
        'the folder is the rule, the wording check is the backstop');

    check('an ordinary article in an ordinary folder is not guidance',
        snap!.articles.find((a) => a.title === 'Are you Kosher certified?')?.guidance === false,
        '',
        'the rule must not sweep up normal answers');

    const kosher = await svc.search('Hi is your product kosher');
    check('finds the kosher article from an awkward question',
        kosher[0]?.article.title === 'Are you Kosher certified?',
        `got ${kosher.map((m) => m.article.title).join(' | ')}`,
        'the question Iri reported against the public KB');

    const shipping = await svc.search('is there free shipping');
    const titles = shipping.map((m) => m.article.title);
    check('a pointer article drags its referenced articles in',
        titles.includes('SHIPPING OPTIONS AND COSTS')
        && titles.includes('SHIPPING OPTION FOR RETAIL CUSTOMER'),
        `got ${titles.join(' | ')}`,
        'answering from the pointer alone tells the customer nothing');

    check('referenced articles are marked as such',
        shipping.some((m) => m.viaReference),
        '',
        'the caller needs to know which ones the customer did not ask for');

    check('free shipping minimum is a lookup', await svc.freeShippingMinimumFor('3029') === 150,
        `got ${await svc.freeShippingMinimumFor('3029')}`);
    check('a conflicted postcode returns null', await svc.freeShippingMinimumFor('2280') === null,
        `got ${await svc.freeShippingMinimumFor('2280')}`,
        'refusing to answer beats picking a tier at random');
    check('an unknown postcode returns null', await svc.freeShippingMinimumFor('9999') === null);
    check('a malformed postcode returns null', await svc.freeShippingMinimumFor('abc') === null);

    // ── the postcode lists must never reach a prompt ────────────────────────
    const tierArticle = snap!.articles.find((a) => a.title === '$400 minimum')!;
    check('a tier article body carries no postcodes',
        !/\b\d{4}\b/.test(tierArticle.body),
        `body was: ${tierArticle.body.slice(0, 120)}`,
        'the live $400 article is 22,000 characters of postcodes');
    check('a tier article body is short',
        tierArticle.body.length < 400,
        `got ${tierArticle.body.length} chars`,
        'it would otherwise be posted into every shipping prompt');

    const withPostcode = await svc.search('do I get free shipping to 3029');
    check('a postcode in the question is answered from the table',
        withPostcode[0]?.article.title === 'Free shipping for postcode 3029'
        && /\$150 or more/.test(withPostcode[0].article.body),
        `got ${withPostcode[0]?.article.title} :: ${withPostcode[0]?.article.body.slice(0, 120)}`,
        'membership of a 4,000 entry list is a lookup, not a comprehension task');

    const conflicted = await svc.search('free shipping to 2280');
    check('a conflicted postcode refuses rather than picking',
        /must not be quoted/.test(conflicted[0]?.article.body ?? ''),
        `got ${conflicted[0]?.article.body?.slice(0, 120)}`,
        '2280 is in both the $300 and $400 tiers on the live KB');

    // ── resilience ──────────────────────────────────────────────────────────
    const broken = new InternalKbService(brokenFetcher(), DEPT);
    check('a failing fetch returns null rather than throwing', (await broken.load()) === null,
        '',
        'a KB outage must not take the whole agent down');

    const noDept = new InternalKbService(fakeFetcher(), '');
    check('no department configured disables it quietly', (await noDept.load()) === null,
        '',
        'it has to be safe to deploy before the department id is set');

    console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
    process.exit(fail ? 1 : 0);
})();
