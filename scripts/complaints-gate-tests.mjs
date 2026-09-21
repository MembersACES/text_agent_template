// lib/services/chat/ComplaintsResponseGate.ts
var CREDIT_REQUEST_FORM_URL = "https://forms.zohopublic.com/admin2553/form/ReturnsCreditForm/formperma/awlhYFHJMB1C-LHd-qUCX5ZbrW9q1OLQL1t_g-7T48Q";
var SUPPORT_CHANNELS = "Honest to Goodness support by phone, email, or the web forms on our website";
var NO_RESULTS_PHRASING = /couldn't find an article|could not find an article|no article|knowledge base lacks|kb lacks|not find.*help center|don't have the answer|do not have the answer|one of my colleagues|i cannot assist/i;
var GROUP_GOODNESS = /\b(group goodness|buying group|group member|group admin|group order|group cart)\b/i;
var SCENARIO_PATTERNS = [
  {
    scenario: "existing_claim_followup",
    pattern: /follow[\s-]?up.*(credit|claim|return)|status of.*(credit|claim)|(?:already )?submitted?.*(credit|claim)|existing (credit|claim)/i
  },
  { scenario: "damaged", pattern: /\b(damaged|broken|crushed|leaking|arrived damaged)\b/i },
  { scenario: "missing_item", pattern: /\b(missing item|item missing|not in (?:my|the) order|short(?:age)?|didn't receive)\b/i },
  { scenario: "wrong_item", pattern: /\b(wrong item|incorrect item|received the wrong|sent the wrong)\b/i },
  {
    scenario: "wrong_price",
    pattern: /\b(wrong price|overcharged|undercharged|charged (?:the )?wrong|incorrect (?:charge|amount|price)|billing (?:error|issue))\b/i
  },
  // Product-quality complaints. Added 21 Sep 2026 (Iri): taste, texture, mould,
  // quality, infestation and incorrect weight were all falling through to the KB
  // and getting "I couldn't find an article". Live examples he sent:
  // "the dried sultana I got in my last order tastes awful" and
  // "you send me mouldy passata".
  {
    scenario: "quality_complaint",
    pattern: /\b(taste[sd]?|tasting|flavour|flavor|smell[sd]?|smelt|smelling|texture|soggy|stale|rancid|off|mould|mold|mouldy|moldy|rotten|rotting|spoiled|spoilt|gone bad|out of date|expired|use by|quality|poor quality|bad quality|infest\w*|weevil\w*|bug[s]?|insect[s]?|larvae|maggot[s]?|worm[s]?|underweight|short ?weight|incorrect weight|wrong weight|light on weight|not the (?:right|correct) weight)\b/i
  },
  {
    scenario: "generic_complaint",
    pattern: /\b(return|refund|credit request|complaint|faulty|problem with my order)\b/i
  }
];
var ComplaintsResponseGate = class {
  static matches(message) {
    return this.classify(message) !== null;
  }
  static classify(message, _history = []) {
    for (const { scenario, pattern } of SCENARIO_PATTERNS) {
      if (pattern.test(message)) return scenario;
    }
    return null;
  }
  /** Retail Contact & FAQs complaints — prefer portal 1 unless Group Goodness is mentioned. */
  static prefersRetailPortal(message) {
    if (GROUP_GOODNESS.test(message)) return false;
    return this.matches(message);
  }
  static isNoResultsPhrasing(response) {
    return NO_RESULTS_PHRASING.test(response);
  }
  /**
   * User replied with order/email after we already handed off an existing-claim follow-up.
   * We still cannot look up status — acknowledge and redirect to support with those details.
   */
  static isExistingClaimDetailsReply(message, history) {
    if (!this.assistantGaveExistingClaimHandoff(history)) return false;
    return /\b(order|invoice|#?\d{4,})\b/i.test(message) || /@/.test(message);
  }
  static buildExistingClaimDetailsReply() {
    return [
      "Thanks \u2014 I've noted you have your order details to hand.",
      "",
      `I still can't look up claim status from here. Please pass your order number and email to ${SUPPORT_CHANNELS} so they can check your existing claim.`
    ].join("\n");
  }
  static buildFallbackResponse(message, history = []) {
    const scenario = this.classify(message, history);
    if (!scenario) return null;
    switch (scenario) {
      case "existing_claim_followup":
        return this.buildExistingClaimResponse();
      case "damaged":
        return this.buildDamagedResponse();
      case "missing_item":
        return this.buildMissingItemResponse();
      case "wrong_item":
        return this.buildWrongItemResponse();
      case "wrong_price":
        return this.buildWrongPriceResponse();
      case "quality_complaint":
        return this.buildQualityComplaintResponse();
      case "generic_complaint":
        return this.buildGenericComplaintResponse();
      default:
        return null;
    }
  }
  static assistantGaveExistingClaimHandoff(history) {
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      if (msg.role !== "assistant") continue;
      const text = String(msg.content ?? "");
      return text.includes("can't check the status of an existing claim");
    }
    return false;
  }
  static buildExistingClaimResponse() {
    return [
      "I understand you'd like to follow up on a credit request you've already submitted.",
      "",
      `I can't check the status of an existing claim from here. For an update, please contact ${SUPPORT_CHANNELS}.`,
      "",
      "When you get in touch, have your order number and the email address used on the order ready \u2014 that will help the team find your claim faster."
    ].join("\n");
  }
  static buildDamagedResponse() {
    return [
      "I'm so sorry to hear your item arrived damaged.",
      "",
      "Please fill in our credit request form to enable us to investigate and rectify the issue. The link to the form is here:",
      "",
      CREDIT_REQUEST_FORM_URL,
      "",
      // CONFIRMED (Iri, 21 Sep 2026), including the change from 7 business days
      // to 3 to 4 days. His wording, not a paraphrase.
      "Please make sure to include clear photos of the damage and the packaging. All damage claims have to be made within 2 days of receipt. Processing usually takes around 3 to 4 days once all the information is submitted."
    ].join("\n");
  }
  static buildMissingItemResponse() {
    return [
      "I'm sorry to hear there's a missing item in your order.",
      "",
      "You can report this using our official credit request form:",
      "",
      CREDIT_REQUEST_FORM_URL,
      "",
      "Before submitting, please check your invoice and whether the order may have been sent in split deliveries. Include your order number and the missing item details in the form. Processing is typically within about 7 business days once we have the required information."
    ].join("\n");
  }
  static buildWrongItemResponse() {
    return [
      "I'm sorry to hear you received the wrong item.",
      "",
      "You can submit a credit request using our official form:",
      "",
      CREDIT_REQUEST_FORM_URL,
      "",
      "Please include your order number, the item you received, and what you ordered. Processing is typically within about 7 business days once we have the required information."
    ].join("\n");
  }
  static buildWrongPriceResponse() {
    return [
      "I'm sorry to hear you were charged the wrong price.",
      "",
      "You can report a billing or pricing issue using our official credit request form:",
      "",
      CREDIT_REQUEST_FORM_URL,
      "",
      "Please include your order number, what you were charged, and what you expected to pay. Our team will review your submission \u2014 processing is typically within about 7 business days."
    ].join("\n");
  }
  /** CONFIRMED wording (Iri, 21 Sep 2026). Deliberately does NOT quote the 2-day
   *  damage window or the 3-to-4-day processing time: those are the damage policy,
   *  and Iri asked for a 48-hour response commitment on quality complaints instead. */
  static buildQualityComplaintResponse() {
    return [
      "I'm so sorry to hear that.",
      "",
      "Please fill in our credit request form to help us investigate the issue. The link to the form is here:",
      "",
      CREDIT_REQUEST_FORM_URL,
      "",
      "Please make sure to include any relevant photos. We will get back to you within 48 hours."
    ].join("\n");
  }
  static buildGenericComplaintResponse() {
    return [
      "I'm sorry to hear you're having an issue with your order.",
      "",
      "For a new credit or returns request, please use our official form:",
      "",
      CREDIT_REQUEST_FORM_URL,
      "",
      `If you need help with an existing claim, please contact ${SUPPORT_CHANNELS} with your order number and email address.`
    ].join("\n");
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
  // No MachShip consignment yet, so nothing has been booked and there is no
  // tracking link to give. Genuinely still in the packing queue.
  preparing: "Your order is being prepared for dispatch. We'll have tracking for you once it leaves our warehouse.",
  // CONFIRMED (Iri, 18 Sep 2026). A consignment EXISTS and MachShip has already
  // issued a tracking link, but nothing has moved yet. The old `preparing` line was
  // used here too, which told the customer there was no tracking and then printed a
  // tracking link underneath it. Only use this where a link is actually shown.
  awaitingCarrierCollection: "Your order has been completed and awaiting carrier collection. Your tracking link will start updating once it leaves our warehouse.",
  // Same situation but MachShip gave us no tracking token, so no link is rendered.
  awaitingCarrierCollectionNoLink: "Your order has been completed and is awaiting carrier collection.",
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
        verifiedVia,
        this.recipientNameOf(cons)
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
    const etaStale = this.isStaleEta(eta);
    const etaSuffix = eta && !etaStale ? `, expected ${this.dateOnly(eta)}` : "";
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
      message = boxes.some((b) => b.trackingUrl) ? DRAFT_COPY.awaitingCarrierCollection : DRAFT_COPY.awaitingCarrierCollectionNoLink;
    } else {
      state = "unknown";
      message = DRAFT_COPY.unknownStatus;
    }
    const showEtaDisclaimer = Boolean(eta) && !etaStale && (state === "partly_delivered" || state === "in_transit" || state === "delayed");
    const fullMessage = showEtaDisclaimer ? `${message} ${ETA_DISCLAIMER}` : message;
    const diagnostics = [];
    if (dateUnknown) diagnostics.push("consignment date unreadable \u2014 60-day gate NOT enforced (date field name unconfirmed)");
    if (totalItems > total) diagnostics.push(`items (${totalItems}) exceed consignments (${total}) \u2014 showing carton count ${boxCount} to the customer (confirmed 18 Aug 2026); delivery status remains per-consignment`);
    if (etaStale) diagnostics.push(`ETA ${String(eta).split("T")[0]} is in the past \u2014 clause and disclaimer suppressed; MachShip has not refreshed it`);
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
      recipientName: this.recipientNameOf(cons),
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
  /** Today's date as YYYY-MM-DD in Australia/Sydney. Judged against the operating
   *  day of the freight rather than Cloud Run's UTC clock, which would call an ETA
   *  stale up to ten hours early. */
  todayInAu() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Australia/Sydney",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(/* @__PURE__ */ new Date());
  }
  /** True when the ETA's calendar date is before today. Same-day is NOT stale: the
   *  parcel may still arrive. Unparseable dates are never treated as stale. */
  isStaleEta(iso) {
    if (!iso) return false;
    const datePart = String(iso).split("T")[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return false;
    return datePart < this.todayInAu();
  }
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
  /** First non-empty recipient name across consignments, or null. */
  recipientNameOf(cons) {
    for (const c of cons) {
      const n = String(c.toName ?? "").trim();
      if (n) return n;
    }
    return null;
  }
  simple(state, message, provider, diagnostic, verifiedVia = null, recipientName = null) {
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
      recipientName,
      diagnostic
    };
  }
};

// lib/services/alerts/transports.ts
var logger5 = getLogger("AlertTransport");
var LogAlertTransport = class {
  constructor() {
    this.name = "log";
  }
  async send(message) {
    logger5.warn(`LogAlertTransport: would send an alert to ${message.to} (content withheld \u2014 contains PII). No email sent.`);
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
      logger5.warn("ALERTS_TRANSPORT=webhook but ALERTS_WEBHOOK_URL is empty \u2014 using LogAlertTransport (no alerts sent).");
      return new LogAlertTransport();
    case "smtp":
      if (cfg.smtp.host && cfg.smtp.user && cfg.smtp.pass) return new SmtpAlertTransport(cfg.smtp);
      logger5.warn("ALERTS_TRANSPORT=smtp but SMTP is not fully configured \u2014 using LogAlertTransport (no alerts sent).");
      return new LogAlertTransport();
    case "log":
      return new LogAlertTransport();
    default:
      logger5.warn(`Unknown ALERTS_TRANSPORT="${cfg.transport}" \u2014 using LogAlertTransport (no alerts sent).`);
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
var logger6 = getLogger("InternalAlertService");
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
  buildSubject(alert) {
    const team = teamForTrigger(alert.trigger);
    const name = alert.customerName?.trim() || "(Unknown)";
    return `H2G AI ALERT_${team}_${name}`;
  }
  buildBody(alert) {
    return [
      `Customer Name: ${alert.customerName?.trim() || "(Unknown)"}`,
      `Email Address: ${alert.customerEmail.trim()}`,
      `Order Number: ${alert.orderNumber.trim()}`,
      `Reason: ${alert.reason?.trim() || DEFAULT_REASON[alert.trigger]}`
    ].join("\n");
  }
  compose(alert) {
    return {
      from: this.fromAddress,
      to: this.toAddress,
      subject: this.buildSubject(alert),
      body: this.buildBody(alert),
      // Structured fields for the webhook transport (n8n builds its own
      // subject/body from these). Email transports use subject/body above.
      payload: {
        team: teamForTrigger(alert.trigger),
        customerName: alert.customerName?.trim() || null,
        orderNumber: alert.orderNumber.trim(),
        customerEmail: alert.customerEmail.trim(),
        reason: alert.reason?.trim() || DEFAULT_REASON[alert.trigger]
      }
    };
  }
  async send(alert) {
    const team = teamForTrigger(alert.trigger);
    const maskedOrder = this.maskOrder(alert.orderNumber);
    if (!this.enabled) {
      logger6.info(`alert suppressed: feature disabled (team=${team}, order=${maskedOrder})`);
      return { sent: false, disabled: true, team };
    }
    const key = this.dedupKey(alert);
    const nowMs = this.now();
    this.purge(nowMs);
    if (this.seen.has(key)) {
      logger6.info(`alert deduped (team=${team}, order=${maskedOrder})`);
      return { sent: false, deduped: true, team };
    }
    if (this.sentTimestamps.length >= this.maxPerHour) {
      logger6.warn(`alert rate-limited: ${this.maxPerHour}/hour reached (team=${team}, order=${maskedOrder})`);
      return { sent: false, rateLimited: true, team };
    }
    this.seen.set(key, nowMs + this.dedupTtlMs);
    this.sentTimestamps.push(nowMs);
    try {
      await this.transport.send(this.compose(alert));
    } catch (err) {
      logger6.error(`alert send failed via ${this.transport.name} (team=${team}, order=${maskedOrder})`, err);
      return { sent: false, error: err instanceof Error ? err.message : String(err), team };
    }
    logger6.info(`alert sent via ${this.transport.name} (team=${team}, order=${maskedOrder})`);
    return { sent: true, team };
  }
  dedupKey(alert) {
    const scope = alert.conversationId?.trim() || `${alert.orderNumber.trim()}|${alert.customerEmail.trim().toLowerCase()}`;
    return `${alert.trigger}:${scope}`;
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

// lib/services/chat/OrderStatusGate.ts
var logger7 = getLogger("OrderStatusGate");
var ORDER_STATUS_PAGE = "https://goodness.com.au/order-status/";
var SUPPORT_CHANNELS2 = "Honest to Goodness support by phone, email, or the web forms on our website";
var STUCK_PACKING_INTENT = /\b(in queue for packing|queue for packing|stuck in packing|still (?:in )?(?:queue|packing)|packing for (?:more than )?\d+|\d+\s*(?:business\s*)?days?.*(?:packing|packed|shipped|dispatch)|not shipped|hasn't shipped|has not shipped)\b/i;
var EXTENDED_DELAY_INTENT = /\b(more than|over|past|at least|for)\s*(?:two|2|three|3|four|4|five|5|\d+)\s*(?:business\s*)?days?\b/i;
var FALSE_ESCALATION_PROMISE = /\b(I will|I'll|we will|I can)\s+(?:then\s+)?(?:escalat|raise|log|create).*(?:ticket|case|support team)/i;
var TRACKING_VERB = /\b(track|tracking|where(?:'?s| is| are)?|status|arriv\w*|deliver(?:ed|y)?|dispatch\w*|shipp\w*|coming|on its way|check|checking|look ?up|looking up|find|chase|chasing|follow(?:ing)? ?up|update|progress|received|receive|eta|when will)\b/i;
var ORDER_NOUN = /\b(order|parcel|package|shipment|consignment|#?\d{6,8})\b/i;
var CONDITION_COMPLAINT = /\b(damaged|broken|crushed|leaking|smashed|mouldy|moldy|mould|mold|rotten|rotting|spoiled|spoilt|stale|rancid|soggy|expired|out of date|use by|taste[sd]?|tasting|flavour|flavor|smell[sd]?|smelt|smelling|texture|quality|infest\w*|weevil\w*|larvae|maggot[s]?|underweight|short ?weight|incorrect weight|wrong weight|wrong item|incorrect item|received the wrong|sent the wrong|missing item|item missing|short ?shipped|faulty|not in (?:my|the) order)\b/i;
var ORDER_CHANGE_REQUEST = /\b(cancel (?:my|the|this|that) order|cancel order|change (?:the |my )?(?:delivery |shipping |postal |street |home )?address|change (?:the |my )?(?:delivery |dispatch )?(?:date|day)|update (?:the |my )?(?:delivery |shipping |postal )?address|add (?:an? |another )?item|remove (?:an? )?item|amend (?:my |the )?order|tax invoice|invoice|receipt|reschedule|redirect (?:my |the )?(?:order|parcel|delivery))\b/i;
var EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
var ORDER_NUM_RE = /\b(?:BC-?)?(?:SO)?\d{6,8}\b/i;
var EMAIL_RE_G = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
var ORDER_NUM_RE_G = /\b(?:BC-?)?(?:SO)?\d{6,8}\b/gi;
var BARE_DETAILS_FILLER = /\b(order|orders|number|numbers|no|num|ref|reference|email|e-?mail|address|my|is|are|was|it|its|it's|for|the|a|an|and|with|on|of|to|placed|under|please|thanks|thank|you|hi|hello|hey|details|here|below|see|this|that)\b/gi;
var ASK_DETAILS_MARKER = "your order number and the email";
var DETAILS_LOOKBACK = 6;
var TRACKING_FOLLOWUP_INTENT = /\b(still (?:hasn'?t|has not|have not|haven'?t|not) (?:arrived|come|turned up|shown up|been delivered|been received)|(?:hasn'?t|has not|haven'?t|have not|didn'?t|did not|never) (?:arrived|turned up|shown up|been delivered)|not arrived|nothing (?:has )?arrived|no sign of (?:it|them|my order|the order)|where is it now|any update|any news|update on (?:my|the) order|still waiting|not here yet|not (?:yet )?received|still nothing|nothing yet)\b/i;
var NOT_FOUND_RECONFIRM = "double-check the order number and the email";
var COLLECTION_MARKER = "post office or collection point";
var CREDIT_FORM_MARKER = "forms.zohopublic.com";
var COLLECTION_REFUSED_INTENT = /\b(can'?t collect|cannot collect|can'?t pick|cannot pick|won'?t collect|not able to collect|unable to collect|can'?t get (?:there|to)|too far|no ?one (?:can|to) collect|don'?t drive|no transport|can'?t make it)\b/i;
var WONT_WAIT_MARKER = "prefer not to wait for the rest";
var WONT_WAIT_MARKER_SENTENCE = "If you'd prefer not to wait for the rest, just let us know and we'll help sort it out.";
var WONT_WAIT_INTENT = /\b(don'?t want to wait|do not want to wait|can'?t wait|cancel the rest|cancel the remaining|just refund|refund the rest|forget the rest|don'?t need the rest|too long)\b/i;
var OrderStatusGate = class _OrderStatusGate {
  static {
    // ═════════════════════ NEW: live order tracking ═════════════════════════
    /**
     * Process-scoped alert service used when no `alerts` is injected. Constructed
     * ONCE and reused across turns so the in-memory dedup (`seen`) and hourly cap
     * (`sentTimestamps`) persist within a Cloud Run instance — a per-turn `new`
     * would reset them and defeat per-conversation dedup. (Per-instance, like the
     * chat rate-limiter; a strictly-global cap needs the shared store noted in
     * API-Hardening-Plan.md.) Public so tests can assert the singleton is stable.
     */
    this.sharedAlerts = null;
  }
  static defaultAlertService() {
    return this.sharedAlerts ??= new InternalAlertService();
  }
  /** Exposes CONDITION_COMPLAINT so complaints-gate-tests can assert that this
   *  list and ComplaintsResponseGate's patterns stay in step. Test-only; nothing
   *  in the request path calls it. */
  static conditionComplaintForTests(message) {
    return CONDITION_COMPLAINT.test(message);
  }
  /** Broad order-tracking / "where is my order" intent. */
  static wantsOrderTracking(message) {
    return TRACKING_VERB.test(message) && ORDER_NOUN.test(message);
  }
  /** True when the customer is replying to our request for order number + email. */
  static isOrderDetailsReply(message, history) {
    if (!this.assistantAskedForOrderDetails(history)) return false;
    return EMAIL_RE.test(message) || ORDER_NUM_RE.test(message);
  }
  /**
   * True when the message is NOTHING BUT order details — an order number, an email
   * and filler ("Order 359633, email x@y.com"). Such a message is a tracking
   * question by construction: nobody volunteers both an order number and the email
   * on the order for any other reason. Deliberately residue-based rather than
   * "has order + email", so a message that carries the details AND a different ask
   * ("cancel order 359633, email x@y.com", "change the address on order 359633...")
   * leaves a residue, fails this test, and still falls through to the KB path
   * instead of being answered with a delivery status.
   */
  /** True when our own most recent reply was a credit/returns form answer. */
  static lastAssistantOfferedCreditForm(history) {
    for (let i = history.length - 1; i >= 0; i--) {
      const m = history[i];
      if (m.role !== "assistant") continue;
      return String(m.content ?? "").includes(CREDIT_FORM_MARKER);
    }
    return false;
  }
  static isBareOrderDetails(message) {
    const residue = String(message ?? "").replace(EMAIL_RE_G, " ").replace(ORDER_NUM_RE_G, " ").replace(BARE_DETAILS_FILLER, " ").replace(/[^a-z0-9]+/gi, " ").trim();
    return residue.length === 0;
  }
  /**
   * The tracking entry point. Returns a customer-facing response string, or null
   * when this gate should not handle the turn (so the caller falls through to
   * the KB / deflection path).
   *
   * Dark until `settings.freight.trackingEnabled`. `service` and `alerts` are
   * injectable for tests. Internal CS/WH alerts fire as a SIDE-EFFECT of a
   * tracking turn — only when tracking is live (this returns early otherwise)
   * and only when `ALERTS_ENABLED` is on (the alert service gates that itself).
   * An alert send is always awaited (Cloud Run may freeze the instance after the
   * response flushes) and always wrapped so a throw NEVER changes or blocks the
   * customer-facing answer.
   */
  static async handleOrderTracking(message, history = [], service, alerts, conversationId) {
    if (!settings.freight.trackingEnabled) return null;
    const current = this.extractOrderAndEmail(message);
    const hasFreshDetails = Boolean(current.order && current.email);
    const isBareDetails = hasFreshDetails && this.isBareOrderDetails(message) && !this.lastAssistantOfferedCreditForm(history);
    const isBareOrderNumberOnly = Boolean(current.order) && !current.email && this.isBareOrderDetails(message) && !this.lastAssistantOfferedCreditForm(history);
    const isDetailsReply = this.assistantAskedForOrderDetails(history);
    const isReconfirmReply = this.assistantAskedReconfirm(history);
    const isWontWaitFollowup = !hasFreshDetails && this.assistantRenderedPartlyDelivered(history) && WONT_WAIT_INTENT.test(message);
    const isTrackingFollowup = !hasFreshDetails && TRACKING_FOLLOWUP_INTENT.test(message) && this.hasPriorOrderDetails(history);
    const isCollectionRefusalFollowup = !hasFreshDetails && this.assistantRenderedCollection(history) && COLLECTION_REFUSED_INTENT.test(message);
    if (!this.wantsOrderTracking(message) && !isBareDetails && !isBareOrderNumberOnly && !isDetailsReply && !isReconfirmReply && !isWontWaitFollowup && !isCollectionRefusalFollowup && !isTrackingFollowup) {
      return null;
    }
    const isEscalationFollowup = isWontWaitFollowup || isCollectionRefusalFollowup;
    if (!isEscalationFollowup && CONDITION_COMPLAINT.test(message)) return null;
    if (!isEscalationFollowup && ORDER_CHANGE_REQUEST.test(message)) return null;
    const alertSvc = alerts ?? _OrderStatusGate.defaultAlertService();
    if (isCollectionRefusalFollowup) {
      const prior = this.extractAttemptBeforeMarker(history, COLLECTION_MARKER);
      if (prior.order && prior.email) {
        const name = await this.recipientNameFor(prior.order, prior.email, service);
        await this.fireAlertSafely(
          alertSvc,
          this.buildAlert("collection_refused", prior.order, prior.email, conversationId, name)
        );
      }
      return DRAFT_COPY.collectionRefused;
    }
    if (isWontWaitFollowup) {
      const prior = this.extractAttemptBeforeMarker(history, WONT_WAIT_MARKER);
      if (prior.order && prior.email) {
        const name = await this.recipientNameFor(prior.order, prior.email, service);
        await this.fireAlertSafely(
          alertSvc,
          this.buildAlert("wont_wait", prior.order, prior.email, conversationId, name)
        );
        return this.buildEscalatedReply("wont_wait");
      }
      return `I understand you'd prefer not to wait for the rest. Please contact ${SUPPORT_CHANNELS2} and the team will sort it out.`;
    }
    const merged = isDetailsReply || isReconfirmReply || isTrackingFollowup ? this.mergeDetailsFromHistory(current, history) : current;
    const { order, email } = merged;
    if (!order || !email) {
      return this.buildAskForOrderDetails(order, email);
    }
    let result;
    try {
      const svc = service ?? new OrderTrackingService();
      result = await svc.track(order, email);
    } catch (err) {
      logger7.error("order tracking failed", err);
      return `I couldn't check that just now. Please try again shortly, or contact ${SUPPORT_CHANNELS2}.`;
    }
    logger7.info(`order tracking handled: state=${result.state}, verifiedVia=${result.verifiedVia ?? "n/a"}`);
    if (result.state === "multiple_consignments") {
      await this.fireAlertSafely(
        alertSvc,
        this.buildAlert("duplicate_consignments", order, email, conversationId, result.recipientName)
      );
      return result.message;
    }
    if (result.state === "preparing" && this.needsStuckPackingHandoff(message)) {
      await this.fireAlertSafely(
        alertSvc,
        this.buildAlert("queued_chasing", order, email, conversationId, result.recipientName)
      );
      return this.renderTracking(result);
    }
    if (result.state === "not_found") {
      if (isReconfirmReply) {
        const prior = this.extractAttemptBeforeMarker(history, NOT_FOUND_RECONFIRM);
        if (prior.order && prior.email && this.sameAttempt(order, email, prior.order, prior.email)) {
          await this.fireAlertSafely(alertSvc, this.buildAlert("not_found", order, email, conversationId));
          return this.buildEscalatedReply("not_found");
        }
      }
      return this.buildNotFoundReconfirm();
    }
    if (result.state === "partly_delivered") {
      return `${this.renderTracking(result)}

${WONT_WAIT_MARKER_SENTENCE}`;
    }
    return this.renderTracking(result);
  }
  // ── Alert plumbing ───────────────────────────────────────────────────────
  // customerName is NOT available in the gate (TrackingResult carries no
  // recipient name) → pass null so the subject reads "(Unknown)".
  // TODO: if TrackingResult ever exposes a recipient/customer name, thread it
  // here instead of null.
  // NOTE: the alert payload uses the REAL order + email on purpose — it must be
  // actionable in the CS/WH inbox. redactPII is a trace/log boundary concern and
  // is deliberately NOT applied on this path (the payload bypasses redaction).
  static buildAlert(trigger, order, email, conversationId, customerName = null) {
    return {
      trigger,
      // MachShip's consignment recipient name, carried through on
      // TrackingResult.recipientName. Fills the name slot in the alert subject
      // (`H2G AI ALERT_<TEAM>_<Name>`), which is what the Helpdesk routing rule
      // reads. Null is correct where there is no consignment to name — a
      // not_found alert is BY DEFINITION an order we could not find, so its
      // subject stays `(Unknown)`.
      customerName,
      customerEmail: email,
      orderNumber: order,
      reason: "",
      // empty → InternalAlertService fills DEFAULT_REASON[trigger]
      conversationId
    };
  }
  /** Send an alert, awaiting it, with any throw swallowed after logging so the
   *  customer answer is returned regardless. (InternalAlertService already turns
   *  transport errors into a result rather than throwing; this is belt-and-braces
   *  against an unexpected throw.) No PII is logged — trigger name only. */
  /**
   * Recipient name for an escalation that fires off a HISTORY marker rather than a
   * fresh lookup (wont_wait, collection_refused). Those branches deliberately do not
   * re-render a status, so they hold no TrackingResult. One extra lookup on a rare
   * escalation turn is worth a named alert in the Helpdesk. Never throws and never
   * blocks: any failure returns null and the alert goes out as `(Unknown)`.
   */
  static async recipientNameFor(order, email, service) {
    try {
      const svc = service ?? new OrderTrackingService();
      const r = await svc.track(order, email);
      return r.recipientName ?? null;
    } catch (err) {
      logger7.info("recipient name lookup for alert failed; alert will say (Unknown)");
      logger7.error("recipient name lookup error", err);
      return null;
    }
  }
  static async fireAlertSafely(alerts, alert) {
    try {
      const res = await alerts.send(alert);
      if (!res.sent) logger7.info(`alert not sent (trigger=${alert.trigger}, outcome=${res.disabled ? "disabled" : res.deduped ? "deduped" : res.rateLimited ? "rate-limited" : res.error ? "error" : "n/a"})`);
    } catch (err) {
      logger7.error(`alert send threw (trigger=${alert.trigger})`, err);
    }
  }
  /** Extract order+email from the user message immediately preceding the most
   *  recent assistant message containing `marker`. Used to recover the prior
   *  attempt's details for re-confirm matching and wont_wait escalation. */
  static extractAttemptBeforeMarker(history, marker) {
    for (let i = history.length - 1; i >= 0; i--) {
      const m = history[i];
      if (m.role === "assistant" && String(m.content ?? "").includes(marker)) {
        for (let j = i - 1; j >= 0; j--) {
          if (history[j].role === "user") {
            return this.extractOrderAndEmail(String(history[j].content ?? ""));
          }
        }
        break;
      }
    }
    return { order: null, email: null };
  }
  /**
   * Fill in whichever of order / email the current message is missing, using the
   * most recent USER message that carried it. Bounded to the last
   * DETAILS_LOOKBACK user messages so a long conversation cannot resurrect a
   * stale order number. Whatever the current message supplies always wins, so a
   * customer correcting one field is never overridden by the old value.
   */
  static mergeDetailsFromHistory(current, history) {
    let { order, email } = current;
    if (order && email) return { order, email };
    let seen = 0;
    for (let i = history.length - 1; i >= 0 && seen < DETAILS_LOOKBACK; i--) {
      const m = history[i];
      if (m.role !== "user") continue;
      seen++;
      const prev = this.extractOrderAndEmail(String(m.content ?? ""));
      if (!order && prev.order) order = prev.order;
      if (!email && prev.email) email = prev.email;
      if (order && email) break;
    }
    return { order, email };
  }
  /** True when some earlier USER message in this conversation carried BOTH an order
   *  number and an email, so a follow-up can be answered without asking again. */
  static hasPriorOrderDetails(history) {
    let order = null;
    let email = null;
    let seen = 0;
    for (let i = history.length - 1; i >= 0 && seen < DETAILS_LOOKBACK; i--) {
      const m = history[i];
      if (m.role !== "user") continue;
      seen++;
      const prev = this.extractOrderAndEmail(String(m.content ?? ""));
      if (!order && prev.order) order = prev.order;
      if (!email && prev.email) email = prev.email;
      if (order && email) return true;
    }
    return false;
  }
  /** Same order (digits-only) + same email (case-insensitive)? */
  static sameAttempt(o1, e1, o2, e2) {
    return o1.replace(/\D/g, "") === o2.replace(/\D/g, "") && e1.trim().toLowerCase() === e2.trim().toLowerCase();
  }
  /** LAST assistant message carries the not_found re-confirm marker. */
  static assistantAskedReconfirm(history) {
    for (let i = history.length - 1; i >= 0; i--) {
      const m = history[i];
      if (m.role !== "assistant") continue;
      return String(m.content ?? "").includes(NOT_FOUND_RECONFIRM);
    }
    return false;
  }
  /** ANY prior assistant message rendered a partly_delivered result. */
  static assistantRenderedCollection(history) {
    return history.some((m) => m.role === "assistant" && String(m.content ?? "").includes(COLLECTION_MARKER));
  }
  static assistantRenderedPartlyDelivered(history) {
    return history.some((m) => m.role === "assistant" && String(m.content ?? "").includes(WONT_WAIT_MARKER));
  }
  static buildNotFoundReconfirm() {
    return `I couldn't find an order matching those details. Could you ${NOT_FOUND_RECONFIRM} address used on the order, and send them through again? If they're correct, I'll pass it to our team to look into.`;
  }
  static buildEscalatedReply(trigger) {
    if (trigger === "wont_wait") {
      return "Thanks for letting us know. I've flagged this with our customer service team, who'll sort out the remaining part of your order and follow up with you.";
    }
    return "Thanks for confirming those details. I've flagged this with our customer service team, who'll look into it and follow up with you.";
  }
  /** Pull an order number and email out of free text. Email removed before the
   *  order-number scan so its digits aren't mistaken for an order number. */
  static extractOrderAndEmail(message) {
    const rawEmail = message.match(EMAIL_RE)?.[0] ?? null;
    const email = rawEmail ? rawEmail.replace(/[.,;:!?)\]]+$/, "") : null;
    const withoutEmail = rawEmail ? message.replace(rawEmail, " ") : message;
    const order = withoutEmail.match(ORDER_NUM_RE)?.[0] ?? null;
    return { order, email };
  }
  static buildAskForOrderDetails(order, email) {
    if (!order && !email) {
      return "Happy to help track your order. What's your order number and the email address used on the order?";
    }
    const missing = !order ? "order number" : "email address on the order";
    return `Thanks \u2014 I just need your ${missing} as well, then I can look it up. (Your order number and the email must match what's on the order.)`;
  }
  static renderTracking(result) {
    let out = result.message;
    const links = result.boxes.map((b) => b.trackingUrl).filter((u) => Boolean(u));
    if (links.length) {
      out += `

Track your ${links.length > 1 ? "boxes" : "parcel"}: ${links.join("   ")}`;
    }
    return out;
  }
  static assistantAskedForOrderDetails(history) {
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      if (msg.role !== "assistant") continue;
      return String(msg.content ?? "").toLowerCase().includes(ASK_DETAILS_MARKER);
    }
    return false;
  }
  // ═══════════════ EXISTING deflection (unchanged behaviour) ═══════════════
  // Retained verbatim so this file is a safe drop-in even with the flag off,
  // and so the post-KB false-escalation guard keeps working.
  /** "In queue for packing" with implied extended delay (e.g. 4 days). */
  static needsStuckPackingHandoff(message) {
    if (!STUCK_PACKING_INTENT.test(message)) return false;
    return EXTENDED_DELAY_INTENT.test(message) || /\b(extended|long time|still|hasn't moved|not moving)\b/i.test(message);
  }
  static isStuckPackingDetailsReply(message, history) {
    if (!this.assistantGaveStuckPackingHandoff(history)) return false;
    return /\b(order|invoice|#?\d{4,})\b/i.test(message) || /@/.test(message);
  }
  static promisesFalseEscalation(response) {
    return FALSE_ESCALATION_PROMISE.test(response);
  }
  static buildStuckPackingResponse() {
    return [
      "I'm sorry to hear your order has been in queue for packing longer than expected.",
      "",
      `I can't access live order statuses or create support tickets from here. Because it's been more than two business days, please contact ${SUPPORT_CHANNELS2} so the team can investigate.`,
      "",
      `Have your order number and the email used on the order ready when you get in touch. You can also check ${ORDER_STATUS_PAGE} with those details.`
    ].join("\n");
  }
  static buildStuckPackingDetailsReply() {
    return [
      "Thanks \u2014 I've noted you have your order details to hand.",
      "",
      `I still can't escalate or look up your order from here. Please contact ${SUPPORT_CHANNELS2} with your order number and email so they can investigate the delay.`
    ].join("\n");
  }
  static assistantGaveStuckPackingHandoff(history) {
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      if (msg.role !== "assistant") continue;
      const text = String(msg.content ?? "");
      return text.includes("can't access live order statuses") || text.includes("can't escalate or look up your order");
    }
    return false;
  }
};

// scripts/complaints-gate-tests.src.ts
var FORM = "forms.zohopublic.com";
var CASES = [
  // ── Iri's two live examples ─────────────────────────────────────────────
  {
    say: "the dried sultana I got in my last order tastes awful",
    scenario: "quality_complaint",
    replyHas: ["so sorry", FORM, "relevant photos", "48 hours"],
    replyLacks: ["article", "help cent", "2 days"],
    trackingStandsDown: true,
    because: `this exact message returned "I couldn't find an article" on the sandbox`
  },
  {
    say: "you send me mouldy passata",
    scenario: "quality_complaint",
    replyHas: ["so sorry", FORM, "48 hours"],
    replyLacks: ["article", "help cent"],
    trackingStandsDown: true,
    because: "Iri's second live example; mould was in the tracking stand-down list but had no answer behind it"
  },
  // ── The rest of the categories Iri listed ───────────────────────────────
  { say: "the texture of the tahini is completely wrong", scenario: "quality_complaint", replyHas: [FORM, "48 hours"], trackingStandsDown: true, because: "texture" },
  { say: "there are weevils in the flour", scenario: "quality_complaint", replyHas: [FORM, "48 hours"], trackingStandsDown: true, because: "infestation" },
  { say: "the bag is underweight, I got 800g not 1kg", scenario: "quality_complaint", replyHas: [FORM, "48 hours"], trackingStandsDown: true, because: "incorrect weight" },
  { say: "the quality of the cashews is poor this time", scenario: "quality_complaint", replyHas: [FORM, "48 hours"], trackingStandsDown: true, because: "quality" },
  { say: "the olive oil smells rancid", scenario: "quality_complaint", replyHas: [FORM, "48 hours"], trackingStandsDown: true, because: "smell and rancid" },
  // ── Damaged keeps its OWN wording, which is different ───────────────────
  {
    say: "the jar of coconut oil in my last order came broken",
    scenario: "damaged",
    replyHas: ["so sorry", FORM, "clear photos of the damage", "2 days of receipt", "3 to 4 days"],
    replyLacks: ["48 hours", "7 business days"],
    trackingStandsDown: true,
    because: "Iri changed the damage wording and the processing time from 7 business days to 3 to 4"
  },
  // ── The specific scenarios must still win over the new broad one ────────
  {
    say: "I received the wrong item in my order",
    scenario: "wrong_item",
    replyHas: [FORM, "what you ordered"],
    replyLacks: ["48 hours"],
    trackingStandsDown: true,
    because: "quality_complaint sits after the specific scenarios and must not swallow them"
  },
  {
    say: "there is a missing item in my order",
    scenario: "missing_item",
    replyHas: [FORM, "split deliveries"],
    trackingStandsDown: true,
    because: "same, for missing items"
  },
  {
    say: "I was charged the wrong price",
    scenario: "wrong_price",
    replyHas: [FORM, "what you were charged"],
    // NOT in CONDITION_COMPLAINT, and correctly so: a pricing dispute is not a
    // complaint about the condition of the goods. It never reaches the tracking
    // gate anyway, because "charged" is not a tracking verb, so wantsOrderTracking
    // is false. Asserted explicitly so nobody "fixes" this later by adding price
    // words to a list about mould and breakage.
    trackingStandsDown: false,
    because: "billing is a complaint but not a condition complaint, and the two lists should not be conflated"
  },
  // ── Must NOT fire ───────────────────────────────────────────────────────
  {
    say: "where is my order 10269854, email customer@example.com",
    scenario: null,
    trackingStandsDown: false,
    because: "an ordinary tracking question must still reach the tracking gate"
  },
  {
    say: "do you deliver to WA?",
    scenario: null,
    trackingStandsDown: false,
    because: "a delivery-policy question is not a complaint"
  },
  {
    say: "is your product kosher",
    scenario: null,
    trackingStandsDown: false,
    because: "a product question must reach the knowledge base, not the credit form"
  },
  {
    say: "what is the shelf life of your almonds",
    scenario: null,
    trackingStandsDown: false,
    because: "asking ABOUT shelf life is not reporting a spoiled product"
  }
];
(() => {
  let pass = 0, fail = 0;
  for (const c of CASES) {
    const notes = [];
    let ok = true;
    const scenario = ComplaintsResponseGate.classify(c.say);
    if (scenario !== c.scenario) {
      ok = false;
      notes.push(`expected scenario ${c.scenario}, got ${scenario}`);
    }
    if (ok && c.scenario) {
      const reply = ComplaintsResponseGate.buildFallbackResponse(c.say) ?? "";
      for (const want of c.replyHas ?? []) {
        if (!reply.toLowerCase().includes(want.toLowerCase())) {
          ok = false;
          notes.push(`reply missing "${want}"`);
        }
      }
      for (const avoid of c.replyLacks ?? []) {
        if (reply.toLowerCase().includes(avoid.toLowerCase())) {
          ok = false;
          notes.push(`reply should not contain "${avoid}"`);
        }
      }
    }
    const standsDown = OrderStatusGate.conditionComplaintForTests(c.say);
    if (standsDown !== c.trackingStandsDown) {
      ok = false;
      notes.push(`tracking stand-down expected ${c.trackingStandsDown}, got ${standsDown}`);
    }
    if (ok) pass++;
    else fail++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${JSON.stringify(c.say)}`);
    if (!ok) {
      for (const n of notes) console.log(`        ${n}`);
      console.log(`        why it matters: ${c.because}`);
    }
  }
  console.log(`
${pass} passed, ${fail} failed, ${CASES.length} total`);
  process.exit(fail ? 1 : 0);
})();
