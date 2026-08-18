# Go-Live Smoke Checklist — Order Tracking + Internal Alerts

_Run this against the **deployed** build (not localhost) immediately after flipping `ORDER_TRACKING_ENABLED=true`. ~15 min. Tick each row; if any fail, don't proceed to alerts / don't repoint n8n to info@._

---

## Pre-flight (before typing anything)

- [ ] Code is actually **deployed** — the live Cloud Run build contains the tracking + alert wiring (push landed, deploy green). Every check below is meaningless if you're testing an old build.
- [ ] `ORDER_TRACKING_ENABLED=true` in the **prod** env.
- [ ] `LANGCHAIN_TRACING_V2` value in prod is **known** (redaction covers PII either way — but know which it is).
- [ ] `CHAT_ALLOWED_ORIGINS` set to the three domains; `CHAT_REQUIRE_TOKEN` still **off** (turn on only after the token round-trip below).
- [ ] For the alert rows (Part B): `ALERTS_ENABLED=true`, `ALERTS_TRANSPORT=webhook`, and **n8n still pointing at members@** — you receive the test alerts, not the HTG team.
- [ ] Have 4 real recent orders to hand (from your examples, don't paste them here): one **delivered**, one **in-transit**, one **own-driver**, and one whose details you'll deliberately mistype.

> Copy note: every line below except the **own-driver** line and the **ETA disclaimer** is still **DRAFT pending Iri's sign-off** (handoff item #2). Verify the branching renders correctly here; treat the exact wording as Iri's to edit.

---

## Part A — Tracking states (customer self-serve)

| # | Type into the widget | Expect (customer sees) | Backend | Pass |
|---|---|---|---|---|
| A1 | A **delivered** order number + its email | "Your order has been delivered." | `state=delivered` | ☐ |
| A2 | An **in-transit** order + email | "Your order is on its way with [courier], expected [date]. If you haven't received it within 24 hours… chase it up." | `state=in_transit`, ETA disclaimer appended | ☐ |
| A3 | An **own-driver** order (8-digit, not in MachShip) + email | "Your order has been packed and is out for delivery on the H2G run delivery day." | `state=own_driver_out` | ☐ |
| A4 | Order **older than 60 days** + email | "That order is outside the window I can look up here (the last 60 days)…" | `state=tooOld` | ☐ |
| A5 | Ask a general delivery question with **no order** ("where's my order?") | Agent asks for order number + email (doesn't crash / doesn't KB-deflect) | ask-for-details | ☐ |

## Part B — Alert triggers (staged; n8n → members@)

| # | Sequence | Expect (customer sees) | Alert | Pass |
|---|---|---|---|---|
| B1 | **not_found → CS.** Send a plausible-but-wrong order+email → then **re-send the same** details | 1st: "double-check both…" (no alert). 2nd: flagged-with-CS message | 2nd turn fires **one CS** email to members@; 1st fires **nothing** | ☐ |
| B2 | not_found, but on the retry **change** the details | Fresh lookup, no "flagged" claim | **No** alert (different details restart the cycle) | ☐ |
| B3 | **queued_chasing → WH.** A verified order still in packing + chase language ("it's been days, still not shipped") | Preparing/handoff response | **One WH** email to members@ | ☐ |
| B4 | **wont_wait → CS.** After a partly-delivered result, say "I don't want to wait for the rest / just refund it" | CS-flagged response | **One CS** email | ☐ (blocked — see gaps) |
| B5 | **Dedup.** Repeat B1's re-confirmed miss twice in the same chat | — | Only **one** email, not two | ☐ |
| B6 | **Kill switch.** Set `ALERTS_ENABLED=false`, repeat B1 | Same customer text | **No** email at all | ☐ |

## Part C — Robustness & security

| # | Type into the widget | Expect | Pass |
|---|---|---|---|
| C1 | Correct order, **wrong email** | Single "couldn't find it" — never reveals whether number or email was wrong | ☐ |
| C2 | Correct order + email but **trailing punctuation** ("…email me@x.com.") | Resolves normally (the extraction fix) — not a false "not found" | ☐ |
| C3 | Correct email in **UPPERCASE** / with stray spaces | Resolves normally | ☐ |

---

## Sign-off gaps to close (not blockers to the flip, but before you lean on them)

- **B4 / partial-delivery is unprovable today.** All live examples are single-consignment; the "2 of 3 boxes delivered" split message — the headline phase-1 feature — has never fired on real data. Ask Welly for one genuinely **split / partly-delivered** order and re-run A + B4 against it.
- **Draft copy sign-off (Iri).** Everything except the own-driver line and the ETA disclaimer is draft. Send Iri the rendered strings for a copy edit.
- **Token enforcement.** Before flipping `CHAT_REQUIRE_TOKEN=on`, confirm the browser mints and sends `x-chat-token` on the live site and a stale token 401-refreshes without dead-ending the widget.
- **Repoint n8n members@ → info@** only after Part B is all green.
```
