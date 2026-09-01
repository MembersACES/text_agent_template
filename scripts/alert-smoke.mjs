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

// lib/services/alerts/transports.ts
var logger = getLogger("AlertTransport");
var LogAlertTransport = class {
  constructor() {
    this.name = "log";
  }
  async send(message) {
    logger.warn(`LogAlertTransport: would send an alert to ${message.to} (content withheld \u2014 contains PII). No email sent.`);
  }
};
var SmtpAlertTransport = class {
  constructor(cfg) {
    this.cfg = cfg;
    this.name = "smtp";
  }
  async send(message) {
    const specifier = "nodemailer";
    const nodemailer = await import(specifier);
    const transporter = nodemailer.createTransport({
      host: this.cfg.host,
      port: this.cfg.port,
      secure: this.cfg.port === 465,
      auth: { user: this.cfg.user, pass: this.cfg.pass }
    });
    await transporter.sendMail({
      from: message.from,
      to: message.to,
      subject: message.subject,
      text: message.body
    });
  }
};
var WebhookAlertTransport = class {
  constructor(cfg) {
    this.cfg = cfg;
    this.name = "webhook";
  }
  async send(message) {
    if (!this.cfg.secret) {
      throw new Error("webhook secret not configured \u2014 refusing to POST alert");
    }
    const res = await fetch(this.cfg.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-alert-secret": this.cfg.secret
      },
      body: JSON.stringify(message.payload)
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`webhook returned HTTP ${res.status}`);
    }
  }
};
function createAlertTransport(cfg) {
  switch (cfg.transport) {
    case "webhook":
      if (cfg.webhook.url) return new WebhookAlertTransport(cfg.webhook);
      logger.warn("ALERTS_TRANSPORT=webhook but ALERTS_WEBHOOK_URL is empty \u2014 using LogAlertTransport (no alerts sent).");
      return new LogAlertTransport();
    case "smtp":
      if (cfg.smtp.host && cfg.smtp.user && cfg.smtp.pass) return new SmtpAlertTransport(cfg.smtp);
      logger.warn("ALERTS_TRANSPORT=smtp but SMTP is not fully configured \u2014 using LogAlertTransport (no alerts sent).");
      return new LogAlertTransport();
    case "log":
      return new LogAlertTransport();
    default:
      logger.warn(`Unknown ALERTS_TRANSPORT="${cfg.transport}" \u2014 using LogAlertTransport (no alerts sent).`);
      return new LogAlertTransport();
  }
}

// lib/services/alerts/triggerMap.ts
var TRIGGER_TEAM = {
  not_found: "CS",
  queued_chasing: "WH",
  wont_wait: "CS",
  collection_refused: "CS",
  duplicate_consignments: "CS"
};
function teamForTrigger(trigger) {
  return TRIGGER_TEAM[trigger];
}
var DEFAULT_REASON = {
  not_found: "Order not found in lookup; customer confirms the details are correct.",
  queued_chasing: "Order is in the packing queue and the customer is chasing to receive it sooner.",
  wont_wait: "Split order: customer does not want to wait for the remaining box.",
  collection_refused: "Parcel is at a collection point and the customer is not able to collect it.",
  duplicate_consignments: "More than one live consignment against this order in MachShip; needs a person to confirm which is correct."
};

// lib/services/alerts/InternalAlertService.ts
var logger2 = getLogger("InternalAlertService");
var InternalAlertService = class {
  constructor(opts = {}) {
    /** dedup key → expiry timestamp (ms). */
    this.seen = /* @__PURE__ */ new Map();
    /** send timestamps within the rolling hour, for the global rate cap. */
    this.sentTimestamps = [];
    this.enabled = opts.enabled ?? settings.alerts.enabled;
    this.fromAddress = opts.fromAddress ?? settings.alerts.fromAddress;
    this.toAddress = opts.toAddress ?? settings.alerts.toAddress;
    this.dedupTtlMs = opts.dedupTtlMs ?? settings.alerts.dedupTtlMinutes * 6e4;
    this.maxPerHour = opts.maxPerHour ?? settings.alerts.maxPerHour;
    this.now = opts.now ?? (() => Date.now());
    this.transport = opts.transport ?? createAlertTransport({
      transport: settings.alerts.transport,
      webhook: settings.alerts.webhook,
      smtp: settings.alerts.smtp
    });
  }
  /** Compose the subject: `H2G AI ALERT_<TEAM>_<Name or (Unknown)>`. */
  buildSubject(alert2) {
    const team = teamForTrigger(alert2.trigger);
    const name = alert2.customerName?.trim() || "(Unknown)";
    return `H2G AI ALERT_${team}_${name}`;
  }
  buildBody(alert2) {
    return [
      `Customer Name: ${alert2.customerName?.trim() || "(Unknown)"}`,
      `Email Address: ${alert2.customerEmail.trim()}`,
      `Order Number: ${alert2.orderNumber.trim()}`,
      `Reason: ${alert2.reason?.trim() || DEFAULT_REASON[alert2.trigger]}`
    ].join("\n");
  }
  compose(alert2) {
    return {
      from: this.fromAddress,
      to: this.toAddress,
      subject: this.buildSubject(alert2),
      body: this.buildBody(alert2),
      // Structured fields for the webhook transport (n8n builds its own
      // subject/body from these). Email transports use subject/body above.
      payload: {
        team: teamForTrigger(alert2.trigger),
        customerName: alert2.customerName?.trim() || null,
        orderNumber: alert2.orderNumber.trim(),
        customerEmail: alert2.customerEmail.trim(),
        reason: alert2.reason?.trim() || DEFAULT_REASON[alert2.trigger]
      }
    };
  }
  async send(alert2) {
    const team = teamForTrigger(alert2.trigger);
    const maskedOrder = this.maskOrder(alert2.orderNumber);
    if (!this.enabled) {
      logger2.info(`alert suppressed: feature disabled (team=${team}, order=${maskedOrder})`);
      return { sent: false, disabled: true, team };
    }
    const key = this.dedupKey(alert2);
    const nowMs = this.now();
    this.purge(nowMs);
    if (this.seen.has(key)) {
      logger2.info(`alert deduped (team=${team}, order=${maskedOrder})`);
      return { sent: false, deduped: true, team };
    }
    if (this.sentTimestamps.length >= this.maxPerHour) {
      logger2.warn(`alert rate-limited: ${this.maxPerHour}/hour reached (team=${team}, order=${maskedOrder})`);
      return { sent: false, rateLimited: true, team };
    }
    this.seen.set(key, nowMs + this.dedupTtlMs);
    this.sentTimestamps.push(nowMs);
    try {
      await this.transport.send(this.compose(alert2));
    } catch (err) {
      logger2.error(`alert send failed via ${this.transport.name} (team=${team}, order=${maskedOrder})`, err);
      return { sent: false, error: err instanceof Error ? err.message : String(err), team };
    }
    logger2.info(`alert sent via ${this.transport.name} (team=${team}, order=${maskedOrder})`);
    return { sent: true, team };
  }
  dedupKey(alert2) {
    const scope = alert2.conversationId?.trim() || `${alert2.orderNumber.trim()}|${alert2.customerEmail.trim().toLowerCase()}`;
    return `${alert2.trigger}:${scope}`;
  }
  purge(nowMs) {
    for (const [k, expiry] of this.seen) {
      if (expiry <= nowMs) this.seen.delete(k);
    }
    const cutoff = nowMs - 36e5;
    this.sentTimestamps = this.sentTimestamps.filter((t) => t > cutoff);
  }
  maskOrder(order) {
    const s = String(order ?? "").trim();
    return s.length > 3 ? `***${s.slice(-3)}` : "***";
  }
};

// scripts/alert-smoke.src.ts
var argv = process.argv.slice(2);
var DRY = argv.includes("--dry");
var caseFlagIdx = argv.indexOf("--case");
var ONLY = "";
var caseArgError = "";
if (caseFlagIdx >= 0) {
  const val = argv[caseFlagIdx + 1];
  if (!val || val.startsWith("--")) {
    caseArgError = "Flag --case requires a case id, e.g. --case L1 (refusing to run all cases).";
  } else {
    ONLY = val.toUpperCase();
  }
}
function svc(overrides = {}) {
  return new InternalAlertService({
    ...overrides,
    ...DRY ? { transport: new LogAlertTransport() } : {}
  });
}
function alert(trigger, f) {
  return {
    trigger,
    customerName: f.customerName,
    customerEmail: f.customerEmail,
    orderNumber: f.orderNumber,
    reason: `alert-smoke ${trigger}`,
    conversationId: f.conversationId
  };
}
var CASES = [
  {
    id: "L1",
    title: "not_found \u2192 CS (live send)",
    run: async () => {
      const r = await svc().send(alert("not_found", { customerName: "Smoke L1", orderNumber: "90000001", customerEmail: "smoke.l1@example.com", conversationId: "smoke-L1" }));
      return { results: [r], expect: "sent=true, team=CS", pass: r.sent === true && r.team === "CS" };
    }
  },
  {
    id: "L2",
    title: "queued_chasing \u2192 WH (live send)",
    run: async () => {
      const r = await svc().send(alert("queued_chasing", { customerName: "Smoke L2", orderNumber: "90000002", customerEmail: "smoke.l2@example.com", conversationId: "smoke-L2" }));
      return { results: [r], expect: "sent=true, team=WH", pass: r.sent === true && r.team === "WH" };
    }
  },
  {
    id: "L3",
    title: "wont_wait \u2192 CS (live send)",
    run: async () => {
      const r = await svc().send(alert("wont_wait", { customerName: "Smoke L3", orderNumber: "90000003", customerEmail: "smoke.l3@example.com", conversationId: "smoke-L3" }));
      return { results: [r], expect: "sent=true, team=CS", pass: r.sent === true && r.team === "CS" };
    }
  },
  {
    id: "L4",
    title: 'null customer name \u2192 subject "(Unknown)" (live send)',
    run: async () => {
      const s = svc();
      const a = alert("not_found", { customerName: null, orderNumber: "90000004", customerEmail: "smoke.l4@example.com", conversationId: "smoke-L4" });
      const subject = s.buildSubject(a);
      const r = await s.send(a);
      const unknown = subject.includes("_(Unknown)");
      return { results: [r], expect: "sent=true, subject ends _(Unknown)", pass: r.sent === true && unknown, extra: `subject="${subject}"` };
    }
  },
  {
    id: "L5",
    title: "dedup by order+email (send twice)",
    run: async () => {
      const s = svc();
      const a = alert("not_found", { customerName: "Smoke L5", orderNumber: "90000005", customerEmail: "smoke.l5@example.com" });
      const r1 = await s.send(a);
      const r2 = await s.send(a);
      return { results: [r1, r2], expect: "[sent, deduped]", pass: r1.sent === true && r2.deduped === true };
    }
  },
  {
    id: "L6",
    title: "dedup by conversationId (different orders)",
    run: async () => {
      const s = svc();
      const r1 = await s.send(alert("not_found", { customerName: "Smoke L6", orderNumber: "90000061", customerEmail: "smoke.l6a@example.com", conversationId: "smoke-L6" }));
      const r2 = await s.send(alert("not_found", { customerName: "Smoke L6", orderNumber: "90000062", customerEmail: "smoke.l6b@example.com", conversationId: "smoke-L6" }));
      return { results: [r1, r2], expect: "[sent, deduped]", pass: r1.sent === true && r2.deduped === true };
    }
  },
  {
    id: "L7",
    title: "rate-limit (maxPerHour forced to 1)",
    run: async () => {
      const s = svc({ maxPerHour: 1 });
      const r1 = await s.send(alert("not_found", { customerName: "Smoke L7", orderNumber: "90000071", customerEmail: "smoke.l7a@example.com", conversationId: "smoke-L7a" }));
      const r2 = await s.send(alert("not_found", { customerName: "Smoke L7", orderNumber: "90000072", customerEmail: "smoke.l7b@example.com", conversationId: "smoke-L7b" }));
      return { results: [r1, r2], expect: "[sent, rateLimited]", pass: r1.sent === true && r2.rateLimited === true };
    }
  },
  {
    id: "L8",
    title: "disabled (ALERTS_ENABLED forced off) \u2192 no send",
    run: async () => {
      const r = await svc({ enabled: false }).send(alert("not_found", { customerName: "Smoke L8", orderNumber: "90000008", customerEmail: "smoke.l8@example.com", conversationId: "smoke-L8" }));
      return { results: [r], expect: "disabled=true, sent=false", pass: r.disabled === true && r.sent === false };
    }
  },
  {
    id: "L9",
    title: "collection_refused \u2192 CS (live send)",
    run: async () => {
      const r = await svc().send(alert("collection_refused", { customerName: "Smoke L9", orderNumber: "90000009", customerEmail: "smoke.l9@example.com", conversationId: "smoke-L9" }));
      return { results: [r], expect: "sent=true, team=CS", pass: r.sent === true && r.team === "CS" };
    }
  },
  {
    id: "L10",
    title: "duplicate_consignments \u2192 CS (live send)",
    run: async () => {
      const r = await svc().send(alert("duplicate_consignments", { customerName: "Smoke L10", orderNumber: "90000010", customerEmail: "smoke.l10@example.com", conversationId: "smoke-L10" }));
      return { results: [r], expect: "sent=true, team=CS", pass: r.sent === true && r.team === "CS" };
    }
  }
];
async function main() {
  const a = settings.alerts;
  const transportName = DRY ? "log (--dry)" : a.transport;
  console.log("\u2500\u2500 alert-smoke \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  console.log(`mode:       ${DRY ? "DRY (no emails)" : "LIVE"}`);
  console.log(`transport:  ${transportName}`);
  console.log(`enabled:    ${a.enabled}${a.enabled ? "" : "   \u26A0\uFE0F ALERTS_ENABLED is off \u2014 live send cases will report disabled=true"}`);
  console.log(`to:         ${a.toAddress}`);
  console.log(`webhook:    ${a.webhook.url}`);
  console.log(`secret set: ${a.webhook.secret ? "yes" : "NO  \u26A0\uFE0F webhook fails closed without ALERTS_WEBHOOK_SECRET"}`);
  if (ONLY) console.log(`case:       ${ONLY}`);
  console.log("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  if (caseArgError) {
    console.error(caseArgError);
    process.exitCode = 2;
    return;
  }
  const selected = ONLY ? CASES.filter((c) => c.id === ONLY) : CASES;
  if (ONLY && selected.length === 0) {
    console.error(`Unknown --case "${ONLY}". Valid: ${CASES.map((c) => c.id).join(", ")}`);
    process.exitCode = 2;
    return;
  }
  let failures = 0;
  for (const c of selected) {
    let res;
    try {
      res = await c.run();
    } catch (err) {
      failures++;
      console.log(`
[${c.id}] ${c.title}`);
      console.log(`  THREW: ${err instanceof Error ? err.message : String(err)}`);
      console.log(`  [FAIL] expected ${"(no throw)"} `);
      continue;
    }
    const tag = res.pass ? "PASS" : "FAIL";
    if (!res.pass) failures++;
    console.log(`
[${c.id}] ${c.title}`);
    res.results.forEach((r, i) => console.log(`  result[${i}]: ${JSON.stringify(r)}`));
    if (res.extra) console.log(`  ${res.extra}`);
    console.log(`  [${tag}] expected: ${res.expect}`);
  }
  console.log(`
${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}  (${selected.length} case(s) run${DRY ? ", dry" : ", LIVE"})`);
  process.exitCode = failures === 0 ? 0 : 1;
}
main().catch((e) => {
  console.error("alert-smoke crashed:", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
