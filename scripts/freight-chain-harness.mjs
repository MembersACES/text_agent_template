// scripts/freight-chain-harness.src.ts
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

// lib/config/chatMessageTrace.ts
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
var TRACE_DIR = path.join(process.cwd(), ".local", "chat-traces");
var TERMINAL_TAIL_MS = 300;
var storage = new AsyncLocalStorage();
var interceptorsInstalled = false;
function isEnabled() {
  if (process.env.ENABLE_CHAT_TRACE_LOGS === "true") return true;
  if (process.env.ENABLE_CHAT_TRACE_LOGS === "false") return false;
  return process.env.NODE_ENV === "development";
}
function slugify(text, maxLen = 48) {
  const slug = text.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, maxLen);
  return slug || "message";
}
function appendRaw(filePath, text) {
  if (!text) return;
  fs.appendFileSync(filePath, text, "utf8");
}
function appendLine(filePath, line) {
  fs.appendFileSync(filePath, `${line}
`, "utf8");
}
function decodeWriteChunk(chunk, encoding) {
  if (typeof chunk === "string") return chunk;
  return Buffer.from(chunk).toString(encoding ?? "utf8");
}
function installTerminalInterceptors() {
  if (interceptorsInstalled) return;
  interceptorsInstalled = true;
  const mirrorWrite = (original) => {
    return function writeMirror(chunk, encodingOrCallback, callback) {
      const ctx = storage.getStore();
      if (ctx) {
        const encoding = typeof encodingOrCallback === "string" ? encodingOrCallback : void 0;
        appendRaw(ctx.filePath, decodeWriteChunk(chunk, encoding));
      }
      if (typeof encodingOrCallback === "function") {
        return original(chunk, encodingOrCallback);
      }
      return original(chunk, encodingOrCallback, callback);
    };
  };
  process.stdout.write = mirrorWrite(process.stdout.write.bind(process.stdout));
  process.stderr.write = mirrorWrite(process.stderr.write.bind(process.stderr));
}
function createTraceFile(message) {
  fs.mkdirSync(TRACE_DIR, { recursive: true });
  const startedAt = /* @__PURE__ */ new Date();
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
  const slug = slugify(message);
  const filePath = path.join(TRACE_DIR, `${stamp}_${slug}.log`);
  fs.writeFileSync(filePath, "", "utf8");
  return { filePath, startedAt: startedAt.toISOString(), sections: [] };
}
function flushSections(ctx) {
  for (const section of ctx.sections) {
    appendLine(ctx.filePath, "");
    appendLine(ctx.filePath, `--- ${section.title} ---`);
    appendRaw(ctx.filePath, `${section.body}
`);
  }
}
function sleep(ms) {
  return new Promise((resolve2) => setTimeout(resolve2, ms));
}
var chatMessageTrace = {
  isEnabled,
  /** True while a trace is active — logger should only use console (stdout mirror captures it). */
  isCapturingTerminal() {
    return storage.getStore() !== void 0;
  },
  /** Queue a labelled block written after terminal output (e.g. full prompt). */
  appendSection(title, body) {
    const ctx = storage.getStore();
    if (!ctx) return;
    ctx.sections.push({ title, body });
  },
  async run(request, fn) {
    if (!isEnabled()) {
      return fn();
    }
    installTerminalInterceptors();
    const ctx = createTraceFile(request.message);
    const header = [
      "================================================================================",
      "CHAT MESSAGE TRACE (local only)",
      "================================================================================",
      `startedAt: ${ctx.startedAt}`,
      `file: ${ctx.filePath}`,
      "",
      "--- REQUEST ---",
      `message: ${request.message}`,
      `agentId: ${request.agentId ?? "(none)"}`,
      `useKnowledgeBase: ${request.useKnowledgeBase ?? false}`,
      `uploadedFiles: ${request.uploadedFiles?.length ?? 0}`,
      "",
      "conversationHistory:",
      JSON.stringify(request.conversationHistory ?? [], null, 2),
      "",
      "--- TERMINAL OUTPUT (stdout/stderr mirror) ---",
      "Includes Next.js request lines and all [Service] logs exactly as in the dev terminal.",
      ""
    ].join("\n");
    fs.writeFileSync(ctx.filePath, `${header}
`, "utf8");
    const started = Date.now();
    try {
      const result = await storage.run(ctx, async () => fn());
      await sleep(TERMINAL_TAIL_MS);
      flushSections(ctx);
      this.writeResponse(ctx, result);
      return result;
    } catch (error) {
      await sleep(TERMINAL_TAIL_MS);
      flushSections(ctx);
      this.writeFailure(ctx, error);
      throw error;
    } finally {
      const elapsed = Date.now() - started;
      appendLine(ctx.filePath, "");
      appendLine(ctx.filePath, `--- trace closed (${elapsed}ms) ---`);
      appendLine(ctx.filePath, `traceFile: ${ctx.filePath}`);
    }
  },
  writeResponse(ctx, result) {
    const lines = [
      "",
      "--- RESPONSE TO USER ---",
      `completedAt: ${(/* @__PURE__ */ new Date()).toISOString()}`
    ];
    if (result.error) {
      lines.push(`error: ${result.error}`);
    } else {
      lines.push("", "assistantReply:", result.response ?? "(empty)");
      if (result.sources) {
        lines.push("", "sources:", JSON.stringify(result.sources, null, 2));
      }
      if (result.extractedData) {
        lines.push("", "extractedData:", JSON.stringify(result.extractedData, null, 2));
      }
      if (result.generateReport) {
        lines.push("", "generateReport: true");
      }
    }
    fs.appendFileSync(ctx.filePath, `${lines.join("\n")}
`, "utf8");
  },
  writeFailure(ctx, error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : void 0;
    appendLine(ctx.filePath, "");
    appendLine(ctx.filePath, "--- REQUEST FAILED ---");
    appendLine(ctx.filePath, `error: ${message}`);
    if (stack) appendLine(ctx.filePath, stack);
  },
  getTraceDir() {
    return TRACE_DIR;
  }
};

// lib/config/logger.ts
function getLogger(name) {
  const write = (level, consoleFn, msg, ...args) => {
    if (chatMessageTrace.isCapturingTerminal()) {
      if (args.length > 0) {
        consoleFn(`[${name}] ${level}  ${msg}`, ...args);
      } else {
        consoleFn(`[${name}] ${level}  ${msg}`);
      }
      return;
    }
    consoleFn(`[${name}] ${level}  ${msg}`, ...args);
  };
  return {
    info: (msg, ...args) => write("INFO", console.log, msg, ...args),
    warn: (msg, ...args) => write("WARN", console.warn, msg, ...args),
    error: (msg, ...args) => write("ERROR", console.error, msg, ...args),
    debug: (msg, ...args) => write("DEBUG", console.debug, msg, ...args)
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

// lib/services/machship/fixture.ts
var MACHSHIP_FIXTURE_CONSIGNMENTS = [
  {
    customerReference: "10216938",
    customerReference2: "SO10216938",
    carrierConsignmentId: "XPD1234567",
    carrierName: "StarTrack",
    status: { name: "Complete" },
    etaLocal: "2026-08-01T00:00:00",
    eta: "2026-08-01T00:00:00",
    etaUtc: "2026-07-31T14:00:00",
    trackingPageAccessToken: "FIXTURE-TOKEN-BOX1",
    attachmentCount: 1,
    toEmail: "fixture@example.com",
    despatchDateUtc: "2026-07-30T02:15:00",
    dateCreated: "2026-07-30T02:15:00.000",
    statusHistory: [{ consignmentTrackingStatus: { name: "Complete" } }]
  },
  {
    customerReference: "10216938",
    customerReference2: "SO10216938",
    carrierConsignmentId: "XPD1234568",
    carrierName: "StarTrack",
    status: { name: "On For Delivery" },
    etaLocal: "2026-08-05T00:00:00",
    eta: "2026-08-05T00:00:00",
    etaUtc: "2026-08-04T14:00:00",
    trackingPageAccessToken: "FIXTURE-TOKEN-BOX2",
    attachmentCount: 0,
    toEmail: "fixture@example.com",
    despatchDateUtc: "2026-07-30T02:15:00",
    dateCreated: "2026-07-30T02:15:00.000",
    statusHistory: [{ consignmentTrackingStatus: { name: "On For Delivery" } }]
  }
];

// lib/services/machship/MachShipService.ts
var logger2 = getLogger("MachShipService");
var MachShipService = class {
  constructor() {
    this.baseUrl = settings.machship.baseUrl;
    this.token = settings.machship.token;
    this.useFixture = settings.machship.useFixture;
  }
  /**
   * Look up consignments for the given references. Tries SO-prefixed
   * customerReference2 first, then the digits-only customerReference1.
   * Never throws for "not found" — returns an outcome.
   */
  async lookupByReferences(refs) {
    if (this.useFixture) {
      logger2.warn("MACHSHIP_USE_FIXTURE=true \u2014 returning canned fixture, NOT live data");
      return {
        outcome: "found",
        consignments: MACHSHIP_FIXTURE_CONSIGNMENTS,
        via: "reference2",
        errors: []
      };
    }
    if (!this.token) {
      logger2.error("MACHSHIP_TOKEN missing \u2014 cannot look up");
      return { outcome: "error", consignments: [], via: null, errors: ["MachShip token not configured"] };
    }
    const ref2 = await this.call("/apiv2/consignments/returnConsignmentsByReference2", refs.sysproReferences);
    if (ref2.consignments.length) return { ...ref2, via: "reference2" };
    const ref1 = await this.call("/apiv2/consignments/returnConsignmentsByReference1", refs.bareReferences);
    if (ref1.consignments.length) return { ...ref1, via: "reference1" };
    const errors = [...ref2.errors, ...ref1.errors];
    return {
      outcome: errors.length ? "error" : "not_found",
      consignments: [],
      via: null,
      errors
    };
  }
  async call(path2, references) {
    if (!references.length) {
      return { outcome: "not_found", consignments: [], errors: [] };
    }
    try {
      const res = await fetch(`${this.baseUrl}${path2}`, {
        method: "POST",
        headers: { token: this.token, "Content-Type": "application/json" },
        body: JSON.stringify(references)
      });
      const text = await res.text();
      let env = null;
      try {
        env = JSON.parse(text);
      } catch {
      }
      const consignments = Array.isArray(env?.object) ? env.object : [];
      const allMessages = (env?.errors ?? []).map((e) => e.errorMessage).filter((m) => Boolean(m));
      const realErrors = allMessages.filter((m) => !/no consignments?\s*(?:were|was)?\s*found/i.test(m));
      if (realErrors.length) logger2.warn(`MachShip ${path2} returned errors: ${realErrors.join("; ")}`);
      return {
        outcome: consignments.length ? "found" : realErrors.length ? "error" : "not_found",
        consignments,
        errors: realErrors
      };
    } catch (err) {
      logger2.error(`MachShip ${path2} transport error`, err);
      return { outcome: "error", consignments: [], errors: [err instanceof Error ? err.message : String(err)] };
    }
  }
  /**
   * Best-effort consignment date for the 60-day lookback gate.
   *
   * Field names CONFIRMED against live consignments (4 Aug 2026): a consignment
   * carries despatchDateUtc, dateCreated, bookedDate, completedDateUtc and
   * etaUtc/eta (NOT manifestedDateUtc / createdDateUtc / consignmentDate). We
   * prefer the actual despatch date, then creation/booking, then completion,
   * then ETA. If none are present, return null so the caller treats the date as
   * UNKNOWN rather than silently assuming "in window".
   */
  consignmentDate(c) {
    const candidates = [
      "despatchDateUtc",
      "dateCreated",
      "bookedDate",
      "completedDateUtc",
      "etaUtc",
      "eta"
    ];
    for (const key of candidates) {
      const v = c[key];
      if (typeof v === "string" && v) {
        const d = new Date(v);
        if (!Number.isNaN(d.getTime())) return d;
      }
    }
    return null;
  }
};

// lib/services/freight/FreightReferenceResolverFactory.ts
var logger3 = getLogger("FreightReferenceResolverFactory");
var FreightReferenceResolverFactory = class {
  static create() {
    const provider = settings.freight.provider;
    switch (provider) {
      case "dotwms":
        return new DotWmsReferenceResolver();
      // case 'odoo':
      //     return new OdooReferenceResolver(); // TODO: build for Odoo go-live (end Oct 2026)
      default:
        logger3.warn(`unknown freight provider "${provider}" \u2014 falling back to dotWMS`);
        return new DotWmsReferenceResolver();
    }
  }
};

// lib/services/tracking/trackingCopy.ts
var OWN_DRIVER_LINE = "Your order has been packed and is out for delivery on the H2G run delivery day.";
var ETA_DISCLAIMER = "If you haven't received it within 24 hours of the estimated date, please contact us and we'll chase it up.";
var DRAFT_COPY = {
  notFound: "I couldn't find an order matching that number and email. Please double-check both \u2014 the email must be the one used on the order.",
  preparing: "Your order is being prepared for dispatch. We'll have tracking for you once it leaves our warehouse.",
  held: (reason) => reason ? `Your order is currently on hold (${reason}). Please contact us and we'll sort it out.` : "Your order is currently on hold. Please contact us and we'll sort it out.",
  tooOld: "That order is outside the window I can look up here (the last 60 days). Please contact us and we will help.",
  unverifiedRefused: "To protect your order details, I can only look these up with your BigCommerce order number and the email address used on the order.",
  // Running late — surfaced instead of a plain "on its way".
  delayed: "Your order is on its way but is currently running behind schedule. If you're concerned, contact us and we'll chase it up with the courier.",
  // A delivery was attempted but not completed.
  attempted: "The courier attempted to deliver your order but couldn't complete it. They'll usually try again \u2014 your tracking link has the details.",
  // Status we don't recognise — never over-claim; stay neutral and point to us.
  unknownStatus: "Your order is in progress. For the latest status, please contact us with your order number and email."
};

// lib/services/tracking/statusMap.ts
var CONSIGNMENT_STATUS_MAP = {
  complete: "delivered",
  delivered: "delivered",
  "partial delivery": "partial",
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
  if (/complete|delivered/.test(key)) return "delivered";
  if (/out for delivery|for delivery/.test(key)) return "out_for_delivery";
  if (/transit|depot|picked|scanned|collected|linehaul|line ?haul|despatch|dispatch|schedul/.test(key)) return "in_transit";
  if (/manifest|booked|await|prepar|pack|created|new/.test(key)) return "preparing";
  return "unknown";
}

// lib/services/tracking/OrderTrackingService.ts
var logger4 = getLogger("OrderTrackingService");
var PREPARING_STATUS = /pack|queue|prepar|pick/i;
var OrderTrackingService = class {
  constructor(resolver, machship) {
    this.resolver = resolver ?? FreightReferenceResolverFactory.create();
    this.machship = machship ?? new MachShipService();
    this.lookbackDays = settings.freight.lookbackDays;
    this.requireVerifiedEmail = settings.freight.requireVerifiedEmail;
  }
  async track(orderNumber, email) {
    const resolved = await this.resolver.resolve({ orderNumber, email });
    if (resolved.outcome === "error") {
      return this.simple("error", DRAFT_COPY.notFound, resolved.provider, resolved.diagnostic);
    }
    if (resolved.outcome === "not_found" || !resolved.orders.length) {
      return this.simple("not_found", DRAFT_COPY.notFound, resolved.provider, resolved.diagnostic);
    }
    let ownershipVerified = resolved.verified;
    let verifyViaMachShip = false;
    if (this.requireVerifiedEmail && !resolved.verified) {
      if (resolved.verifyVia === "machship-toEmail") {
        verifyViaMachShip = true;
      } else {
        logger4.info("unverifiable match and requireVerifiedEmail=true \u2014 refusing");
        return this.simple("unverified_refused", DRAFT_COPY.unverifiedRefused, resolved.provider);
      }
    } else if (!this.requireVerifiedEmail) {
      ownershipVerified = true;
    }
    if (ownershipVerified) {
      const held = resolved.orders.find((o) => o.heldReason);
      if (held) {
        const via = resolved.verifyVia === "dotwms" ? "dotwms" : null;
        return this.simple("held", DRAFT_COPY.held(held.heldReason), resolved.provider, void 0, via);
      }
    }
    const lookup = await this.machship.lookupByReferences({
      sysproReferences: resolved.orders.map((o) => o.sysproReference),
      bareReferences: resolved.orders.map((o) => o.bareReference)
    });
    if (lookup.outcome === "error") {
      return this.simple("error", DRAFT_COPY.notFound, resolved.provider, `machship: ${lookup.errors.join("; ")}`);
    }
    if (verifyViaMachShip) {
      if (lookup.outcome !== "found") {
        logger4.info("direct Syspro ref not in MachShip \u2014 cannot verify ownership, refusing");
        return this.simple("unverified_refused", DRAFT_COPY.unverifiedRefused, resolved.provider);
      }
      if (!this.ownershipMatchesToEmail(lookup.consignments, email)) {
        logger4.info("MachShip toEmail did not match customer email \u2014 refusing");
        return this.simple("unverified_refused", DRAFT_COPY.unverifiedRefused, resolved.provider);
      }
      ownershipVerified = true;
    }
    if (lookup.outcome === "not_found") {
      return this.classifyNoMachShip(resolved.orders, resolved.provider);
    }
    const inWindow = this.withinLookback(lookup.consignments);
    if (inWindow === false) {
      return this.simple("too_old", DRAFT_COPY.tooOld, resolved.provider);
    }
    return this.buildFromConsignments(
      lookup.consignments,
      resolved.provider,
      inWindow === null,
      verifyViaMachShip ? "machship-toEmail" : "dotwms"
    );
  }
  /** Match the customer's email against consignment `toEmail`. Requires at least
   *  one populated toEmail and that EVERY populated one matches. */
  ownershipMatchesToEmail(cons, email) {
    const target = email.trim().toLowerCase();
    const populated = cons.filter((c) => typeof c.toEmail === "string" && c.toEmail.trim());
    if (!populated.length) {
      logger4.warn("no toEmail on any consignment \u2014 cannot verify 8-digit ownership");
      return false;
    }
    return populated.every((c) => String(c.toEmail).trim().toLowerCase() === target);
  }
  classifyNoMachShip(orders, provider) {
    const status = orders[0]?.warehouseStatusRaw ?? "";
    if (PREPARING_STATUS.test(status)) {
      return this.simple("preparing", DRAFT_COPY.preparing, provider, void 0, "dotwms");
    }
    return this.simple(
      "own_driver_out",
      OWN_DRIVER_LINE,
      provider,
      "no MachShip consignment; treated as own-driver (also possible: predates MachShip / shipped otherwise)",
      "dotwms"
    );
  }
  buildFromConsignments(cons, provider, dateUnknown, verifiedVia) {
    const boxes = cons.map((c) => ({
      reference: c.carrierConsignmentId ?? null,
      carrier: c.carrierName ?? null,
      status: c.status?.name ?? null,
      etaLocal: c.etaLocal ?? c.eta ?? null,
      trackingUrl: c.trackingPageAccessToken ? `https://mship.io/v2/${c.trackingPageAccessToken}` : null
    }));
    const total = boxes.length;
    const buckets = boxes.map((b) => classifyConsignmentStatus(b.status));
    const delivered = buckets.filter((x) => x === "delivered").length;
    const totalItems = cons.reduce((n, c) => n + (Array.isArray(c.consignmentItems) ? c.consignmentItems.length : 0), 0);
    const carrier = boxes.find((b) => b.carrier)?.carrier ?? "the courier";
    const boxCount = Math.max(total, totalItems);
    const eta = boxes.filter((_, i) => buckets[i] !== "delivered").map((b) => b.etaLocal).filter((e) => Boolean(e)).sort()[0] ?? null;
    const etaSuffix = eta ? `, expected ${this.dateOnly(eta)}` : "";
    const currentPartial = buckets.includes("partial");
    const mixedMultiConsignment = delivered > 0 && delivered < total;
    const has = (b) => buckets.includes(b);
    const unknownStatuses = boxes.filter((_, i) => buckets[i] === "unknown").map((b) => b.status ?? "?");
    let state;
    let message;
    if (currentPartial || mixedMultiConsignment) {
      state = "partly_delivered";
      message = mixedMultiConsignment ? `Your order is coming in ${total} ${total === 1 ? "box" : "boxes"}. ${delivered} ${delivered === 1 ? "has" : "have"} been delivered; the rest are on their way with ${carrier}${etaSuffix}.` : boxCount > 1 ? `Your order is coming in ${boxCount} boxes. Some have already been delivered and the rest are on their way with ${carrier}${etaSuffix}.` : `Part of your order has been delivered; the rest is on its way with ${carrier}${etaSuffix}.`;
    } else if (delivered === total && total > 0) {
      state = "delivered";
      message = boxCount > 1 ? `All ${boxCount} boxes of your order have been delivered.` : "Your order has been delivered.";
    } else if (has("delayed")) {
      state = "delayed";
      message = DRAFT_COPY.delayed;
    } else if (has("attempted")) {
      state = "attempted";
      message = DRAFT_COPY.attempted;
    } else if (has("out_for_delivery")) {
      state = "out_for_delivery";
      message = boxCount > 1 ? `Your order is out for delivery today with ${carrier}, in ${boxCount} boxes.` : `Your order is out for delivery today with ${carrier}.`;
    } else if (has("in_transit")) {
      state = "in_transit";
      message = boxCount > 1 ? `Your order is on its way in ${boxCount} boxes with ${carrier}${etaSuffix}.` : `Your order is on its way with ${carrier}${etaSuffix}.`;
    } else if (buckets.every((x) => x === "preparing")) {
      state = "preparing";
      message = DRAFT_COPY.preparing;
    } else {
      state = "unknown";
      message = DRAFT_COPY.unknownStatus;
    }
    const showEtaDisclaimer = Boolean(eta) && (state === "partly_delivered" || state === "in_transit" || state === "delayed");
    const fullMessage = showEtaDisclaimer ? `${message} ${ETA_DISCLAIMER}` : message;
    const diagnostics = [];
    if (dateUnknown) diagnostics.push("consignment date unreadable \u2014 60-day gate NOT enforced (date field name unconfirmed)");
    if (totalItems > total) diagnostics.push(`items (${totalItems}) exceed consignments (${total}) \u2014 showing carton count ${boxCount} to the customer (confirmed 18 Aug 2026); delivery status remains per-consignment`);
    if (unknownStatuses.length) diagnostics.push(`unrecognised MachShip status(es): ${[...new Set(unknownStatuses)].join(", ")} \u2014 mapped to 'unknown' safe default; add to statusMap.ts`);
    return {
      state,
      message: fullMessage,
      boxes,
      totalBoxes: total,
      deliveredBoxes: delivered,
      totalItems,
      verifiedVia,
      eta,
      showEtaDisclaimer,
      provider,
      diagnostic: diagnostics.length ? diagnostics.join(" | ") : void 0
    };
  }
  /**
   * true  = at least one consignment is within the lookback window
   * false = every consignment with a readable date is older than the window
   * null  = no readable dates at all (cannot decide — do NOT treat as pass)
   */
  withinLookback(cons) {
    const cutoff = Date.now() - this.lookbackDays * 864e5;
    let sawDate = false;
    let anyInWindow = false;
    for (const c of cons) {
      const d = this.machship.consignmentDate(c);
      if (d) {
        sawDate = true;
        if (d.getTime() >= cutoff) anyInWindow = true;
      }
    }
    if (!sawDate) return null;
    return anyInWindow;
  }
  dateOnly(iso) {
    return String(iso).split("T")[0];
  }
  simple(state, message, provider, diagnostic, verifiedVia = null) {
    return {
      state,
      message,
      boxes: [],
      totalBoxes: 0,
      deliveredBoxes: 0,
      totalItems: 0,
      verifiedVia,
      eta: null,
      showEtaDisclaimer: false,
      provider,
      diagnostic
    };
  }
};

// scripts/freight-chain-harness.src.ts
function mask(v) {
  if (typeof v !== "string" || !v.trim()) return "(empty)";
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
async function main() {
  if (settings.machship.useFixture) {
    console.error("MACHSHIP_USE_FIXTURE is on \u2014 unset it for a live run.");
    process.exit(1);
  }
  if (!settings.dotwms.apiKey || !settings.machship.token) {
    console.error("Missing DOTWMS_API_KEY / MACHSHIP_TOKEN. Run with --env-file=.env.local");
    process.exit(1);
  }
  const path2 = fileArg();
  let examples;
  try {
    const parsed = JSON.parse(readFileSync(path2, "utf8").replace(/^\uFEFF/, ""));
    examples = Array.isArray(parsed?.examples) ? parsed.examples : [];
  } catch (e) {
    console.error(`Cannot read examples from ${path2}: ${e instanceof Error ? e.message : String(e)}`);
    console.error("Copy scripts/freight-examples.example.json \u2192 scripts/freight-examples.local.json and fill it in.");
    process.exit(1);
  }
  if (!examples.length) {
    console.error(`No examples found in ${path2}.`);
    process.exit(1);
  }
  const isPlaceholder = (v) => !v || /[<>]/.test(v) || /PASTE_/i.test(v);
  const unfilled = examples.filter((e) => isPlaceholder(String(e.order)) || isPlaceholder(String(e.email)));
  if (unfilled.length) {
    console.error(`
\u2717 ${unfilled.length}/${examples.length} example(s) STILL CONTAIN TEMPLATE PLACEHOLDERS.`);
    console.error(`  File actually read: ${resolve(path2)}`);
    console.error("  Edit THAT file \u2014 replace every <...> / PASTE_ value with the real order number + email \u2014 and re-run.");
    console.error("  Windows note: make sure it saved as ...local.json, NOT ...local.json.txt (Notepad hides the .txt).");
    process.exit(1);
  }
  console.log(`Reading examples from: ${resolve(path2)}
`);
  const resolver = new DotWmsReferenceResolver();
  const machship = new MachShipService();
  const tracking = new OrderTrackingService();
  for (const ex of examples) {
    console.log("\n" + "=".repeat(74));
    console.log(ex.label);
    console.log(`order ${ex.order}    email ${mask(ex.email)}`);
    console.log("=".repeat(74));
    const r = await resolver.resolve({ orderNumber: ex.order, email: ex.email });
    console.log(`[1] resolver: path=${r.verifyVia}  outcome=${r.outcome}  verified=${r.verified}`);
    for (const o of r.orders) {
      console.log(`    packslip ${o.sysproReference}  jobStatus=${o.warehouseStatusRaw ?? "-"} / ${o.warehouseStatusTranslated ?? "-"}  held=${o.heldReason ?? "none"}`);
    }
    if (r.diagnostic) console.log(`    diag: ${r.diagnostic}`);
    if (r.orders.length) {
      const ms = await machship.lookupByReferences({
        sysproReferences: r.orders.map((o) => o.sysproReference),
        bareReferences: r.orders.map((o) => o.bareReference)
      });
      console.log(`[2] machship: via=${ms.via ?? "-"}  consignments=${ms.consignments.length}${ms.errors.length ? `  errors=${ms.errors.join("; ")}` : ""}`);
      let totalItems = 0;
      ms.consignments.forEach((c, i) => {
        const items = Array.isArray(c.consignmentItems) ? c.consignmentItems.length : 0;
        totalItems += items;
        const tok = c.trackingPageAccessToken ? "\u2026" + String(c.trackingPageAccessToken).slice(-4) : "-";
        console.log(`    box ${i + 1}: cons=${c.carrierConsignmentId ?? "-"} status=${c.status?.name ?? "-"} eta=${c.etaLocal ?? c.eta ?? "-"} items=${items} toEmail=${mask(c.toEmail)} track=${tok}`);
        if (i === 0) {
          const dateKeys = Object.keys(c).filter((k) => /date|eta|utc|created|manifest|dispatch/i.test(k));
          console.log(`      date-ish fields: ${dateKeys.map((k) => `${k}=${String(c[k])}`).join("   ") || "(none)"}`);
        }
      });
      const n = ms.consignments.length;
      const structure = n > 1 ? "SPLIT across SEPARATE consignments" : totalItems > 1 ? "multiple items within ONE consignment" : n === 1 ? "single consignment" : "not in MachShip";
      console.log(`    STRUCTURE: consignments=${n}, totalItems=${totalItems} \u2192 ${structure}`);
    }
    const t = await tracking.track(ex.order, ex.email);
    console.log(`[3] tracking: state=${t.state}  verifiedVia=${t.verifiedVia ?? "-"}  boxes=${t.totalBoxes} delivered=${t.deliveredBoxes} items=${t.totalItems}  eta=${t.eta ?? "-"}`);
    if (t.diagnostic) console.log(`    diag: ${t.diagnostic}`);
    console.log("    --- rendered customer message ---");
    console.log(t.message.split("\n").map((l) => "    " + l).join("\n"));
    console.log("    ---------------------------------");
  }
  console.log("\nDone. PII masked; this run is local and writes nothing to the repo.");
}
main().catch((e) => {
  console.error("harness error:", e);
  process.exit(1);
});
