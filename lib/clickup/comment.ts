/**
 * ClickUp integration — posts the finished memo's Google Doc link as a comment
 * on the deal task, so it lands where the team already works the pipeline.
 *
 * Setup: create a ClickUp API token (Settings → Apps → API Token) and set
 * CLICKUP_API_TOKEN. The token must have access to the space containing the
 * deal tasks.
 */

const CLICKUP_API = 'https://api.clickup.com/api/v2'

/** True when ClickUp commenting is configured; lets callers skip it cleanly. */
export function isClickUpConfigured(): boolean {
  return Boolean(process.env.CLICKUP_API_TOKEN)
}

/**
 * Post a comment on a ClickUp task.
 *
 * @param taskId  ClickUp task id (supports custom ids like "DEV-1234")
 * @param text    comment body
 * @param notifyAll whether to notify all task watchers
 */
export async function postTaskComment(params: {
  taskId: string
  text: string
  notifyAll?: boolean
}): Promise<{ id?: string }> {
  const token = process.env.CLICKUP_API_TOKEN
  if (!token) {
    throw new Error('CLICKUP_API_TOKEN is not set — cannot post ClickUp comment.')
  }

  const { taskId, text, notifyAll = true } = params

  // custom_task_ids is required when the id is a custom one (e.g. "DEV-1234").
  const isCustomId = /[A-Za-z]/.test(taskId) && taskId.includes('-')
  const query = new URLSearchParams()
  if (isCustomId) {
    query.set('custom_task_ids', 'true')
    if (process.env.CLICKUP_TEAM_ID) query.set('team_id', process.env.CLICKUP_TEAM_ID)
  }

  const url = `${CLICKUP_API}/task/${encodeURIComponent(taskId)}/comment${
    query.toString() ? `?${query}` : ''
  }`

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment_text: text, notify_all: notifyAll }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`ClickUp comment failed (${res.status}): ${body.slice(0, 300)}`)
  }

  return res.json()
}

/** The comment body posted when a memo is ready. */
export function buildMemoComment(params: {
  docUrl: string
  companyName: string
  attendeeNames: string[]
}): string {
  const { docUrl, companyName, attendeeNames } = params
  const who = attendeeNames.length > 0 ? ` with ${attendeeNames.join(', ')}` : ''
  return `📋 Meeting prep memo ready for ${companyName}${who}:\n${docUrl}`
}
