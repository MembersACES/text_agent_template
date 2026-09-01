#!/usr/bin/env node
/**
 * MachShip RAW consignment dump (READ ONLY).
 *
 * Purpose: find where per-carton delivery status lives. The consignment payload
 * carries per-item LABELS (itemReferences[].carrierItemReference) but no per-item
 * status. Iri can see "Complete" against a single label in the MachShip UI, so the
 * data exists somewhere. This dumps the COMPLETE object for one partially
 * delivered consignment and reports every nested key that looks like a scan,
 * event, tracking or delivery record, so we stop guessing endpoint names.
 *
 * Run:  node --env-file=.env.local scripts/machship-raw-dump.mjs [order]
 * Writes the full JSON to machship-raw-<order>.local.json (gitignored by *.local.json).
 */
import { writeFileSync } from 'node:fs';

const BASE = process.env.MACHSHIP_BASE_URL || 'https://live.machship.com';
const TOKEN = process.env.MACHSHIP_TOKEN;
if (!TOKEN) { console.error('MACHSHIP_TOKEN not set.'); process.exit(1); }
const ORDER = process.argv[2] || '10264002';

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { token: TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let env = null; try { env = JSON.parse(text); } catch {}
  return { http: res.status, env, text };
}

const name = (v) => (v && typeof v === 'object' ? (v.name ?? v.description ?? JSON.stringify(v).slice(0, 60)) : v);

// Walk the whole object and report paths whose KEY looks tracking-related.
function findPaths(obj, re, path = '', out = [], depth = 0) {
  if (depth > 6 || obj === null || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    if (re.test(k)) {
      const kind = Array.isArray(v) ? `array[${v.length}]` : (v && typeof v === 'object' ? 'object' : JSON.stringify(v));
      out.push(`${p} = ${kind}`);
    }
    if (Array.isArray(v)) v.slice(0, 2).forEach((x, i) => findPaths(x, re, `${p}[${i}]`, out, depth + 1));
    else if (v && typeof v === 'object') findPaths(v, re, p, out, depth + 1);
  }
  return out;
}

(async () => {
  const r = await post('/apiv2/consignments/returnConsignmentsByReference2', [`SO${ORDER}`]);
  const cons = Array.isArray(r.env?.object) ? r.env.object : [];
  console.log(`order ${ORDER}  http=${r.http}  consignments=${cons.length}\n`);
  if (!cons.length) { console.log('nothing returned'); return; }

  for (const c of cons) {
    console.log('='.repeat(78));
    console.log(`consignment ${c.consignmentNumber}  id=${c.id}`);
    console.log(`  status        = ${JSON.stringify(c.status)}`);
    console.log(`  statusType    = ${c.consignmentStatusType}`);
    console.log(`  ALL top-level keys:\n    ${Object.keys(c).join(', ')}`);

    const hist = Array.isArray(c.statusHistory) ? c.statusHistory : [];
    console.log(`\n  statusHistory (${hist.length}):`);
    hist.forEach((h, i) => {
      console.log(`    [${i}] ${name(h.status)}  partial=${h.statusIsPartial}  keys=${Object.keys(h).join('|')}`);
    });

    console.log('\n  tracking/scan/event/delivery-shaped keys anywhere in the object:');
    const hits = findPaths(c, /scan|event|track|pod|deliver|receipt|signature|attempt/i);
    console.log(hits.length ? '    ' + hits.join('\n    ') : '    (none found)');
    console.log('');
  }

  const f = `machship-raw-${ORDER}.local.json`;
  writeFileSync(f, JSON.stringify(cons, null, 2));
  console.log(`Full JSON written to ${f} (gitignored). Size: ${JSON.stringify(cons).length} bytes.`);
})();
