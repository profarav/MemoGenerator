/**
 * Convert memo markdown into Google Docs API batchUpdate requests.
 *
 * The point of this module is to preserve the scannable structure the team
 * standardized on — real heading styles, real bulleted and numbered lists,
 * real bold runs — rather than dumping plain text into a doc.
 *
 * Strategy: Google Docs indices shift as content is inserted, so we build the
 * full plain-text body first, tracking the index ranges of every heading,
 * bold run, and list block. Then we emit one insertText request followed by
 * styling requests applied to those recorded ranges. Styling requests are
 * emitted last-range-first so earlier ranges stay valid.
 *
 * Pure and dependency-free so it can be unit-tested without credentials.
 */

export interface DocsRequest {
  [key: string]: unknown
}

interface Range {
  startIndex: number
  endIndex: number
}

interface BoldRun extends Range {}

interface ListBlock extends Range {
  ordered: boolean
}

interface HeadingRange extends Range {
  level: 1 | 2
}

const UL_ITEM = /^\s*[-*]\s+(.*)$/
const OL_ITEM = /^\s*\d+\.\s+(.*)$/
const H1 = /^#\s+(.*)$/
const H2 = /^##\s+(.*)$/
const H3 = /^###\s+(.*)$/

/**
 * Strip inline markdown from a line, returning the clean text plus the
 * offsets (relative to the cleaned line) of any bold runs.
 */
function extractInline(line: string): { text: string; bold: Range[] } {
  const bold: Range[] = []
  let text = ''
  let i = 0

  while (i < line.length) {
    // Bold: **...**
    if (line.startsWith('**', i)) {
      const end = line.indexOf('**', i + 2)
      if (end !== -1) {
        const inner = line.slice(i + 2, end)
        const start = text.length
        text += inner
        bold.push({ startIndex: start, endIndex: text.length })
        i = end + 2
        continue
      }
    }
    // Italic markers: drop the asterisk, keep the text (Docs italic is not
    // load-bearing for these memos; certainty labels read fine unstyled).
    if (line[i] === '*') {
      i++
      continue
    }
    // Links: [text](url) — keep the visible text, append the URL so the
    // reader can still get to it in a printed/pasted doc.
    if (line[i] === '[') {
      const close = line.indexOf('](', i)
      const paren = close !== -1 ? line.indexOf(')', close) : -1
      if (close !== -1 && paren !== -1) {
        text += line.slice(i + 1, close)
        i = paren + 1
        continue
      }
    }
    text += line[i]
    i++
  }

  return { text, bold }
}

export interface ConvertedDoc {
  /** The full plain-text body, ready for a single insertText request */
  text: string
  /** batchUpdate requests: one insert followed by styling */
  requests: DocsRequest[]
}

/**
 * Build the Google Docs batchUpdate requests for a memo.
 *
 * @param markdown the memo body
 * @param title optional document title inserted as a Heading 1 at the top
 */
export function markdownToDocsRequests(markdown: string, title?: string): ConvertedDoc {
  const lines = markdown.split('\n')

  // Docs bodies start at index 1.
  const START = 1
  let cursor = START
  let text = ''

  const headings: HeadingRange[] = []
  const bolds: BoldRun[] = []
  const listBlocks: ListBlock[] = []

  function pushLine(raw: string): Range {
    const { text: clean, bold } = extractInline(raw)
    const startIndex = cursor
    const line = clean + '\n'
    text += line
    cursor += line.length
    for (const b of bold) {
      bolds.push({
        startIndex: startIndex + b.startIndex,
        endIndex: startIndex + b.endIndex,
      })
    }
    // endIndex excludes the trailing newline so styling doesn't bleed.
    return { startIndex, endIndex: startIndex + clean.length }
  }

  if (title) {
    const r = pushLine(title)
    headings.push({ ...r, level: 1 })
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    const h2 = line.match(H2)
    const h3 = line.match(H3)
    const h1 = line.match(H1)

    // Order matters: ### and ## must be tested before #.
    if (h3) {
      const r = pushLine(h3[1])
      headings.push({ ...r, level: 2 })
      i++
      continue
    }
    if (h2) {
      const r = pushLine(h2[1])
      headings.push({ ...r, level: 2 })
      i++
      continue
    }
    if (h1) {
      const r = pushLine(h1[1])
      headings.push({ ...r, level: 1 })
      i++
      continue
    }

    // Horizontal rules add nothing in a Doc with real headings.
    if (/^\s*---\s*$/.test(line)) {
      i++
      continue
    }

    // List blocks (consecutive items of the same kind)
    const isUl = UL_ITEM.test(line)
    const isOl = OL_ITEM.test(line)
    if (isUl || isOl) {
      const pattern = isUl ? UL_ITEM : OL_ITEM
      const blockStart = cursor
      let blockEnd = cursor
      while (i < lines.length && pattern.test(lines[i])) {
        const content = lines[i].replace(pattern, '$1')
        const r = pushLine(content)
        blockEnd = r.endIndex
        i++
      }
      listBlocks.push({ startIndex: blockStart, endIndex: blockEnd, ordered: isOl })
      continue
    }

    // Blank lines: keep one to separate blocks, but skip runs.
    if (line.trim() === '') {
      i++
      continue
    }

    pushLine(line)
    i++
  }

  const requests: DocsRequest[] = []

  if (text.length === 0) {
    return { text, requests }
  }

  requests.push({
    insertText: {
      location: { index: START },
      text,
    },
  })

  // Apply styling from the end backwards so ranges stay valid.
  const styling: DocsRequest[] = []

  for (const h of headings) {
    styling.push({
      updateParagraphStyle: {
        range: { startIndex: h.startIndex, endIndex: h.endIndex },
        paragraphStyle: { namedStyleType: h.level === 1 ? 'HEADING_1' : 'HEADING_2' },
        fields: 'namedStyleType',
      },
    })
  }

  for (const b of bolds) {
    if (b.endIndex <= b.startIndex) continue
    styling.push({
      updateTextStyle: {
        range: { startIndex: b.startIndex, endIndex: b.endIndex },
        textStyle: { bold: true },
        fields: 'bold',
      },
    })
  }

  for (const block of listBlocks) {
    styling.push({
      createParagraphBullets: {
        range: { startIndex: block.startIndex, endIndex: block.endIndex },
        bulletPreset: block.ordered
          ? 'NUMBERED_DECIMAL_ALPHA_ROMAN'
          : 'BULLET_DISC_CIRCLE_SQUARE',
      },
    })
  }

  // Sort descending by start index so applying one doesn't invalidate the next.
  styling.sort((a, b) => rangeStart(b) - rangeStart(a))
  requests.push(...styling)

  return { text, requests }
}

function rangeStart(req: DocsRequest): number {
  const op = Object.values(req)[0] as { range?: Range } | undefined
  return op?.range?.startIndex ?? 0
}
