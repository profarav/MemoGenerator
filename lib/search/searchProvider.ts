export interface SearchResult {
  title: string
  url: string
  snippet: string
  sourceType: string
}

async function searchTavily(query: string): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY!
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      max_results: 5,
      include_answer: false,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Tavily search failed (${res.status}): ${text}`)
  }

  const data = await res.json()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data.results ?? []).map((r: any) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.content ?? '',
    sourceType: 'web',
  }))
}

function mockSearchResults(query: string): SearchResult[] {
  const q = query.toLowerCase()
  return [
    {
      title: `About: ${query}`,
      url: `https://example.com/about?q=${encodeURIComponent(query)}`,
      snippet: `[Mock result] This is a placeholder search result for the query "${query}". In production, set TAVILY_API_KEY to get real web results. This result would normally contain a relevant excerpt from a web page about ${q}.`,
      sourceType: 'mock',
    },
    {
      title: `${query} — Overview`,
      url: `https://example.com/overview?q=${encodeURIComponent(query)}`,
      snippet: `[Mock result] Background information related to "${query}". Configure a real search API key to replace these placeholders with actual web research.`,
      sourceType: 'mock',
    },
  ]
}

export async function searchWeb(query: string): Promise<SearchResult[]> {
  if (process.env.TAVILY_API_KEY) {
    try {
      return await searchTavily(query)
    } catch (err) {
      console.error('[search] Tavily failed, falling back to mock:', err)
      return mockSearchResults(query)
    }
  }
  return mockSearchResults(query)
}
