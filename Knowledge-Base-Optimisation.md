# Knowledge base optimisation (Zoho Help Center)

This guide is for anyone who **writes or structures** articles in **Zoho Desk**—especially the planned **Systems Support** (internal / AI-oriented) department—so the Honest to Goodness chat agent can **find and use** the right content.

It complements the agent instructions in [`docs/Agent-Specific-Prompt.md`](docs/Agent-Specific-Prompt.md).

---

## 1. What the chat agent actually sees

The agent does **not** read your whole help centre like a browser. It uses a **search step** against each configured **public portal** (for example Contact & FAQs vs Group Goodness).

Roughly:

1. The customer (or tester) asks a question.
2. The assistant calls **Zoho’s knowledge-base search** with that question (sometimes with extra fallback searches).
3. Zoho returns a **small set of articles** (up to a handful per search).
4. For each hit, the integration passes to the model mainly:
   - **Title**
   - **Summary** (or short snippet—whatever Zoho returns on the search result row)
   - **Link** to the full article on the public portal  

So the **title and opening searchable text** matter more than layout lower down the page. If an important fact exists only in paragraph five or in a PDF, the model may **never** see it during search.

---

## 2. Why this feels different from “normal” KB writing

| Goal for humans | Goal for search + AI |
|------------------|----------------------|
| Polished long-form page | **Clear top-of-article** signal: title + first lines match how people ask |
| One mega FAQ covering many topics | **One main intent per article** so the right page wins ranking |
| Clever titles | **Literal titles** that include words customers use (“two cards”, “split payment”, “American Express”) |

You can still have beautiful customer-facing pages; for tricky flows, add or duplicate a **short, search-friendly** article or section that states the procedure plainly at the top.

---

## 3. Practical checklist for each article

### Title

- Use **plain language** and words a customer would type: e.g. “Pay with two credit cards (Group Goodness)” not only “Payment flexibility”.
- If the answer differs for **retail**, **wholesale**, or **Group Goodness**, say so in the title or split into separate articles.

### Summary / first screen (most important)

- Treat the **summary** field (or whatever appears in search results) as **must-read context for the bot**.
- Put **the answer or the critical steps in the first 1–3 sentences** where Zoho surfaces them to search:
  - who it applies to (retail / wholesale / Group Goodness),
  - the rule in one line,
  - phone number or form link if escalation is the answer.

### One topic per article

- Avoid one article that answers **five unrelated** questions—search will match it weakly for all of them.
- Prefer **cross-links** (“See also …”) over stuffing alternate scenarios into one long page without clear headings.

### Tables and lists

- **Tables** (postcodes, weight tiers, minimum spend) work well **if** the important cells are still reflected in **plain text** in the summary or lead paragraph. Search snippets sometimes truncate tables.

### Synonyms and “wrong word” problems

- If customers say “split payment” but your article only says “multiple cards”, the article may rank poorly.
- Add a **short line** in the summary: e.g. “If you need to pay with **two cards** or **split** the amount…”
- Same for **ambiguous words**: in Group Goodness, “split” might mean **bulk product splits** vs **payment splits**—use **“payment”** and **“two cards”** in titles/summaries for payment topics.

### Policies vs forms

- If the **next step** is always a form, put the **canonical URL** in the article body **and** mention “credit request form” / “returns form” in the summary so search can connect wording.

---

## 4. Systems Support (internal) vs customer-facing

**Systems Support** (or similar) is useful when:

- You want **model-specific** phrasing (“ask for retail vs wholesale first”, “do not quote freight without postcode”) **without** changing public marketing copy.
- You want **stub articles** whose only job is to be retrieved for odd queries, pointing to the right public policy.

Keep those articles:

- **Short**, with the behaviour stated in the **title + summary**.
- In a department the agent’s portals are allowed to search (coordinate with whoever configures **portal IDs** in the app).

Customer-facing articles remain the source of **policy truth**; internal articles **route and reinforce** behaviour.

---

## 5. Two portals (Contact & FAQs vs Group Goodness)

The app may search **both** portals and pick the better match. Helpful habits:

- **Group-only** rules (group cart, coordinators, member payments) should live in the **Group Goodness** KB with **“Group Goodness”** in title or summary where true.
- **Retail checkout** payment and shipping should be unmistakably in the **main** FAQ portal so generic questions don’t pull the wrong portal.

---

## 6. How to test from Support’s side

1. In each public help centre, use the **same search box** the customers use and type **exact chat phrases** (e.g. “pay with two cards”, “American Express”, “free shipping Melbourne”).
2. Check whether the **correct article** appears in the **top 3** results.
3. Open the hit: confirm the **answer is visible in the preview/summary**, not only deep in the page.

If the right policy exists but **never ranks in the top results**, fix **title/summary** or split content before changing the chat app.

---

## 7. When optimisation isn’t enough

If search returns **no** good hits, the app may show a generic “couldn’t find an article” message—that is **not** fixed by prompt wording alone. You need either **new** articles, better **summaries**, or a product change (e.g. fetch full article body for top hits—engineering decision).

---

## 8. Quick reference

| Do | Avoid |
|----|--------|
| Lead with **who** + **what** + **next step** in summary | Bury the only answer in a footnote |
| Use **customer language** in titles | Vague titles (“Payments overview”) for narrow rules |
| Disambiguate **Group Goodness payment** vs **bulk split** | Reusing the word “split” for different ideas without context |
| One **primary** article per intent | One page that tries to answer every payment edge case in one block |

---

*For embedding the chat widget on a website, see [EMBEDDING.md](EMBEDDING.md).*
