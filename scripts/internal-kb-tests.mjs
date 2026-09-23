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
    oauthRedirectUri: envTrim(process.env.ZOHO_REDIRECT_URI),
    /**
     * Systems Support department: the agent-specific KB Iri built (Sep 2026).
     * Not published to any help centre, so it is read through the authenticated
     * Desk API and needs Desk.articles.READ on the token.
     * Empty disables the internal KB entirely and the public portals serve alone.
     */
    systemsSupportDepartmentId: envTrim(process.env.ZOHO_SS_DEPARTMENT_ID),
    /** Dark until true, so it can deploy ahead of being switched on. */
    internalKbEnabled: envTrim(process.env.INTERNAL_KB_ENABLED) === "true"
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

// lib/services/zoho/ZohoAuthService.ts
var logger = getLogger("ZohoAuthService");
var TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1e3;
var ZohoAuthService = class {
  constructor() {
    this.cachedAccessToken = null;
    this.tokenExpiresAt = 0;
    this.clientId = settings.zohoDesk.clientId;
    this.clientSecret = settings.zohoDesk.clientSecret;
    this.refreshToken = settings.zohoDesk.refreshToken;
    this.tokenUrl = `https://${settings.zohoDesk.accountsHost}/oauth/v2/token`;
  }
  /**
   * Return a valid access token, refreshing if necessary.
   */
  async getAccessToken() {
    if (this.cachedAccessToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedAccessToken;
    }
    logger.info("Refreshing Zoho OAuth access token");
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: this.refreshToken
    });
    const redirectUri = settings.zohoDesk.oauthRedirectUri;
    if (redirectUri) {
      params.set("redirect_uri", redirectUri);
    }
    const response = await fetch(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });
    if (!response.ok) {
      const body = await response.text();
      logger.error(`Token refresh failed (${response.status}): ${body}`);
      throw new Error(`Zoho OAuth token refresh failed: ${response.status}`);
    }
    const data = await response.json();
    if (data.error || !data.access_token) {
      const detail = JSON.stringify(data);
      logger.error(`Zoho OAuth token response error: ${detail}`);
      throw new Error(
        data.error === "invalid_code" ? "Zoho OAuth invalid_code \u2014 check ZOHO_REFRESH_TOKEN (must be refresh_token from token JSON) and ZOHO_REDIRECT_URI for web clients" : `Zoho OAuth response missing access_token: ${detail}`
      );
    }
    this.cachedAccessToken = data.access_token;
    const expiresInMs = (data.expires_in || 3600) * 1e3;
    this.tokenExpiresAt = Date.now() + expiresInMs - TOKEN_REFRESH_BUFFER_MS;
    logger.info("Zoho access token refreshed successfully");
    return this.cachedAccessToken;
  }
};
var zohoAuthService = new ZohoAuthService();

// lib/services/zoho/InternalKbService.ts
var logger2 = getLogger("InternalKbService");
var CACHE_TTL_MS = 30 * 60 * 1e3;
var PAGE_SIZE = 50;
var MAX_PAGES = 10;
var GUIDANCE_MARKERS = /(please refer to the article|refer to the articles|the agent (?:will |need|should)|please ask the customer|check the article titled|in subsection|sub-?category)/i;
var TIER_TITLE = /^\s*\$\s*(\d+)\s*minimum\s*$/i;
var QUOTED_TITLE = /['‘’"“”]([^'‘’"“”]{3,80})['‘’"“”]/g;
var STOP = /* @__PURE__ */ new Set([
  "a",
  "about",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "can",
  "could",
  "do",
  "does",
  "for",
  "from",
  "get",
  "have",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "please",
  "so",
  "that",
  "the",
  "their",
  "them",
  "there",
  "they",
  "this",
  "to",
  "us",
  "was",
  "we",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "you",
  "your",
  "hi",
  "hello",
  "hey",
  "item",
  "items",
  "order",
  "orders",
  "product",
  "products",
  "thing",
  "things",
  "stuff"
]);
var InternalKbService = class {
  constructor(fetcher, departmentId) {
    this.snapshot = null;
    this.inFlight = null;
    this.fetcher = fetcher ?? ((path2) => this.deskGet(path2));
    this.departmentId = departmentId ?? settings.zohoDesk.systemsSupportDepartmentId ?? "";
  }
  // ── loading ─────────────────────────────────────────────────────────────
  /** Cached snapshot, refreshed past the TTL. Never throws: a failed refresh
   *  serves the previous snapshot rather than dropping the KB mid-conversation. */
  async load() {
    if (this.snapshot && Date.now() - this.snapshot.loadedAt < CACHE_TTL_MS) return this.snapshot;
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.build().then((snap) => {
      if (snap) this.snapshot = snap;
      return this.snapshot;
    }).catch((err) => {
      logger2.error(`internal KB refresh failed: ${err}`);
      return this.snapshot;
    }).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }
  async build() {
    if (!this.departmentId) {
      logger2.info("no Systems Support department configured; internal KB disabled");
      return null;
    }
    const roots = await this.fetcher(`/kbRootCategories?departmentId=${encodeURIComponent(this.departmentId)}`);
    if (!roots.ok) {
      logger2.error(`kbRootCategories failed (${roots.status})`);
      return null;
    }
    const categories = (this.data(roots.json) ?? []).map((c) => ({
      id: String(c.id ?? ""),
      name: String(c.name ?? "")
    })).filter((c) => c.id);
    const raw = [];
    for (const cat of categories) {
      let from = 1;
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await this.fetcher(`/articles?categoryId=${encodeURIComponent(cat.id)}&from=${from}&limit=${PAGE_SIZE}`);
        if (!res.ok) break;
        const rows = this.data(res.json) ?? [];
        for (const r of rows) {
          const o = r;
          raw.push({ id: String(o.id ?? ""), title: String(o.title ?? "").trim(), category: cat.name });
        }
        if (rows.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
    }
    const articles = [];
    for (const r of raw) {
      if (!r.id) continue;
      const full = await this.fetcher(`/articles/${encodeURIComponent(r.id)}`);
      const o = full.ok ? full.json : null;
      const rawBody = stripHtml(String(o?.answer ?? o?.summary ?? ""));
      const tier = r.title.match(TIER_TITLE);
      const body = tier ? `Free shipping applies to orders over $${tier[1]} for eligible postcodes, where the order weight does not exceed 24kg. Eligibility is checked against the postcode list rather than quoted.` : rawBody;
      articles.push({
        id: r.id,
        title: r.title,
        body,
        category: r.category,
        guidance: GUIDANCE_MARKERS.test(body),
        references: [],
        postcodeSource: tier ? rawBody : void 0
      });
    }
    if (articles.length === 0) {
      logger2.warn("internal KB returned no articles");
      return null;
    }
    resolveReferences(articles);
    const { postcodeTiers, conflictedPostcodes } = buildPostcodeTable(articles);
    logger2.info(
      `internal KB loaded: ${articles.length} article(s), ${postcodeTiers.size} postcode(s), ${conflictedPostcodes.size} conflicted, ${articles.filter((a) => a.guidance).length} guidance`
    );
    return { articles, postcodeTiers, conflictedPostcodes, loadedAt: Date.now() };
  }
  // ── querying ────────────────────────────────────────────────────────────
  /** Ranked articles for a customer question, with referenced articles pulled
   *  in behind them. An article that only points elsewhere is no use alone. */
  async search(query, limit = 4) {
    const snap = await this.load();
    if (!snap) return [];
    const postcodeInQuery = (query.match(/\b\d{4}\b/g) ?? []).find((c) => snap.postcodeTiers.has(c) || snap.conflictedPostcodes.has(c));
    const decided = [];
    if (postcodeInQuery) {
      const minimum = snap.conflictedPostcodes.has(postcodeInQuery) ? null : snap.postcodeTiers.get(postcodeInQuery) ?? null;
      decided.push({
        article: {
          id: `postcode-${postcodeInQuery}`,
          title: `Free shipping for postcode ${postcodeInQuery}`,
          body: minimum === null ? `The free shipping threshold for postcode ${postcodeInQuery} is not settled in the knowledge base, so it must not be quoted. Ask the customer to contact the team for this postcode.` : `Postcode ${postcodeInQuery} qualifies for free shipping on retail orders of $${minimum} or more, provided the order weight does not exceed 24kg.`,
          category: "Derived",
          guidance: false,
          references: []
        },
        score: 100,
        viaReference: false
      });
    }
    const terms = tokenise(query);
    if (terms.length === 0) return decided;
    const scored = snap.articles.map((article) => ({ article, score: scoreArticle(article, terms), viaReference: false })).filter((m) => m.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
    const byTitle = new Map(snap.articles.map((a) => [a.title.toLowerCase().trim(), a]));
    const out = [...decided];
    const seen = /* @__PURE__ */ new Set();
    for (const m of scored) {
      if (seen.has(m.article.id)) continue;
      seen.add(m.article.id);
      out.push(m);
      for (const refTitle of m.article.references) {
        const ref = byTitle.get(refTitle.toLowerCase().trim());
        if (!ref || seen.has(ref.id)) continue;
        seen.add(ref.id);
        out.push({ article: ref, score: m.score / 2, viaReference: true });
      }
    }
    return out;
  }
  /** Minimum order value for free shipping at a postcode, or null when unknown
   *  or listed under more than one tier. Never guesses: an ambiguous postcode
   *  returns null so the caller falls back to asking a person. */
  async freeShippingMinimumFor(postcode) {
    const snap = await this.load();
    if (!snap) return null;
    const code = String(postcode ?? "").trim();
    if (!/^\d{4}$/.test(code)) return null;
    if (snap.conflictedPostcodes.has(code)) {
      logger2.info("postcode is listed under more than one tier; refusing to answer");
      return null;
    }
    return snap.postcodeTiers.get(code) ?? null;
  }
  /** The guidance articles, for injecting as context rather than quoting. */
  async guidance() {
    const snap = await this.load();
    return snap ? snap.articles.filter((a) => a.guidance) : [];
  }
  // ── plumbing ────────────────────────────────────────────────────────────
  data(json) {
    const d = json?.data;
    return Array.isArray(d) ? d : null;
  }
  async deskGet(path2) {
    const token = await zohoAuthService.getAccessToken();
    const res = await fetch(`https://${settings.zohoDesk.deskApiHost}/api/v1${path2}`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}`, orgId: settings.zohoDesk.orgId }
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
    }
    return { ok: res.ok, status: res.status, json };
  }
};
function stripHtml(html) {
  return String(html ?? "").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}
function tokenise(text) {
  return String(text ?? "").toLowerCase().replace(/[^a-z0-9$]+/g, " ").split(" ").filter((w) => w.length > 1 && !STOP.has(w));
}
function scoreArticle(article, terms) {
  const title = ` ${article.title.toLowerCase()} `;
  const body = ` ${article.body.toLowerCase()} `;
  let score = 0;
  for (const t of terms) {
    if (title.includes(t)) score += 3;
    else if (body.includes(t)) score += 1;
  }
  return score;
}
function resolveReferences(articles) {
  const byTitle = new Map(articles.map((a) => [a.title.toLowerCase().trim(), a.title]));
  for (const a of articles) {
    const found = [];
    for (const m of a.body.matchAll(QUOTED_TITLE)) {
      const real = byTitle.get(m[1].toLowerCase().trim());
      if (real && real.toLowerCase() !== a.title.toLowerCase() && !found.includes(real)) found.push(real);
    }
    a.references = found;
  }
}
function buildPostcodeTable(articles) {
  const postcodeTiers = /* @__PURE__ */ new Map();
  const conflictedPostcodes = /* @__PURE__ */ new Set();
  for (const a of articles) {
    const m = a.title.match(TIER_TITLE);
    if (!m) continue;
    const minimum = Number(m[1]);
    if (!minimum) continue;
    const source = a.postcodeSource ?? a.body;
    for (const code of new Set(source.match(/\b\d{4}\b/g) ?? [])) {
      const existing = postcodeTiers.get(code);
      if (existing !== void 0 && existing !== minimum) conflictedPostcodes.add(code);
      else postcodeTiers.set(code, minimum);
    }
  }
  for (const code of conflictedPostcodes) postcodeTiers.delete(code);
  return { postcodeTiers, conflictedPostcodes };
}
var internalKbService = new InternalKbService();

// scripts/internal-kb-tests.src.ts
var DEPT = "493989000054808139";
var FIXTURES = [
  {
    id: "1",
    title: "SHIPPING OPTIONS AND COSTS",
    answer: "<p>Does the customer have a wholesale account or not? IF the customer has a wholesale account, please refer to the article 'SHIPPING OPTION FOR WHOLESALE CUSTOMER'. IF the customer does not have a wholesale account, please refer to the article 'SHIPPING OPTION FOR RETAIL CUSTOMER'</p>"
  },
  {
    id: "2",
    title: "SHIPPING OPTION FOR RETAIL CUSTOMER",
    answer: "Free shipping depends on postcode, order value and a 24kg weight limit. Please check the article titled '$150 minimum' or '$400 minimum' for the details."
  },
  {
    id: "3",
    title: "SHIPPING OPTION FOR WHOLESALE CUSTOMER",
    answer: "Please confirm the state. Check the article titled 'New South Wales (NSW)' or 'Victoria (VIC)'. The agent will need to ask the customer whether their address is residential or commercial."
  },
  { id: "4", title: "New South Wales (NSW)", answer: "Wholesale customers with a commercial address in Sydney Metro are eligible for free shipping via the H2G Run." },
  { id: "5", title: "Victoria (VIC)", answer: "Melbourne Metropolitan, Ballarat, Geelong and Apollo Bay can be eligible for free shipping." },
  { id: "6", title: "$150 minimum", answer: "Eligible postcodes: 2487,3029,2137,2600,2601" },
  // 2533-2540 and 2280 sit in BOTH tiers on the live KB. 2487 is in $150 and $400.
  { id: "7", title: "$300 minimum", answer: "Eligible postcodes: 2280,2533,2534,2536" },
  { id: "8", title: "$400 minimum", answer: "Eligible postcodes: 2280,2487,2533,2534,2536,6000,6001" },
  { id: "9", title: "Are you Kosher certified?", answer: "Yes, we are Kosher certified. Please email info@goodness.com.au for a copy of the certification." },
  { id: "10", title: "AI Agent High Level Instructions", answer: "There are 6 types of customer enquiries that the agent need to deal with. For each enquiry type, please refer to the specific subsection." }
];
function fakeFetcher() {
  return async (path2) => {
    if (path2.startsWith("/kbRootCategories")) {
      return { ok: true, status: 200, json: { data: [{ id: "cat1", name: "AI Agent Instructions" }] } };
    }
    if (path2.startsWith("/articles?")) {
      const from = Number(new URLSearchParams(path2.split("?")[1]).get("from") ?? "1");
      const page = from === 1 ? FIXTURES.map((f) => ({ id: f.id, title: f.title })) : [];
      return { ok: true, status: 200, json: { data: page } };
    }
    const m = path2.match(/^\/articles\/(\d+)$/);
    if (m) {
      const f = FIXTURES.find((x) => x.id === m[1]);
      return f ? { ok: true, status: 200, json: { answer: f.answer } } : { ok: false, status: 404, json: null };
    }
    return { ok: false, status: 404, json: null };
  };
}
function brokenFetcher() {
  return async () => ({ ok: false, status: 403, json: { errorCode: "SCOPE_MISMATCH" } });
}
var pass = 0;
var fail = 0;
function check(name, ok, detail = "", because = "") {
  if (ok) pass++;
  else {
    fail++;
    console.log(`FAIL  ${name}`);
    if (detail) console.log(`        ${detail}`);
    if (because) console.log(`        why it matters: ${because}`);
    return;
  }
  console.log(`PASS  ${name}`);
}
(async () => {
  check(
    "stripHtml removes tags and entities",
    stripHtml("<p>Yes &amp; no&nbsp;here</p>") === "Yes & no here"
  );
  check(
    "tokenise drops filler and generic nouns",
    JSON.stringify(tokenise("Hi is your product kosher")) === JSON.stringify(["kosher"]),
    `got ${JSON.stringify(tokenise("Hi is your product kosher"))}`,
    "the same distillation that fixed the public KB search"
  );
  const arts = FIXTURES.map((f) => ({
    id: f.id,
    title: f.title,
    body: stripHtml(f.answer),
    category: "c",
    guidance: false,
    references: []
  }));
  resolveReferences(arts);
  const costs = arts.find((a) => a.title === "SHIPPING OPTIONS AND COSTS");
  check(
    "an article resolves the articles it names",
    costs.references.length === 2 && costs.references.includes("SHIPPING OPTION FOR WHOLESALE CUSTOMER") && costs.references.includes("SHIPPING OPTION FOR RETAIL CUSTOMER"),
    `got ${JSON.stringify(costs.references)}`,
    "this article is a pointer with no answer in it; alone it is useless"
  );
  const wholesale = arts.find((a) => a.title === "SHIPPING OPTION FOR WHOLESALE CUSTOMER");
  check(
    "quoted names that are not articles are ignored",
    !wholesale.references.includes("Retail Customer"),
    `got ${JSON.stringify(wholesale.references)}`,
    "sub-category names are navigation for a human, not something to fetch"
  );
  const { postcodeTiers, conflictedPostcodes } = buildPostcodeTable(arts);
  check(
    "a clean postcode maps to its tier",
    postcodeTiers.get("3029") === 150,
    `got ${postcodeTiers.get("3029")}`
  );
  check(
    "a postcode only in the top tier maps to it",
    postcodeTiers.get("6000") === 400,
    `got ${postcodeTiers.get("6000")}`
  );
  check(
    "postcodes in two tiers are recorded as conflicted",
    ["2280", "2487", "2533", "2534", "2536"].every((c) => conflictedPostcodes.has(c)),
    `got ${JSON.stringify([...conflictedPostcodes])}`,
    "eight real postcodes are in two tiers on the live KB"
  );
  check(
    "a conflicted postcode is in NO tier",
    ["2280", "2487", "2533"].every((c) => !postcodeTiers.has(c)),
    "",
    "answering $150 or $400 at random is worse than not answering"
  );
  const svc = new InternalKbService(fakeFetcher(), DEPT);
  const snap = await svc.load();
  check(
    "loads every article",
    snap?.articles.length === FIXTURES.length,
    `got ${snap?.articles.length}`
  );
  check(
    "marks guidance articles",
    snap.articles.filter((a) => a.guidance).map((a) => a.title).sort().join("|") === ["AI Agent High Level Instructions", "SHIPPING OPTION FOR RETAIL CUSTOMER", "SHIPPING OPTION FOR WHOLESALE CUSTOMER", "SHIPPING OPTIONS AND COSTS"].sort().join("|"),
    `got ${JSON.stringify(snap.articles.filter((a) => a.guidance).map((a) => a.title))}`,
    "guidance must never be quoted at a customer"
  );
  const kosher = await svc.search("Hi is your product kosher");
  check(
    "finds the kosher article from an awkward question",
    kosher[0]?.article.title === "Are you Kosher certified?",
    `got ${kosher.map((m) => m.article.title).join(" | ")}`,
    "the question Iri reported against the public KB"
  );
  const shipping = await svc.search("is there free shipping");
  const titles = shipping.map((m) => m.article.title);
  check(
    "a pointer article drags its referenced articles in",
    titles.includes("SHIPPING OPTIONS AND COSTS") && titles.includes("SHIPPING OPTION FOR RETAIL CUSTOMER"),
    `got ${titles.join(" | ")}`,
    "answering from the pointer alone tells the customer nothing"
  );
  check(
    "referenced articles are marked as such",
    shipping.some((m) => m.viaReference),
    "",
    "the caller needs to know which ones the customer did not ask for"
  );
  check(
    "free shipping minimum is a lookup",
    await svc.freeShippingMinimumFor("3029") === 150,
    `got ${await svc.freeShippingMinimumFor("3029")}`
  );
  check(
    "a conflicted postcode returns null",
    await svc.freeShippingMinimumFor("2280") === null,
    `got ${await svc.freeShippingMinimumFor("2280")}`,
    "refusing to answer beats picking a tier at random"
  );
  check("an unknown postcode returns null", await svc.freeShippingMinimumFor("9999") === null);
  check("a malformed postcode returns null", await svc.freeShippingMinimumFor("abc") === null);
  const tierArticle = snap.articles.find((a) => a.title === "$400 minimum");
  check(
    "a tier article body carries no postcodes",
    !/\b\d{4}\b/.test(tierArticle.body),
    `body was: ${tierArticle.body.slice(0, 120)}`,
    "the live $400 article is 22,000 characters of postcodes"
  );
  check(
    "a tier article body is short",
    tierArticle.body.length < 400,
    `got ${tierArticle.body.length} chars`,
    "it would otherwise be posted into every shipping prompt"
  );
  const withPostcode = await svc.search("do I get free shipping to 3029");
  check(
    "a postcode in the question is answered from the table",
    withPostcode[0]?.article.title === "Free shipping for postcode 3029" && /\$150 or more/.test(withPostcode[0].article.body),
    `got ${withPostcode[0]?.article.title} :: ${withPostcode[0]?.article.body.slice(0, 120)}`,
    "membership of a 4,000 entry list is a lookup, not a comprehension task"
  );
  const conflicted = await svc.search("free shipping to 2280");
  check(
    "a conflicted postcode refuses rather than picking",
    /must not be quoted/.test(conflicted[0]?.article.body ?? ""),
    `got ${conflicted[0]?.article.body?.slice(0, 120)}`,
    "2280 is in both the $300 and $400 tiers on the live KB"
  );
  const broken = new InternalKbService(brokenFetcher(), DEPT);
  check(
    "a failing fetch returns null rather than throwing",
    await broken.load() === null,
    "",
    "a KB outage must not take the whole agent down"
  );
  const noDept = new InternalKbService(fakeFetcher(), "");
  check(
    "no department configured disables it quietly",
    await noDept.load() === null,
    "",
    "it has to be safe to deploy before the department id is set"
  );
  console.log(`
${pass} passed, ${fail} failed, ${pass + fail} total`);
  process.exit(fail ? 1 : 0);
})();
