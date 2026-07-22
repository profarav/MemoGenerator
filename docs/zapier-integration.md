# Hooking the Zap up to the memo generator

This replaces the four middle steps of the existing Zap (Run JavaScript, Web
Reader, and both Anthropic calls) with two calls to this app. **Your ClickUp
trigger, filter, Google Docs template, and ClickUp comment steps all stay as
they are** — Zapier keeps owning the doc and the comment, using the Google and
ClickUp connections you already have.

## The Zap

| # | Step | Change |
|---|---|---|
| 1 | ClickUp — Task Changes | unchanged |
| 2 | Filter by Zapier | unchanged |
| 3 | **Webhooks — POST** to this app | **replaces old steps 3–6** |
| 4 | **Delay by Zapier — 5 minutes** | new |
| 5 | **Webhooks — GET** the finished memo | new |
| 6 | Google Docs — Create Document From Template | unchanged; remap placeholders |
| 7 | ClickUp — Post a Task Comment | unchanged; remap the doc link |

Delete the old steps 3, 4, 5, and 6 — Apollo enrichment, web research, and the
model calls all happen inside the app now.

### Why the delay

Generation takes about 2–3 minutes (research plus several model calls). A
Zapier webhook step times out long before that, so step 3 hands the work off
and returns immediately; step 5 collects the result after the wait.

Five minutes is a deliberate safety margin over the ~2.5 min typical run. If
step 5 ever runs before the memo is ready it returns **409**, so the Zap fails
visibly and can be replayed — it will not create a half-empty document.

---

## Step 3 — POST (start the memo)

```
POST https://<app-url>/api/hooks/booking
Header:  X-Webhook-Secret: <BOOKING_WEBHOOK_SECRET>
```

Body — map `attendeeEmail` from your ClickUp email custom field, and
`clickupTaskId` from the trigger's task id:

```json
{
  "attendeeEmail": "{{ClickUp email custom field}}",
  "companyName":   "{{ClickUp company field, optional}}",
  "meetingTitle":  "Discovery Call — {{company}}",
  "clickupTaskId": "{{ClickUp task id}}",
  "focus":         "{{optional — steers the questions and talking points}}"
}
```

Only the attendee's identity is truly required: either `attendeeEmail`, or
`attendeeName` **plus** `companyDomain`. Everything else is optional.

Returns immediately (measured at 0.32s):

```json
{
  "memoId": "2b255d50-...",
  "status": "generating",
  "memoUrl": "https://<app-url>/memo/2b255d50-..."
}
```

**Map `memoId` into step 5.**

---

## Step 5 — GET (collect the memo)

```
GET https://<app-url>/api/memo-sections/{{memoId from step 3}}?secret=<BOOKING_WEBHOOK_SECRET>
```

Returns flat, plain-text fields ready to drop into the template. Markdown is
already stripped — bullets come through as `•` and questions stay numbered, so
nothing prints literal `**` or `-` characters in the doc.

**Section fields** (each maps to one template placeholder):

| Field | Contents |
|---|---|
| `sector` | One-line industry positioning |
| `who_they_are` | Company bullets — website, product, how it works, scale, signals |
| `who_talking_to` | Contact block — name, title, email/LinkedIn |
| `background` | The contact's career and prior companies/products |
| `questions` | Numbered discovery questions |
| `talking_points` | Conversation angles |
| `summary` | Closing prose recap |
| `full_memo` | Everything at once, if you'd rather use a single placeholder |

**Helper fields** for naming the doc and writing the comment:

`companyName`, `meetingTitle`, `attendeeNames`, `attendeeTitles`,
`clickupTaskId`, `memoUrl`, `docTitle` (e.g. `Meeting Prep — Hipcamp`).

### Responses

| Status | Meaning |
|---|---|
| `200` | Ready — `status: "ready"` plus all fields |
| `409` | Not ready yet, or generation failed. **Lengthen the Delay and replay** |
| `401` | Missing/wrong secret |
| `404` | Unknown memo id |

---

## Steps 6 & 7 — unchanged

Point your existing Google Docs template placeholders at the section fields
above, and the ClickUp comment at the resulting document link. Because the
template holds the headings and styling, the layout Sadie already approved is
preserved — the app supplies content, the template supplies the look.

---

## Configuration

Only two environment variables are needed for this flow, both in Vercel:

| Variable | Purpose |
|---|---|
| `BOOKING_WEBHOOK_SECRET` | Shared secret for steps 3 and 5. Long random string |
| `NEXT_PUBLIC_APP_URL` | Public app URL, used to build `memoUrl` |

Plus the database migration (already applied):

```sql
alter table memo_requests add column if not exists google_doc_url  text;
alter table memo_requests add column if not exists clickup_task_id text;
```

### Not needed for this flow

The app can also create the Google Doc and post the ClickUp comment itself —
that's what `GOOGLE_SERVICE_ACCOUNT_KEY` and `CLICKUP_API_TOKEN` are for. Since
Zapier already owns those steps, **leave them unset**. The app detects they're
missing, skips those steps, and logs a note; nothing breaks. They're there if
you ever want to drop the Zapier dependency.

---

## Testing it

1. Set the two env vars in Vercel and deploy.
2. In Zapier, run step 3 on its own — you should get a `memoId` back in under
   a second, and the memo appears in the app's dashboard as "Generating…".
3. Wait ~3 minutes, then run step 5 with that id — you should get `status:
   "ready"` and all the section fields populated.
4. Map the fields into the template, run steps 6 and 7.
5. Move a real test deal into "Discovery Call Booked" and watch it end to end.

If step 5 returns 409, the memo either isn't finished (lengthen the delay) or
failed — open `memoUrl` in the app to see what happened.
