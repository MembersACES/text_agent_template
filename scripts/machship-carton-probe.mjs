#!/usr/bin/env node
/**
 * MachShip CARTON-LEVEL probe (READ ONLY, report only).
 *
 * Answers Iri's question of 20 Aug 2026: on a partially delivered order, can we
 * work out HOW MANY cartons have been delivered? His theory is that each carton
 * carries its own label (e.g. W9DZ00047392EXP00001 / ...EXP00002) and only the
 * delivered one shows Complete.
 *
 * Also probes the duplicate-consignment case (one order, two open consignments).
 *
 * Plain JS, no bundling needed. Runs LOCALLY (sandbox blocks live.machship.com):
 *     node --env-file=.env.local scripts/machship-carton-probe.mjs
 */
const BASE = process.env.MACHSHIP_BASE_URL || 'https://live.machship.com';
const TOKEN = process.env.MACHSHIP_TOKEN;
if (!TOKEN) { console.error('MACHSHIP_TOKEN not set. Run with --env-file=.env.local'); process.exit(1); }

const PARTIAL = ['10264002'];
const DUPLICATE = ['10265223', '10264076', '10263779', '10266144', '10257041'];

const mask = (v) => {
  if (typeof v !== 'string' || !v) return v;
  if (v.includes('@')) { const [u, d] = v.split('@'); return `${u.slice(0, 2)}***@${d}`; }
  return v;
};

async function call(path, refs) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { token: TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(refs),
  });
  const text = await res.text();
  let env = null;
  try { env = JSON.parse(text); } catch { /* non-JSON */ }
  // MachShip wraps the payload in an envelope: the array lives at env.object.
  const list = Array.isArray(env?.object) ? env.object : [];
  const msgs = (env?.errors ?? []).map((e) => e.errorMessage).filter(Boolean);
  return {
    http: res.status,
    consignments: list,
    messages: msgs,
    rawShape: env ? Object.keys(env).join(',') : `non-JSON (${text.slice(0, 60)})`,
  };
}

async function lookup(order) {
  // Try all four combinations so a reference-format mismatch can't hide a result.
  const attempts = [
    ['reference2 SO', '/apiv2/consignments/returnConsignmentsByReference2', `SO${order}`],
    ['reference2 bare', '/apiv2/consignments/returnConsignmentsByReference2', order],
    ['reference1 bare', '/apiv2/consignments/returnConsignmentsByReference1', order],
    ['reference1 SO', '/apiv2/consignments/returnConsignmentsByReference1', `SO${order}`],
  ];
  const tried = [];
  for (const [label, path, ref] of attempts) {
    const r = await call(path, [ref]);
    tried.push(`${label}: http=${r.http} n=${r.consignments.length}${r.messages.length ? ' msg=' + r.messages.join('|') : ''}`);
    if (r.consignments.length) return { via: label, tried, ...r };
  }
  return { via: 'none matched', tried, http: 0, consignments: [], messages: [], rawShape: '' };
}

// Find any key whose name hints at status/delivery/label, anywhere in an object (1 level deep).
function statusish(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj || {})) {
    if (v && typeof v === 'object') continue;
    if (/status|deliver|complete|scan|label|consignmentnumber|barcode|track|item.?ref|deleted|cancel|void/i.test(k)) {
      out.push(`${prefix}${k}=${JSON.stringify(v)}`);
    }
  }
  return out;
}

function report(order, r) {
  console.log('='.repeat(78));
  console.log(`ORDER ${order}   via=${r.via}   consignments=${r.consignments.length}`);
  console.log('='.repeat(78));
  if (r.tried) r.tried.forEach((t) => console.log(`  tried ${t}`));
  if (!r.consignments.length) { console.log('  no consignments returned'); return; }

  for (const c of r.consignments) {
    const items = Array.isArray(c.consignmentItems) ? c.consignmentItems : [];
    console.log(`\n  CONSIGNMENT id=${c.id}  number=${c.consignmentNumber ?? '(none)'}  status=${c.status}`);
    console.log(`    top-level status-ish: ${statusish(c).join('  ') || '(none)'}`);
    console.log(`    items=${items.length}  toEmail=${mask(c.toEmail)}  eta=${c.etaLocal ?? c.eta ?? '-'}`);

    items.forEach((it, i) => {
      console.log(`    item[${i}] keys: ${Object.keys(it).join(', ')}`);
      const s = statusish(it, '      ');
      console.log(`    item[${i}] status-ish: ${s.length ? '\n' + s.join('\n') : '(none)'}`);
      // itemReferences is where Iri's EXP labels would live
      if (Array.isArray(it.itemReferences) && it.itemReferences.length) {
        console.log(`    item[${i}] itemReferences: ${JSON.stringify(it.itemReferences)}`);
      }
      if (Array.isArray(it.references) && it.references.length) {
        console.log(`    item[${i}] references: ${JSON.stringify(it.references)}`);
      }
    });

    const hist = Array.isArray(c.statusHistory) ? c.statusHistory : [];
    console.log(`    statusHistory (${hist.length}): ${hist.map((h) => h.status ?? h.statusName ?? '?').join(' -> ')}`);
    // Does any history event name a specific item/label?
    const perItem = hist.filter((h) => JSON.stringify(h).match(/EXP\d{5}|itemId|consignmentItemId/i));
    console.log(`    history events referencing a specific item/label: ${perItem.length}`);
    if (perItem.length) console.log('      sample: ' + JSON.stringify(perItem[0]).slice(0, 400));
  }
}

(async () => {
  console.log('\n########## PART 1: Iri\'s partially delivered orders ##########\n');
  for (const o of PARTIAL) { try { report(o, await lookup(o)); } catch (e) { console.log(`ORDER ${o} ERROR: ${e.message}`); } }

  console.log('\n\n########## PART 2: duplicate-consignment case ##########\n');
  for (const o of DUPLICATE) { try { report(o, await lookup(o)); } catch (e) { console.log(`ORDER ${o} ERROR: ${e.message}`); } }

  console.log('\n\nDone. Read-only, PII masked, nothing written.');
})();
