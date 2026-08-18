#!/usr/bin/env node
/**
 * dotWMS lookup check — READ ONLY, deliberately narrow.
 *
 * ONE question: does the endpoint verify the email, or will it hand over an order
 * to anyone who knows the (6-digit, sequential) BigCommerce order number?
 *
 * SCOPE DISCIPLINE — read this before extending:
 *   We test ONLY the single order Welly volunteered in his own email/screenshot.
 *   We do NOT iterate over other order numbers. They're sequential and guessable, and
 *   walking them would pull real customers' PII we have no business reason to see —
 *   which is precisely the risk we're testing FOR. Questions about split orders and the
 *   full status list go to Welly, not to this script.
 *
 * Setup — put these in .env.local (never in this file, never in chat):
 *   DOTWMS_API_KEY=...
 *   DOTWMS_TEST_ORDER=BC-319896                 # the order from Welly's example
 *   DOTWMS_TEST_EMAIL=nadeeka.whyte@gmail.com   # the matching email from his example
 *
 * Run:
 *   node --env-file=.env.local scripts/dotwms-access-check.mjs
 */

const BASE = 'https://f.dotwms.com/api/1.0/GetFileExport/';
const KEY = process.env.DOTWMS_API_KEY;
const ORDER = process.env.DOTWMS_TEST_ORDER;
const EMAIL = process.env.DOTWMS_TEST_EMAIL;

if (!KEY || !ORDER || !EMAIL) {
  console.error('\nMissing env. Add to .env.local:');
  console.error('  DOTWMS_API_KEY=...');
  console.error('  DOTWMS_TEST_ORDER=BC-319896');
  console.error('  DOTWMS_TEST_EMAIL=the.matching@email.com\n');
  process.exit(1);
}

const mask = (v) => {
  if (typeof v !== 'string' || !v) return v;
  if (v.includes('@')) { const [u, d] = v.split('@'); return `${u.slice(0, 2)}***@${d}`; }
  return v;
};

async function lookup(email, order, label) {
  const url = `${BASE}?InstanceCode=H2G&ExportFileType=GenericSQL_1323&APIKey=${encodeURIComponent(KEY)}`
    + `&DocumentFormat=JSON&DocumentKey=${encodeURIComponent(`${email}|${order}`)}`;
  const res = await fetch(url);
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  const rows = Array.isArray(json) ? json : (json ? [json] : []);
  console.log(`\n${label}`);
  console.log(`  key: ${mask(email)}|${order}`);
  console.log(`  HTTP ${res.status} · ${rows.length} row(s)`);
  for (const r of rows) {
    console.log(`    PackSlipNumber=${r.PackSlipNumber ?? '-'}  JobStatus=${r.JobStatus ?? '-'}`
      + `  Translated=${r.JobStatusTranslated ?? '-'}  Held=${r.JobHeldReason ?? 'none'}`
      + `  DeliveryEmail=${mask(r.DeliveryEmail ?? '-')}`);
  }
  if (!rows.length) console.log(`    raw: ${text.slice(0, 200)}`);
  return rows;
}

console.log('\n' + '='.repeat(62));
console.log('dotWMS lookup — does it check the email?');
console.log('Testing ONLY the order Welly provided. No enumeration.');
console.log('='.repeat(62));

// 1. Baseline — his own example. Should return the order.
const good = await lookup(EMAIL, ORDER, '[1] BASELINE — correct email + correct order');

// 2. THE TEST — same order, wrong email. Should return NOTHING.
//
// Use a WELL-FORMED address at a REAL domain. An earlier version used
// "@example.invalid" — a reserved non-existent TLD — which meant a rejection
// might only prove the email was malformed, not that it failed to match the
// order. That is the difference between "this endpoint is secure" and "this
// endpoint rejects rubbish input", and we were about to tell the client the
// former based on evidence for the latter.
const wrong = await lookup('aces.integration.test.not.a.customer@gmail.com', ORDER,
  '[2] SECURITY TEST — WRONG email (well-formed, real domain) + correct order');

// 2b. Control — malformed address. If 2 rejects but 2b rejects too, we still
// cannot tell "no match" from "bad input". Compare the two responses.
const malformed = await lookup('definitely-not-the-customer@example.invalid', ORDER,
  '[2b] CONTROL — malformed email (reserved .invalid TLD) + correct order');

// 3. What does "not found" look like? Nonsense key, cannot collide with a real order.
await lookup(EMAIL, 'BC-NOTAREALORDER', '[3] NOT FOUND — what an unknown order returns');

// 4. Same customer, same order — just typed with different capitalisation.
// If this fails, real customers get locked out of their own orders for typing
// their email the way their keyboard did. We'd normalise before sending.
const upper = await lookup(EMAIL.toUpperCase(), ORDER, '[4] CASE TEST — same email, UPPERCASE');

// 5. Same again with stray whitespace, as a browser/autofill would send it.
const spaced = await lookup(` ${EMAIL} `, ORDER, '[5] WHITESPACE TEST — same email, padded');

// ── Verdict ─────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(62));
if (!good.length) {
  console.log('INCONCLUSIVE — baseline returned nothing. Check the env values against');
  console.log("Welly's example before reading anything into test 2.");
} else if (wrong.length) {
  console.log('⚠️  IT DOES NOT CHECK THE EMAIL.');
  console.log('    A wrong email still returned the order. Because BigCommerce order');
  console.log('    numbers are 6 digits and sequential, anyone could walk them and read');
  console.log("    other customers' order status through our chatbot.");
  console.log('    => WE must verify: compare the returned DeliveryEmail to what the');
  console.log('       customer typed, and refuse if they differ. Tell Welly — politely,');
  console.log('       as a heads-up; his system, his call.');
} else {
  console.log('✅  IT CHECKS THE EMAIL.');
  console.log('    A well-formed, real-domain email that does NOT belong to this order');
  console.log('    returned nothing. That is a genuine ownership check, not just input');
  console.log('    validation. His endpoint does the verification for us.');
  console.log('    We should still double-check DeliveryEmail our end (belt and braces).');
  console.log(`    (control: malformed address also rejected = ${malformed.length === 0})`);
}
console.log('');
console.log(`Case sensitivity : ${upper.length ? 'OK — uppercase still matched' : '⚠️  CASE-SENSITIVE — we must lowercase before sending'}`);
console.log(`Whitespace       : ${spaced.length ? 'OK — padding tolerated' : '⚠️  NOT TRIMMED — we must trim before sending'}`);
console.log('');
console.log('Note for the build: JSON on success, XML on failure, HTTP 400 for both');
console.log('"wrong email" and "no such order" — identical responses, so no info leak.');
console.log('Our agent can mirror that with a single "couldn\'t find it" message.');
console.log('='.repeat(62) + '\n');
