#!/usr/bin/env node
/**
 * MachShip CAPABILITY / PERMISSION check.
 *
 * Question this answers: can our EXISTING token do everything Iri asked for,
 * or do we need a new one issued?
 *
 * Requirements traced (from the 19 Jun meeting):
 *   R1  Look up a customer's shipment by their order number      (Reference1/2)
 *   R2  Split shipments: multiple consignments + box-level data  (items/extensions 01,02)
 *   R3  Security gate: order number + matching EMAIL             (is email on the consignment?)
 *   R4  Status translation: raw statuses -> friendly wording     (status + statusHistory)
 *   R5  Self-service tracking link                               (trackingPageAccessToken)
 *   R6  Proof of delivery                                        (attachments/PODs)
 *   R7  FUTURE phase: live rate quotes                           (prices/routes permission)
 *   R8  Over-privilege: can this token CREATE/manifest freight?  (it shouldn't need to)
 *
 * SAFETY: read-only by default. Creates/books/modifies NOTHING.
 *   --probe-writes  additionally probes write endpoints using DELIBERATELY EMPTY
 *                   payloads. An empty payload cannot create anything — it just
 *                   distinguishes 403 (no permission) from 400 (has permission,
 *                   invalid body). This is how we detect over-privilege.
 *
 * Usage (from repo root):
 *   node --env-file=.env.local scripts/machship-capability-check.mjs
 *   node --env-file=.env.local scripts/machship-capability-check.mjs --bc-order 1234
 *   node --env-file=.env.local scripts/machship-capability-check.mjs --probe-writes
 *
 * Customer PII (emails/names) is MASKED in output. Never commit the token.
 *
 * Refs: developers.live.machship.com  /api/api-overview, /api/supporting/tracking-pods,
 *       /api/supporting/tracking-links, /api/faqs/finding-company-ids
 */

const BASE = 'https://live.machship.com';
const TOKEN = process.env.MACHSHIP_TOKEN;
if (!TOKEN) {
  console.error('\nERROR: MACHSHIP_TOKEN not set. Run from repo root:');
  console.error('  node --env-file=.env.local scripts/machship-capability-check.mjs\n');
  process.exit(1);
}

const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d; };
const has = (n) => args.includes(`--${n}`);
const bcOrder = getArg('bc-order', null);
const probeWrites = has('probe-writes');
const MAX_DAYS = 10; // hard API limit on getRecentlyCreatedOrUpdatedConsignments
const days = Math.min(parseInt(getArg('days', '7'), 10), MAX_DAYS);

const R = {}; // requirement -> {status, note}
const set = (k, status, note = '') => { R[k] = { status, note }; };

async function call(method, path, body) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { token: TOKEN, 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* non-JSON (files) */ }
    const errs = json?.errors;
    const errMsg = Array.isArray(errs) ? errs.map((e) => e.errorMessage).filter(Boolean).join('; ') : null;
    return { status: res.status, json, text, errMsg, obj: json?.object ?? null };
  } catch (err) {
    return { status: 0, json: null, text: String(err), errMsg: String(err), obj: null };
  }
}

const mask = (v) => {
  if (typeof v !== 'string' || !v) return v;
  if (v.includes('@')) { const [u, d] = v.split('@'); return `${u.slice(0, 2)}***@${d}`; }
  return v.length > 4 ? `${v.slice(0, 2)}***${v.slice(-2)}` : '***';
};

/** Recursively find keys matching a pattern. Returns [{path, value}]. */
function findKeys(obj, pattern, path = '', out = [], depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return out;
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    if (pattern.test(k) && (v === null || typeof v !== 'object')) out.push({ path: p, value: v });
    else if (v && typeof v === 'object') findKeys(Array.isArray(v) ? v[0] ?? {} : v, pattern, Array.isArray(v) ? `${p}[0]` : p, out, depth + 1);
  }
  return out;
}

console.log(`\n${'='.repeat(66)}`);
console.log(`MachShip capability check — ${new Date().toISOString()}`);
console.log(`Mode: ${probeWrites ? 'READ + write-permission probes (empty payloads)' : 'READ ONLY'}`);
console.log('='.repeat(66));

// ── Auth + scope ────────────────────────────────────────────────────────────
console.log('\n[ AUTH & SCOPE ]');
const ping = await call('POST', '/apiv2/authenticate/ping');
if (!(ping.status === 200 && ping.obj === true)) {
  console.error(`  FAIL ping — HTTP ${ping.status}. Token invalid.\n`);
  process.exit(1);
}
console.log('  PASS  token authenticates');

const co = await call('GET', '/apiv2/companies/getAll');
const companies = Array.isArray(co.obj) ? co.obj : [];
console.log(`  ${companies.length ? 'PASS' : 'WARN'}  companies visible: ${companies.map((c) => `${c.name} (id=${c.id}, ${c.accountCode})`).join(', ') || 'none'}`);

// ── Pull a live sample to work against ──────────────────────────────────────
console.log('\n[ SAMPLE DATA ]');
const fromDateUtc = new Date(Date.now() - days * 86400000).toISOString().split('.')[0];
const toDateUtc = new Date().toISOString().split('.')[0];
const recent = await call('GET', `/apiv2/consignments/getRecentlyCreatedOrUpdatedConsignments?fromDateUtc=${encodeURIComponent(fromDateUtc)}&toDateUtc=${encodeURIComponent(toDateUtc)}&retrieveSize=200&includeChildCompanies=true`);
const cons = Array.isArray(recent.obj) ? recent.obj : [];
console.log(`  ${cons.length ? 'PASS' : 'FAIL'}  ${cons.length} consignment(s) in last ${days}d${recent.errMsg ? ` — API: ${recent.errMsg}` : ''}`);
if (!cons.length) { console.error('\n  No sample data — cannot assess capabilities. Stop.\n'); process.exit(1); }
console.log(`  NOTE  live production data present => token is NOT test-mode`);

// ── R1: lookup by reference ─────────────────────────────────────────────────
console.log('\n[ R1 ] Order lookup by reference');
const sample = cons[0];
const ref1 = sample.customerReference;
const ref2 = sample.customerReference2;
console.log(`  sample consignment id=${sample.id}  ref1="${ref1}"  ref2="${ref2}"`);

const byRef1 = await call('POST', '/apiv2/consignments/returnConsignmentsByReference1', [ref1]);
const r1list = Array.isArray(byRef1.obj) ? byRef1.obj : [];
console.log(`  ${r1list.length ? 'PASS' : 'FAIL'}  returnConsignmentsByReference1 → HTTP ${byRef1.status}, ${r1list.length} result(s)`);

const byRef2 = await call('POST', '/apiv2/consignments/returnConsignmentsByReference2', [ref2]);
const r2list = Array.isArray(byRef2.obj) ? byRef2.obj : [];
console.log(`  ${r2list.length ? 'PASS' : 'FAIL'}  returnConsignmentsByReference2 → HTTP ${byRef2.status}, ${r2list.length} result(s)`);
set('R1', r1list.length || r2list.length ? 'YES' : 'NO', `ref1 lookup=${r1list.length}, ref2 lookup=${r2list.length}`);

// ── The BIG question: is the reference the BigCommerce order number? ────────
console.log('\n[ R1b ] Is the reference a BigCommerce order number, or an ERP sales order?');
console.log(`  observed format: ref1="${ref1}" ref2="${ref2}"`);
if (String(ref2 ?? '').toUpperCase().startsWith('SO')) {
  console.log('  >> ref2 carries an "SO" prefix — that looks like an ERP Sales Order number.');
  console.log('     If customers quote their BigCommerce order number, it may NOT match these.');
}
// FORENSICS: how fast does the reference sequence climb vs how many shipments exist?
// If refs advance ~1 per consignment, the sequence is shipment-driven (ERP SO per shipment).
// If it advances much faster, it's counting something bigger (e.g. ALL web orders incl.
// unshipped/cancelled) — which is what a BigCommerce order-number sequence looks like.
{
  const total = recent.json?.totalItems ?? null;
  const nums = cons.map((c) => parseInt(String(c.customerReference ?? '').replace(/\D/g, ''), 10)).filter((n) => !isNaN(n));
  if (nums.length > 1) {
    const min = Math.min(...nums), max = Math.max(...nums);
    const spread = max - min;
    console.log(`  reference sequence: min=${min} max=${max} spread=${spread}`);
    console.log(`  consignments: returned=${cons.length}${total !== null ? ` totalItems=${total}` : ' (totalItems not reported)'}`);
    const denom = total ?? cons.length;
    const ratio = denom ? (spread / denom).toFixed(1) : '?';
    console.log(`  => sequence advances ~${ratio} per consignment over ${days}d`);
    if (denom && spread / denom > 3) {
      console.log('     >> Climbs MUCH faster than shipments — the sequence counts more than');
      console.log('        consignments. Consistent with a WEB ORDER number (many orders never');
      console.log('        become a freight consignment). Weak evidence FOR BigCommerce.');
    } else if (denom && spread / denom <= 1.5) {
      console.log('     >> Roughly 1:1 with consignments — sequence looks shipment-driven.');
      console.log('        Weak evidence FOR an ERP sales-order number.');
    }
    console.log('     (Weak signal either way — corroborate, do not conclude.)');
  }

  // The item-level `references` field was never expanded. If the web order number is
  // stashed anywhere, this is the most likely spot.
  const d0 = (await call('GET', `/apiv2/consignments/getConsignment?id=${cons[0].id}`)).obj;
  const item = d0?.consignmentItems?.[0];
  if (item) {
    console.log('\n  unexplored item fields (hunting for a web order number):');
    console.log(`    references      = ${JSON.stringify(item.references)}`);
    console.log(`    itemReferences  = ${JSON.stringify(item.itemReferences)}`);
    console.log(`    contents        = ${JSON.stringify(item.consignmentItemContents)}`);
    console.log(`    name/sku        = ${JSON.stringify(item.name)} / ${JSON.stringify(item.sku)}`);
  }
}

// Which system creates these consignments? MachShip's native BigCommerce order-sync
// creates PENDING consignments first ("BigCommerce order number to reference field").
// An ERP/WMS push creates consignments directly. Lineage tells us which.
{
  const sampleSize = Math.min(cons.length, 25);
  let withPending = 0;
  const creators = {};
  for (const c of cons.slice(0, sampleSize)) {
    const d = (await call('GET', `/apiv2/consignments/getConsignment?id=${c.id}`)).obj;
    if (!d) continue;
    if (Array.isArray(d.pendingConsignmentIds) && d.pendingConsignmentIds.length) withPending++;
    const who = d.insertedByUserName || d.createdByUserId || 'unknown';
    creators[who] = (creators[who] || 0) + 1;
  }
  console.log(`  lineage check over ${sampleSize} consignments:`);
  console.log(`    created via PENDING consignment (BigCommerce order-sync style): ${withPending}/${sampleSize}`);
  console.log(`    created DIRECTLY (ERP/WMS push style):                          ${sampleSize - withPending}/${sampleSize}`);
  console.log(`    distinct creators: ${Object.keys(creators).length} → ${Object.entries(creators).map(([k, n]) => `${mask(String(k))}×${n}`).join(', ')}`);
  if (withPending === 0) {
    console.log('    >> No pending lineage anywhere => NOT MachShip\'s native BigCommerce order-sync.');
    console.log('       Leans ERP/WMS push => ref1 may be the ERP sales order number.');
  } else if (withPending === sampleSize) {
    console.log('    >> All via pending consignments => consistent with BigCommerce order-sync.');
    console.log('       MachShip docs: that integration writes the BIGCOMMERCE ORDER NUMBER to the reference field.');
  }
}

if (bcOrder) {
  for (const [label, ep] of [['Reference1', 'returnConsignmentsByReference1'], ['Reference2', 'returnConsignmentsByReference2']]) {
    const r = await call('POST', `/apiv2/consignments/${ep}`, [String(bcOrder)]);
    const n = Array.isArray(r.obj) ? r.obj.length : 0;
    console.log(`  BC order "${bcOrder}" via ${label} → ${n} result(s) ${n ? '*** MATCH — BigCommerce order numbers ARE in MachShip ***' : '(no match)'}`);
    if (n) set('R1b', 'YES', `BigCommerce order number matches ${label}`);
  }
  if (!R.R1b) set('R1b', 'NO', `BC order "${bcOrder}" not found in either reference field — mapping layer needed`);
} else {
  set('R1b', 'UNKNOWN', 'no --bc-order supplied; pass a real BigCommerce order number to settle this');
  console.log('  SKIP — re-run with --bc-order "<a real BigCommerce order number>" to settle it.');
}

// ── Optional: dump EVERY field on a consignment, hunting for a web order no. ─
if (has('dump-detail')) {
  console.log('\n[ DUMP ] Every scalar field on the consignment detail');
  console.log('  Looking for any field that might carry the BigCommerce/web order number.');
  const d0 = (await call('GET', `/apiv2/consignments/getConsignment?id=${cons[0].id}`)).obj;
  if (d0) {
    for (const [k, v] of Object.entries(d0)) {
      if (v === null || typeof v !== 'object') {
        const show = /email|phone|name|address|contact/i.test(k) ? mask(String(v)) : JSON.stringify(v);
        console.log(`    ${k} = ${show}`);
      } else if (Array.isArray(v)) {
        console.log(`    ${k} = [array of ${v.length}]`);
      } else {
        console.log(`    ${k} = {object: ${Object.keys(v).slice(0, 8).join(', ')}}`);
      }
    }
    console.log('\n  >> Any field above look like a web/store order number (distinct from the SO)?');
  }
}

// ── R2: split shipments + box-level detail ──────────────────────────────────
console.log('\n[ R2 ] Split shipments & box-level data');
const refCounts = {};
for (const c of cons) { const k = c.customerReference; if (k) refCounts[k] = (refCounts[k] || 0) + 1; }
const multi = Object.entries(refCounts).filter(([, n]) => n > 1);
console.log(`  ${multi.length} order reference(s) with MULTIPLE consignments in this window${multi.length ? ` (e.g. ${multi[0][0]} → ${multi[0][1]} consignments)` : ''}`);

const detailRes = await call('GET', `/apiv2/consignments/getConsignment?id=${sample.id}`);
const detail = detailRes.obj;
let itemsInfo = 'none found';
if (detail) {
  const arrays = Object.entries(detail).filter(([, v]) => Array.isArray(v) && v.length && typeof v[0] === 'object');
  console.log(`  detail arrays: ${arrays.map(([k, v]) => `${k}(${v.length})`).join(', ') || 'none'}`);
  const itemsKey = arrays.find(([k]) => /item|package|carton|box/i.test(k));
  if (itemsKey) {
    const [k, v] = itemsKey;
    itemsInfo = `${k} × ${v.length}`;
    console.log(`  PASS  box-level data via "${k}": ${v.length} item(s)`);
    console.log(`        item fields: ${Object.keys(v[0]).slice(0, 14).join(', ')}`);
    const bc = findKeys(v[0], /barcode|sscc|extension|reference/i);
    if (bc.length) console.log(`        identifiers: ${bc.map((x) => `${x.path}=${JSON.stringify(x.value)}`).join('  ')}`);
  } else {
    console.log('  WARN  no item/package array found on the consignment detail');
  }
}
set('R2', multi.length || itemsInfo !== 'none found' ? 'YES' : 'PARTIAL', `multi-consignment orders=${multi.length}, items=${itemsInfo}`);

// ── R3: security gate — is an email available? ──────────────────────────────
console.log('\n[ R3 ] Security gate — order number + EMAIL match');
const emails = detail ? findKeys(detail, /email/i) : [];
if (emails.length) {
  for (const e of emails) console.log(`  found ${e.path} = ${e.value ? mask(String(e.value)) : '(empty)'}`);
  const populated = emails.filter((e) => typeof e.value === 'string' && e.value.trim());
  console.log(`  ${populated.length ? 'PASS' : 'WARN'}  ${populated.length}/${emails.length} email field(s) populated`);
  set('R3', populated.length ? 'YES' : 'NO', populated.length ? `email present at ${populated[0].path}` : 'email fields exist but are EMPTY — gate needs BigCommerce');
} else {
  console.log('  FAIL  no email field anywhere on the consignment detail');
  console.log('  >> The order+email gate would need BigCommerce as the email source. Extra scope.');
  set('R3', 'NO', 'no email on consignment — needs BigCommerce API for the gate');
}

// ── R4: status vocabulary ───────────────────────────────────────────────────
console.log('\n[ R4 ] Status translation source');
const statusNames = new Set();
for (const c of cons) if (c.status?.name) statusNames.add(c.status.name);
if (detail?.statusHistory?.length) for (const h of detail.statusHistory) if (h.consignmentTrackingStatus?.name) statusNames.add(h.consignmentTrackingStatus.name);
console.log(`  PASS  statuses observed: ${[...statusNames].join(', ') || '(none in sample)'}`);
console.log('  NOTE  full documented set: Unmanifested, Manifested, In Transit, Complete (+ others)');
set('R4', statusNames.size ? 'YES' : 'PARTIAL', `observed: ${[...statusNames].join(', ')}`);

// ── R5: tracking link ───────────────────────────────────────────────────────
console.log('\n[ R5 ] Self-service tracking link');
const tok = (r1list[0] ?? sample)?.trackingPageAccessToken;
if (tok) {
  console.log(`  PASS  trackingPageAccessToken present → https://mship.io/v2/${mask(String(tok))}`);
  set('R5', 'YES', 'token returned on reference lookup; no extra call needed');
} else {
  console.log('  WARN  no trackingPageAccessToken on this consignment');
  set('R5', 'NO', 'not returned in lookup response');
}

// ── R6: PODs ────────────────────────────────────────────────────────────────
console.log('\n[ R6 ] Proof of delivery');
const withPod = cons.find((c) => (c.attachmentCount ?? 0) > 0);
if (!withPod) {
  console.log(`  SKIP  no consignment in the last ${days}d has attachments (PODs appear once Complete).`);
  set('R6', 'UNKNOWN', 'no delivered consignment in window to test against');
} else {
  const att = await call('POST', '/apiv2/consignments/getAttachments', { consignmentId: withPod.id });
  const list = Array.isArray(att.obj) ? att.obj : [];
  console.log(`  ${att.status === 200 ? 'PASS' : 'FAIL'}  getAttachments → HTTP ${att.status}, ${list.length} attachment(s)${att.errMsg ? ` — ${att.errMsg}` : ''}`);
  set('R6', att.status === 200 ? 'YES' : 'NO', `HTTP ${att.status}, ${list.length} attachment(s)`);
}

// ── R7 / R8: permission probes (empty payloads — cannot create anything) ────
if (probeWrites) {
  console.log('\n[ R7/R8 ] Write & rate permission probes (EMPTY payloads — nothing can be created)');
  console.log('  Reading: 403/401 = no permission | 400/422 = HAS permission, body just invalid');
  const probes = [
    ['R7 live rates (future phase)', 'POST', '/apiv2/consignments/getPricesAndRoutes'],
    ['R8 create consignment', 'POST', '/apiv2/consignments/createConsignment'],
    ['R8 create pending', 'POST', '/apiv2/consignments/createPendingConsignment'],
    ['R8 manifest', 'POST', '/apiv2/consignments/manifestConsignments'],
  ];
  for (const [label, method, path] of probes) {
    const r = await call(method, path, {});
    const denied = r.status === 401 || r.status === 403;
    const permitted = r.status === 400 || r.status === 422 || r.status === 200;
    console.log(`  ${label.padEnd(30)} HTTP ${r.status} → ${denied ? 'NO PERMISSION' : permitted ? 'PERMISSION PRESENT' : 'inconclusive'}${r.errMsg ? ` (${r.errMsg.slice(0, 70)})` : ''}`);
    if (label.startsWith('R7')) set('R7', denied ? 'NO' : permitted ? 'YES' : 'UNKNOWN', `HTTP ${r.status}`);
    if (label.startsWith('R8') && permitted) set('R8', 'YES', 'token can perform write operations — OVER-PRIVILEGED for tracking-only');
  }
  if (!R.R8) set('R8', 'NO', 'no write permissions detected — correctly scoped');
} else {
  set('R7', 'UNKNOWN', 'run with --probe-writes');
  set('R8', 'UNKNOWN', 'run with --probe-writes');
  console.log('\n[ R7/R8 ] SKIPPED — re-run with --probe-writes to test rate + write permissions.');
}

// ── Verdict ─────────────────────────────────────────────────────────────────
const labels = {
  R1: 'Look up shipment by order reference',
  R1b: 'Reference == BigCommerce order number?',
  R2: 'Split shipments + box-level data',
  R3: 'Email available for security gate',
  R4: 'Status vocabulary for translation',
  R5: 'Self-service tracking link',
  R6: 'Proof of delivery',
  R7: 'Live rates (future phase)',
  R8: 'Token can write/book freight (over-privilege)',
};
console.log(`\n${'='.repeat(66)}`);
console.log('CAPABILITY MATRIX — can our existing token do what Iri asked?');
console.log('='.repeat(66));
for (const [k, label] of Object.entries(labels)) {
  const r = R[k] ?? { status: 'UNKNOWN', note: '' };
  console.log(`  ${k.padEnd(4)} ${label.padEnd(44)} ${r.status.padEnd(8)} ${r.note}`);
}
const blockers = Object.entries(R).filter(([k, v]) => ['R1', 'R2', 'R4', 'R5'].includes(k) && v.status === 'NO');
console.log('\n  PHASE 1 (order tracking):');
console.log(`    ${blockers.length === 0 ? 'No blockers on the core tracking path.' : `BLOCKED: ${blockers.map(([k]) => k).join(', ')}`}`);
if (R.R1b?.status !== 'YES') console.log('    OPEN: confirm whether customers quote a number that exists in MachShip (R1b).');
if (R.R3?.status === 'NO') console.log('    OPEN: email gate needs a source other than MachShip (BigCommerce). Adds scope.');
if (R.R8?.status === 'YES') console.log('    SECURITY: token is over-privileged — request a tracking-only user for production.');
console.log('='.repeat(66) + '\n');
