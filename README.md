# Weekly Meeting Prep Agent

An internal tool that generates Hugh-ready meeting prep memos. Patrick enters meeting details, the agent researches the company and attendees, and produces a structured brief.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Set environment variables

Copy `.env.example` to `.env.local` and fill in the values:

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service role key (server-side only) |
| `ANTHROPIC_API_KEY` | ✅ | Anthropic API key for Claude |
| `TAVILY_API_KEY` | ❌ | Tavily search API key. If absent, mock results are used. |

> The app runs without `TAVILY_API_KEY` — it returns placeholder search results so you can test the full flow without a search API.

### 3. Set up the Supabase database

1. Create a new [Supabase](https://supabase.com) project.
2. Open the **SQL Editor** in your Supabase dashboard.
3. Copy and run the contents of `supabase/schema.sql`.

This creates three tables: `memo_requests`, `research_sources`, and `generated_memos`.

### 4. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## How It Works

1. **Patrick** opens `/new` and fills in meeting details (company, attendees, context).
2. The app saves the request to Supabase and calls `POST /api/generate-memo`.
3. The backend:
   - Generates targeted research queries (company + each attendee).
   - Runs web searches via Tavily (or returns mock results).
   - Stores all sources in `research_sources`.
   - Summarizes the research using Claude.
   - Generates the full memo using Claude with a structured prompt.
   - Saves the memo to `generated_memos`.
4. Patrick is redirected to `/memo/[id]` to review, edit, regenerate, or approve.
5. Approved memos update the request status to `approved`.

---

## Pages

| Route | Description |
|---|---|
| `/` | Dashboard — list of all memos, stats, links |
| `/new` | Form to create a new memo request |
| `/memo/[id]` | Memo detail — view, edit, regenerate, approve |

## API Routes

| Route | Method | Description |
|---|---|---|
| `/api/generate-memo` | POST | Runs the full research + generation pipeline |
| `/api/regenerate-memo` | POST | Regenerates memo using existing sources + optional feedback |
| `/api/memo/[id]` | PATCH | Update memo markdown, review status, or feedback |
| `/api/memo-request/[id]` | PATCH | Update memo request status (e.g. approved) |

---

## Future Architecture

The MVP uses manual trigger memo generation. The full system pipeline will be:

```
Calendar Scanner
  → Meeting Classifier
  → Attendee + Company Resolver
  → External Background Research Layer
  → Internal Context Retrieval Layer  (Gmail/Superhuman, Slack, Granola)
  → Context Summarizer
  → Memo Generator
  → Patrick Review
  → Hugh-Ready Meeting Prep Memo
```

### Planned integrations (post-MVP)

- **Calendar scanning**: Automatically identify meetings 24–48h out that need prep.
- **Meeting classifier**: Skip internal 1:1s, flag external meetings worth prepping.
- **Gmail / Superhuman**: Pull prior email threads with the company/contacts.
- **Slack**: Search for any relevant mentions of the company or people.
- **Granola**: Pull prior meeting notes for returning clients.

The memo quality and prompt are validated in the MVP. Integrations come after quality is proven.
