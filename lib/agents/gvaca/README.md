# GVACA (Gaming Venue Automation & Compliance Assistant)

Technical module for the multi-agent template: **Australian licensed gaming venue** compliance co-pilot. Business context lives in `NEXT_STEPS.md` at repo root; this file is for engineers.

## Why three agents instead of one?

Regulatory domains (AML/CTF, responsible gambling, liquor/WHS, etc.) must not be **cross-contaminated** with commercial or revenue-optimisation reasoning. A single LLM that can be steered toward “convenience” over statutory duty is a liability in audits.

We implement separation as **three preset agents** (separate system prompts, welcomes, and optional tools):

| Preset ID | Purpose |
|-----------|---------|
| `gvaca-rgr` | Responsible Gambling Register assistant + structured `record_rgr_entry` tool |
| `gvaca-compliance` | Statutory / regulatory Q&A only |
| `gvaca-operations` | Operational productivity; must **redirect** compliance questions to the other agents |

Presets are defined in `GvacaPresetRegistry.ts` and applied when creating an agent via `POST /api/agents` with `"preset": "gvaca-rgr"` (etc.), which stores `templatePresetId` in GCS config.

## Folder layout (product vs shared)

- **`lib/agents/gvaca/`** — GVACA product code: prompts, registry, RGR schema, venue helpers, **product-specific tools** under `tools/`.
- **`lib/services/tools/`** — **Shared** tools (e.g. invoices, Zoho KB) used across products.

Rule: **new GVACA-only tools go under `lib/agents/gvaca/tools/`**, not next to `InvoiceToolService`.

## RGR structured entry (`record_rgr_entry`)

- **Tool:** `lib/agents/gvaca/tools/RgrEntryToolService.ts`
- **Schema:** `rgrEntrySchema.ts` — `GvacaRgrEntryV1`, discriminator `schema: "gvaca_rgr_entry_v1"`.
- **Fields:** include **`venue_id`** on every stored record (multi-tenant partition key).
- **Server fields:** `recorded_at_utc` is set when the tool runs; do not trust the model for wall-clock time.
- **Attachment:** `AgentToolRegistry` adds this tool when `agentId === 'gvaca-rgr'` or `config.templatePresetId === 'gvaca-rgr'`.

The chat UI accumulates RGR payloads separately from invoice `extractedData` (see `ChatWindow.tsx`).

## How `venue_id` enters the system

**Precedence (highest first):**

1. **Path** — `POST /api/venues/{venueId}/chat` (body same as `/api/chat`; path wins for `venueId`).
2. **JSON body** — `venueId` on `POST /api/chat`.
3. **Header** — `x-gvaca-venue-id` on `POST /api/chat`.
4. **Environment** — `GVACA_DEFAULT_VENUE_ID` in `lib/config/settings.ts` (single-venue pilot default).

**Browser (optional):** `sessionStorage.setItem('gvaca-venue-id', 'your-venue-key')` — the dashboard chat client forwards this as JSON `venueId` on `POST /api/chat` when set.

Resolution is implemented in `venueContext.ts` (`resolveVenueIdForRequest`). The RGR tool uses the resolved value passed in `ToolExecutionParams.venueId`, with an optional **last-resort** `venue_id` from the model args only if nothing else is set (dev / migration only — prefer always setting server-side).

If **no** venue can be resolved, `record_rgr_entry` returns an error tool response (no silent cross-venue writes).

## Phase 1 scope (current)

- Staff-supplied facts; **no** venue POS/EGM/HR API integrations.
- Chat → `record_rgr_entry` → **`POST /api/venues/{venueId}/rgr-entries`** appends one JSON line to **`venues/{venueId}/rgr/{entry_date}.jsonl`** in GCS (via `GcsClient.appendJsonlLine`). The tool POSTs using **`NEXT_PUBLIC_APP_URL`** (see `settings.app.publicBaseUrl`); persistence failures are logged but do not fail the tool (chat + `extractedData` still return).
- **`GET /api/venues/{venueId}/rgr-entries?date=YYYY-MM-DD`** returns parsed lines for that day.
- **Not built:** FRT/CV, predictive patron ML, supplier integrations, lighting/music/floor “optimisation” (see `NEXT_STEPS.md`).

## Test fixtures

Example `GvacaRgrEntryV1` JSON files (Frankston-style audit scenarios) live in `fixtures/rgr/`. Use them for demos, unit tests, and prompt regression.

## Related API routes

| Route | Role |
|-------|------|
| `POST /api/chat` | Main chat; optional `venueId` body or `x-gvaca-venue-id` |
| `POST /api/venues/{venueId}/chat` | Same as chat with path-scoped venue |
| `GET/POST /api/venues/{venueId}/rgr-entries` | Read / append RGR JSONL in GCS |
| `GET /api/agents/presets` | Lists GVACA templates for the dashboard |
| `POST /api/agents` | Create agent; optional `preset` |
