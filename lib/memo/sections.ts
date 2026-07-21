/**
 * Memo section structure — parsing, splicing, and the canonical section list.
 *
 * Generated memos follow a fixed structure (see MEMO_SECTIONS):
 *   ## SECTOR / INDUSTRY
 *   ...body...
 *   ## WHO THEY ARE
 *   ...body...
 *
 * Sections are identified by their (uppercase) title. These helpers let a
 * single section be rewritten without touching the rest.
 *
 * This module is dependency-free on purpose so it can be imported by both
 * server code and client components (the memo generator adds the per-section
 * writing instructions on the server side in lib/agents/memoGenerator.ts).
 */

export interface MemoSection {
  /** Stable identifier, safe to persist/reference (e.g. "sector") */
  key: string
  /** The section heading shown in the memo, e.g. "SECTOR / INDUSTRY" */
  title: string
}

/**
 * The canonical memo structure, in order. Mirrors the scannable format the
 * team standardized on: identifiers and company facts up top, discovery tools
 * in the middle, and a prose recap at the end.
 */
export const MEMO_SECTIONS: MemoSection[] = [
  { key: 'sector', title: 'SECTOR / INDUSTRY' },
  { key: 'who_they_are', title: 'WHO THEY ARE' },
  { key: 'who_talking_to', title: "WHO WE'RE TALKING TO" },
  { key: 'background', title: 'BACKGROUND ON THE CONTACT' },
  { key: 'questions', title: 'QUESTIONS TO ASK' },
  { key: 'talking_points', title: 'KEY TALKING POINTS' },
  { key: 'summary', title: 'QUICK SUMMARY' },
]

export function isKnownSection(title: string): boolean {
  return MEMO_SECTIONS.some((s) => s.title === title)
}

export interface ParsedSection {
  /** The title without the "## ", e.g. "WHO THEY ARE" */
  title: string
  /** The full heading line, e.g. "## WHO THEY ARE" */
  heading: string
  /** Everything between this heading and the next one, trimmed */
  body: string
}

export interface ParsedMemo {
  /** Content above the first "## " heading, if any */
  preamble: string
  sections: ParsedSection[]
}

const SECTION_HEADING = /^##\s+(.+?)\s*$/

/**
 * Split a memo into its sections. Returns an empty `sections` array for memos
 * that don't follow the expected structure — callers fall back to rendering /
 * regenerating the whole memo in that case.
 */
export function parseMemoSections(markdown: string): ParsedMemo {
  const lines = markdown.split('\n')

  const starts: Array<{ index: number; title: string; heading: string }> = []
  lines.forEach((line, index) => {
    const match = line.match(SECTION_HEADING)
    if (match) {
      starts.push({ index, title: match[1], heading: line })
    }
  })

  if (starts.length === 0) {
    return { preamble: markdown.trim(), sections: [] }
  }

  const preamble = lines.slice(0, starts[0].index).join('\n').trim()

  const sections: ParsedSection[] = starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : lines.length
    return {
      title: start.title,
      heading: start.heading,
      body: lines.slice(start.index + 1, end).join('\n').trim(),
    }
  })

  return { preamble, sections }
}

/**
 * Replace one section's body (matched by title), leaving every other section
 * byte-identical. Throws if the section isn't present so callers surface a
 * clear error instead of silently returning an unchanged memo.
 */
export function replaceSectionBody(
  markdown: string,
  sectionTitle: string,
  newBody: string
): string {
  const { preamble, sections } = parseMemoSections(markdown)

  if (!sections.some((s) => s.title === sectionTitle)) {
    throw new Error(`Section "${sectionTitle}" not found in memo`)
  }

  const rebuilt = sections
    .map((s) => {
      const body = s.title === sectionTitle ? newBody.trim() : s.body
      return `${s.heading}\n${body}`
    })
    .join('\n\n')

  return preamble ? `${preamble}\n\n${rebuilt}` : rebuilt
}

/**
 * Models sometimes echo the "## WHO THEY ARE" heading even when asked for the
 * body only. Strip a leading heading so splicing never doubles it.
 */
export function stripLeadingHeading(text: string): string {
  const lines = text.trim().split('\n')
  if (lines.length > 0 && SECTION_HEADING.test(lines[0])) {
    return lines.slice(1).join('\n').trim()
  }
  return lines.join('\n').trim()
}
