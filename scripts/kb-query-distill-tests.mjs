// lib/services/tools/ZohoKbToolService.ts
import { SchemaType, GoogleGenerativeAI } from "@google/generative-ai";

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

// lib/services/storage/GcsClient.ts
import { Storage } from "@google-cloud/storage";
var logger = getLogger("GcsClient");
var LEGACY_PLAYBOOK_HEADER = "HONEST TO GOODNESS \u2014 SUPPORT PLAYBOOK (stakeholder rules)";
var LEGACY_PLAYBOOK_SEP = "\n\n---\n\n";
function stripLegacyMergedPlaybookFromGlobal(text) {
  const t = text.trimEnd();
  const idx = t.indexOf(LEGACY_PLAYBOOK_HEADER);
  if (idx === -1) {
    return t.trim();
  }
  let cut = idx;
  if (idx >= LEGACY_PLAYBOOK_SEP.length && t.slice(idx - LEGACY_PLAYBOOK_SEP.length, idx) === LEGACY_PLAYBOOK_SEP) {
    cut = idx - LEGACY_PLAYBOOK_SEP.length;
  }
  return t.slice(0, cut).trimEnd();
}
var SETTINGS_FILENAME = "settings.json";
var AGENTS_DIR = "agents";
var SYSTEM_SETTINGS_FILENAME = "system-settings.json";
var DEFAULT_PROMPT = `You are a friendly, conversational AI assistant helping users with step-by-step guidance.

Context from documentation:
{{context}}

User message: {{message}}

CRITICAL INSTRUCTIONS:
1. **Be concise and conversational** - Keep responses SHORT (2-4 sentences typically)
2. **Step-by-step approach** - If the context contains a procedure with multiple steps:
   - Only explain the FIRST step in detail
   - Give clear, actionable instructions for that step
   - End by asking if they've completed it before moving on
   - Wait for user confirmation before explaining the next step
3. **Formatting** - Use plain text, natural language. NO markdown symbols like ** or ##
4. **Tone** - Be friendly, supportive, and patient like a helpful colleague
5. **If not procedural** - Answer the question directly and briefly

Examples:
- Bad: "**Step 1:** Go to Settings. **Step 2:** Click on API Keys..."
- Good: "Let's start! First, go to Settings in your Google Cloud console. Once you're there, let me know and I'll guide you to the next step."

Remember: ONE step at a time. Keep it SHORT and FRIENDLY.

Response:`;
var DEFAULT_WELCOME_MESSAGE = "Hello!\n\nI'm your AI assistant. How can I help you today?";
var DEFAULT_AGENT_NAME = "Text Agent";
var DEFAULT_GLOBAL_SYSTEM_PROMPT = `GLOBAL RULES FOR ALL AGENTS:

1. **Knowledge Base Awareness**:
   - When context is provided (knowledge base files or uploaded files), you MUST use it to answer questions
   - If the user asks about specific documents/files mentioned in the context, search and reference that content
   - If context is provided but you ignore it and give generic responses, you are not following instructions
   - NEVER mention "the knowledge base", "knowledge base tool", or internal document names in your responses \u2014 answer directly and naturally as if the information is your own knowledge

2. **Response Style**:
   - Be concise and conversational for simple questions
   - Provide detailed, comprehensive answers when:
     * User asks about knowledge base files or documents
     * User asks for lists, data extraction, or analysis
     * User asks "what files do you have?" or "list all files"
     * Task requires comprehensive information
     * Agent is performing specialized work (e.g., invoice analysis, report generation)

3. **Acknowledgment Handling**:
   - When user sends short acknowledgments like "ok", "go", "yes", "\u{1F44D}", respond with ONE brief sentence and suggest the next action
   - Do NOT restate your full instructions or configuration unless explicitly asked

4. **Uncertainty Handling**:
   - If you don't know something or the data is incomplete, clearly state that
   - Never fabricate information
   - When a tool returns successful content, use it to answer directly instead of saying information was not found \u2014 unless the agent prompt requires asking retail vs wholesale before listing payment methods

5. **Professional Tone**:
   - Be friendly, supportive, and professional
   - Avoid overly casual language

6. **Formatting**:
   - Use plain text, natural language
   - Avoid excessive markdown unless formatting is needed

7. **Context Usage**:
   - ALWAYS check the provided context before answering
   - Use knowledge base and uploaded files to inform your responses
   - Don't repeat the entire context back to the user unless asked
   - When listing files, use the exact file names from the "KNOWLEDGE BASE FILES AVAILABLE" section

Remember: If context is provided, USE IT. Generic "I'm ready to help" responses when context contains the answer are incorrect.`;
var GcsClient = class {
  constructor() {
    this.bucketName = settings.gcs.bucketName;
    this.storage = new Storage({
      projectId: settings.gcs.projectId,
      credentials: {
        client_email: settings.gcs.clientEmail,
        private_key: settings.gcs.privateKey
      }
    });
  }
  async getPromptConfig(agentId) {
    const defaultData = {
      systemPrompt: DEFAULT_PROMPT,
      welcomeMessage: DEFAULT_WELCOME_MESSAGE,
      agentName: DEFAULT_AGENT_NAME,
      config: { model: "Gemini 3.0 Flash", language: "Multilingual" }
    };
    if (!this.bucketName) {
      logger.warn("GCS_BUCKET_NAME not configured, using default prompt.");
      return defaultData;
    }
    try {
      const bucket = this.storage.bucket(this.bucketName);
      let filePath = agentId ? `${AGENTS_DIR}/${agentId}/settings.json` : SETTINGS_FILENAME;
      let file = bucket.file(filePath);
      let [exists] = await file.exists();
      if (!exists && agentId) {
        file = bucket.file(SETTINGS_FILENAME);
        [exists] = await file.exists();
      }
      if (!exists && !agentId) {
        const oldFile = bucket.file("prompt.json");
        const [oldExists] = await oldFile.exists();
        if (oldExists) {
          logger.info("Found legacy prompt.json, migrating to settings.json");
          file = oldFile;
          exists = true;
        }
      }
      if (!exists) {
        logger.info(`Settings file not found for ${agentId || "default"}, returning default.`);
        return defaultData;
      }
      const [content] = await file.download();
      const rawData = JSON.parse(content.toString("utf-8"));
      return {
        systemPrompt: rawData.systemPrompt || rawData.template || DEFAULT_PROMPT,
        welcomeMessage: rawData.welcomeMessage || DEFAULT_WELCOME_MESSAGE,
        agentName: rawData.agentName || DEFAULT_AGENT_NAME,
        config: rawData.config || { model: "Gemini 3.0 Flash", language: "Multilingual" }
      };
    } catch (error) {
      logger.error(`Error fetching prompt from GCS: ${error}`);
      return defaultData;
    }
  }
  async getPromptTemplate(agentId) {
    const config = await this.getPromptConfig(agentId);
    return config.systemPrompt;
  }
  async savePromptConfig(data, agentId) {
    if (!this.bucketName) throw new Error("GCS_BUCKET_NAME not configured");
    const filePath = agentId ? `${AGENTS_DIR}/${agentId}/settings.json` : SETTINGS_FILENAME;
    const file = this.storage.bucket(this.bucketName).file(filePath);
    await file.save(JSON.stringify(data, null, 2), {
      contentType: "application/json",
      metadata: { cacheControl: "no-cache" }
    });
  }
  async savePromptTemplate(template, agentId) {
    const current = await this.getPromptConfig(agentId);
    await this.savePromptConfig({ ...current, systemPrompt: template }, agentId);
  }
  async listAgents() {
    if (!this.bucketName) return [];
    try {
      const bucket = this.storage.bucket(this.bucketName);
      const [files] = await bucket.getFiles({ prefix: `${AGENTS_DIR}/` });
      const agentIds = /* @__PURE__ */ new Set();
      files.forEach((file) => {
        const match = file.name.match(new RegExp(`^${AGENTS_DIR}/([^/]+)/`));
        if (match) agentIds.add(match[1]);
      });
      return Array.from(agentIds).sort();
    } catch (error) {
      logger.error(`Error listing agents: ${error}`);
      return [];
    }
  }
  async deleteAgent(agentId) {
    if (!this.bucketName) throw new Error("GCS_BUCKET_NAME not configured");
    if (!agentId || agentId.trim() === "") throw new Error("agentId is required");
    const prefix = `${AGENTS_DIR}/${agentId}/`;
    const bucket = this.storage.bucket(this.bucketName);
    const [files] = await bucket.getFiles({ prefix });
    const deleted = [];
    for (const file of files) {
      if (!file.name.startsWith(prefix)) {
        logger.warn(`Skipping unexpected file outside prefix: ${file.name}`);
        continue;
      }
      await file.delete();
      deleted.push(file.name);
      logger.info(`Deleted: ${file.name}`);
    }
    logger.info(`Removed ${deleted.length} file(s) for agent "${agentId}"`);
    return { deleted };
  }
  async getSystemSettings() {
    const defaultData = {
      globalSystemPrompt: DEFAULT_GLOBAL_SYSTEM_PROMPT
    };
    if (!this.bucketName) {
      logger.warn("GCS_BUCKET_NAME not configured, using default system settings.");
      return defaultData;
    }
    try {
      const bucket = this.storage.bucket(this.bucketName);
      const file = bucket.file(SYSTEM_SETTINGS_FILENAME);
      const [exists] = await file.exists();
      if (!exists) {
        logger.info("System settings file not found, returning default.");
        return defaultData;
      }
      const [content] = await file.download();
      const rawData = JSON.parse(content.toString("utf-8"));
      const rawPrompt = typeof rawData.globalSystemPrompt === "string" ? rawData.globalSystemPrompt : DEFAULT_GLOBAL_SYSTEM_PROMPT;
      const basePrompt = stripLegacyMergedPlaybookFromGlobal(rawPrompt);
      return { globalSystemPrompt: basePrompt };
    } catch (error) {
      logger.error(`Error fetching system settings from GCS: ${error}`);
      return defaultData;
    }
  }
  /**
   * Global system prompt plus this agent's system prompt (same order as live chat, before KB tool overrides).
   */
  async buildGlobalAndAgentPrompt(agentId) {
    const [sys, agentPrompt] = await Promise.all([
      this.getSystemSettings(),
      this.getPromptTemplate(agentId)
    ]);
    const globalBase = stripLegacyMergedPlaybookFromGlobal(sys.globalSystemPrompt.trim());
    return `${globalBase}

---

${agentPrompt}`;
  }
  async saveSystemSettings(data) {
    if (!this.bucketName) throw new Error("GCS_BUCKET_NAME not configured");
    const basePrompt = stripLegacyMergedPlaybookFromGlobal(data.globalSystemPrompt.trim());
    const file = this.storage.bucket(this.bucketName).file(SYSTEM_SETTINGS_FILENAME);
    await file.save(
      JSON.stringify(
        {
          globalSystemPrompt: basePrompt
        },
        null,
        2
      ),
      {
        contentType: "application/json",
        metadata: { cacheControl: "no-cache" }
      }
    );
  }
};
var gcsClient = new GcsClient();

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

// lib/services/chat/PaymentSegmentGate.ts
var PAYMENT_SEGMENT_OPENER = "Happy to help with that. Could you let me know whether you're a retail or wholesale customer? Accepted payment methods can differ between the two.";
var CARD_DECLINE_SEGMENT_OPENER = "Sorry to hear that's happening \u2014 I can help. Could you let me know whether you're a retail or wholesale customer? Accepted payment methods can differ between the two.";
var PAYMENT_INTENT = /(?:pay|payment|checkout|card|credit card|debit card|visa|mastercard|amex|american express|apple pay|google pay|paypal|pay in 4|bank transfer|afterpay|zip)/i;
var CARD_DECLINE_INTENT = /(?:won't|wont|not)\s+(?:take|accept|working)|(?:declined|rejected)|system\s+won't|card\s+(?:isn't|is not|won't|wont|not being)|isn't being accepted|not being accepted/i;
var SEGMENT_STATED = /\b(retail|wholesale|trade customer|trade account)\b/i;
var GROUP_GOODNESS2 = /\b(group goodness|buying group|group member|group admin|group coordinator|group order|group cart)\b/i;
var BANNED_OPENER_PATTERNS = [
  /^\s*yes\b/i,
  /^\s*we (do )?accept\b/i,
  /^\s*we offer\b/i,
  /^\s*our\b.*\baccepts?\b/i,
  /\bis accepted\b/i,
  /\bare accepted\b/i,
  /\bwe accept\b/i,
  /^\s*(visa|mastercard|american express|amex|apple pay|google pay|paypal)\b/i,
  /\b(visa|mastercard|american express|amex|apple pay|google pay|paypal)\b.*\b(and|&)\b/i
];
var NO_RESULTS_PHRASING2 = /couldn't find an article|could not find an article|no article|knowledge base lacks|kb lacks|not find.*help center|don't have the answer|do not have the answer|one of my colleagues/i;
var PaymentSegmentGate = class {
  static needsSegmentQuestion(message, history = []) {
    if (!PAYMENT_INTENT.test(message)) return false;
    const transcript = [
      message,
      ...history.map((m) => String(m.content ?? ""))
    ].join("\n");
    if (GROUP_GOODNESS2.test(transcript)) return false;
    return !SEGMENT_STATED.test(transcript);
  }
  static mentionsGroupGoodness(text) {
    return GROUP_GOODNESS2.test(text);
  }
  static hasRetailSegment(text) {
    return /\bretail\b/i.test(text);
  }
  static hasSegmentStated(text) {
    return SEGMENT_STATED.test(text);
  }
  static looksLikePaymentIntent(text) {
    return PAYMENT_INTENT.test(text);
  }
  static getSegmentOpener(message) {
    if (CARD_DECLINE_INTENT.test(message) || /\bmy card\b/i.test(message)) {
      return CARD_DECLINE_SEGMENT_OPENER;
    }
    return PAYMENT_SEGMENT_OPENER;
  }
  static isNoResultsPhrasing(response) {
    return NO_RESULTS_PHRASING2.test(response);
  }
  static violatesOpener(response) {
    const trimmed = response.trim();
    if (!trimmed) return false;
    const firstChunk = trimmed.slice(0, 280);
    return BANNED_OPENER_PATTERNS.some((pattern) => pattern.test(firstChunk));
  }
};

// lib/services/chat/KbSearchQueryResolver.ts
var SEGMENT_ONLY_REPLY = /^(retail|wholesale|trade)(\s+customer)?[!.?\s]*$/i;
var SEGMENT_LABEL = /\b(retail|wholesale|trade)\b/i;
var CLARIFICATION_SIGNALS = /\b(postcode|post\s*code|\d{4}\b|kg|kilo|weight|order\s+weight)\b/i;
var ASSISTANT_CLARIFICATION_ASK = [
  /\b(retail|wholesale)\b.*\b(retail|wholesale)\b/i,
  /whether you(?:'re| are) a retail or wholesale/i,
  /retail or wholesale customer/i,
  /(postcode|weight).*(retail|wholesale)|(retail|wholesale).*(postcode|weight)/i,
  /free shipping eligibility depends on these factors/i,
  /approximate weight of your order/i,
  /specific .* postcode/i
];
var KbSearchQueryResolver = class {
  static resolveSearchQuery(message, history = []) {
    const followUp = this.getClarificationFollowUp(message, history);
    if (followUp) return followUp.enrichedSearchQuery;
    return message.trim();
  }
  static getSegmentFollowUp(message, history = []) {
    return this.getClarificationFollowUp(message, history);
  }
  static getClarificationFollowUp(message, history = []) {
    const trimmed = message.trim();
    if (!trimmed || !this.assistantAskedClarification(history)) return null;
    if (!this.isClarificationFollowUpMessage(trimmed)) return null;
    const originalQuestion = this.findPriorUserQuestion(history);
    if (!originalQuestion) return null;
    return {
      segmentAnswer: trimmed,
      segmentLabel: this.extractSegmentLabel(trimmed),
      originalQuestion,
      enrichedSearchQuery: this.buildEnrichedSearchQuery(originalQuestion, trimmed)
    };
  }
  static buildTurn2Instruction(followUp) {
    const segment = followUp.segmentLabel ?? "the segment they stated";
    const shipping = /(ship|shipping|freight|deliver|postcode|melbourne|free delivery)/i.test(
      `${followUp.originalQuestion} ${followUp.segmentAnswer}`
    );
    const payment = /(pay|payment|paypal|visa|mastercard|amex|apple pay|card)/i.test(
      followUp.originalQuestion
    );
    const lines = [
      "Clarification follow-up policy:",
      `- The customer is answering your earlier clarification request, not asking a new topic.`,
      `- Their follow-up: "${followUp.segmentAnswer}"`,
      `- Their original question to answer: "${followUp.originalQuestion}"`,
      `- Treat them as a ${segment} customer and apply facts they gave (weight, postcode, etc.).`,
      `- Do NOT search or answer about "${followUp.segmentAnswer}" as a standalone topic.`
    ];
    if (shipping) {
      lines.push(
        "- Use the free-shipping / shipping articles for this segment. Under 24 kg and minimum spend by postcode are the usual retail rules when the article says so.",
        '- Give a direct eligibility answer for their postcode and weight when the article supports it. Do NOT say the knowledge base lacks information when status is "success".'
      );
    } else if (payment) {
      lines.push(
        '- List accepted payment methods for this segment from the article. Do NOT say the KB is silent when status is "success".'
      );
    } else {
      lines.push(
        "- Answer the original question using the retrieved articles for this segment."
      );
    }
    return lines.join("\n");
  }
  static isClarificationFollowUpMessage(message) {
    if (SEGMENT_ONLY_REPLY.test(message)) return true;
    const hasSegment = SEGMENT_LABEL.test(message);
    const hasClarification = CLARIFICATION_SIGNALS.test(message);
    if (hasSegment && hasClarification) return true;
    if (hasSegment && message.length < 100) return true;
    if (hasClarification && message.length < 180 && !/^(how|what|when|where|why|can|do|does|is|are)\s/i.test(message)) {
      return true;
    }
    return false;
  }
  static isFollowUpAnswerContent(content) {
    return this.isClarificationFollowUpMessage(content.trim());
  }
  static extractSegmentLabel(message) {
    const match = message.match(/\b(retail|wholesale|trade)\b/i);
    return match ? match[1].toLowerCase() : null;
  }
  static buildEnrichedSearchQuery(originalQuestion, followUp) {
    const parts = [originalQuestion];
    const segment = this.extractSegmentLabel(followUp);
    if (segment) parts.push(segment);
    const postcode = followUp.match(/\b(\d{4})\b/);
    if (postcode) parts.push(`postcode ${postcode[1]}`);
    const weight = followUp.match(/\b(\d+)\s*(?:kg|kilograms?)\b/i);
    if (weight) parts.push(`${weight[1]} kg`);
    if (/free\s+ship|shipping|delivery/i.test(originalQuestion)) {
      parts.push("free shipping");
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }
  static assistantAskedClarification(history) {
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      if (msg.role !== "assistant") continue;
      const text = String(msg.content ?? "");
      return ASSISTANT_CLARIFICATION_ASK.some((pattern) => pattern.test(text));
    }
    return false;
  }
  static findPriorUserQuestion(history) {
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      if (msg.role !== "user") continue;
      const content = String(msg.content ?? "").trim();
      if (!content || this.isFollowUpAnswerContent(content)) continue;
      return content;
    }
    return null;
  }
};

// lib/services/privacy/redact.ts
var EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
var ORDER_RE = /\b(?:BC-?|SO)?\d{6,}\b/gi;
var REDACTED_EMAIL = "[redacted-email]";
var REDACTED_ORDER = "[redacted-order]";
function redactPII(text) {
  if (!text) return text;
  return text.replace(EMAIL_RE, REDACTED_EMAIL).replace(ORDER_RE, REDACTED_ORDER);
}

// lib/services/zoho/ZohoDeskClient.ts
var logger2 = getLogger("ZohoDeskClient");
var BASE_URL = "https://desk.zoho.com/portal/api";
var MAX_RESULTS = 5;
var ZohoDeskClient = class {
  async searchArticles(query, portalId) {
    const url = new URL(`${BASE_URL}/kbArticles/search`);
    url.searchParams.set("portalId", portalId);
    url.searchParams.set("searchStr", query);
    url.searchParams.set("limit", String(MAX_RESULTS));
    logger2.info(`Searching Zoho KB for: "${redactPII(query)}"`);
    const response = await fetch(url.toString());
    if (!response.ok) {
      logger2.error(`Zoho KB search failed: ${response.status} ${response.statusText}`);
      throw new Error(`Zoho Desk API error: ${response.status}`);
    }
    const data = await response.json();
    const rawResults = Array.isArray(data.data) ? data.data : [];
    logger2.info(`Zoho API returned ${rawResults.length} article(s): ${rawResults.map((a) => String(a.title ?? "")).filter(Boolean).join(" | ") || "(none)"}`);
    const articles = rawResults.map((item) => ({
      id: String(item.id ?? ""),
      title: String(item.title ?? ""),
      summary: String(item.summary ?? item.answer ?? ""),
      permalink: String(item.webUrl ?? item.permalink ?? "")
    }));
    logger2.info(`Found ${articles.length} article(s) for query: "${redactPII(query)}"`);
    return articles;
  }
};

// lib/services/tools/ZohoKbToolService.ts
import { traceable } from "langsmith/traceable";
var logger3 = getLogger("ZohoKbToolService");
var ZohoKbToolService = class _ZohoKbToolService {
  constructor() {
    /** Zoho article search wrapped in a LangSmith traceable span. */
    this.searchArticlesTraceable = traceable(
      async (query, portalId) => {
        return this.publicClient.searchArticles(query, portalId);
      },
      { name: "retrieve_zoho_kb_articles" }
    );
    this.publicClient = new ZohoDeskClient();
  }
  get metadata() {
    return {
      name: "Search Knowledge Base",
      description: "Search Zoho Help Center articles to answer support questions"
    };
  }
  get declaration() {
    return {
      functionDeclarations: [
        {
          name: "search_knowledge_base",
          description: `Search support articles and FAQs to answer the user's question. Call this tool when the user asks a support question, needs how-to guidance, or is looking for information about a product or process. Pass the customer's actual support question as the query. If they only replied "retail" or "wholesale" after you asked the segment question, pass their earlier question (e.g. PayPal acceptance) \u2014 never search the segment word alone.`,
          parameters: {
            type: SchemaType.OBJECT,
            properties: {
              query: {
                type: SchemaType.STRING,
                description: 'The support question to search for. Use the earlier user question on segment-only follow-ups, not "retail"/"wholesale".'
              }
            },
            required: ["query"]
          }
        }
      ]
    };
  }
  canHandle(functionCallName) {
    return functionCallName === "search_knowledge_base";
  }
  async execute(params) {
    const rawMessage = (params.userMessage ?? String(params.args.query ?? "")).trim();
    const history = params.conversationHistory ?? [];
    const query = KbSearchQueryResolver.resolveSearchQuery(rawMessage, history) || String(params.args.query ?? "").trim();
    if (!query) {
      logger3.warn("search_knowledge_base called with empty query");
      return { toolResponse: { status: "error", message: "No search query provided." } };
    }
    const segmentFollowUp = KbSearchQueryResolver.getSegmentFollowUp(rawMessage, history);
    if (segmentFollowUp) {
      logger3.info(
        `Segment follow-up: customer said "${redactPII(segmentFollowUp.segmentAnswer)}"; searching for "${redactPII(query)}"`
      );
    } else {
      logger3.info(`Executing search_knowledge_base with query: "${redactPII(query)}"`);
    }
    const agentConfig = await gcsClient.getPromptConfig(params.agentId);
    const zohoConfig = agentConfig.config?.zohoDesk;
    const actualArgs = {
      query,
      ...segmentFollowUp && {
        segmentAnswer: segmentFollowUp.segmentAnswer,
        segmentLabel: segmentFollowUp.segmentLabel,
        originalQuestion: segmentFollowUp.originalQuestion
      }
    };
    const [portalId, portalId2] = zohoConfig?.publicPortalIds ?? [];
    if (!portalId) {
      return {
        toolResponse: { status: "no_results", message: `No knowledge base articles found for "${query}".` },
        actualArgs
      };
    }
    try {
      logger3.info("Using public Zoho portal API search");
      const paymentFallbackQueries = [
        ...this.getPaymentFallbackQueries(query),
        ...this.buildKeywordFallbackQueries(query)
      ];
      const portal1Articles = await this.searchPortalWithFallbacks(portalId, query, paymentFallbackQueries);
      const portal1Relevant = portal1Articles.length > 0 && await this.isRelevantToQuery(query, portal1Articles, "portal 1");
      const portal1Score = this.scoreArticleSet(query, portal1Articles);
      let portal2Articles = [];
      let portal2Relevant = false;
      let portal2Score = -1;
      if (portalId2) {
        logger3.info("Portal 2 configured; evaluating both portals and selecting best match");
        portal2Articles = await this.searchPortalWithFallbacks(portalId2, query, paymentFallbackQueries);
        portal2Relevant = portal2Articles.length > 0 && await this.isRelevantToQuery(query, portal2Articles, "portal 2");
        portal2Score = this.scoreArticleSet(query, portal2Articles);
      }
      const normalizedQuery = this.normalizeText(query);
      const preferPortal2 = PaymentSegmentGate.mentionsGroupGoodness(query);
      const preferPortal1 = (PaymentSegmentGate.hasRetailSegment(query) || PaymentSegmentGate.hasSegmentStated(query)) && !preferPortal2;
      const paymentIntent = PaymentSegmentGate.looksLikePaymentIntent(query);
      const cardBrandIntent = /(amex|american express|visa|mastercard|paypal|apple pay|google pay)/.test(normalizedQuery);
      const retailComplaintIntent = ComplaintsResponseGate.prefersRetailPortal(query);
      const portal1PriorityBoost = !preferPortal2 && (cardBrandIntent || retailComplaintIntent || preferPortal1 && paymentIntent) ? 10 : 0;
      const portal2PriorityBoost = preferPortal2 ? 5 : 0;
      const portal2Penalty = preferPortal1 && paymentIntent ? 12 : 0;
      const candidates = [
        {
          label: "portal 1",
          articles: portal1Articles,
          relevant: portal1Relevant,
          score: portal1Score + (preferPortal2 ? 0 : 1) + portal1PriorityBoost
        },
        {
          label: "portal 2",
          articles: portal2Articles,
          relevant: portal2Relevant,
          score: portal2Score + (preferPortal2 ? 1 : 0) + portal2PriorityBoost - portal2Penalty
        }
      ].filter((candidate) => candidate.articles.length > 0);
      candidates.sort((a, b) => {
        if (a.relevant !== b.relevant) return a.relevant ? -1 : 1;
        if (a.score !== b.score) return b.score - a.score;
        return b.articles.length - a.articles.length;
      });
      const bestCandidate = candidates[0];
      if (!bestCandidate || !bestCandidate.relevant) {
        return {
          toolResponse: {
            status: "no_results",
            message: `No knowledge base articles found for "${query}".`
          },
          actualArgs
        };
      }
      logger3.info(
        `Selected ${bestCandidate.label} with relevance=${bestCandidate.relevant} score=${bestCandidate.score} for query "${redactPII(query)}"`
      );
      let articles = this.rankArticlesForQuery(query, bestCandidate.articles);
      if (paymentIntent) {
        articles = this.promotePaymentArticle(articles);
      }
      return {
        toolResponse: {
          status: "success",
          bestArticle: {
            title: articles[0].title,
            summary: articles[0].summary,
            url: articles[0].permalink
          },
          relatedArticles: articles.slice(1, 3).map((a) => ({
            title: a.title,
            summary: a.summary,
            url: a.permalink
          })),
          articles: articles.map((a) => ({
            title: a.title,
            summary: a.summary,
            url: a.permalink
          })),
          ...segmentFollowUp && {
            segmentFollowUp: {
              segmentAnswer: segmentFollowUp.segmentAnswer,
              originalQuestion: segmentFollowUp.originalQuestion
            }
          }
        },
        actualArgs
      };
    } catch (error) {
      logger3.error(`Zoho KB search failed for query "${redactPII(query)}": ${redactPII(String(error))}`);
      return {
        toolResponse: {
          status: "error",
          message: "Failed to query knowledge base articles."
        },
        actualArgs
      };
    }
  }
  async isRelevantToQuery(query, articles, portalLabel) {
    if (this.hasPaymentArticleMatch(query, articles)) {
      logger3.info(`Relevance check passed via payment article match (${portalLabel})`);
      return true;
    }
    if (this.hasStrongLexicalMatch(query, articles)) {
      logger3.info(`Relevance check passed via lexical matching (${portalLabel})`);
      return true;
    }
    return this.articlesAnswerQuery(query, articles, portalLabel);
  }
  async searchPortalWithFallbacks(portalId, query, fallbackQueries) {
    const primary = await this.searchArticlesTraceable(query, portalId);
    if (fallbackQueries.length === 0) return primary;
    const primaryScore = this.scoreArticleSet(query, primary);
    const paymentIntent = PaymentSegmentGate.looksLikePaymentIntent(query);
    const shouldTryFallbacks = primary.length === 0 || primaryScore < 6 || paymentIntent && fallbackQueries.length > 0;
    if (!shouldTryFallbacks) return primary;
    logger3.info(
      `Primary search appears weak for "${redactPII(query)}" (score=${primaryScore}); trying ${fallbackQueries.length} fallback query(ies).`
    );
    const merged = /* @__PURE__ */ new Map();
    for (const article of primary) {
      merged.set(article.id || article.permalink || article.title, article);
    }
    for (const fallbackQuery of fallbackQueries) {
      const fallbackArticles = await this.searchArticlesTraceable(fallbackQuery, portalId);
      for (const article of fallbackArticles) {
        merged.set(article.id || article.permalink || article.title, article);
      }
    }
    const mergedArticles = Array.from(merged.values());
    return this.rankArticlesForQuery(query, mergedArticles);
  }
  hasStrongLexicalMatch(query, articles) {
    const normalizedQuery = this.normalizeText(query);
    const queryIsGroupGoodness = PaymentSegmentGate.mentionsGroupGoodness(query);
    if (queryIsGroupGoodness) {
      if (PaymentSegmentGate.looksLikePaymentIntent(query) && this.findPaymentOptionsArticle(articles)) {
        return true;
      }
      const hasGroupGoodnessArticle = articles.some((article) => {
        const corpus = this.normalizeText(`${article.title} ${article.summary}`);
        return corpus.includes("group goodness") || corpus.includes("buying group");
      });
      if (hasGroupGoodnessArticle) {
        return true;
      }
    }
    const keywordGroups = this.extractQueryKeywordGroups(query);
    if (keywordGroups.length === 0) return false;
    const requiredGroups = keywordGroups.length <= 2 ? keywordGroups.length : Math.max(2, Math.ceil(keywordGroups.length * 0.6));
    return articles.some((article) => {
      const title = this.normalizeText(article.title);
      const summary = this.normalizeText(article.summary);
      const corpus = `${title} ${summary}`;
      const titleMatchCount = keywordGroups.filter(
        (group) => group.some((token) => this.matchesToken(title, token))
      ).length;
      if (titleMatchCount >= requiredGroups) return true;
      const corpusMatchCount = keywordGroups.filter(
        (group) => group.some((token) => this.matchesToken(corpus, token))
      ).length;
      if (corpusMatchCount >= requiredGroups) return true;
      return false;
    });
  }
  extractQueryKeywordGroups(query) {
    const stopWords = /* @__PURE__ */ new Set([
      "a",
      "an",
      "and",
      "are",
      "can",
      "could",
      "do",
      "does",
      "for",
      "from",
      "how",
      "i",
      "in",
      "is",
      "it",
      "me",
      "my",
      "of",
      "offer",
      "on",
      "or",
      "please",
      "the",
      "to",
      "we",
      "what",
      "when",
      "where",
      "with",
      "you",
      "your"
    ]);
    const shippingDeliveryCluster = [
      "delivery",
      "shipping",
      "freight",
      "postage",
      "dispatch",
      "courier",
      "ship",
      "deliver"
    ];
    const paymentCluster = [
      "pay",
      "payment",
      "payments",
      "paying",
      "paid",
      "checkout",
      "option",
      "options",
      "method",
      "methods",
      "accept",
      "accepts",
      "accepted",
      "american express",
      "amex",
      "visa",
      "mastercard",
      "paypal",
      "apple pay",
      "google pay"
    ];
    const costCluster = ["much", "cost", "costs", "price", "prices", "fee", "fees", "charge", "charges"];
    const synonyms = {
      join: ["join", "joining", "signup", "sign up", "register", "enrol", "enroll", "buying group"],
      click: ["click"],
      collect: ["collect", "pickup", "pick up"],
      goodness: ["goodness"],
      group: ["group"],
      delivery: shippingDeliveryCluster,
      shipping: shippingDeliveryCluster,
      freight: shippingDeliveryCluster,
      postage: shippingDeliveryCluster,
      dispatch: shippingDeliveryCluster,
      courier: shippingDeliveryCluster,
      ship: shippingDeliveryCluster,
      deliver: shippingDeliveryCluster,
      pay: paymentCluster,
      payment: paymentCluster,
      payments: paymentCluster,
      paying: paymentCluster,
      paid: paymentCluster,
      checkout: paymentCluster,
      option: paymentCluster,
      options: paymentCluster,
      method: paymentCluster,
      methods: paymentCluster,
      accept: paymentCluster,
      accepts: paymentCluster,
      accepted: paymentCluster,
      much: costCluster,
      cost: costCluster,
      costs: costCluster,
      price: costCluster,
      prices: costCluster,
      fee: costCluster,
      fees: costCluster,
      charge: costCluster,
      charges: costCluster,
      american: ["american", "amex"],
      amex: ["amex", "american"],
      express: ["express", "amex", "american express"],
      visa: ["visa"],
      mastercard: ["mastercard", "master"],
      paypal: ["paypal"],
      paypall: ["paypal"],
      apple: ["apple"],
      applepay: ["apple", "pay", "apple pay"],
      google: ["google"],
      googlepay: ["google", "pay", "google pay"]
    };
    const normalizedQuery = this.normalizeText(query).replace(/\bamerican express\b/g, "amex");
    const raw = normalizedQuery.split(/\s+/).filter(Boolean).filter((token) => !stopWords.has(token));
    const deduped = [];
    for (const token of raw) {
      if (!deduped.includes(token)) deduped.push(token);
    }
    return deduped.map((token) => {
      const group = synonyms[token] ?? [token];
      const seen = /* @__PURE__ */ new Set();
      const normalizedGroup = [];
      for (const candidate of group) {
        const normalized = this.normalizeText(candidate);
        if (normalized && !seen.has(normalized)) {
          seen.add(normalized);
          normalizedGroup.push(normalized);
        }
      }
      return normalizedGroup;
    }).filter((group) => group.length > 0);
  }
  static {
    /**
     * Greeting and grammar that Zoho's keyword search treats as content.
     * Superset of the stop-words used for lexical matching: this list also drops
     * conversational openers, because the customer is typing at a chat box rather
     * than a search field.
     */
    this.QUERY_FILLER = /* @__PURE__ */ new Set([
      "a",
      "about",
      "an",
      "and",
      "any",
      "anyone",
      "are",
      "as",
      "at",
      "be",
      "been",
      "but",
      "by",
      "can",
      "could",
      "did",
      "do",
      "does",
      "for",
      "from",
      "get",
      "guys",
      "have",
      "hello",
      "hey",
      "hi",
      "how",
      "i",
      "if",
      "in",
      "is",
      "it",
      "its",
      "just",
      "know",
      "like",
      "me",
      "my",
      "need",
      "of",
      "on",
      "or",
      "our",
      "please",
      "so",
      "some",
      "tell",
      "thanks",
      "that",
      "the",
      "their",
      "them",
      "there",
      "these",
      "they",
      "this",
      "to",
      "us",
      "want",
      "was",
      "we",
      "were",
      "what",
      "when",
      "where",
      "which",
      "who",
      "why",
      "will",
      "with",
      "wondering",
      "would",
      "you",
      "your",
      "yours",
      // Generic commerce nouns. They look like content words but carry no
      // discriminating power in a food catalogue, and they are what pulled
      // "Hi is your product kosher" towards every article titled "Is your ...".
      "good",
      "goods",
      "item",
      "items",
      "order",
      "orders",
      "produce",
      "product",
      "products",
      "stock",
      "stuff",
      "thing",
      "things"
    ]);
  }
  /**
   * Retry queries built by stripping filler from the customer's sentence.
   *
   * Found in the Cloud Run logs 21 Sep 2026, from Iri's sweep. "Hi is your
   * product kosher" returned "Is your packaging recyclable?", "Is your Coconut
   * Cream homogenised?" and three more of the same shape: Zoho matched the
   * phrase "is your" and never scored the one word that mattered. The same
   * customer asking "are you kosher certified" got the right article first hit.
   *
   * So the distinctive word has to be searched on its own. Two extra queries at
   * most, and only when searchPortalWithFallbacks judges the primary result weak,
   * so an ordinary hit still costs one API call.
   *
   * Public for tests: the distillation is the part with logic in it, and it can
   * be checked without touching Zoho.
   */
  buildKeywordFallbackQueries(query) {
    const words = this.normalizeText(query).split(" ").filter((w) => w.length > 1 && !_ZohoKbToolService.QUERY_FILLER.has(w));
    if (words.length === 0) return [];
    const phrase = words.join(" ");
    if (phrase === this.normalizeText(query)) return [];
    return [phrase];
  }
  getPaymentFallbackQueries(query) {
    const normalized = this.normalizeText(query);
    const looksLikePaymentIntent = /(pay|payment|method|option|checkout|amex|american express|visa|mastercard|paypal|apple pay|google pay)/.test(normalized);
    if (!looksLikePaymentIntent) return [];
    const fallbacks = ["payment options", "payment methods"];
    if (PaymentSegmentGate.mentionsGroupGoodness(query)) {
      fallbacks.push("group goodness payment options", "what payment options you offer");
    }
    if (/(amex|american express)/.test(normalized)) {
      fallbacks.push("what payment options you offer", "american express payment");
    }
    if (/apple pay/.test(normalized)) {
      fallbacks.push("what payment options you offer", "apple pay payment");
    }
    if (/paypal/.test(normalized)) {
      fallbacks.push("what payment options you offer", "paypal payment");
    }
    return Array.from(new Set(fallbacks));
  }
  normalizeText(text) {
    return text.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  }
  matchesToken(text, token) {
    if (!token) return false;
    if (token.includes(" ")) {
      return text.includes(token);
    }
    return text.split(" ").includes(token);
  }
  async articlesAnswerQuery(query, articles, portalLabel) {
    const articleList = articles.map((a, i) => `${i + 1}. ${a.title}: ${a.summary}`).join("\n");
    const prompt = `Question: "${query}"

Articles found:
${articleList}

Do any of these articles answer or substantially help answer the question?
- Reply "yes" if wording differs but the topic matches (e.g. "delivery" vs "shipping" or "freight" for costs; "pay" vs "payment" or "checkout").
- Reply "yes" for short follow-ups about a card or method (e.g. "American Express", "Visa") if an article lists that method among accepted payments.
- Prefer "yes" when an article explains the same concept in general, even if the title uses different words.
Reply with only "yes" or "no".`;
    try {
      const genAI = new GoogleGenerativeAI(settings.gemini.apiKey);
      const model = genAI.getGenerativeModel({
        model: settings.gemini.model,
        generationConfig: { maxOutputTokens: 10, temperature: 0 }
      });
      const result = await model.generateContent(prompt);
      const answer = result.response.text().trim().toLowerCase();
      logger3.info(`Relevance check for ${portalLabel} articles: "${answer}"`);
      if (answer.startsWith("yes")) return true;
      if (answer.startsWith("no")) return false;
      const fallbackScore = this.scoreArticleSet(query, articles);
      logger3.warn(
        `Ambiguous relevance response for ${portalLabel}; fallback lexical score=${fallbackScore}.`
      );
      return fallbackScore >= 4;
    } catch (err) {
      logger3.warn("Relevance check failed, assuming articles are relevant", err);
      return true;
    }
  }
  rankArticlesForQuery(query, articles) {
    return [...articles].sort((a, b) => this.scoreArticle(query, b) - this.scoreArticle(query, a));
  }
  scoreArticleSet(query, articles) {
    if (articles.length === 0) return 0;
    const top3 = articles.slice(0, 3);
    return top3.reduce((sum, article) => sum + this.scoreArticle(query, article), 0);
  }
  scoreArticle(query, article) {
    const groups = this.extractQueryKeywordGroups(query);
    if (groups.length === 0) return 0;
    const title = this.normalizeText(article.title);
    const summary = this.normalizeText(article.summary);
    const queryNorm = this.normalizeText(query);
    const fullText = `${title} ${summary}`;
    const titleMatches = groups.filter((group) => group.some((token) => this.matchesToken(title, token))).length;
    const bodyMatches = groups.filter((group) => group.some((token) => this.matchesToken(fullText, token))).length;
    let score = titleMatches * 3 + bodyMatches;
    if (queryNorm && title.includes(queryNorm)) score += 4;
    const paymentIntent = /(pay|payment|amex|visa|mastercard|paypal|apple|google|option|method|accept)/.test(queryNorm);
    if (paymentIntent) {
      if (/(pay|payment|checkout|visa|mastercard|amex|paypal|apple pay|google pay)/.test(fullText)) score += 3;
    }
    const shippingIntent = /(deliver|shipping|freight|postage|courier|dispatch|ship)/.test(queryNorm);
    if (shippingIntent) {
      if (/(deliver|shipping|freight|postage|courier|dispatch|ship)/.test(fullText)) score += 3;
    }
    return score;
  }
  findPaymentOptionsArticle(articles) {
    return articles.find(
      (article) => /payment option|payment method/i.test(this.normalizeText(article.title))
    );
  }
  promotePaymentArticle(articles) {
    const index = articles.findIndex(
      (article) => /payment option|payment method/i.test(this.normalizeText(article.title))
    );
    if (index <= 0) return articles;
    const reordered = [...articles];
    const [paymentArticle] = reordered.splice(index, 1);
    return [paymentArticle, ...reordered];
  }
  hasPaymentArticleMatch(query, articles) {
    const paymentArticle = this.findPaymentOptionsArticle(articles);
    if (!paymentArticle) return false;
    const normalizedQuery = this.normalizeText(query);
    const body = this.normalizeText(`${paymentArticle.title} ${paymentArticle.summary}`);
    if (/(amex|american express)/.test(normalizedQuery)) {
      return /(amex|american express)/.test(body);
    }
    if (/(two cards?|multiple cards?|split pay)/.test(normalizedQuery)) {
      return /(credit card|bank transfer)/.test(body);
    }
    if (PaymentSegmentGate.looksLikePaymentIntent(normalizedQuery)) {
      return /(pay|payment|visa|mastercard|amex|paypal|credit card|bank transfer)/.test(body);
    }
    return false;
  }
};

// scripts/kb-query-distill-tests.src.ts
var svc = new ZohoKbToolService();
var CASES = [
  {
    query: "Hi is your product kosher",
    exact: ["kosher"],
    because: "the live failure. 'kosher' is the whole question; 'product' is noise that matched every 'Is your ...' article"
  },
  {
    // Guards the bug in the FIRST cut of this function, which searched for the
    // longest remaining word and so retried on "product" rather than "kosher".
    query: "Hi is your product kosher",
    mustNotContain: ["product", "product kosher"],
    because: "a retry on the generic word is worse than no retry at all"
  },
  {
    query: "are you kosher certified",
    mustContain: ["kosher certified"],
    mustNotContain: ["are you kosher certified", "certified"],
    because: "this one already works; the retry must not repeat it or degrade it to a generic word"
  },
  {
    query: "what is the shelf life on your products",
    exact: ["shelf life"],
    because: "'products' carries nothing in a food catalogue"
  },
  {
    query: "do you have any gluten free oats",
    exact: ["gluten free oats"],
    because: "three real content words, all kept, in order"
  },
  {
    query: "is my order kosher certified",
    exact: ["kosher certified"],
    because: "'order' is filler here even though it is a real word elsewhere in the system"
  },
  {
    query: "kosher",
    exact: [],
    because: "nothing to strip, so no retry; re-running the identical query is a wasted API call"
  },
  {
    query: "hi",
    exact: [],
    because: "filler only, nothing left to search on"
  },
  {
    query: "hello there",
    exact: [],
    because: "still nothing worth a search"
  },
  {
    query: "is your packaging recyclable",
    exact: ["packaging recyclable"],
    because: "both words are discriminating, so both stay"
  }
];
(() => {
  let pass = 0, fail = 0;
  for (const c of CASES) {
    const got = svc.buildKeywordFallbackQueries(c.query);
    const notes = [];
    let ok = true;
    if (c.exact) {
      if (JSON.stringify(got) !== JSON.stringify(c.exact)) {
        ok = false;
        notes.push(`expected exactly ${JSON.stringify(c.exact)}, got ${JSON.stringify(got)}`);
      }
    }
    for (const want of c.mustContain ?? []) {
      if (!got.includes(want)) {
        ok = false;
        notes.push(`missing "${want}" in ${JSON.stringify(got)}`);
      }
    }
    for (const avoid of c.mustNotContain ?? []) {
      if (got.includes(avoid)) {
        ok = false;
        notes.push(`should not contain "${avoid}" in ${JSON.stringify(got)}`);
      }
    }
    const normalised = c.query.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    if (got.includes(normalised)) {
      ok = false;
      notes.push(`retry is identical to the original query: "${normalised}"`);
    }
    if (got.length > 1) {
      ok = false;
      notes.push(`${got.length} fallbacks; at most 1 extra Zoho call per portal`);
    }
    if (ok) pass++;
    else fail++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${JSON.stringify(c.query)} -> ${JSON.stringify(got)}`);
    if (!ok) {
      for (const nte of notes) console.log(`        ${nte}`);
      console.log(`        why it matters: ${c.because}`);
    }
  }
  console.log(`
${pass} passed, ${fail} failed, ${CASES.length} total`);
  process.exit(fail ? 1 : 0);
})();
