import { runChatGptPrompt } from '@/lib/chatgpt-playwright'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const body = await request.json() as { engine?: unknown; prompt?: unknown }
    if (body.engine !== 'chatgpt') {
      return Response.json({ error: 'only the chatgpt engine is supported' }, { status: 400 })
    }
    if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
      return Response.json({ error: 'prompt must be a non-empty string' }, { status: 400 })
    }
    const result = await runChatGptPrompt(body.prompt)
    return Response.json(result, { status: result.status === 'login_required' ? 409 : 200 })
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 })
  }
}
