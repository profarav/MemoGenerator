/**
 * Markdown → clean plain text.
 *
 * Used for anywhere the memo leaves the app as text rather than rendered
 * markup: the "Copy plain text" button, and the Zapier feed that fills a
 * Google Docs template (template placeholders take plain text — leaving `**`
 * or `- ` in would print those characters literally in the doc).
 *
 * Bullets become "• " and numbered items keep their numbers, so the structure
 * still reads as a list once it lands in the document.
 */

export function stripMarkdown(md: string): string {
  return (
    md
      // Headings: "## WHO THEY ARE" → "WHO THEY ARE"
      .replace(/^#{1,6}\s+/gm, '')
      // Bold / italic
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      // Inline code
      .replace(/`([^`]+)`/g, '$1')
      // Links: [text](url) → text (url)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
      // Horizontal rules
      .replace(/^\s*[-*_]{3,}\s*$/gm, '')
      // Bullets → "• ", preserving any indentation
      .replace(/^(\s*)[-*+]\s+/gm, '$1• ')
      // Collapse 3+ blank lines
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}
