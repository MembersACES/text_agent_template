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
  return new Promise((resolve) => setTimeout(resolve, ms));
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

// lib/services/freight/FreightReferenceResolverFactory.ts
var logger2 = getLogger("FreightReferenceResolverFactory");
var FreightReferenceResolverFactory = class {
  static create() {
    const provider = settings.freight.provider;
    switch (provider) {
      case "dotwms":
        return new DotWmsReferenceResolver();
      // case 'odoo':
      //     return new OdooReferenceResolver(); // TODO: build for Odoo go-live (end Oct 2026)
      default:
        logger2.warn(`unknown freight provider "${provider}" \u2014 falling back to dotWMS`);
        return new DotWmsReferenceResolver();
    }
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
var logger3 = getLogger("MachShipService");
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
      logger3.warn("MACHSHIP_USE_FIXTURE=true \u2014 returning canned fixture, NOT live data");
      return {
        outcome: "found",
        consignments: MACHSHIP_FIXTURE_CONSIGNMENTS,
        via: "reference2",
        errors: []
      };
    }
    if (!this.token) {
      logger3.error("MACHSHIP_TOKEN missing \u2014 cannot look up");
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
      if (realErrors.length) logger3.warn(`MachShip ${path2} returned errors: ${realErrors.join("; ")}`);
      return {
        outcome: consignments.length ? "found" : realErrors.length ? "error" : "not_found",
        consignments,
        errors: realErrors
      };
    } catch (err) {
      logger3.error(`MachShip ${path2} transport error`, err);
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
  // CONFIRMED (Iri, 31 Aug 2026). H2G do not have carriers re-attempt; the parcel
  // goes to the nearest collection point. Iri collapsed the failed-attempt and
  // awaiting-collection cases into ONE line, and asked that the first response does
  // NOT offer escalation. Escalation is only offered if the customer says they
  // cannot or will not collect (see COLLECTION_REFUSED in OrderStatusGate).
  attempted: "Your order is waiting for you at your nearest post office or collection point. The courier has tried to deliver your order without success. Your tracking link has the address and any collection reference you need.",
  // Same customer situation, reached via MachShip's "Awaiting Collection" status
  // rather than a failed attempt. Same line, per Iri.
  awaitingCollection: "Your order is waiting for you at your nearest post office or collection point. The courier has tried to deliver your order without success. Your tracking link has the address and any collection reference you need.",
  // More than one LIVE consignment against one order. Per Iri (31 Aug 2026) this
  // happens when a bad consignment was raised and not deleted straight away. Never
  // guess which one is real; hand it to a person.
  multipleConsignments: "I can see more than one delivery record against that order, so I don't want to give you the wrong information. I've passed this to our team and someone will come back to you with the right details.",
  // Offered ONLY after the customer indicates they cannot collect.
  collectionRefused: "No problem, I've passed this to our team and someone will be in touch to sort out another option for you.",
  // Status we don't recognise — never over-claim; stay neutral and point to us.
  unknownStatus: "Your order is in progress. For the latest status, please contact us with your order number and email."
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

// lib/services/tracking/OrderTrackingService.ts
var logger4 = getLogger("OrderTrackingService");
var PREPARING_STATUS = /pack|queue|prepar|pick/i;
function isDeadConsignment(c) {
  return /cancel|delet|void/i.test(String(c.status?.name ?? ""));
}
function isCustomerFacingHold(reason) {
  const r = String(reason ?? "").trim().toLowerCase();
  if (!r) return false;
  return r.includes("suspended in syspro");
}
var OrderTrackingService = class {
  constructor(resolver2, machship2) {
    this.resolver = resolver2 ?? FreightReferenceResolverFactory.create();
    this.machship = machship2 ?? new MachShipService();
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
      const held = resolved.orders.find((o) => isCustomerFacingHold(o.heldReason));
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
  buildFromConsignments(consRaw, provider, dateUnknown, verifiedVia) {
    const cons = consRaw.filter((c) => !isDeadConsignment(c));
    const droppedDead = consRaw.length - cons.length;
    if (cons.length > 1) {
      return this.simple(
        "multiple_consignments",
        DRAFT_COPY.multipleConsignments,
        provider,
        `${cons.length} live consignments against one order (${cons.map((c) => c.consignmentNumber ?? c.carrierConsignmentId).join(", ")})${droppedDead ? `; ${droppedDead} cancelled ignored` : ""} \u2014 escalated rather than rendered`,
        verifiedVia
      );
    }
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
    } else if (has("awaiting_collection")) {
      state = "awaiting_collection";
      message = DRAFT_COPY.awaitingCollection;
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
  /**
   * Customer-facing date. Was `iso.split('T')[0]`, which rendered "expected
   * 2026-08-28" in an otherwise plain-English sentence (spotted live 31 Aug 2026 on
   * order 10265537). MachShip's own page says "Friday, 28 Aug", so match that.
   *
   * CRITICAL: the value is `etaLocal`, which is ALREADY local and carries no zone
   * suffix. Passing it through `new Date()` and a timeZone formatter re-interprets
   * it as UTC and slides the day — "2026-08-28T23:59:59" came out as
   * "Saturday 29 August". So take the DATE PARTS verbatim and format those; never
   * convert. Falls back to the raw date portion if the shape is unexpected.
   */
  dateOnly(iso) {
    const datePart = String(iso).split("T")[0];
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
    if (!m) return datePart;
    const [, y, mo, d] = m;
    const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), 12));
    if (Number.isNaN(dt.getTime())) return datePart;
    return new Intl.DateTimeFormat("en-AU", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "UTC"
    }).format(dt);
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

// scripts/tracking-render-tests.src.ts
var EMAIL = "customer@example.com";
var RECENT = new Date(Date.now() - 3 * 864e5).toISOString();
function resolver(heldReason = null, verified = true) {
  return {
    provider: "test",
    async resolve() {
      return {
        outcome: "matched",
        verified,
        verifyVia: "dotwms",
        deliveryEmail: EMAIL,
        orders: [{
          sysproReference: "SO10000001",
          bareReference: "10000001",
          warehouseStatusRaw: "Closed / Fulfilled",
          warehouseStatusTranslated: "Fulfilled",
          heldReason
        }],
        provider: "test"
      };
    }
  };
}
function consignment(statusName, items, id = "W9DZ00000001") {
  return {
    customerReference: "10000001",
    customerReference2: "SO10000001",
    carrierConsignmentId: id,
    consignmentNumber: `MS${id}`,
    carrierName: "StarTrack",
    status: { name: statusName },
    etaLocal: "2026-09-04T23:59:59",
    eta: "2026-09-04T23:59:59",
    despatchDateUtc: RECENT,
    toEmail: EMAIL,
    trackingPageAccessToken: "TESTTOKEN",
    consignmentItems: Array.from({ length: items }, (_, i) => ({
      name: "Generic Item",
      references: [`${id}EXP0000${i + 1}`]
    })),
    statusHistory: []
  };
}
function machship(cons) {
  const svc = new MachShipService();
  svc.lookupByReferences = async () => ({
    outcome: cons.length ? "found" : "not_found",
    consignments: cons,
    via: "reference2",
    errors: []
  });
  return svc;
}
var CASES = [
  {
    name: "Cancelled consignment is ignored (mirrors live order 10257041)",
    cons: [consignment("Cancelled", 1, "W9DZ00047591"), consignment("Complete", 4, "W9DZ00047592")],
    expectState: "delivered",
    expectMessage: (m) => m.includes("All 4 boxes") && !m.includes("5 boxes"),
    because: "the cancelled one has 1 carton; counting it would say 5"
  },
  {
    name: "Two LIVE consignments escalate (mirrors live order 10265223)",
    cons: [consignment("Booked", 1, "W9DZ00048114"), consignment("Picked Up", 1, "W9DZ00048117")],
    expectState: "multiple_consignments",
    expectMessage: (m) => m.includes("more than one delivery record"),
    because: "never guess which consignment is real"
  },
  {
    name: "Cancelled + Cancelled + one live = tracks normally",
    cons: [consignment("Cancelled", 2, "A"), consignment("Cancelled", 3, "B"), consignment("Complete", 2, "C")],
    expectState: "delivered",
    expectMessage: (m) => m.includes("All 2 boxes"),
    because: "multiple dead consignments must not trip the duplicate rule"
  },
  {
    name: "Awaiting Collection renders the collection line",
    cons: [consignment("Awaiting Collection", 1)],
    expectState: "awaiting_collection",
    expectMessage: (m) => m.includes("post office or collection point") && !m.includes("being prepared"),
    because: 'this rendered as "being prepared for dispatch" before 24 Aug'
  },
  {
    name: "Delivery Attempted renders the same collection line",
    cons: [consignment("Delivery Attempted", 1)],
    expectState: "attempted",
    expectMessage: (m) => m.includes("post office or collection point") && !m.includes("try again"),
    because: "Iri: H2G do not have carriers re-attempt"
  },
  {
    name: "Collection line does NOT offer escalation up front",
    cons: [consignment("Awaiting Collection", 1)],
    expectState: "awaiting_collection",
    expectMessage: (m) => !/pass (this )?to our team/i.test(m),
    because: "Iri: only offer a handoff if the customer says they cannot collect"
  },
  {
    name: "Partial Delivery renders the split line with a carton count",
    cons: [consignment("Partial Delivery", 3)],
    expectState: "partly_delivered",
    expectMessage: (m) => m.includes("coming in 3 boxes") && m.includes("Some have already been delivered"),
    because: "never observed live; this is the only way to verify it"
  },
  {
    name: 'Hold "Suspended in SYSPRO" IS surfaced',
    cons: [consignment("Booked", 1)],
    held: "Suspended in SYSPRO",
    expectState: "held",
    expectMessage: (m) => m.toLowerCase().includes("on hold"),
    because: "Iri: this is the only genuine customer-facing hold"
  },
  {
    name: 'Hold "Hold For Release >250kg" is NOT surfaced',
    cons: [consignment("Complete", 1)],
    held: "Hold For Release >250kg",
    expectState: "delivered",
    expectMessage: (m) => !m.toLowerCase().includes("on hold"),
    because: "internal workflow marker, irrelevant to the customer"
  },
  {
    name: 'Hold "SPECIAL PACKING REQUIRED. SEE SUPERVISOR" is NOT surfaced',
    cons: [consignment("Complete", 1)],
    held: "SPECIAL PACKING REQUIRED. SEE SUPERVISOR",
    expectState: "delivered",
    expectMessage: (m) => !m.toLowerCase().includes("on hold"),
    because: "internal workflow marker, irrelevant to the customer"
  },
  {
    name: "Hold matching is case-insensitive",
    cons: [consignment("Booked", 1)],
    held: "suspended in syspro",
    expectState: "held",
    expectMessage: (m) => m.toLowerCase().includes("on hold"),
    because: "the WMS screen shows SYSPRO, Iri wrote Syspro"
  },
  {
    name: "Single-carton delivered says no box count",
    cons: [consignment("Complete", 1)],
    expectState: "delivered",
    expectMessage: (m) => m === "Your order has been delivered." || m.startsWith("Your order has been delivered."),
    because: 'a one-box order should not say "All 1 boxes"'
  },
  {
    name: "Unrecognised status never claims delivered",
    cons: [consignment("Something We Have Never Seen", 2)],
    expectState: "unknown",
    expectMessage: (m) => !/delivered/i.test(m),
    because: "the safe default must never over-claim"
  }
];
(async () => {
  let pass = 0;
  let fail = 0;
  for (const c of CASES) {
    const svc = new OrderTrackingService(resolver(c.held ?? null), machship(c.cons));
    const r = await svc.track("10000001", EMAIL);
    const stateOk = r.state === c.expectState;
    const msgOk = c.expectMessage(r.message);
    const ok = stateOk && msgOk;
    ok ? pass++ : fail++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}`);
    if (!ok) {
      console.log(`        expected state=${c.expectState}, got=${r.state}`);
      console.log(`        message: ${r.message}`);
      console.log(`        why it matters: ${c.because}`);
    }
  }
  console.log(`
${pass} passed, ${fail} failed, ${CASES.length} total`);
  process.exit(fail ? 1 : 0);
})();
