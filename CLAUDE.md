# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Clean Code Architecture

### Guiding principles

All new code must follow these conventions for modularity and maintainability:

1. **Centralised config** — environment variables and settings are read **once** in `lib/config/settings.ts` and exported as a typed singleton. Services never call `process.env` directly.
2. **Centralised logger** — use `getLogger(name)` from `lib/config/logger.ts` at the top of every module. Never use `console.log/warn/error` directly.
3. **Class-based services** — business logic lives in classes that receive settings via the singleton. Use `private readonly` fields for injected dependencies.
4. **One class per file** — each service file exports a single class. No mixed unrelated exports.

### Folder layout

```
lib/
├── config/
│   ├── settings.ts        # Typed config singleton (reads process.env once)
│   └── logger.ts          # getLogger() factory
└── services/
    └── <domain>/
        └── <ServiceName>.ts
```

### `lib/config/settings.ts`

```typescript
const settings = {
  gemini: {
    apiKey: process.env.GEMINI_API_KEY!,
    model: 'gemini-2.5-flash' as const,
    embeddingModel: 'gemini-embedding-001' as const,
    temperature: 0.1,
    maxOutputTokens: 65536,
  },
  gcs: {
    bucketName: process.env.GCS_BUCKET_NAME!,
    projectId: process.env.GCP_PROJECT_ID!,
    clientEmail: process.env.GCP_CLIENT_EMAIL!,
    privateKey: process.env.GCP_PRIVATE_KEY!.replace(/\\n/g, '\n'),
  },
  googleDrive: {
    defaultFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
  },
  auth: {
    sitePassword: process.env.SITE_PASSWORD!,
  },
} as const;

export { settings };
```

### `lib/config/logger.ts`

```typescript
export function getLogger(name: string) {
  return {
    info:  (msg: string, ...args: unknown[]) => console.log (`[${name}] INFO  ${msg}`, ...args),
    warn:  (msg: string, ...args: unknown[]) => console.warn(`[${name}] WARN  ${msg}`, ...args),
    error: (msg: string, ...args: unknown[]) => console.error(`[${name}] ERROR ${msg}`, ...args),
  };
}
```

### Service class pattern

```typescript
import { getLogger } from '@/lib/config/logger';
import { settings } from '@/lib/config/settings';

const logger = getLogger('EmbeddingService');

export class EmbeddingService {
  private readonly model: string;

  constructor() {
    this.model = settings.gemini.embeddingModel;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const start = Date.now();
    const normalized = text.replace(/\n/g, ' ');
    // ... call Gemini with this.model
    logger.info(`Embedding generated in ${Date.now() - start}ms`);
    return embedding;
  }
}
```

### Do / Don't

| Do | Don't |
|---|---|
| Import `settings` from `@/lib/config/settings` | Read `process.env` inline inside a function |
| Use `getLogger('ClassName')` at module scope | Sprinkle `console.log` throughout |
| Export a single class per file | Mix multiple unrelated classes in one file |
| Use `private readonly` for injected config | Mutate service state after construction |
| Keep API routes as thin controllers | Put business logic directly in route handlers |

---

## Commands

```bash
# Development
npm run dev       # Start Next.js dev server at http://localhost:3000

# Production
npm run build
npm start

# Lint
npm run lint
```

No test framework is configured in this project.

## Environment Variables

Copy `.env.example` to `.env.local` and fill in:

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Google Gemini AI API key (required for chat) |
| `SITE_PASSWORD` | Password for the lock-screen auth (`/api/auth`) |
| `GCP_PROJECT_ID` / `GCP_CLIENT_EMAIL` / `GCP_PRIVATE_KEY` | GCP service account credentials for GCS and Google Drive |
| `GCS_BUCKET_NAME` | GCS bucket for agent configs and knowledge-base JSON |
| `GOOGLE_DRIVE_FOLDER_ID` | Default Drive folder for the knowledge base (agents may override) |
| `LANGCHAIN_API_KEY` | Optional — LangSmith tracing |

`GCP_PRIVATE_KEY` must be stored with literal `\n` in the env file; the code converts them with `.replace(/\\n/g, '\n')`.

## Architecture

### Multi-agent platform

The app is a **multi-agent AI chat platform**. The home page (`/`) is an agent management dashboard. Each agent has its own page at `/agent/[agentId]` with a split-panel layout: a prompt editor on the left and a chat window on the right.

All pages are behind a simple password lock screen. Auth state is stored in `sessionStorage` (`app-auth = 'true'`).

### GCS as the data store

All persistent state lives in Google Cloud Storage (`GCS_BUCKET_NAME`):

- `settings.json` — global/default agent config
- `system-settings.json` — global system prompt applied to every agent
- `agents/{agentId}/settings.json` — per-agent config (`PromptConfig`: system prompt, welcome message, agent name, `kbFolderId`)
- `agents/{agentId}/knowledge-base.json` — serialised vector index (chunks + embeddings + file metadata)

Agent configs are fetched via `lib/gcs-client.ts` (`getPromptConfig`, `getSystemSettings`, `listAgents`, `deleteAgent`, `savePromptConfig`).

Agents are also defined in a hard-coded list in `app/api/agents/route.ts` (`HARDCODED_AGENTS`). The GET handler merges hard-coded entries with any dynamic GCS agents.

### Knowledge-base pipeline

Documents are sourced from **Google Drive** (Docs and Sheets only; other MIME types are skipped). Indexing is triggered via `POST /api/knowledge-base/index`:

1. `lib/document-fetcher.ts` — lists Drive folder, fetches text from Docs/Sheets via Google APIs
2. `lib/document-chunker.ts` — splits text into chunks; `findSimilarChunks` does cosine-similarity search
3. `lib/embeddings.ts` — calls Gemini to generate embeddings for chunks
4. `lib/knowledge-base-storage.ts` — saves/loads the resulting JSON to GCS; in-memory cache with 10-minute TTL

Each agent can have its own Drive folder (`kbFolderId` in its settings). If `kbFolderId` is `''` (empty string), the agent has no KB. If `undefined`, it falls back to `GOOGLE_DRIVE_FOLDER_ID`.

### Chat pipeline (`lib/services/chat/`)

The chat endpoint (`POST /api/chat`) is a thin controller that delegates to `GeminiChatService`. The service layer is split across four classes:

- **`GeminiChatService`** — orchestrator; drives a **two-turn Gemini function-calling flow** when invoice files are uploaded (Turn 1: user prompt + tool declaration → Turn 2: tool result → human-readable response)
- **`ContextService`** — builds all context strings: file content (with budget capping), KB semantic search results (`buildKnowledgeBaseContext`), and full guide-document context for invoice extraction (`buildGuideDocumentContext`)
- **`InvoiceToolService`** — owns the `process_invoices` Gemini function declaration and executes the extraction pipeline; the extraction itself is a separate Gemini call using the prompt templates from `lib/prompts.ts`
- **`ConversationHistoryService`** — formats conversation history for injection into prompts
- **`PromptBuilderService`** — (exists alongside `GeminiChatService`; the chat route currently uses `GeminiChatService` directly, which has absorbed this logic inline)

The final LLM prompt uses `{{context}}` and `{{message}}` placeholders, which the service replaces. The global system prompt and the agent-specific prompt are concatenated with `---` between them.

### Invoice extraction (Base 1 Review agent)

When a user uploads files and the agent has the knowledge base enabled, `GeminiChatService` attaches the `process_invoices` tool. If Gemini decides to call it:

1. `InvoiceToolService.execute()` calls `ContextService.buildGuideDocumentContext()` to retrieve ALL chunks from files prefixed `ELECTRICITY_GUIDE`, `GAS_GUIDE`, `WATER_GUIDE`, `WASTE_GUIDE`, `OIL_GUIDE` in the KB (these are benchmark/rules documents, not subject to semantic search)
2. The combined context is injected into `buildInvoiceExtractionPrompt()` from `lib/prompts.ts`
3. A second Gemini call runs the extraction and returns structured JSON
4. The JSON is parsed by `lib/json-parser.ts` and passed back as `extractedData`
5. When `generateReport: true`, the frontend triggers Excel report generation via `POST /api/export/generate-report`

### Key API routes

| Route | Purpose |
|---|---|
| `POST /api/chat` | Main chat endpoint |
| `GET/POST /api/agents` | List or create agents |
| `DELETE /api/agents/[agentId]` | Delete agent and all its GCS files |
| `GET/PUT /api/prompt` | Get/save agent prompt config |
| `GET/PUT /api/system-settings` | Get/save global system prompt |
| `GET/POST /api/knowledge-base/index` | Read KB status or trigger re-indexing |
| `POST /api/knowledge-base/query` | Vector search query |
| `POST /api/export/generate-report` | Generate Excel report from extracted invoice data |
| `POST /api/end-of-chat-report` | Post-chat logging to Google Sheets |
| `POST /api/uploads` | Handle file uploads for chat |
| `POST /api/auth` | Password authentication |

### Prompt template conventions

Agent prompts must contain `{{context}}` and `{{message}}` placeholders. The `{{context}}` slot receives conversation history, KB results, and/or uploaded file content depending on mode.

The AI model used throughout is `gemini-2.5-flash` with `temperature: 0.1` and `maxOutputTokens: 65536`.

LangSmith tracing is applied to KB retrieval steps via `traceable()` from `langsmith/traceable`.
