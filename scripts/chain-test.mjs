#!/usr/bin/env node
/**
 * END-TO-END CHAIN TEST — the actual phase-1 flow, proven against one real order.
 *
 *   customer's BigCommerce order + email
 *        -> dotWMS  (verifies the email, returns the Syspro number)
 *        -> MachShip (returns boxes, status, courier, ETA, tracking link)
 *        -> what the customer would read
 *
 * READ ONLY. Uses ONLY the single order Welly volunteered. No enumeration.
 *
 * .env.local needs:
 *   DOTWMS_API_KEY=...
 *   DOTWMS_TEST_ORDER=BC-319896
 *   DOTWMS_TEST_EMAIL=nadeeka.whyte@gmail.com
 *   MACHSHIP_TOKEN=...
 *
 * Run:
 *   node --env-file=.env.local scripts/chain-test.mjs
 */

const DOTWMS = 'https://f.dotwms.com/api/1.0/GetFileExport/';
const MACHSHIP = 'https://live.machship.com';

const { DOTWMS_API_KEY: KEY, DOTWMS_TEST_ORDER: ORDER, DOTWMS_TEST_EMAIL: EMAIL, MACHSHIP_TOKEN: TOKEN } = process.env;
if (!KEY || !ORDER || !EMAIL || !TOKEN) {
  console.error('\nMissing env — need DOTWMS_API_KEY, DOTWMS_TEST_ORDER, DOTWMS_TEST_EMAIL, MACHSHIP_TOKEN\n');
  process.exit(1);
}

const mask = (v) => {
  if (typeof v !== 'string' || !v) return String(v);
  if (v.includes('@')) { const [u, d] = v.split('@'); return `${u.slice(0, 2)}***@${d}`; }
  return v.length > 6 ? `${v.slice(0, 3)}***${v.slice(-2)}` : '***';
};

console.log('\n' + '='.repeat(64));
console.log('END-TO-END CHAIN TEST — phase 1 flow, one real order');
console.log('='.repeat(64));

// ── STEP 1 — customer input (trimmed: dotWMS does NOT tolerate padding) ─────
const custEmail = EMAIL.trim();
const custOrder = ORDER.trim();
console.log(`\n[1] Customer gives us: order ${custOrder}, email ${mask(custEmail)}`);

// ── STEP 2 — dotWMS: verify the email, get the Syspro number ────────────────
const url = `${DOTWMS}?InstanceCode=H2G&ExportFileType=GenericSQL_1323&APIKey=${encodeURIComponent(KEY)}`
  + `&DocumentFormat=JSON&DocumentKey=${encodeURIComponent(`${custEmail}|${custOrder}`)}`;
const wmsRes = await fetch(url);
const wmsText = await wmsRes.text();
let wmsRows = [];
try { const j = JSON.parse(wmsText); wmsRows = Array.isArray(j) ? j : [j]; } catch { /* XML error body */ }

console.log(`\n[2] dotWMS → HTTP ${wmsRes.status}, ${wmsRows.length} row(s)`);
if (!wmsRows.length) {
  console.log(`    ${wmsText.slice(0, 160)}`);
  console.log('\n    No match — dotWMS rejected it. Chain stops here (this is also exactly');
  console.log('    what a customer with a wrong email would hit).\n');
  process.exit(0);
}
for (const r of wmsRows) {
  console.log(`    PackSlip=${r.PackSlipNumber}  Status=${r.JobStatus}/${r.JobStatusTranslated}`
    + `  Held=${r.JobHeldReason ?? 'none'}  Email=${mask(r.DeliveryEmail)}`);
}

// Belt-and-braces: dotWMS already checks, but verify it ourselves too.
const emailOk = wmsRows.every((r) => String(r.DeliveryEmail ?? '').trim().toLowerCase() === custEmail.toLowerCase());
console.log(`    our own email re-check: ${emailOk ? 'PASS' : 'FAIL — refuse to continue'}`);
if (!emailOk) process.exit(1);

// ── STEP 3 — MachShip: Syspro number -> shipments ──────────────────────────
const syspro = wmsRows.map((r) => r.PackSlipNumber).filter(Boolean);
console.log(`\n[3] MachShip lookup by Syspro number: ${syspro.join(', ')}`);

async function ms(path, body) {
  const r = await fetch(`${MACHSHIP}${path}`, {
    method: 'POST',
    headers: { token: TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, obj: j?.object ?? null, errs: j?.errors ?? null, text: t };
}

// customerReference2 holds "SO10216938"; customerReference holds "10216938".
let cons = [];
let via = '';

// MachShip returns 200 with the real reason inside `errors` — never assume an
// empty list means "not found". Print what it actually said.
const byRef2 = await ms('/apiv2/consignments/returnConsignmentsByReference2', syspro);
console.log(`    Reference2 ${JSON.stringify(syspro)} → HTTP ${byRef2.status}, `
  + `${Array.isArray(byRef2.obj) ? byRef2.obj.length : 'null'} result(s)`
  + `${byRef2.errs && byRef2.errs.length ? ` — errors: ${JSON.stringify(byRef2.errs)}` : ''}`);
if (Array.isArray(byRef2.obj) && byRef2.obj.length) { cons = byRef2.obj; via = 'Reference2 (SO-prefixed)'; }
else {
  const bare = syspro.map((s) => s.replace(/^SO/i, ''));
  const byRef1 = await ms('/apiv2/consignments/returnConsignmentsByReference1', bare);
  console.log(`    Reference1 ${JSON.stringify(bare)} → HTTP ${byRef1.status}, `
    + `${Array.isArray(byRef1.obj) ? byRef1.obj.length : 'null'} result(s)`
    + `${byRef1.errs && byRef1.errs.length ? ` — errors: ${JSON.stringify(byRef1.errs)}` : ''}`);
  if (Array.isArray(byRef1.obj) && byRef1.obj.length) { cons = byRef1.obj; via = 'Reference1 (digits only)'; }
}

console.log(`    → ${cons.length} consignment(s)${via ? ` via ${via}` : ''}`);
if (!cons.length) {
  console.log('\n    ⚠️  CHAIN BREAKS HERE. dotWMS gave us a number MachShip does not recognise.');
  console.log('    Possible: this order predates MachShip, shipped another way, or the');
  console.log('    reference formats differ. Try a RECENT order before concluding.\n');
  process.exit(0);
}

// ── STEP 4 — what the customer would actually read ─────────────────────────
console.log('\n[4] What the customer would see:\n');
const boxes = cons.length;
const delivered = cons.filter((c) => /complete|delivered/i.test(c.status?.name ?? '')).length;
const courier = cons[0]?.carrierName ?? 'the courier';
const eta = cons[0]?.etaLocal ?? cons[0]?.eta ?? null;
const track = cons.map((c) => c.trackingPageAccessToken).filter(Boolean).map((t) => `https://mship.io/v2/${mask(t)}`);

for (const c of cons) {
  console.log(`    box: ${c.carrierConsignmentId ?? '-'}  status=${c.status?.name ?? '-'}  eta=${c.etaLocal ?? '-'}`);
}
console.log('');
if (boxes > 1) {
  console.log(`    "Your order is coming in ${boxes} boxes. ${delivered} delivered so far —`);
  console.log(`     the rest are on their way with ${mask(courier)}${eta ? `, expected ${String(eta).split('T')[0]}` : ''}."`);
} else {
  console.log(`    "Your order is on its way with ${mask(courier)}${eta ? `, expected ${String(eta).split('T')[0]}` : ''}."`);
}
for (const t of track) console.log(`    track: ${t}`);

console.log('\n' + '='.repeat(64));
console.log('✅ CHAIN PROVEN — BigCommerce order + email → Syspro → MachShip → answer.');
console.log('   Every step verified against a real order. This is phase 1.');
console.log('='.repeat(64) + '\n');
