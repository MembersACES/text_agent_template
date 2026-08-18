#!/usr/bin/env node
/**
 * MachShip API access check — READ ONLY.
 *
 * Answers, in order:
 *   1. Does the token authenticate?
 *   2. WHOSE account is it on? (companies visible to this token)
 *   3. Can it read real consignments?
 *   4. Do the reference fields carry the order number? (the whole design rests on this)
 *   5. Does returnConsignmentsByReference1 work?
 *
 * Creates/modifies NOTHING in MachShip. Only read endpoints.
 *
 * Usage (PowerShell, from the repo root):
 *   node --env-file=.env.local scripts/machship-access-check.mjs
 *   node --env-file=.env.local scripts/machship-access-check.mjs --days 365
 *   node --env-file=.env.local scripts/machship-access-check.mjs --ref "12345"
 *
 * Never hard-code the token here. Never commit it.
 *
 * Refs: https://developers.live.machship.com/api/api-overview
 *       https://developers.live.machship.com/api/supporting/tracking-pods
 *       https://developers.live.machship.com/api/faqs/finding-company-ids
 */

const BASE = 'https://live.machship.com';
const TOKEN = process.env.MACHSHIP_TOKEN;

if (!TOKEN) {
  console.error('\nERROR: MACHSHIP_TOKEN not set. From the repo root run:');
  console.error('  node --env-file=.env.local scripts/machship-access-check.mjs\n');
  process.exit(1);
}

const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d; };
const refArg = getArg('ref', null);
// getRecentlyCreatedOrUpdatedConsignments rejects any window > 10 days:
// "You cannot go back further than 10 days for this query"
const MAX_DAYS = 10;
const requestedDays = parseInt(getArg('days', '7'), 10);
const days = Math.min(requestedDays, MAX_DAYS);

// Facts we establish, used for an honest verdict at the end.
const facts = { auth: false, companies: 0, consignments: 0, refFieldWithValue: false, refLookup: false, apiError: null };

async function call(method, path, body) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { token: TOKEN, 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: res.status, ok: res.ok, json, text };
  } catch (err) {
    return { status: 0, ok: false, json: null, text: String(err) };
  }
}

function showRefFields(obj, indent = '      ') {
  const hits = Object.keys(obj).filter((k) => /ref/i.test(k) && (obj[k] === null || typeof obj[k] !== 'object'));
  if (!hits.length) return console.log(`${indent}(no *ref* fields on this object)`);
  for (const k of hits) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) facts.refFieldWithValue = true;
    console.log(`${indent}${k} = ${JSON.stringify(v)}`);
  }
}

console.log(`\nMachShip access check — ${new Date().toISOString()}`);
console.log(`Base: ${BASE}   Window: last ${days} day(s)`);
if (requestedDays > MAX_DAYS) {
  console.log(`NOTE: --days ${requestedDays} exceeds this endpoint's ${MAX_DAYS}-day hard limit; clamped to ${MAX_DAYS}.`);
}
console.log('');

// ── 1. Authentication ───────────────────────────────────────────────────────
console.log('1) Authentication');
const ping = await call('POST', '/apiv2/authenticate/ping');
facts.auth = ping.status === 200 && ping.json?.object === true;
console.log(`   ${facts.auth ? 'PASS' : 'FAIL'}  ping — HTTP ${ping.status}`);
if (!facts.auth) {
  console.error(`\n   Token invalid/expired/revoked. Response: ${ping.text.slice(0, 200)}\n`);
  process.exit(1);
}

// ── 2. Whose account is this token on? ──────────────────────────────────────
console.log('\n2) Account scope — which companies can this token see?');
const co = await call('GET', '/apiv2/companies/getAll');
const companies = Array.isArray(co.json?.object) ? co.json.object : [];
facts.companies = companies.length;
console.log(`   HTTP ${co.status}, ${companies.length} company/companies visible`);
if (co.status === 403 || (co.status === 200 && companies.length === 0)) {
  console.log('   >> Token cannot list companies (permission-scoped, or sees none).');
}
for (const c of companies.slice(0, 20)) {
  console.log(`     id=${c.id}  name="${c.name}"  code=${c.accountCode ?? '-'}  parent=${c.parentCompanyId ?? '-'}`);
}
if (companies.length) {
  console.log('\n   >> Do you recognise Honest to Goodness above? If not, this token is on');
  console.log('      a DIFFERENT MachShip account and will never see their consignments.');
}

// ── 3. Consignment read access ──────────────────────────────────────────────
console.log('\n3) Consignment read access');
const fromDateUtc = new Date(Date.now() - days * 86400000).toISOString().split('.')[0];
const toDateUtc = new Date().toISOString().split('.')[0];
const qs = `fromDateUtc=${encodeURIComponent(fromDateUtc)}&toDateUtc=${encodeURIComponent(toDateUtc)}&retrieveSize=40&includeChildCompanies=true`;

/** The API wraps everything in {object, errors}. Surface errors — they explain empty results. */
function reportEnvelope(r, label) {
  const list = Array.isArray(r.json?.object) ? r.json.object : [];
  const errs = r.json?.errors;
  console.log(`   ${label} → HTTP ${r.status}, ${list.length} consignment(s)`);
  if (errs && (!Array.isArray(errs) || errs.length)) {
    console.log(`     API errors: ${JSON.stringify(errs)}`);
    facts.apiError = Array.isArray(errs) ? errs.map((e) => e.errorMessage).filter(Boolean).join('; ') : String(errs);
  }
  if (r.json?.object === null) console.log('     (object was null, not an empty array)');
  if (!list.length) console.log(`     raw: ${r.text.slice(0, 300)}`);
  return list;
}

let cons = [];
console.log(`   window: ${fromDateUtc} .. ${toDateUtc}`);
const unfiltered = await call('GET', `/apiv2/consignments/getRecentlyCreatedOrUpdatedConsignments?${qs}`);
cons = reportEnvelope(unfiltered, 'unfiltered      ');

// If nothing, try explicitly per company — some tokens need the companyId filter.
if (!cons.length && companies.length) {
  for (const c of companies.slice(0, 10)) {
    const r = await call('GET', `/apiv2/consignments/getRecentlyCreatedOrUpdatedConsignments?${qs}&companyId=${c.id}`);
    const list = reportEnvelope(r, `companyId=${c.id} ("${c.name}")`);
    if (list.length) { cons = list; break; }
  }
}
facts.consignments = cons.length;

if (!cons.length) {
  if (facts.apiError) {
    console.log(`\n   The API REJECTED the query: "${facts.apiError}"`);
    console.log('   This is a QUERY problem, not proof of an access problem. Fix the query, re-run.');
  } else {
    console.log('\n   DIAGNOSIS — query accepted but 0 consignments returned. Candidates:');
    console.log('     a) token is on a TEST-MODE user (only ever sees test consignments)');
    console.log('     b) its user has consignment permissions scoped to nothing');
    console.log('     c) genuinely no consignment activity in this short window (try --days 10)');
  }
}

// ── 4. Reference fields — the make-or-break check ───────────────────────────
if (cons.length) {
  console.log('\n4) Reference fields (order-number lookup depends entirely on these)');
  for (const c of cons.slice(0, 5)) {
    console.log(`   consignment id=${c.id}  carrierCon=${c.carrierConsignmentId ?? '-'}  status=${c.status?.name ?? '-'}  attachments=${c.attachmentCount ?? 0}`);
    showRefFields(c);
  }
  console.log('\n   >> Does any ref field hold the BigCommerce order number?');
  console.log('      If all null/blank, "look up by order number" needs a rethink.');

  // Single consignment detail + status vocabulary
  const one = await call('GET', `/apiv2/consignments/getConsignment?id=${cons[0].id}`);
  const detail = one.json?.object;
  console.log(`\n   getConsignment by id → HTTP ${one.status}`);
  if (detail?.statusHistory?.length) {
    const names = [...new Set(detail.statusHistory.map((h) => h.consignmentTrackingStatus?.name).filter(Boolean))];
    console.log(`   raw tracking statuses: ${names.join(' -> ')}`);
    console.log('   (these are what we map into friendly customer wording)');
  }
}

// ── 5. Lookup by Reference 1 ────────────────────────────────────────────────
console.log('\n5) Lookup by Reference 1 (returnConsignmentsByReference1)');
let testRef = refArg;
if (!testRef && cons.length) {
  for (const c of cons) {
    const k = Object.keys(c).find((key) => /ref/i.test(key) && typeof c[key] === 'string' && c[key].trim());
    if (k) { testRef = c[k]; console.log(`   (using discovered ref from "${k}": ${JSON.stringify(testRef)})`); break; }
  }
}

if (!testRef) {
  console.log('   SKIP — no reference to test. Re-run with --ref "<a real order ref>".');
} else {
  // Body schema isn't in the handbook; try likely shapes, report which lands.
  const shapes = [
    { label: 'array of strings', body: [testRef] },
    { label: '{ references: [...] }', body: { references: [testRef] } },
    { label: '{ reference1s: [...] }', body: { reference1s: [testRef] } },
    { label: '{ reference1: "..." }', body: { reference1: testRef } },
  ];
  for (const s of shapes) {
    const r = await call('POST', '/apiv2/consignments/returnConsignmentsByReference1', s.body);
    const got = Array.isArray(r.json?.object) ? r.json.object.length : null;
    if (r.status === 200 && got !== null) {
      facts.refLookup = true;
      console.log(`   PASS [${s.label}] → HTTP 200, ${got} consignment(s) for ref ${JSON.stringify(testRef)}`);
      if (got > 1) console.log('   >> Multiple consignments for one ref = split shipment. Exactly our use case.');
      break;
    }
    console.log(`   tried ${s.label} → HTTP ${r.status} ${r.text.slice(0, 100)}`);
  }
  if (!facts.refLookup) console.log('   FAIL — no shape accepted. Confirm schema at https://live.machship.com/swagger');
}

// ── Honest verdict ──────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(64));
console.log('WHAT IS ACTUALLY PROVEN:');
console.log(`  token authenticates .................. ${facts.auth ? 'YES' : 'NO'}`);
console.log(`  companies visible .................... ${facts.companies}`);
console.log(`  real consignments readable ........... ${facts.consignments > 0 ? `YES (${facts.consignments})` : 'NO'}`);
console.log(`  a ref field carries a value .......... ${facts.refFieldWithValue ? 'YES' : 'NOT SHOWN'}`);
console.log(`  lookup by reference works ............ ${facts.refLookup ? 'YES' : 'NOT SHOWN'}`);
console.log('');
if (facts.auth && facts.consignments === 0) {
  console.log('  => Token is VALID but has proven NO access to live shipment data.');
  console.log('     Not sufficient for phase 1 yet. Resolve test-mode vs wrong-account');
  console.log('     vs permissions with whoever issued it before scoping the build.');
} else if (facts.auth && facts.consignments > 0 && facts.refLookup && facts.refFieldWithValue) {
  console.log('  => Sufficient for phase 1 (order tracking). Confirm the ref field really');
  console.log('     holds the BigCommerce order number, not an internal ID.');
} else {
  console.log('  => Partial. See the gaps above before committing to scope.');
}
console.log('─'.repeat(64) + '\n');
