// scripts/machship-partial-signal.src.ts
import { readFileSync } from "node:fs";

// lib/config/settings.ts
function envTrim(value, fallback = "") {
  return (value ?? fallback).trim();
}
var settings = {
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: "gemini-2.5-flash",
    embeddingModel: "gemini-embedding-001",
    temperature: 0.1,
    maxOutputTokens: 65536
  },
  gcs: {
    bucketName: process.env.GCS_BUCKET_NAME,
    projectId: process.env.GCP_PROJECT_ID,
    clientEmail: process.env.GCP_CLIENT_EMAIL,
    privateKey: (process.env.GCP_PRIVATE_KEY ?? "").replace(/\\n/g, "\n")
  },
  googleDrive: {
    defaultFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID
  },
  auth: {
    sitePassword: process.env.SITE_PASSWORD
  },
  zohoDesk: {
    clientId: envTrim(process.env.ZOHO_CLIENT_ID),
    clientSecret: envTrim(process.env.ZOHO_CLIENT_SECRET),
    refreshToken: envTrim(process.env.ZOHO_REFRESH_TOKEN),
    orgId: envTrim(process.env.ZOHO_ORG_ID),
    datacenter: envTrim(process.env.ZOHO_DATACENTER, "com.au"),
    /**
     * Hostname only (no https). Defaults to accounts.zoho.${datacenter}.
     * Set ZOHO_ACCOUNTS_HOST=accounts.zoho.com when OAuth tokens show api_domain www.zohoapis.com.
     */
    accountsHost: envTrim(
      process.env.ZOHO_ACCOUNTS_HOST,
      `accounts.zoho.${envTrim(process.env.ZOHO_DATACENTER, "com.au")}`
    ),
    /**
     * Hostname only. Defaults to desk.zoho.${datacenter}.
     * Set ZOHO_DESK_HOST=desk.zoho.com if Desk REST is on the global host (not desk.zoho.com.au).
     */
    deskApiHost: envTrim(
      process.env.ZOHO_DESK_HOST,
      `desk.zoho.${envTrim(process.env.ZOHO_DATACENTER, "com.au")}`
    ),
    /** Web-based Zoho clients: same redirect_uri as API Console when exchanging / refreshing tokens */
    oauthRedirectUri: envTrim(process.env.ZOHO_REDIRECT_URI)
  },
  /**
   * dotWMS — the Syspro-era warehouse lookup that translates a BigCommerce
   * order number into a Syspro sales-order (freight) reference and enforces
   * the delivery-email match. Retired at Odoo go-live (end Oct 2026) — see
   * `freight.provider`. Creds re-used from the existing dotWMS key (limited
   * blast radius: every call needs order# + email).
   */
  dotwms: {
    baseUrl: envTrim(process.env.DOTWMS_BASE_URL, "https://f.dotwms.com/api/1.0/GetFileExport/"),
    apiKey: envTrim(process.env.DOTWMS_API_KEY),
    instanceCode: envTrim(process.env.DOTWMS_INSTANCE_CODE, "H2G"),
    exportFileType: envTrim(process.env.DOTWMS_EXPORT_FILE_TYPE, "GenericSQL_1323"),
    /**
     * Prefix dotWMS expects on a 6-digit BigCommerce order number (default "BC-").
     * ASSUMPTION flagged for Welly ("is that prefix always there?") — kept
     * configurable so it can change without a code edit.
     */
    orderPrefix: envTrim(process.env.DOTWMS_ORDER_PREFIX, "BC-"),
    /**
     * Prefix dotWMS expects on an 8-digit Syspro number (default "SO"). Confirmed
     * 4 Aug 2026: dotWMS resolves an 8-digit key ONLY when SO-prefixed, and
     * enforces the email on it — so 8-digit orders route through dotWMS too.
     */
    sysproPrefix: envTrim(process.env.DOTWMS_SYSPRO_PREFIX, "SO")
  },
  /**
   * MachShip — freight/consignment lookup by reference (boxes, courier, ETA,
   * tracking link). Read-only tracking use. A dedicated read-only API user was
   * agreed at the 16 Jul meeting but is not yet provisioned; until then the
   * existing token is used.
   */
  machship: {
    baseUrl: envTrim(process.env.MACHSHIP_BASE_URL, "https://live.machship.com"),
    token: envTrim(process.env.MACHSHIP_TOKEN),
    /**
     * When true, MachShipService returns a bundled fixture in the known
     * response shape instead of calling live MachShip. For development before
     * a real order that exists in BOTH dotWMS and MachShip is available
     * (blocked on Iri's example orders). Unset / "false" => live calls.
     */
    useFixture: envTrim(process.env.MACHSHIP_USE_FIXTURE) === "true"
  },
  /**
   * Freight-reference resolution — the swappable seam of phase-1 order tracking.
   * Switch `provider` to 'odoo' at Odoo go-live (end Oct 2026) once an
   * OdooReferenceResolver is registered in FreightReferenceResolverFactory.
   */
  freight: {
    provider: envTrim(process.env.FREIGHT_PROVIDER, "dotwms"),
    /** Confirmed with Iri (28 Jul 2026): only surface orders from the last 60 days. */
    lookbackDays: Number(envTrim(process.env.FREIGHT_LOOKBACK_DAYS, "60")),
    /**
     * Refuse to show shipment status unless the delivery email was verified.
     * Defence in depth: a direct 8-digit Syspro-number lookup bypasses dotWMS
     * and therefore the email gate, so it resolves `verified:false`.
     */
    requireVerifiedEmail: envTrim(process.env.FREIGHT_REQUIRE_VERIFIED_EMAIL, "true") !== "false",
    /**
     * Master switch for LIVE order tracking in the chat gate. Stays FALSE until
     * the API hardening lands (see API-Hardening-Plan.md). While false, the
     * OrderStatusGate rewrite's tracking path is inert and the existing
     * "can't look up your order" deflection continues to serve.
     */
    trackingEnabled: envTrim(process.env.ORDER_TRACKING_ENABLED) === "true"
  },
  /**
   * Internal CS/WH team alert emails. SERVER-SIDE ONLY, and a SIDE-EFFECTING
   * action — kept OFF until the API hardening lands (an open endpoint could
   * spam the HTG Helpdesk). `fromAddress` is deliberately swappable (Morgan's
   * choice, likely to change). SMTP creds are optional: without them the
   * service uses the no-send LogAlertTransport.
   */
  alerts: {
    enabled: envTrim(process.env.ALERTS_ENABLED) === "true",
    fromAddress: envTrim(process.env.ALERTS_FROM, "members@acesolutions.com.au"),
    toAddress: envTrim(process.env.ALERTS_TO, "info@goodness.com.au"),
    dedupTtlMinutes: Number(envTrim(process.env.ALERTS_DEDUP_TTL_MIN, "60")),
    maxPerHour: Number(envTrim(process.env.ALERTS_MAX_PER_HOUR, "50")),
    smtp: {
      host: envTrim(process.env.ALERTS_SMTP_HOST),
      port: Number(envTrim(process.env.ALERTS_SMTP_PORT, "587")),
      user: envTrim(process.env.ALERTS_SMTP_USER),
      pass: envTrim(process.env.ALERTS_SMTP_PASS)
    }
  }
};

// lib/config/logger.ts
function getLogger(name) {
  const silent = process.env.TEST_SILENT === "true";
  return {
    info: (msg, ...a) => {
      if (!silent) console.log(`[${name}] INFO  ${msg}`, ...a);
    },
    warn: (msg, ...a) => {
      if (!silent) console.warn(`[${name}] WARN  ${msg}`, ...a);
    },
    error: (msg, ...a) => {
      if (!silent) console.error(`[${name}] ERROR ${msg}`, ...a);
    }
  };
}

// lib/services/freight/DotWmsReferenceResolver.ts
var logger = getLogger("DotWmsReferenceResolver");
var DotWmsReferenceResolver = class {
  constructor() {
    this.provider = "dotwms";
    this.baseUrl = settings.dotwms.baseUrl;
    this.apiKey = settings.dotwms.apiKey;
    this.instanceCode = settings.dotwms.instanceCode;
    this.exportFileType = settings.dotwms.exportFileType;
    this.orderPrefix = settings.dotwms.orderPrefix;
    this.sysproPrefix = settings.dotwms.sysproPrefix;
  }
  async resolve(input) {
    const email = input.email.trim();
    const rawOrder = input.orderNumber.trim();
    if (!this.apiKey) {
      logger.error("DOTWMS_API_KEY missing \u2014 cannot resolve");
      return this.error("dotWMS API key not configured");
    }
    if (!email || !rawOrder) {
      return this.notFound("empty order or email");
    }
    const order = this.normaliseOrderKey(rawOrder);
    const url = this.buildUrl(email, order);
    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      logger.error("dotWMS request failed", err);
      return this.error(`transport error: ${err instanceof Error ? err.message : String(err)}`);
    }
    const text = await res.text();
    let rows = [];
    try {
      const parsed = JSON.parse(text);
      rows = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      logger.info(`dotWMS no-match (HTTP ${res.status})`);
      return this.notFound(`non-JSON body, HTTP ${res.status}`);
    }
    const usable = rows.filter((r) => r.PackSlipNumber);
    if (!usable.length) {
      return this.notFound(`HTTP ${res.status}, 0 usable rows`);
    }
    const deliveryEmail = usable.find((r) => r.DeliveryEmail)?.DeliveryEmail ?? null;
    const emailOk = usable.every(
      (r) => String(r.DeliveryEmail ?? "").trim().toLowerCase() === email.toLowerCase()
    );
    if (!emailOk) {
      logger.warn("dotWMS returned rows but our email re-check FAILED \u2014 refusing");
      return {
        outcome: "not_found",
        verified: false,
        verifyVia: "none",
        deliveryEmail,
        orders: [],
        provider: this.provider,
        diagnostic: "email re-check failed"
      };
    }
    const orders = usable.map((r) => this.toResolvedOrder(r));
    logger.info(`dotWMS matched ${orders.length} pack slip(s); email verified`);
    return {
      outcome: "matched",
      verified: true,
      verifyVia: "dotwms",
      deliveryEmail,
      orders,
      provider: this.provider
    };
  }
  /**
   * Normalise the customer's number into the dotWMS DocumentKey form:
   *   6 digits          → BigCommerce order, `${orderPrefix}` (default "BC-")
   *   8 digits (±"SO")  → Syspro number,     `${sysproPrefix}` (default "SO")
   * dotWMS enforces the email on both. Anything else is passed through unchanged.
   */
  normaliseOrderKey(raw) {
    if (/^\d{6}$/.test(raw) && this.orderPrefix) {
      return `${this.orderPrefix}${raw}`;
    }
    const so = raw.match(/^(?:SO)?(\d{8})$/i);
    if (so) {
      return `${this.sysproPrefix}${so[1]}`;
    }
    return raw;
  }
  toResolvedOrder(r) {
    const pack = String(r.PackSlipNumber ?? "").trim();
    const digits = pack.replace(/^SO/i, "");
    return {
      sysproReference: /^SO/i.test(pack) ? pack : `SO${digits}`,
      bareReference: digits,
      warehouseStatusRaw: r.JobStatus ?? null,
      warehouseStatusTranslated: r.JobStatusTranslated ?? null,
      heldReason: r.JobHeldReason ?? null
    };
  }
  buildUrl(email, order) {
    const params = new URLSearchParams({
      InstanceCode: this.instanceCode,
      ExportFileType: this.exportFileType,
      APIKey: this.apiKey,
      DocumentFormat: "JSON",
      DocumentKey: `${email}|${order}`
    });
    return `${this.baseUrl}?${params.toString()}`;
  }
  notFound(diagnostic) {
    return {
      outcome: "not_found",
      verified: false,
      verifyVia: "none",
      deliveryEmail: null,
      orders: [],
      provider: this.provider,
      diagnostic
    };
  }
  error(diagnostic) {
    return {
      outcome: "error",
      verified: false,
      verifyVia: "none",
      deliveryEmail: null,
      orders: [],
      provider: this.provider,
      diagnostic
    };
  }
};

// scripts/machship-partial-signal.src.ts
var BASE = settings.machship.baseUrl;
var TOKEN = settings.machship.token;
function mask(v) {
  if (typeof v !== "string" || !v.trim()) return String(v);
  if (v.includes("@")) {
    const [u, d] = v.split("@");
    return `${u.slice(0, 2)}***@${d}`;
  }
  return v.length > 6 ? `${v.slice(0, 3)}***${v.slice(-2)}` : "***";
}
function fileArg() {
  const i = process.argv.indexOf("--file");
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : "scripts/freight-examples.local.json";
}
async function ms(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { token: TOKEN, "Content-Type": "application/json" },
    body: body !== void 0 ? JSON.stringify(body) : void 0
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
  }
  return { status: res.status, obj: json?.object ?? null };
}
function findKeys(obj, pattern, path = "", out = [], depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 4) return out;
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    if (pattern.test(k) && (v === null || typeof v !== "object")) out.push({ path: p, value: v });
    else if (v && typeof v === "object") {
      const next = Array.isArray(v) ? v[0] ?? {} : v;
      findKeys(next, pattern, Array.isArray(v) ? `${p}[0]` : p, out, depth + 1);
    }
  }
  return out;
}
var PARTIAL_RE = /partial|remaining|outstanding|fulfil|deliver|receiv|quantity|qty|scanned|pieces?/i;
async function main() {
  if (settings.machship.useFixture) {
    console.error("MACHSHIP_USE_FIXTURE is on \u2014 unset it for a live run.");
    process.exit(1);
  }
  if (!TOKEN) {
    console.error("Missing MACHSHIP_TOKEN. Run with --env-file=.env.local");
    process.exit(1);
  }
  const path = fileArg();
  let examples;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
    examples = Array.isArray(parsed?.examples) ? parsed.examples : [];
  } catch (e) {
    console.error(`Cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  if (!examples.length) {
    console.error("No examples in input file.");
    process.exit(1);
  }
  const resolver = new DotWmsReferenceResolver();
  let sawPartialFlag = false;
  for (const e of examples) {
    console.log("\n" + "=".repeat(72));
    console.log(`${e.label}  (order ${e.order})`);
    console.log("=".repeat(72));
    const r = await resolver.resolve({ orderNumber: e.order, email: e.email });
    if (!r.orders.length) {
      console.log(`  resolver: ${r.outcome} (${r.diagnostic ?? "-"}) \u2014 skipping`);
      continue;
    }
    const ref = r.orders[0].sysproReference;
    const isSO = /^SO/i.test(ref);
    const look = await ms("POST", `/apiv2/consignments/returnConsignmentsByReference${isSO ? 2 : 1}`, [ref]);
    const list = Array.isArray(look.obj) ? look.obj : [];
    if (!list.length) {
      console.log(`  MachShip: no consignment for ${mask(ref)} \u2014 skipping`);
      continue;
    }
    for (const summary of list) {
      const id = summary.id;
      const det = id !== void 0 ? (await ms("GET", `/apiv2/consignments/getConsignment?id=${encodeURIComponent(String(id))}`)).obj : null;
      const detail = det && typeof det === "object" ? det : summary;
      const status = detail.status?.name ?? "-";
      const items = Array.isArray(detail.consignmentItems) ? detail.consignmentItems : [];
      const history = Array.isArray(detail.statusHistory) ? detail.statusHistory : [];
      console.log(`  consignment id=${id ?? "-"}  status=${status}  items=${items.length}  historyEvents=${history.length}`);
      const partialFlags = Object.entries(detail).filter(([k, v]) => /partial/i.test(k) && (v === null || typeof v !== "object"));
      if (partialFlags.length) {
        for (const [k, v] of partialFlags) {
          console.log(`    PARTIAL FLAG: ${k} = ${JSON.stringify(v)}`);
          if (v === true) sawPartialFlag = true;
        }
      } else {
        console.log("    no top-level *partial* field");
      }
      const hits = findKeys(detail, PARTIAL_RE).filter((h) => !/email|contact|name|address|phone/i.test(h.path));
      const uniq = [...new Map(hits.map((h) => [h.path, h.value])).entries()].slice(0, 20);
      console.log(`    delivery/quantity-ish fields: ${uniq.length ? uniq.map(([p, v]) => `${p}=${JSON.stringify(v)}`).join("  ") : "(none)"}`);
      if (items.length) {
        const it0 = items[0];
        const itemStatusKeys = Object.entries(it0).filter(([k]) => /status|deliver|receiv|quantity|qty|scanned/i.test(k));
        console.log(`    item[0] keys: ${Object.keys(it0).slice(0, 16).join(", ")}`);
        console.log(`    item[0] status/qty fields: ${itemStatusKeys.length ? itemStatusKeys.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("  ") : "(none)"}`);
      }
      const historyNames = history.map((h) => String(h.consignmentTrackingStatus?.name ?? h.status?.name ?? "?"));
      if (history.length) console.log(`    statusHistory: ${historyNames.join(" \u2192 ")}`);
      const anyPartialFlag = history.some((h) => h.statusIsPartial === true);
      const anyPartialName = historyNames.some((n) => /partial/i.test(n)) || /partial/i.test(String(status));
      if (anyPartialFlag || anyPartialName) {
        sawPartialFlag = true;
        console.log(`    \u27F9 PARTIAL SIGNAL PRESENT: statusIsPartial=true on an event? ${anyPartialFlag}; "Partial Delivery" in status/history? ${anyPartialName}`);
      }
    }
  }
  console.log("\n" + "=".repeat(72));
  console.log("VERDICT \u2014 single-consignment partial signal:");
  if (sawPartialFlag) {
    console.log('  \u2705 PRESENT. MachShip exposes partial delivery on a single consignment via a "Partial Delivery"');
    console.log("     status name and a per-event statusIsPartial boolean. The render COULD cover the");
    console.log('     items-in-one-consignment partial case by detecting the current status "Partial Delivery"');
    console.log("     (or the latest statusHistory event with statusIsPartial=true).");
    console.log('     NOTE: "Partial Delivery" does NOT match the current delivered-regex, so today it would render as');
    console.log('     plain "on its way" \u2014 understating it. Copy change recommended \u2014 CONFIRM before building.');
  } else {
    console.log("  \u2717 Not seen in this sample. Re-run when an order is mid-partial, or treat as not representable.");
  }
  console.log("=".repeat(72));
}
main().catch((e) => {
  console.error("partial-signal probe error:", e);
  process.exitCode = 1;
});
