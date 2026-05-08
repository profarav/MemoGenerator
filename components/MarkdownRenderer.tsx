'use client'

// Lightweight markdown-to-HTML renderer without external deps.
// Handles: headings, bold, bullets, horizontal rules, paragraphs.
function renderMarkdown(md: string): string {
  let html = md
    // Headings
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold text-gray-800 mt-5 mb-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold text-gray-900 mt-6 mb-2 border-b border-gray-200 pb-1">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-gray-900 mt-0 mb-4">$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr class="my-4 border-gray-200" />')
    // Bullet points
    .replace(/^- (.+)$/gm, '<li class="ml-4 text-gray-700 text-sm leading-relaxed">$1</li>')
    // Wrap consecutive <li> in <ul>
    .replace(/(<li[^>]*>.*<\/li>\n?)+/g, (match) => `<ul class="list-disc list-inside space-y-1 my-2">${match}</ul>`)
    // Links
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener" class="text-blue-600 underline hover:text-blue-800">$1</a>')
    // Paragraphs — wrap lines not already wrapped
    .replace(/^(?!<[hul]|<li|<hr|<strong|<em)(.+)$/gm, '<p class="text-sm text-gray-700 leading-relaxed my-1">$1</p>')

  return html
}

export default function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div
      className="prose-sm max-w-none"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
    />
  )
}
