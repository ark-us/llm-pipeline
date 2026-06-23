'use client'

export type AiProvider = 'openai-api' | 'local-playwright' | 'remote-playwright'

type PromptResult = {
  status?: string
  text?: string
  message?: string
  error?: string
}

function extractOpenAiText(result: {
  output_text?: unknown
  output?: Array<{
    content?: Array<{
      type?: string
      text?: string
    }>
  }>
}) {
  if (typeof result.output_text === 'string') return result.output_text
  return (result.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === 'output_text' && typeof content.text === 'string')
    .map((content) => content.text)
    .join('\n')
}

async function readJsonResponse(response: Response) {
  const text = await response.text()
  try {
    return JSON.parse(text) as PromptResult
  } catch {
    return { error: text || response.statusText }
  }
}

function remoteUrl(baseUrl: string, path: string) {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (!normalized) throw new Error('Remote Playwright service URL is required.')
  return `${normalized}${path}`
}

export async function runConfiguredPrompt(options: {
  provider: AiProvider
  prompt: string
  openAiApiKey: string
  openAiModel: string
  remotePlaywrightUrl: string
  remotePlaywrightToken: string
}) {
  if (options.provider === 'openai-api') {
    if (!options.openAiApiKey) throw new Error('Enter an OpenAI API key in Settings.')
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.openAiApiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: options.openAiModel || 'gpt-5.5',
        input: options.prompt,
      }),
    })
    const result = await response.json() as {
      error?: { message?: string }
      output_text?: string
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
    }
    if (!response.ok) {
      throw new Error(result.error?.message ?? `OpenAI API request failed (${response.status})`)
    }
    const text = extractOpenAiText(result)
    if (!text) throw new Error('OpenAI returned no text output.')
    return { status: 'completed' as const, text }
  }

  const url = options.provider === 'local-playwright'
    ? '/api/prompt'
    : remoteUrl(options.remotePlaywrightUrl, '/api/prompt')
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(options.provider === 'remote-playwright' && options.remotePlaywrightToken
        ? { authorization: `Bearer ${options.remotePlaywrightToken}` }
        : {}),
    },
    body: JSON.stringify({ engine: 'chatgpt', prompt: options.prompt }),
  })
  const result = await readJsonResponse(response)
  if (response.status === 409 && result.status === 'login_required') return result
  if (!response.ok || typeof result.text !== 'string') {
    throw new Error(result.error ?? 'ChatGPT prompt failed')
  }
  return result
}

export async function checkPlaywrightSession(options: {
  provider: 'local-playwright' | 'remote-playwright'
  openLogin: boolean
  remotePlaywrightUrl: string
  remotePlaywrightToken: string
}) {
  const url = options.provider === 'local-playwright'
    ? '/api/chatgpt/session'
    : remoteUrl(options.remotePlaywrightUrl, '/api/chatgpt/session')
  const response = await fetch(url, {
    method: options.openLogin ? 'POST' : 'GET',
    headers: options.provider === 'remote-playwright' && options.remotePlaywrightToken
      ? { authorization: `Bearer ${options.remotePlaywrightToken}` }
      : undefined,
  })
  const result = await readJsonResponse(response)
  if (!response.ok && result.status !== 'login_required') {
    throw new Error(result.error ?? result.message ?? `Session check failed (${response.status})`)
  }
  return result
}
