#!/usr/bin/env node
/**
 * MachShip `toEmail` POPULATION check.
 *
 * Question this answers: on the consignments our reference-lookup path actually
 * returns, how often is `toEmail` populated? The 8-digit (direct Syspro number)
 * verification route matches the customer's email against `toEmail`; if that
 * field is frequently empty, the route quietly degrades to "refuse".
 *
 * Method (READ ONLY, no enumeration — only HTG's own recent consignments):
 *   1. getRecentlyCreatedOrUpdatedConsignments over the last N days (<=10, API cap)
 *      to obtain real reference numbers.
 *   2. Feed those references back through returnConsignmentsByReference2/1 — the
 *      SAME calls the production code uses — so we test toEmail on the exact
 *      response shape OrderTrackingService consumes.
 *   3. Report the fraction of returned consignments with a non-empty toEmail,
 *      plus any other email-bearing fields (in case the field name varies).
 *
 * All emails are MASKED in output. Never commit the token.
 *
 * Run (from repo root):
 *   node --env-file=.env.local scripts/machship-toemail-check.mjs
 *   node --env-file=.env.local scripts/machship-toemail-check.mjs --days 10 --sample 120
 */

const BASE = 'https://live.machship.com';
const TOKEN = process.env.MACHSHIP_TOKEN;
if (!TOKEN) {
  console.error('\nERROR: MACHSHIP_TOKEN not set. Run: node --env-file=.env.local scripts/machship-toemail-check.mjs\n');
  process.exit(1);
}

const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d; };
// MachShip rejects windows that reach the 10-day boundary ("cannot go back
// further than 10 days"); our working calls used 7. Cap at 9, default 7.
const MAX_DAYS = 9;
const days = Math.min(parseInt(getArg('days', '7'), 10), MAX_DAYS);
const sample = parseInt(getArg('sample', '150'), 10);

async function call(method, path, body) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { token: TOKEN, 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: res.status, obj: json?.object ?? null, errs: json?.errors ?? null, text };
  } catch (err) {
    return { status: 0, obj: null, errs: [{ errorMessage: String(err) }], text: String(err) };
  }
}

const mask = (v) => {
  if (typeof v !== 'string' || !v) return v;
  if (v.includes('@')) { const [u, d] = v.split('@'); return `${u.slice(0, 2)}***@${d}`; }
  return v.length > 4 ? `${v.slice(0, 2)}***${v.slice(-2)}` : '***';
};

/** Recursively find populated keys matching a pattern. Returns [{path, value}]. */
function findKeys(obj, pattern, path = '', out = [], depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return out;
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    if (pattern.test(k) && (v === null || typeof v !== 'object')) out.push({ path: p, value: v });
    else if (v && typeof v === 'object') findKeys(Array.isArray(v) ? v[0] ?? {} : v, pattern, Array.isArray(v) ? `${p}[0]` : p, out, depth + 1);
  }
  return out;
}

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

console.log(`\n${'='.repeat(66)}`);
console.log(`MachShip toEmail population check — last ${days}d, sample<=${sample}`);
console.log('='.repeat(66));

// Auth
const ping = await call('POST', '/apiv2/authenticate/ping');
if (!(ping.status === 200 && ping.obj === true)) {
  console.error(`\nFAIL ping — HTTP ${ping.status}. Token invalid or network blocked.\n`);
  process.exit(1);
}
console.log('  auth OK');

// 1. Recent consignments → collect references.
const fromDateUtc = new Date(Date.now() - days * 86400000).toISOString().split('.')[0];
const toDateUtc = new Date().toISOString().split('.')[0];
const recent = await call('GET', `/apiv2/consignments/getRecentlyCreatedOrUpdatedConsignments?fromDateUtc=${encodeURIComponent(fromDateUtc)}&toDateUtc=${encodeURIComponent(toDateUtc)}&retrieveSize=${sample}&includeChildCompanies=true`);
const recentCons = Array.isArray(recent.obj) ? recent.obj : [];
console.log(`  recent consignments pulled: ${recentCons.length}${recent.errs?.length ? ` (errors: ${JSON.stringify(recent.errs)})` : ''}`);
if (!recentCons.length) { console.error('\n  No recent consignments — cannot assess. Stop.\n'); process.exit(1); }

// 2. Feed refs back through the SAME reference-lookup calls the app uses.
const ref2s = [...new Set(recentCons.map((c) => c.customerReference2).filter(nonEmpty))];
const ref1s = [...new Set(recentCons.map((c) => c.customerReference).filter(nonEmpty))];

let looked = [];
if (ref2s.length) {
  const r2 = await call('POST', '/apiv2/consignments/returnConsignmentsByReference2', ref2s);
  if (Array.isArray(r2.obj)) looked = looked.concat(r2.obj);
}
if (ref1s.length) {
  const r1 = await call('POST', '/apiv2/consignments/returnConsignmentsByReference1', ref1s);
  if (Array.isArray(r1.obj)) looked = looked.concat(r1.obj);
}
// De-dup by consignment id if present.
const seen = new Set();
const consignments = looked.filter((c) => {
  const id = c?.id ?? JSON.stringify(c).slice(0, 40);
  if (seen.has(id)) return false; seen.add(id); return true;
});
console.log(`  consignments returned by reference lookups: ${consignments.length} (ref2 refs=${ref2s.length}, ref1 refs=${ref1s.length})`);
if (!consignments.length) { console.error('\n  Reference lookups returned nothing — cannot assess toEmail on the lookup path.\n'); process.exit(1); }

// 3. toEmail population + any other email-bearing fields.
const withToEmail = consignments.filter((c) => nonEmpty(c.toEmail)).length;
const pct = ((withToEmail / consignments.length) * 100).toFixed(1);

// Discover every email-ish field across the sample and its populated rate.
const emailFieldCounts = {};
for (const c of consignments) {
  for (const { path, value } of findKeys(c, /email/i)) {
    emailFieldCounts[path] ??= { total: 0, populated: 0, sample: null };
    emailFieldCounts[path].total += 1;
    if (nonEmpty(value)) { emailFieldCounts[path].populated += 1; if (!emailFieldCounts[path].sample) emailFieldCounts[path].sample = mask(String(value)); }
  }
}

console.log('\n[ RESULT ]');
console.log(`  toEmail populated: ${withToEmail}/${consignments.length}  (${pct}%)`);
console.log('\n  all email-bearing fields on the reference-lookup response:');
for (const [path, s] of Object.entries(emailFieldCounts)) {
  console.log(`    ${path.padEnd(28)} populated ${s.populated}/${s.total}  e.g. ${s.sample ?? '(none populated)'}`);
}

const verdict = pct >= 98 ? 'SOLID — 8-digit toEmail verification is reliable'
  : pct >= 80 ? 'MOSTLY — usable but flag the gap; some 8-digit lookups will refuse'
  : 'PATCHY — 8-digit toEmail route degrades to refuse too often; do not pitch as reliable';
console.log(`\n  VERDICT: ${verdict}`);
console.log('='.repeat(66) + '\n');
