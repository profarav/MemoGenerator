'use client'

import { useState } from 'react'
import MarkdownRenderer from '@/components/MarkdownRenderer'
import { parseMemoSections } from '@/lib/memo/sections'

interface Props {
  content: string
  /** Which section number is currently regenerating, if any */
  regeneratingSection: number | null
  onRegenerateSection: (sectionNumber: number, focus: string) => void
  disabled?: boolean
}

/**
 * Renders a memo split into its numbered sections, each with its own
 * "Regenerate" control and optional focus instruction. Falls back to plain
 * rendering for memos that don't follow the expected section structure.
 */
export default function MemoSections({
  content,
  regeneratingSection,
  onRegenerateSection,
  disabled,
}: Props) {
  const [openSection, setOpenSection] = useState<number | null>(null)
  const [focus, setFocus] = useState('')

  const { preamble, sections } = parseMemoSections(content)

  if (sections.length === 0) {
    return <MarkdownRenderer content={content} />
  }

  function startRegenerate(sectionNumber: number) {
    onRegenerateSection(sectionNumber, focus)
    setOpenSection(null)
    setFocus('')
  }

  return (
    <div>
      {preamble && <MarkdownRenderer content={preamble} />}

      {sections.map((section) => {
        const isRegenerating = regeneratingSection === section.number
        const isOpen = openSection === section.number

        return (
          <section
            key={section.number}
            className={`group relative -mx-2 rounded-md px-2 py-1 transition-colors ${
              isRegenerating ? 'bg-indigo-50/60' : 'hover:bg-gray-50'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <MarkdownRenderer content={`${section.heading}\n${section.body}`} />
              </div>

              <button
                type="button"
                onClick={() => {
                  setOpenSection(isOpen ? null : section.number)
                  setFocus('')
                }}
                disabled={disabled || regeneratingSection !== null}
                title={`Regenerate "${section.title}"`}
                className="mt-6 shrink-0 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-400 opacity-60 transition hover:border-gray-300 hover:bg-gray-50 hover:text-gray-700 focus:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-gray-400"
              >
                {isRegenerating ? 'Regenerating…' : '↻ Regenerate'}
              </button>
            </div>

            {isRegenerating && (
              <p className="mt-1 text-xs text-indigo-700">
                Rewriting “{section.title}”…
              </p>
            )}

            {isOpen && !isRegenerating && (
              <div className="mb-3 mt-2 space-y-2 rounded-md border border-gray-200 bg-white p-3">
                <label className="block text-xs font-medium text-gray-700">
                  Regenerate “{section.title}” with a focus on… (optional)
                </label>
                <textarea
                  rows={2}
                  autoFocus
                  value={focus}
                  onChange={(e) => setFocus(e.target.value)}
                  placeholder="e.g. Focus on what Colormatics actually produces, not their client list."
                  className="input text-sm"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => startRegenerate(section.number)}
                    className="btn-primary text-xs"
                  >
                    Regenerate section
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenSection(null)
                      setFocus('')
                    }}
                    className="btn-secondary text-xs"
                  >
                    Cancel
                  </button>
                </div>
                <p className="text-xs text-gray-400">
                  Only this section changes — the rest of the memo stays as it is.
                </p>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
