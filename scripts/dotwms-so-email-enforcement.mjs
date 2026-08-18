// scripts/dotwms-so-email-enforcement.src.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

// scripts/dotwms-so-email-enforcement.src.ts
var D = settings.dotwms;
var WRONG_EMAIL = "wrong-owner-test@gmail.com";
var MALFORMED_EMAIL = "not-a-valid-email";
function mask(v) {
  if (typeof v !== "string" || !v.trim()) return "(empty)";
  if (v.includes("@")) {
    const [u, d] = v.split("@");
    return `${u.slice(0, 2)}***@${d}`;
  }
  return v.length > 5 ? `${v.slice(0, 2)}***${v.slice(-3)}` : "***";
}
function fileArg() {
  const i = process.argv.indexOf("--file");
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : "scripts/freight-examples.local.json";
}
function urlFor(email, key) {
  const params = new URLSearchParams({
    InstanceCode: D.instanceCode,
    ExportFileType: D.exportFileType,
    APIKey: D.apiKey,
    DocumentFormat: "JSON",
    DocumentKey: `${email}|${key}`
  });
  return `${D.baseUrl}?${params.toString()}`;
}
async function query(email, key) {
  let res;
  try {
    res = await fetch(urlFor(email, key));
  } catch (e) {
    return { status: 0, found: false, detail: `transport error: ${e instanceof Error ? e.message : String(e)}` };
  }
  const text = await res.text();
  let rows = [];
  try {
    const j = JSON.parse(text);
    rows = Array.isArray(j) ? j : [j];
  } catch {
  }
  const usable = rows.filter((r) => r && r.PackSlipNumber);
  const detail = usable.length ? `${usable.length} row(s), PackSlip=${usable[0].PackSlipNumber}` : text.slice(0, 70).replace(/\s+/g, " ");
  return { status: res.status, found: usable.length > 0, detail };
}
async function main() {
  if (!D.apiKey) {
    console.error("Missing DOTWMS_API_KEY. Run with --env-file=.env.local");
    process.exit(1);
  }
  const path = fileArg();
  let examples;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
    examples = Array.isArray(parsed?.examples) ? parsed.examples : [];
  } catch (e) {
    console.error(`Cannot read ${resolve(path)}: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  const eights = examples.filter((e) => /^(?:SO)?\d{8}$/i.test(String(e.order).trim()));
  if (!eights.length) {
    console.error("No 8-digit examples in the input file.");
    process.exit(1);
  }
  console.log("dotWMS email-enforcement on the SO key (correct vs well-formed-wrong vs malformed):\n");
  let allEnforced = true;
  for (const e of eights) {
    const soKey = `SO${String(e.order).trim().replace(/^SO/i, "")}`;
    console.log(`Order ${soKey}:`);
    const correct = await query(e.email.trim(), soKey);
    const wrong = await query(WRONG_EMAIL, soKey);
    const malformed = await query(MALFORMED_EMAIL, soKey);
    console.log(`  correct  ${mask(e.email)} \u2192 HTTP ${correct.status}  ${correct.found ? "FOUND" : "nothing"}  (${correct.detail})`);
    console.log(`  wrong    ${WRONG_EMAIL} \u2192 HTTP ${wrong.status}  ${wrong.found ? "FOUND \u26A0\uFE0F" : "nothing"}  (${wrong.detail})`);
    console.log(`  control  ${MALFORMED_EMAIL} \u2192 HTTP ${malformed.status}  ${malformed.found ? "FOUND \u26A0\uFE0F" : "nothing"}  (${malformed.detail})`);
    const enforced = correct.found && !wrong.found;
    console.log(`  \u2192 ${enforced ? "ENFORCED (correct found, wrong rejected)" : "NOT ENFORCED for this order"}
`);
    allEnforced = allEnforced && enforced;
  }
  console.log("VERDICT:");
  if (allEnforced) {
    console.log("  dotWMS ENFORCES the email on the SO key \u2192 SAFE to route 8-digit verification through dotWMS.");
    console.log("  Build the refinement: 8-digit \u2192 dotWMS with SO prefix (email-verified + job status), MachShip for tracking.");
  } else {
    console.log("  dotWMS does NOT enforce the email on the SO key (a wrong email returned the order, or the correct one");
    console.log("  did not) \u2192 DO NOT route verification through dotWMS. Keep the MachShip-toEmail path for 8-digit.");
  }
}
main().catch((e) => {
  console.error("probe error:", e);
  process.exitCode = 1;
});
