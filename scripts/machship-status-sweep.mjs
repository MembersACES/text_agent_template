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
   * choice, likely to change).
   *
   * TRANSPORT (`ALERTS_TRANSPORT`): the CHOSEN path is `webhook` → posts the
   * alert JSON to an n8n webhook, which validates the shared secret and sends
   * the email. This SUPERSEDES the Workspace-SMTP / app-password route (`smtp`,
   * retained as a selectable fallback). `log` (default) is the safe no-send.
   */
  alerts: {
    enabled: envTrim(process.env.ALERTS_ENABLED) === "true",
    transport: envTrim(process.env.ALERTS_TRANSPORT, "log"),
    // 'log' | 'webhook' | 'smtp'
    fromAddress: envTrim(process.env.ALERTS_FROM, "members@acesolutions.com.au"),
    toAddress: envTrim(process.env.ALERTS_TO, "info@goodness.com.au"),
    dedupTtlMinutes: Number(envTrim(process.env.ALERTS_DEDUP_TTL_MIN, "60")),
    maxPerHour: Number(envTrim(process.env.ALERTS_MAX_PER_HOUR, "50")),
    /**
     * n8n webhook (chosen transport). URL is not a secret (endpoint only) so
     * it carries a default; the SHARED SECRET is env-only, never committed.
     */
    webhook: {
      url: envTrim(process.env.ALERTS_WEBHOOK_URL, "https://membersaces.app.n8n.cloud/webhook/htg"),
      secret: envTrim(process.env.ALERTS_WEBHOOK_SECRET)
    },
    /** Retained SMTP fallback (superseded by webhook). Creds env-only. */
    smtp: {
      host: envTrim(process.env.ALERTS_SMTP_HOST),
      port: Number(envTrim(process.env.ALERTS_SMTP_PORT, "587")),
      user: envTrim(process.env.ALERTS_SMTP_USER),
      pass: envTrim(process.env.ALERTS_SMTP_PASS)
    }
  },
  /**
   * /api/chat hardening (API-Hardening-Plan.md). Cloud Run is NOT behind a load
   * balancer (confirmed 5 Aug) → app-level rate limiting. Tier 1 (error hygiene,
   * payload caps, frame-ancestors) is always on. Origin check enforces only when
   * `allowedOrigins` is set. Token enforcement is behind `requireToken` (default
   * OFF until the browser round-trip is smoke-tested), then flip it on.
   */
  chatSecurity: {
    // Comma-separated exact origins, e.g. "https://goodness.com.au,https://www.goodness.com.au".
    // ⚠️ CONFIRM the production storefront domain(s) with Welly before enforcing.
    allowedOrigins: envTrim(process.env.CHAT_ALLOWED_ORIGINS).split(",").map((s) => s.trim()).filter(Boolean),
    requireOrigin: envTrim(process.env.CHAT_REQUIRE_ORIGIN, "true") !== "false",
    requireToken: envTrim(process.env.CHAT_REQUIRE_TOKEN) === "true",
    tokenSecret: envTrim(process.env.CHAT_TOKEN_SECRET),
    tokenTtlMinutes: Number(envTrim(process.env.CHAT_TOKEN_TTL_MIN, "60")),
    rateLimit: {
      windowMs: Number(envTrim(process.env.CHAT_RATE_WINDOW_MS, "60000")),
      perIpMax: Number(envTrim(process.env.CHAT_RATE_PER_IP, "20")),
      globalMax: Number(envTrim(process.env.CHAT_RATE_GLOBAL, "300"))
    },
    limits: {
      maxMessageChars: Number(envTrim(process.env.CHAT_MAX_MESSAGE_CHARS, "8000")),
      maxHistory: Number(envTrim(process.env.CHAT_MAX_HISTORY, "50")),
      maxUploads: Number(envTrim(process.env.CHAT_MAX_UPLOADS, "10")),
      maxUploadBytes: Number(envTrim(process.env.CHAT_MAX_UPLOAD_BYTES, "10485760"))
    }
  }
};

// lib/services/tracking/statusMap.ts
var CONSIGNMENT_STATUS_MAP = {
  complete: "delivered",
  delivered: "delivered",
  "partial delivery": "partial",
  // Observed live 24 Aug 2026 on order 10264002 (MachShip status id 29). H2G do
  // not have carriers re-attempt; the parcel is left at a collection point, so
  // this is a DISTINCT customer situation, not a transit state. Before this was
  // mapped it fell through to the `await` keyword in the preparing fallback and
  // rendered "being prepared for dispatch" while the parcel sat at a post office.
  "awaiting collection": "awaiting_collection",
  "ready for collection": "awaiting_collection",
  "available for collection": "awaiting_collection",
  "card left": "awaiting_collection",
  "on for delivery": "out_for_delivery",
  "out for delivery": "out_for_delivery",
  "in transit": "in_transit",
  "picked up": "in_transit",
  "scanned into depot": "in_transit",
  "delivery time scheduled": "in_transit",
  unmanifested: "preparing",
  manifested: "preparing",
  booked: "preparing",
  delayed: "delayed",
  "delivery attempted": "attempted"
};
function classifyConsignmentStatus(name) {
  const key = String(name ?? "").trim().toLowerCase();
  if (!key) return "unknown";
  const exact = CONSIGNMENT_STATUS_MAP[key];
  if (exact) return exact;
  if (/partial/.test(key)) return "partial";
  if (/attempt|failed|unsuccessful|refused|returned to sender|rtn/.test(key)) return "attempted";
  if (/delay|exception|on hold|held/.test(key)) return "delayed";
  if (/awaiting collection|for collection|collection point|card left/.test(key)) return "awaiting_collection";
  if (/complete|delivered/.test(key)) return "delivered";
  if (/out for delivery|for delivery/.test(key)) return "out_for_delivery";
  if (/transit|depot|picked|scanned|collected|linehaul|line ?haul|despatch|dispatch|schedul/.test(key)) return "in_transit";
  if (/manifest|booked|await|prepar|pack|created|new/.test(key)) return "preparing";
  return "unknown";
}

// scripts/machship-status-sweep.src.ts
var BASE = settings.machship.baseUrl;
var TOKEN = settings.machship.token;
if (!TOKEN) {
  console.error("MACHSHIP_TOKEN not set.");
  process.exit(1);
}
var daysIdx = process.argv.indexOf("--days");
var DAYS = Math.min(9, Number(daysIdx >= 0 ? process.argv[daysIdx + 1] : 9) || 9);
var mask = (v) => {
  if (typeof v !== "string" || !v) return "(none)";
  if (v.includes("@")) {
    const [u, d] = v.split("@");
    return `${u.slice(0, 2)}***@${d}`;
  }
  return v;
};
var INTERESTING = /awaiting collection|delivery attempted|partial|delayed|for collection|card left/i;
var DEAD = /cancel|delet|void/i;
async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { token: TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let env = null;
  try {
    env = JSON.parse(text);
  } catch {
  }
  return Array.isArray(env?.object) ? env.object : [];
}
async function get(path) {
  const res = await fetch(`${BASE}${path}`, {
    method: "GET",
    headers: { token: TOKEN, "Content-Type": "application/json" }
  });
  const text = await res.text();
  let env = null;
  try {
    env = JSON.parse(text);
  } catch {
  }
  return { http: res.status, env };
}
(async () => {
  const fromDateUtc = new Date(Date.now() - DAYS * 864e5).toISOString().split(".")[0];
  const toDateUtc = (/* @__PURE__ */ new Date()).toISOString().split(".")[0];
  const r = await get(
    `/apiv2/consignments/getRecentlyCreatedOrUpdatedConsignments?fromDateUtc=${encodeURIComponent(fromDateUtc)}&toDateUtc=${encodeURIComponent(toDateUtc)}&retrieveSize=500&includeChildCompanies=true`
  );
  const summary = Array.isArray(r.env?.object) ? r.env.object : [];
  console.log(`Stage 1: ${summary.length} consignments over ${DAYS} days (http ${r.http}).`);
  if (!summary.length) {
    console.log("Nothing returned. Check MACHSHIP_TOKEN.");
    return;
  }
  const refs = [...new Set(summary.map((c) => String(c.customerReference ?? "")).filter(Boolean))];
  console.log(`Stage 1: ${refs.length} distinct order references.
`);
  const SAMPLE = Math.min(refs.length, 120);
  const stride = Math.max(1, Math.floor(refs.length / SAMPLE));
  const picked = refs.filter((_, i) => i % stride === 0).slice(0, SAMPLE);
  console.log(`Stage 2: re-querying ${picked.length} references spread across the window (every ${stride}${stride === 1 ? "st" : "th"}) through returnConsignmentsByReference2...`);
  const full = /* @__PURE__ */ new Map();
  for (const ref of picked) {
    const cons = await post("/apiv2/consignments/returnConsignmentsByReference2", [`SO${ref}`]);
    if (cons.length) full.set(ref, cons);
  }
  const allCons = [...full.values()].flat();
  console.log(`Stage 2: ${allCons.length} consignments with full detail across ${full.size} orders.
`);
  const seen = /* @__PURE__ */ new Map();
  for (const c of allCons) {
    const n = String(c.status?.name ?? "(none)");
    seen.set(n, (seen.get(n) ?? 0) + 1);
  }
  console.log("\u2500\u2500 Status names seen, and how we handle each \u2500\u2500");
  const unmapped = [];
  for (const [name, count] of [...seen.entries()].sort((a, b) => b[1] - a[1])) {
    const key = name.trim().toLowerCase();
    const explicit = Object.prototype.hasOwnProperty.call(CONSIGNMENT_STATUS_MAP, key);
    const bucket = classifyConsignmentStatus(name);
    const how = explicit ? "mapped" : bucket === "unknown" ? "UNMAPPED \u2192 unknown" : `fallback \u2192 ${bucket}`;
    const dead = DEAD.test(name);
    const note = dead ? "filtered upstream (never rendered)" : how;
    if (!explicit && !dead && name !== "(none)") unmapped.push(`${name} (${how})`);
    console.log(`  ${String(count).padStart(4)}  ${name.padEnd(28)} ${(dead ? "\u2014" : bucket).padEnd(20)} ${note}`);
  }
  console.log(unmapped.length ? `
  \u26A0 NOT explicitly mapped: ${unmapped.join(", ")}
      A fallback match is a guess. Add these to CONSIGNMENT_STATUS_MAP.` : "\n  \u2705 Every live status name is explicitly mapped.");
  console.log("\n\u2500\u2500 Orders currently in a hard-to-observe state (use these to test) \u2500\u2500");
  let found = 0;
  for (const [ref, cons] of full) {
    for (const c of cons) {
      if (!INTERESTING.test(String(c.status?.name ?? ""))) continue;
      found++;
      console.log(`  ${String(c.status?.name).padEnd(22)} order=${ref}  email=${mask(c.toEmail)}  cartons=${(c.consignmentItems ?? []).length}`);
    }
  }
  if (!found) console.log("  none right now");
  console.log("\n\u2500\u2500 Orders with more than one LIVE consignment (the agent escalates these) \u2500\u2500");
  let dupes = 0;
  for (const [ref, cons] of full) {
    const live = cons.filter((c) => !DEAD.test(String(c.status?.name ?? "")));
    if (live.length < 2) continue;
    dupes++;
    console.log(`  order=${ref}  live=${live.length}  dead=${cons.length - live.length}  email=${mask(live[0].toEmail)}`);
    cons.forEach((c) => console.log(`      ${c.consignmentNumber} ${c.status?.name}${DEAD.test(String(c.status?.name ?? "")) ? "  (ignored)" : ""}`));
  }
  if (!dupes) console.log("  none right now");
  console.log("\nRead-only. Nothing written.");
})();
