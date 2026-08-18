# Go-Live Smoke Checklist — Order Tracking + Internal Alerts

_Stage 0 runs on **localhost** to catch breakage cheaply. Stages A–D run against the
**deployed** build immediately after flipping `ORDER_TRACKING_ENABLED=true`. ~15 min for
A–D. Tick each row; if any fail, don't proceed to alerts / don't repoint n8n to info@._

_Updated 18 Aug 2026 after the live test round — see "What changed" at the foot._

---

## Stage 0 — localhost first (before you deploy anything)

Cheaper to fail here than in a deploy cycle. In `.env.local` add:

```
ORDER_TRACKING_ENABLED=true
```

Then:

```
npm run build            # must pass — Turbopack fails on type errors
npm run dev
npm run health:chat      # second terminal; Phase-1 KB regression
```

Open `http://localhost:3000/htg-agent` (SITE_PASSWORD from `.env.local`) and run
rows A1–A5 and C1–C3 below against the widget.

> ⚠️ Alerts are LIVE from localhost. `ALERTS_ENABLED=true` + `ALERTS_TRANSPORT=webhook`
> means B-rows POST to the real n8n. That is fine **only while n8n still points at
> members@**. Confirm that before typing anything in Part B.

- [ ] `npm run build` green
- [ ] `npm run health:chat` — no regressions in the Phase-1 KB answers
- [ ] A + C rows pass locally
- [ ] Only then deploy

---

## Pre-flight (deployed build, before typing anything)

- [ ] Code is actually **deployed** — the live Cloud Run build contains the tracking + alert wiring (push landed, deploy green). Every check below is meaningless if you're testing an old build.
- [ ] `ORDER_TRACKING_ENABLED=true` in the **prod** env.
- [ ] `LANGCHAIN_TRACING_V2` value in prod is **known** (redaction covers PII either way — but know which it is).
- [ ] `CHAT_ALLOWED_ORIGINS` set to the three domains; `CHAT_REQUIRE_TOKEN` still **off** (turn on only after the token round-trip in Part D).
- [ ] For the alert rows (Part B): `ALERTS_ENABLED=true`, `ALERTS_TRANSPORT=webhook`, and **n8n still pointing at members@** — you receive the test alerts, not the HTG team.
- [ ] Have 5 real recent orders to hand (don't paste them here): one **delivered single-carton**, one **delivered multi-carton**, one **in-transit**, one **own-driver**, and one whose details you'll deliberately mistype.

> Copy note: every line below except the **own-driver** line and the **ETA disclaimer** is still **DRAFT pending Iri's sign-off** (handoff item #2). Verify the branching renders correctly here; treat the exact wording as Iri's to edit.

---

## Part A — Tracking states (customer self-serve)

| # | Type into the widget | Expect (customer sees) | Backend | Pass |
|---|---|---|---|---|
| A1 | A **delivered single-carton** order + its email | "Your order has been delivered." | `state=delivered`, boxCount=1 | ☐ |
| A1b | A **delivered multi-carton** order + its email | "All [N] boxes of your order have been delivered." — N must match the cartons the customer actually received | `state=delivered`, boxCount=N | ☐ |
| A2 | An **in-transit** order + email | "Your order is on its way in [N] boxes with [courier], expected [date]. If you haven't received it within 24 hours… chase it up." | `state=in_transit`, ETA disclaimer appended | ☐ |
| A3 | An **own-driver** order (8-digit, not in MachShip) + email | "Your order has been packed and is out for delivery on the H2G run delivery day." | `state=own_driver_out` | ☐ |
| A4 | Order **older than 60 days** + email | "That order is outside the window I can look up here (the last 60 days)…" | `state=too_old` | ☐ |
| A5 | Ask a general delivery question with **no order** ("where's my order?") | Agent asks for order number + email (doesn't crash / doesn't KB-deflect) | ask-for-details | ☐ |
| A6 | An order **out for delivery today** | "Your order is out for delivery today with [courier], in [N] boxes." | `state=out_for_delivery` | ☐ |
| A7 | A **partly delivered** order (MachShip status "Partial Delivery") | "Your order is coming in [N] boxes. Some have already been delivered and the rest are on their way with [courier], expected [date]." | `state=partly_delivered` | ☐ |

**A7 is the one that has never fired on live data.** See "What changed" below — the code
path is correct and the copy is right, but no example has been observed rendering it.

## Part B — Alert triggers (staged; n8n → members@)

| # | Sequence | Expect (customer sees) | Alert | Pass |
|---|---|---|---|---|
| B1 | **not_found → CS.** Send a plausible-but-wrong order+email → then **re-send the same** details | 1st: "double-check both…" (no alert). 2nd: flagged-with-CS message | 2nd turn fires **one CS** email to members@; 1st fires **nothing** | ☐ |
| B2 | not_found, but on the retry **change** the details | Fresh lookup, no "flagged" claim | **No** alert (different details restart the cycle) | ☐ |
| B3 | **queued_chasing → WH.** A verified order still in packing + chase language ("it's been days, still not shipped") | Preparing/handoff response | **One WH** email to members@ | ☐ |
| B4 | **wont_wait → CS.** After a partly-delivered result, say "I don't want to wait for the rest / just refund it" | CS-flagged response | **One CS** email | ☐ (needs an A7 order first) |
| B5 | **Dedup.** Repeat B1's re-confirmed miss twice in the same chat | — | Only **one** email, not two | ☐ |
| B6 | **Kill switch.** Set `ALERTS_ENABLED=false`, repeat B1 | Same customer text | **No** email at all | ☐ |
| B7 | **Subject line.** Open any alert from B1–B4 | — | Subject reads `H2G AI ALERT_CS_(Unknown)` — customer name is not populated (known gap). Decide whether Iri sees this or it's fixed first | ☐ |
| B8 | **From header.** Open any alert | — | From reads `members@acesolutions.com.au` — this is what Iri routes on and no script can verify it | ☐ |

## Part C — Robustness & security

| # | Type into the widget | Expect | Pass |
|---|---|---|---|
| C1 | Correct order, **wrong email** | Single "couldn't find it" — never reveals whether number or email was wrong | ☐ |
| C2 | Correct order + email but **trailing punctuation** ("…email me@x.com.") | Resolves normally (the extraction fix) — not a false "not found" | ☐ |
| C3 | Correct email in **UPPERCASE** / with stray spaces | Resolves normally | ☐ |

## Part D — Tier-1 hardening (committed 18 Aug, NOT yet exercised)

`rateLimiter.ts`, `requestToken.ts` and `chatRequest.ts` shipped in commit 751f361 and
nothing has tested them. `settings.ts:112-115` gates `ORDER_TRACKING_ENABLED` on this
hardening landing, so these are on the critical path.

| # | Test | Expect | Pass |
|---|---|---|---|
| D1 | **Payload cap.** POST /api/chat with a message far over the limit | 400 `Invalid request` + correlationId; raw payload never echoed | ☐ |
| D2 | **History cap.** Send a conversation longer than `CHAT_MAX_HISTORY` (default 50) | Truncated to the last N turns, not rejected | ☐ |
| D3 | **Rate limit.** Hammer /api/chat past the configured window from one IP | Throttled cleanly; widget degrades with a message, doesn't hang | ☐ |
| D4 | **Origin check.** With `CHAT_ALLOWED_ORIGINS` set, POST from a non-allowlisted origin | Rejected once the allowlist is populated (advisory while empty) | ☐ |
| D5 | **frame-ancestors.** Load the widget on the sandbox storefront with the allowlist set | Renders; CSP header lists exactly the three domains, not `*` | ☐ |
| D6 | **Token round-trip.** Widget GETs /api/chat-session and sends `x-chat-token` on /api/chat; then try a stale token | Mints and sends correctly; stale token refreshes without dead-ending the widget. **Only then** flip `CHAT_REQUIRE_TOKEN=on` | ☐ |

---

## Sign-off gaps to close

- **A7 / partial delivery has never been observed rendering.** The signal exists and the
  code handles it (see below), but every example order is `Complete`. One genuinely
  in-flight, part-delivered order closes this. Not a blocker.
- **Draft copy sign-off (Iri).** Everything except the own-driver line and the ETA
  disclaimer is draft. Send Iri the rendered strings for a copy edit — including the
  delayed / attempted / held / too-old / unknown lines he has never seen.
- **Alert subject shows `(Unknown)`.** `OrderStatusGate` passes `customerName: null`;
  `TrackingResult` carries no recipient name. Fix or disclose before Iri sees a sample.
- **`consignmentItems.length` = cartons?** This is now the number printed to customers.
  Three examples agree and surcharges sit in a separate array, but confirm with Welly
  that H2G never books one item with quantity > 1.
- **Repoint n8n members@ → info@** only after Part B is all green.

---

## What changed on 18 Aug 2026 (and why this file was wrong before)

**The "2 of 3 boxes delivered" message cannot be built as originally specified.**
`freight-split-finder` scanned 200 consignments over 9 days: 4 references had 2+
consignments in the feed, but all 4 returned `lookup=1` through the production
reference lookup. `freight-chain-harness` agrees — Ex1 (2 cartons), Ex2 (9), Ex5 (8) are
all `consignments=1` with `consolidatedIntoConsignmentId=null`. HTG books ONE consignment
holding N cartons. Separate-consignment splits do not occur on this account.

**Partial delivery is still detectable, just not countable.** `machship-partial-signal`
confirms MachShip exposes a `"Partial Delivery"` status name and a per-event
`statusIsPartial` boolean. `statusMap.ts` already maps it. What is NOT available is
per-carton delivery state — `consignmentItems[n]` carries `quantity` and nothing else.
So the copy can say "some have arrived, the rest are coming"; it cannot say how many.

**Box counts now use cartons, not consignments.** `OrderTrackingService` derives
`boxCount = Math.max(totalBoxes, totalItems)` and states it in the delivered,
in-transit, out-for-delivery and partial lines. Delivery status remains per-consignment,
because only a consignment carries one.

**Verified green on 18 Aug:** dotWMS email enforcement on the SO key (correct → FOUND,
wrong and malformed → nothing, 3 orders); all five examples end to end; own-driver;
carton counts; `alert-smoke` LIVE 8/8 through the real n8n webhook.
