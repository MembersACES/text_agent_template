# Pre-go-live API hardening plan — `/api/chat`

_Morgan · 3 August 2026 · PLAN ONLY — no route or `OrderStatusGate` changes made._
_This is the gate that must land before order tracking is wired into `/api/chat`._

## Why (rationale — cost/abuse and hygiene, NOT enumeration)

To be explicit about the threat model, because it drives the controls: the order lookup is **not** an enumeration risk. dotWMS requires the matching delivery email, so walking sequential 6-digit BigCommerce order numbers returns nothing without each order's email. The current setup does **not** expose customer order data. So this plan is **not** scoped around enumeration.

The real reasons to gate the endpoint:

- **Cost/abuse.** `/api/chat` is public, unauthenticated, and unrate-limited (`app/api/chat/route.ts`). Anyone who finds the URL can drive unlimited Gemini calls (billed) and, once tracking is wired in, unlimited load against dotWMS and MachShip. That is a direct spend and third-party-quota liability.
- **Error hygiene.** The route returns `error.message` verbatim to the client (`route.ts:44-45`), leaking internal detail.
- **Embedding hygiene.** `Content-Security-Policy: frame-ancestors *` (`next.config.ts:13`) lets any site iframe the widget.

## Current state (verified against the code)

- **Auth:** none. Only validation is `if (!message)` → 400 (`route.ts:21-23`). `agentId`, `conversationHistory`, `uploadedFiles` pass straight through (`route.ts:19`).
- **Rate limiting:** none.
- **Errors:** `error.message` returned verbatim, HTTP 500 (`route.ts:44-45`).
- **CSP:** `frame-ancestors *` for `/:path*` (`next.config.ts:5-17`).
- **Call topology (important):** the widget iframe is served by the app itself at `/chat-widget` (Cloud Run: `aces-honest-to-goodness-agent-…run.app`) and is embedded on the BigCommerce storefronts via Script Manager (`HTG-BigCommerce-Embed.md`). So the browser calls `/api/chat` **same-origin** from the app-rendered widget page — not cross-origin from `goodness.com.au`. This is why a signed short-lived token minted by the widget page is a better gate than an Origin allowlist (the legitimate Origin is just the app's own domain, which an attacker can also target directly).

## Controls (in recommended sequence)

### Tier 1 — pure-app, low-risk, do first

1. **Stop leaking `error.message`.** Return a generic body (`{ error: 'Something went wrong', correlationId }`) and log the real error + correlationId server-side (the logger and `chatMessageTrace` are already in this route). Change is local to `route.ts`.
2. **Payload caps + input validation.** Cap `message` length (e.g. ≤ 4–8k chars), cap `conversationHistory` entries, cap `uploadedFiles` count/size, and validate `agentId` against the known agent list. Rejects oversized requests that inflate Gemini cost. Local to `route.ts` (+ a small validator).
3. **Tighten `frame-ancestors`.** Replace `*` with the HTG storefront origins only, e.g.
   `frame-ancestors https://goodness.com.au https://www.goodness.com.au https://sandbox-honest-to-goodness.mybigcommerce.com;`
   Confirm the exact production domain(s) with Welly before shipping. Local to `next.config.ts`. Add `X-Content-Type-Options: nosniff` while there.

### Tier 2 — the real gate

4. **Short-lived signed request token.** When `/chat-widget` renders, mint an HMAC token server-side (server secret + short expiry, e.g. 30–60 min, optionally bound to a nonce). The widget sends it as a header on every `/api/chat` call; the route verifies signature + expiry and rejects otherwise. Because the token is minted by the app-rendered page (not present in the storefront embed snippet), a scripted attacker hitting `/api/chat` directly has no valid token. Pair with a same-origin `Origin`/`Referer` sanity check as cheap defence-in-depth (reject obviously foreign origins; treat as secondary since it's spoofable outside browsers).

### Tier 3 — rate limiting (infra decision needed)

5. **Rate limit per-IP + a global ceiling.** Cloud Run is multi-instance, so an in-memory limiter won't hold across instances — it needs a shared store or edge enforcement. Two options:
   - **Edge (stronger):** Google Cloud Armor per-IP rate limiting. Caveat: Cloud Armor sits in front of a HTTPS Load Balancer, but the widget currently hits the `*.run.app` URL **directly** (`HTG-BigCommerce-Embed.md`). Using Cloud Armor means fronting the service with a LB + custom domain and pointing the embed at it — more infra.
   - **App-level (pragmatic, no topology change):** a limiter keyed by client IP backed by a shared store (Firestore or Memorystore/Redis; the project already uses GCP). Simpler to ship against the current direct-`run.app` setup.
   - **Recommendation:** ship app-level limiting now (fits the current topology); adopt Cloud Armor if/when the service is fronted by a LB. Set conservative limits (e.g. per-IP N/min with burst, plus a global cap) and return HTTP 429.

### Tier 4 — optional, only if abuse appears

6. Bot mitigation (Cloud Armor bot management, or a lightweight challenge on the widget). Not needed for launch; hold in reserve.

## Open questions — CONFIRM WITH WELLY BEFORE BUILDING (do not guess)

Two infrastructure unknowns are deliberately left open. They don't block the *plan*, but each changes what gets built, so confirm both with Welly before writing the code — don't assume:

1. **Exact production storefront domain(s)** the widget is embedded on, for the `frame-ancestors` allowlist. Likely `goodness.com.au` (+ `www`?) and the sandbox host, but the real list must come from Welly — guessing risks either leaving `*` open or breaking the live embed.
2. **Is the Cloud Run service fronted by a HTTPS Load Balancer, or hit directly on the `run.app` URL?** The embed currently points at the `run.app` URL directly (`HTG-BigCommerce-Embed.md`), which would mean **app-level rate limiting**; if it's (or will be) behind a load balancer, **Cloud Armor** at the edge is the stronger choice. This is the fork that decides the entire rate-limiting approach — confirm before building either.

Secondary, follow-on from (2): if app-level limiting, the **shared store** (Firestore vs Memorystore/Redis) given the existing GCP footprint — also a Welly confirm.

## Verification (how each control is proven)

- Error hygiene: trigger a handled error, assert the response body carries no internal message, only a correlationId; assert full detail is in the server log.
- Payload caps: send an oversized `message`/`conversationHistory`/`uploadedFiles`, assert 400 before any Gemini call.
- `frame-ancestors`: assert the CSP header value on a response; attempt to iframe from a non-HTG origin and confirm the browser blocks it.
- Signed token: call `/api/chat` with no/expired/tampered token → 401/403; call from the real widget → 200.
- Rate limit: script N+1 requests within the window from one IP → 429 after the limit; confirm a normal session is unaffected.

## Sequencing note

Tier 1 is safe to land immediately and independently. Tier 2 + Tier 3 are the substantive gate. **All of this precedes** wiring `OrderTrackingService` into `/api/chat` and rewriting `OrderStatusGate` — order tracking must not serve customer data through the endpoint until at least Tiers 1–3 are in place.
