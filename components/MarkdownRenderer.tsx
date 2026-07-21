'use client'

// Lightweight markdown-to-HTML renderer without external deps.
// Handles: headings, ordered + unordered lists, bold, italic, links,
// horizontal rules, and paragraphs. Block-based so lists render correctly.

function renderInline(text: string): string {
  return text
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Links
    .replace(
      /\[(.+?)\]\((.+?)\)/g,
      '<a href="$2" target="_blank" rel="noopener" class="text-blue-600 underline hover:text-blue-800">$1</a>'
    )
}

const UL_ITEM = /^\s*[-*]\s+(.*)$/
const OL_ITEM = /^\s*\d+\.\s+(.*)$/

function renderMarkdown(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Headings
    if (/^###\s+/.test(line)) {
      out.push(`<h3 class="text-sm font-semibold text-gray-800 mt-4 mb-1">${renderInline(line.replace(/^###\s+/, ''))}</h3>`)
      i++
      continue
    }
    if (/^##\s+/.test(line)) {
      out.push(`<h2 class="text-xs font-bold uppercase tracking-wider text-gray-500 mt-6 mb-2 border-b border-gray-200 pb-1">${renderInline(line.replace(/^##\s+/, ''))}</h2>`)
      i++
      continue
    }
    if (/^#\s+/.test(line)) {
      out.push(`<h1 class="text-lg font-bold text-gray-900 mt-0 mb-3">${renderInline(line.replace(/^#\s+/, ''))}</h1>`)
      i++
      continue
    }

    // Horizontal rule
    if (/^\s*---\s*$/.test(line)) {
      out.push('<hr class="my-4 border-gray-200" />')
      i++
      continue
    }

    // Unordered list block
    if (UL_ITEM.test(line)) {
      const items: string[] = []
      while (i < lines.length && UL_ITEM.test(lines[i])) {
        items.push(`<li class="text-gray-700 text-sm leading-relaxed">${renderInline(lines[i].replace(UL_ITEM, '$1'))}</li>`)
        i++
      }
      out.push(`<ul class="list-disc pl-5 space-y-1 my-2">${items.join('')}</ul>`)
      continue
    }

    // Ordered list block
    if (OL_ITEM.test(line)) {
      const items: string[] = []
      while (i < lines.length && OL_ITEM.test(lines[i])) {
        items.push(`<li class="text-gray-700 text-sm leading-relaxed pl-1">${renderInline(lines[i].replace(OL_ITEM, '$1'))}</li>`)
        i++
      }
      out.push(`<ol class="list-decimal pl-5 space-y-1 my-2">${items.join('')}</ol>`)
      continue
    }

    // Blank line
    if (line.trim() === '') {
      i++
      continue
    }

    // Paragraph
    out.push(`<p class="text-sm text-gray-700 leading-relaxed my-1">${renderInline(line)}</p>`)
    i++
  }

  return out.join('\n')
}

export default function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div
      className="prose-sm max-w-none"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
    />
  )
}
