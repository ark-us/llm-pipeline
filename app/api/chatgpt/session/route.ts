import {
  getChatGptSessionStatus,
  openChatGptSession,
} from '@/lib/chatgpt-playwright'
import {
  authorizePlaywrightService,
  playwrightJson,
  playwrightOptions,
} from '@/lib/playwright-service-http'

export const runtime = 'nodejs'

export function OPTIONS(request: Request) {
  return playwrightOptions(request)
}

export async function GET(request: Request) {
  const unauthorized = authorizePlaywrightService(request)
  if (unauthorized) return unauthorized
  try {
    return playwrightJson(request, await getChatGptSessionStatus())
  } catch (error) {
    return playwrightJson(request, {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const unauthorized = authorizePlaywrightService(request)
  if (unauthorized) return unauthorized
  try {
    return playwrightJson(request, await openChatGptSession())
  } catch (error) {
    return playwrightJson(request, {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    }, { status: 500 })
  }
}
