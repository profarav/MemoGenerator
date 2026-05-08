import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Weekly Meeting Prep Agent',
  description: 'Generate Hugh-ready meeting prep memos',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen flex flex-col">
          <header className="border-b border-gray-200 bg-white">
            <div className="mx-auto max-w-5xl px-4 sm:px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-md bg-gray-900 flex items-center justify-center">
                  <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <a href="/" className="text-sm font-semibold text-gray-900 hover:text-gray-700">
                  Meeting Prep Agent
                </a>
              </div>
              <a href="/new" className="btn-primary text-xs">
                + New Memo
              </a>
            </div>
          </header>
          <main className="flex-1 mx-auto w-full max-w-5xl px-4 sm:px-6 py-8">
            {children}
          </main>
          <footer className="border-t border-gray-200 bg-white">
            <div className="mx-auto max-w-5xl px-4 sm:px-6 py-3 text-xs text-gray-400 text-center">
              Internal tool — for Patrick & Hugh
            </div>
          </footer>
        </div>
      </body>
    </html>
  )
}
