/**
 * Memo section parsing + splicing.
 *
 * Generated memos follow a fixed structure (see MEMO_SECTION_SPECS):
 *   # Meeting Prep Memo: <Company>
 *   ## 1. Quick Summary
 *   ...body...
 *   ## 2. Person Background
 *   ...body...
 *
 * These helpers let a single section be rewritten without touching the rest.
 */

export interface ParsedSection {
  /** Leading number in the heading, e.g. 2 for "## 2. Person Background" */
  number: number
  /** Title without the number, e.g. "Person Background" */
  title: string
  /** The full heading line, e.g. "## 2. Person Background" */
  heading: string
  /** Everything between this heading and the next one, trimmed */
  body: string
}

export interface ParsedMemo {
  /** Content above the first "## " heading (the "# Meeting Prep Memo: X" title) */
  preamble: string
  sections: ParsedSection[]
}

const SECTION_HEADING = /^##\s+(\d+)\.\s+(.+?)\s*$/

/**
 * Split a memo into its numbered sections. Returns an empty `sections` array
 * for memos that don't follow the expected structure — callers should fall
 * back to rendering/regenerating the whole memo in that case.
 */
export function parseMemoSections(markdown: string): ParsedMemo {
  const lines = markdown.split('\n')

  const starts: Array<{ index: number; number: number; title: string; heading: string }> = []
  lines.forEach((line, index) => {
    const match = line.match(SECTION_HEADING)
    if (match) {
      starts.push({
        index,
        number: parseInt(match[1], 10),
        title: match[2],
        heading: line,
      })
    }
  })

  if (starts.length === 0) {
    return { preamble: markdown.trim(), sections: [] }
  }

  const preamble = lines.slice(0, starts[0].index).join('\n').trim()

  const sections: ParsedSection[] = starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : lines.length
    return {
      number: start.number,
      title: start.title,
      heading: start.heading,
      body: lines.slice(start.index + 1, end).join('\n').trim(),
    }
  })

  return { preamble, sections }
}

/**
 * Replace one section's body, leaving every other section byte-identical.
 * Throws if the section isn't present so callers surface a clear error
 * instead of silently returning an unchanged memo.
 */
export function replaceSectionBody(
  markdown: string,
  sectionNumber: number,
  newBody: string
): string {
  const { preamble, sections } = parseMemoSections(markdown)

  if (!sections.some((s) => s.number === sectionNumber)) {
    throw new Error(`Section ${sectionNumber} not found in memo`)
  }

  const rebuilt = sections
    .map((s) => {
      const body = s.number === sectionNumber ? newBody.trim() : s.body
      return `${s.heading}\n${body}`
    })
    .join('\n\n')

  return preamble ? `${preamble}\n\n${rebuilt}` : rebuilt
}

/**
 * Models sometimes echo the "## 2. Person Background" heading even when asked
 * for the body only. Strip a leading heading so splicing never doubles it.
 */
export function stripLeadingHeading(text: string): string {
  const lines = text.trim().split('\n')
  if (lines.length > 0 && SECTION_HEADING.test(lines[0])) {
    return lines.slice(1).join('\n').trim()
  }
  return lines.join('\n').trim()
}
