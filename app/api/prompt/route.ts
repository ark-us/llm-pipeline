import { runChatGptPrompt } from '@/lib/chatgpt-playwright'
import {
  authorizePlaywrightService,
  playwrightJson,
  playwrightOptions,
} from '@/lib/playwright-service-http'

export const runtime = 'nodejs'

export function OPTIONS(request: Request) {
  return playwrightOptions(request)
}

export async function POST(request: Request) {
  const unauthorized = authorizePlaywrightService(request)
  if (unauthorized) return unauthorized
  try {
    const body = await request.json() as { engine?: unknown; prompt?: unknown }
    if (body.engine !== 'chatgpt') {
      return playwrightJson(
        request,
        { error: 'only the chatgpt engine is supported' },
        { status: 400 },
      )
    }
    if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
      return playwrightJson(
        request,
        { error: 'prompt must be a non-empty string' },
        { status: 400 },
      )
    }
    const result = await runChatGptPrompt(body.prompt)
    return playwrightJson(
      request,
      result,
      { status: result.status === 'login_required' ? 409 : 200 },
    )
  } catch (error) {
    return playwrightJson(request, {
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 })
  }
}
