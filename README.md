# Well Connected Marketing — Live AI Visibility Audit

This project has two parts:

| Part | Where it lives | What it does |
|---|---|---|
| `api/` folder | **Vercel** | Asks Claude (with live web search) three questions a client would ask, works out whether the practice is recommended, and sends the lead + results to GHL. Keeps your API key secret. |
| `ghl/ai-audit-custom-code.html` | **GHL page** (Custom JS/HTML element) | The audit people actually see: details form → live AI check → 10 quick questions → score, breakdown, top 3 fixes → "Want to talk to a human?" |

---

## Step 1 — Get your Claude API key (10 min)

You can use the Claude Console account you already have.

1. Go to **platform.claude.com** and sign in (this is separate from a claude.ai chat subscription).
2. **Billing**: make sure there's a payment method and some credit (start with US$10–20).
3. **Limits**: set a **monthly spend limit** (e.g. US$30). This is your main protection against surprise costs.
4. Check **web search is enabled** for your organisation (Console → Settings → Privacy/Features, or ask your admin). If it's turned off, the audit's live check will fall back to the do-it-yourself questions.
5. **API keys → Create key**. Name it "Well Connected audit" and put it in its own workspace if you'd like to see its costs separately. Copy it somewhere safe; you'll only see it once.

Cost guide: each audit runs 3 web-searched questions (up to 3 searches each) plus 3 quick follow-up reads. Web search costs US$10 per 1,000 searches (1 cent each) plus normal token costs, so expect very roughly **US$0.10–0.30 per audit** on Claude Sonnet, less on Claude Haiku. Check the Claude pricing page for current rates.

## Step 2 — Put the backend on Vercel (10 min)

1. Put this folder in a new GitHub repository (or drag it into Vercel using the Vercel CLI: `vercel` from inside the folder).
2. In Vercel: **Add New → Project → Import** that repository. No build settings needed. Click **Deploy**.
3. In the project: **Settings → Environment Variables**, add:

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your key from Step 1 |
| `ALLOWED_ORIGINS` | the address of the GHL page the audit sits on, e.g. `https://wellconnectedmarketing.com,https://www.wellconnectedmarketing.com` (add your GHL preview domain while testing, e.g. `https://sites.leadconnectorhq.com`) |
| `GHL_WEBHOOK_URL` | from Step 3 (you can add this after) |
| `CLAUDE_MODEL` | optional, defaults to `claude-sonnet-5-5` (use `claude-haiku-5-5` to cut costs) |
| `CLAUDE_EXTRACT_MODEL` | optional, defaults to `claude-haiku-5-5` |
| `MAX_SEARCHES_PER_QUESTION` | optional, default `3` |
| `MAX_CHECKS_PER_IP_PER_HOUR` | optional, default `3` |
| `MAX_CHECKS_PER_DAY` | optional, default `60` |

4. **Deployments → Redeploy** so the variables take effect.
5. Note your project address, e.g. `https://wcm-ai-audit.vercel.app`.

## Step 3 — Connect GHL (15 min)

1. In GHL (your Well Connected sub-account): **Automation → Create Workflow → Start from scratch**.
2. Trigger: **Inbound Webhook**. Copy the webhook URL it gives you and paste it into Vercel as `GHL_WEBHOOK_URL` (then redeploy).
3. Run one test audit (Step 4) so GHL receives a sample, then map the fields in the trigger.
4. Add actions:
   - **Create/Update Contact** using `email`, `first_name`, plus custom fields for `practice_name`, `suburb`, `state`, `profession`.
   - **Add Tag**: `AI Audit – Started` when `event` = `ai_check`; `AI Audit – Completed` when `event` = `audit_complete`.
   - Save `ai_summary`, `audit_score`, `audit_breakdown` and `audit_top_fixes` into custom fields (or a note) so you can see them before a call.
   - **Send Email**: their results (use the custom fields), ending with your "book a call" link.
   - Optional: create an opportunity in your Well Connected pipeline.

The two events the backend sends:

- `ai_check` — first_name, email, practice_name, profession, suburb, state, website, top_service, ai_mentioned_count, ai_questions_asked, ai_summary
- `audit_complete` — email, first_name, practice_name, audit_score, audit_breakdown, audit_top_fixes

## Step 4 — Add the audit to your GHL page (5 min)

1. Open `ghl/ai-audit-custom-code.html` and change the two settings near the top of the script:
   - `API_BASE` → your Vercel address from Step 2
   - `BOOK_URL` → your booking page
2. In the GHL page builder: add a full-width section with zero padding → **Custom JS/HTML** element → paste the whole file → Save.
3. Preview and run a test audit with a real practice name and suburb.

## How the live check works

For the practice type and suburb entered, the backend asks:

1. "Who is the best [practice type] in [suburb]?"
2. "Can you recommend a [practice type] near [suburb] with good reviews?"
3. "I need help with [their service]. Who should I see near [suburb]?" (or "…who is taking new clients")

Each question runs through Claude with web search, set to the person's suburb and state. A second short AI step reads each answer, lists the practices it recommended, and checks whether theirs was one of them. Results show the practices named and the sources AI relied on.

Scoring for the "AI answers" area: recommended in the first three = 2 points per question, mentioned further down = 1, not mentioned = 0, scaled to the same 0–4 range as the other five areas. If the AI can't be reached, the page falls back to two do-it-yourself search questions, so the audit always completes.

## Safety and honesty built in

- Your API key only ever lives in Vercel, never on the page.
- Only your own website can call the backend (`ALLOWED_ORIGINS`).
- Email is required before any AI search runs, there's a hidden spam trap, and per-person and per-day limits (best effort). **Your Claude Console monthly spend limit is the real backstop.**
- AI output is displayed as plain text only (no code can be injected).
- The page labels answers as AI-generated with live search on a stated date, and calls the result a snapshot, not a ranking guarantee.

## Changing things later

- Questions, tips and headlines: in `ghl/ai-audit-custom-code.html` (the `QS` and `AREAS` lists).
- The three AI questions: `buildQuestions()` in `api/ai-check.js`.
- Model: the `CLAUDE_MODEL` environment variable.
