import Anthropic from '@anthropic-ai/sdk'

const apiKey = process.env.ANTHROPIC_API_KEY

if (!apiKey) {
  console.warn('[anthropic] ANTHROPIC_API_KEY is not set — AI calls will fail.')
}

export const anthropic = new Anthropic({ apiKey })

export const MODEL = 'claude-sonnet-4-20250514'

export async function callClaude(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 4096
): Promise<string> {
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    })

    const block = response.content[0]
    if (block.type !== 'text') {
      throw new Error('Unexpected response type from Claude')
    }
    return block.text
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string }

    if (error?.status === 401) {
      throw new Error(
        'Anthropic API authentication failed. Check your ANTHROPIC_API_KEY.'
      )
    }
    if (error?.status === 429) {
      throw new Error(
        'Anthropic API rate limit reached. Please wait a moment and try again.'
      )
    }
    if (error?.status === 529 || error?.status === 500) {
      throw new Error(
        'Anthropic API is temporarily unavailable. Please try again shortly.'
      )
    }

    throw new Error(
      `Claude API error: ${error?.message ?? 'Unknown error'}`
    )
  }
}
