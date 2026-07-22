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

/**
 * Convert text to Unicode "mathematical sans-serif bold" characters.
 *
 * Why this exists: the memo reaches Google Docs through a Zapier template
 * placeholder, which does plain-text substitution — it cannot apply bold
 * formatting to part of what it inserts. These characters are bold *shapes*,
 * so headings render bold without any formatting being applied.
 *
 * Trade-off: they aren't really styled text. Ctrl+F for "SECTOR" won't match
 * the bolded heading, and the glyphs may fall back to a different font.
 * If the doc template ever gains its own styled headings, drop this and use
 * the per-section fields instead.
 */
export function toUnicodeBold(text: string): string {
  let out = ''
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    if (c >= 65 && c <= 90) out += String.fromCodePoint(0x1d5d4 + c - 65)        // A–Z
    else if (c >= 97 && c <= 122) out += String.fromCodePoint(0x1d5ee + c - 97)  // a–z
    else if (c >= 48 && c <= 57) out += String.fromCodePoint(0x1d7ec + c - 48)   // 0–9
    else out += ch
  }
  return out
}

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
