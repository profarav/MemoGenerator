/**
 * Google Docs export.
 *
 * Creates a properly formatted Google Doc from a memo's markdown and returns
 * its URL. Uses a service account (no per-user OAuth), so it can run
 * unattended from the booking webhook.
 *
 * Setup (one time):
 *  1. Create a Google Cloud project; enable the Google Docs API and Drive API.
 *  2. Create a service account; download its JSON key.
 *  3. Set GOOGLE_SERVICE_ACCOUNT_KEY to the JSON (single line, or base64).
 *  4. Create a Drive folder for memos, share it with the service account's
 *     email as Editor, and set GOOGLE_DRIVE_FOLDER_ID to the folder id.
 *  5. Optionally set GOOGLE_DOC_SHARE_DOMAIN (e.g. "yourcompany.com") to
 *     give everyone in the workspace edit access to each memo.
 *
 * Note on Drive quota: files created by a service account are owned by that
 * service account. Placing them in a shared folder (step 4) keeps them
 * visible to the team and counted against the folder owner's Drive.
 */
import { JWT } from 'google-auth-library'
import { markdownToDocsRequests } from '@/lib/google/markdownToDocs'

const SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive',
]

export interface GoogleDocResult {
  documentId: string
  url: string
}

function loadServiceAccount(): { client_email: string; private_key: string } {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!raw) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_KEY is not set — cannot create Google Docs. ' +
      'See lib/google/docs.ts for setup steps.'
    )
  }

  // Accept either raw JSON or base64-encoded JSON (easier to paste into Vercel).
  const json = raw.trim().startsWith('{')
    ? raw
    : Buffer.from(raw, 'base64').toString('utf8')

  let parsed: { client_email?: string; private_key?: string }
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON (or base64-encoded JSON).')
  }

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is missing client_email or private_key.')
  }

  return {
    client_email: parsed.client_email,
    // Vercel env vars often store newlines escaped.
    private_key: parsed.private_key.replace(/\\n/g, '\n'),
  }
}

/** True when the Google export is configured; lets callers skip it cleanly. */
export function isGoogleDocsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_KEY)
}

async function getAuthToken(): Promise<string> {
  const { client_email, private_key } = loadServiceAccount()
  const jwt = new JWT({ email: client_email, key: private_key, scopes: SCOPES })
  const { access_token } = await jwt.authorize()
  if (!access_token) throw new Error('Google auth failed: no access token returned.')
  return access_token
}

async function googleFetch(
  token: string,
  url: string,
  init: RequestInit = {}
): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Google API ${res.status} on ${url}: ${body.slice(0, 500)}`)
  }
  return res.json()
}

/**
 * Create a formatted Google Doc for a memo. Returns the document id and URL.
 */
export async function createMemoDoc(params: {
  title: string
  markdown: string
}): Promise<GoogleDocResult> {
  const { title, markdown } = params
  const token = await getAuthToken()

  // 1. Create the (empty) document
  const created = (await googleFetch(token, 'https://docs.googleapis.com/v1/documents', {
    method: 'POST',
    body: JSON.stringify({ title }),
  })) as { documentId?: string }

  const documentId = created.documentId
  if (!documentId) throw new Error('Google Docs did not return a documentId.')

  // 2. Insert content + formatting in one batch
  const { requests } = markdownToDocsRequests(markdown, title)
  if (requests.length > 0) {
    await googleFetch(
      token,
      `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
      { method: 'POST', body: JSON.stringify({ requests }) }
    )
  }

  // 3. Move into the memos folder, if one is configured
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID
  if (folderId) {
    await googleFetch(
      token,
      `https://www.googleapis.com/drive/v3/files/${documentId}?addParents=${folderId}&removeParents=root&supportsAllDrives=true`,
      { method: 'PATCH', body: JSON.stringify({}) }
    )
  }

  // 4. Share with the workspace domain, if configured
  const shareDomain = process.env.GOOGLE_DOC_SHARE_DOMAIN
  if (shareDomain) {
    await googleFetch(
      token,
      `https://www.googleapis.com/drive/v3/files/${documentId}/permissions?supportsAllDrives=true`,
      {
        method: 'POST',
        body: JSON.stringify({ role: 'writer', type: 'domain', domain: shareDomain }),
      }
    )
  }

  return {
    documentId,
    url: `https://docs.google.com/document/d/${documentId}/edit`,
  }
}
