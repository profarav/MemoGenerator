# Booking → Memo → Google Doc → ClickUp

How the Zap hooks into the memo generator.

## Flow

```
Client books a discovery call
  → Zap moves the ClickUp deal to "Discovery Call Booked"   (existing behaviour)
  → Zap POSTs to this app's booking webhook                  (new)
      ← responds in <1s with a memo id
  → app enriches the attendee via Apollo, researches, and writes the memo (~2 min)
  → app creates a formatted Google Doc
  → app posts a comment on the ClickUp task with the doc link
```

**Why the webhook returns immediately:** generation takes about two minutes.
Zapier webhook steps time out well before that, so the Zap must not wait. It
fires and forgets; the memo link arrives as a ClickUp comment a couple of
minutes later.

## The webhook

```
POST https://<app-url>/api/hooks/booking
```

### Auth

Send the shared secret in a header (preferred) or query param:

```
X-Webhook-Secret: <BOOKING_WEBHOOK_SECRET>
```

Requests without a matching secret get `401`. If the secret isn't configured
server-side, **all** requests are rejected with `500` — it fails closed.

### Request body

Only the attendee's identity is strictly required: either `attendeeEmail`, or
`attendeeName` **plus** `companyDomain`.

| Field | Required | Notes |
|---|---|---|
| `attendeeEmail` | yes* | Best input — Apollo resolves the most from a work email |
| `attendeeName` | no | Used as a fallback with `companyDomain` |
| `companyDomain` | no | Fallback when there's no email, e.g. `hipcamp.com` |
| `companyName` | no | Overrides the enriched company name |
| `meetingTitle` | no | Defaults to `Discovery Call — <company>` |
| `meetingDatetime` | no | ISO 8601, e.g. `2026-07-25T15:00:00Z` |
| `clickupTaskId` | no | **Needed for the ClickUp comment.** The deal's task id |
| `focus` | no | Free text — steers the memo's questions and talking points |

\* or `attendeeName` + `companyDomain`

Example:

```json
{
  "attendeeEmail": "jenna@hipcamp.com",
  "attendeeName": "Jenna Valdespino",
  "companyName": "Hipcamp",
  "meetingTitle": "Discovery Call — Hipcamp",
  "meetingDatetime": "2026-07-25T15:00:00Z",
  "clickupTaskId": "86a1b2c3d",
  "focus": "They reached out about paid media support"
}
```

### Response

Immediate, before the memo exists:

```json
{
  "memoId": "8b85baca-d0b6-4799-b194-3accdd6b352b",
  "status": "generating",
  "memoUrl": "https://<app-url>/memo/8b85baca-..."
}
```

`memoUrl` is viewable right away — it shows a progress state and fills in when
the memo is ready, so it's safe to surface in ClickUp immediately if useful.

### Errors

| Status | Meaning |
|---|---|
| `400` | Couldn't identify the attendee (no email, no name+domain) |
| `401` | Missing or wrong secret |
| `500` | Webhook secret not configured, or the database rejected the request |

Failures *after* the response (Apollo can't resolve anyone, generation errors)
mark the memo request `failed` in the app rather than surfacing to the Zap —
check the dashboard or the Vercel logs.

## Required configuration

Set these in the Vercel project environment:

| Variable | Purpose |
|---|---|
| `BOOKING_WEBHOOK_SECRET` | Shared secret for the Zap. Long random string |
| `NEXT_PUBLIC_APP_URL` | Public app URL, used to build `memoUrl` |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Service account JSON (raw or base64) |
| `GOOGLE_DRIVE_FOLDER_ID` | Folder the memo docs land in |
| `GOOGLE_DOC_SHARE_DOMAIN` | Optional — grants the whole workspace access |
| `CLICKUP_API_TOKEN` | For posting the comment |
| `CLICKUP_TEAM_ID` | Only if passing custom task ids like `DEV-1234` |

### Google service account setup

1. Create a Google Cloud project; enable the **Google Docs API** and **Drive API**.
2. Create a service account and download its JSON key.
3. Put the JSON in `GOOGLE_SERVICE_ACCOUNT_KEY` (base64 is easier to paste).
4. Create a Drive folder for memos, share it with the service account's email
   as **Editor**, and set `GOOGLE_DRIVE_FOLDER_ID` to the folder id.

Docs created by a service account are owned by it, which is why they must live
in a shared folder — otherwise nobody on the team can open them.

### Database migration

The `memo_requests` table needs two columns. Run this in the Supabase SQL
editor (it's also at the bottom of `supabase/schema.sql`, and is idempotent):

```sql
alter table memo_requests add column if not exists google_doc_url  text;
alter table memo_requests add column if not exists clickup_task_id text;

create index if not exists idx_memo_requests_clickup_task_id
  on memo_requests (clickup_task_id);
```

## Graceful degradation

Each integration is independent and optional:

- No Google credentials → the memo still generates and is viewable in the app;
  the export is skipped and logged.
- No `clickupTaskId`, or no ClickUp token → the doc is still created; only the
  comment is skipped.
- A delivery failure never fails the memo itself.

This means you can wire the webhook up first and add Google/ClickUp after.
