function configuredOrigins() {
  return (process.env.PLAYWRIGHT_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

export function playwrightCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin')
  if (!origin) return {}
  const allowed = configuredOrigins()
  if (!allowed.includes('*') && !allowed.includes(origin)) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    vary: 'Origin',
  }
}

export function authorizePlaywrightService(request: Request) {
  const expected = process.env.PLAYWRIGHT_SERVICE_TOKEN
  if (!expected) return null
  const supplied = request.headers.get('authorization')
  if (supplied === `Bearer ${expected}`) return null
  return Response.json(
    { error: 'unauthorized remote Playwright request' },
    { status: 401, headers: playwrightCorsHeaders(request) },
  )
}

export function playwrightJson(
  request: Request,
  body: unknown,
  init?: ResponseInit,
) {
  const headers = new Headers(init?.headers)
  Object.entries(playwrightCorsHeaders(request)).forEach(([name, value]) => {
    headers.set(name, value)
  })
  return Response.json(body, {
    ...init,
    headers,
  })
}

export function playwrightOptions(request: Request) {
  return new Response(null, {
    status: 204,
    headers: playwrightCorsHeaders(request),
  })
}
