# Welly call — dotWMS lookup · Fri 17 July (before 12pm)

**Goal:** understand his lookup well enough to build it. 5 questions. That's it.

---

### OPEN WITH THIS (frames the whole thing)
> "Thanks for sending this — it's the missing piece. The plan is: the customer gives us their
> BigCommerce order number and their email, we call your endpoint to get the Syspro number,
> then we look that up in MachShip for the delivery status. So they only need the number they
> already have. Just want to make sure I build it right."

---

### 1. THE SECURITY ONE ⭐ (most important)
**Ask:** *"If someone puts in a real order number but the wrong email address — does it still return the order?"*

**Why:** those BigCommerce numbers are only 6 digits and run in sequence (BC-319896, BC-319897…).
If it doesn't check the email, someone could type in random numbers and see other people's orders
through our chatbot.

**Listen for:**
- "It checks both" → 🎉 perfect, his system does the security for us.
- "It only uses the order number" → fine, we'll check it ourselves — his response already sends
  back the delivery email, so we compare it to what the customer typed. Just need to know.

### 2. SPLIT ORDERS
**Ask:** *"If an order ships in multiple boxes, does it return more than one row?"*

**Why:** split deliveries are the whole reason we're doing this.

### 3. THE STATUS LIST
**Ask:** *"Your example shows 'Closed' and 'Fulfilled'. What are all the possible statuses? And I noticed
a 'held reason' field — when does an order get held?"*

**Why:** we need the full list to write what the customer reads. And if orders can be *held*, the
chatbot needs to know what to say about that.

**Also ask:** *"What comes back if the order isn't packed yet?"* (Customer orders Monday, asks Tuesday.)

### 4. OUR OWN KEY 🔒
**Ask:** *"Could we get our own API key for this, rather than the one in your email? And is it read-only?"*

**Why:** same as the MachShip read-only account — our integration should have its own credentials
they can switch off independently. The one he emailed is probably shared.

### 5. ODOO
**Ask:** *"Does dotWMS stay in place after you move to Odoo, or would this lookup change?"*

**Why:** if it's going away, I build it so it can be swapped without touching everything else.

---

### CLOSE
> "That's everything I need. I'll send through a written recap with the suggested customer wording,
> and Iri can adjust it from there."

---

**Quick check if it comes up:** the customer types `319896` and we send `BC-319896` — is that prefix
always there?

**Jargon:** *dotWMS* = their warehouse system (what his link points at) · *Syspro* = their current
back-office system, being replaced by Odoo · *Endpoint* = the web address that returns the data ·
*API key* = the password for it

**After the call:** send me his answers and I'll rewrite the recap email for Iri.
