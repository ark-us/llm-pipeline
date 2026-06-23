'use client'

export const GOOGLE_DRIVE_SCOPE = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

const GOOGLE_DRIVE_SCOPES = GOOGLE_DRIVE_SCOPE.split(' ')

type GoogleTokenResponse = {
  access_token?: string
  scope?: string
  error?: string
  error_description?: string
}

type GoogleTokenClient = {
  requestAccessToken: (config?: {
    scope?: string
    prompt?: string
    include_granted_scopes?: boolean
  }) => void
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            include_granted_scopes?: boolean
            callback: (response: GoogleTokenResponse) => void
            error_callback?: (error: { type?: string; message?: string }) => void
          }) => GoogleTokenClient
          hasGrantedAllScopes: (
            response: GoogleTokenResponse,
            firstScope: string,
            ...restScopes: string[]
          ) => boolean
          revoke: (token: string, callback: () => void) => void
        }
      }
    }
  }
}

let scriptPromise: Promise<void> | null = null

function loadGoogleIdentity() {
  if (window.google?.accounts.oauth2) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    )
    const script = existing ?? document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Could not load Google Identity Services'))
    if (!existing) document.head.appendChild(script)
  })
  return scriptPromise
}

export async function requestGoogleDriveToken(clientId: string) {
  await loadGoogleIdentity()
  if (!window.google?.accounts.oauth2) {
    throw new Error('Google Identity Services did not initialize')
  }
  return new Promise<string>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_DRIVE_SCOPE,
      include_granted_scopes: false,
      callback: (response) => {
        if (!response.access_token) {
          reject(new Error(response.error_description ?? response.error ?? 'Google login failed'))
          return
        }
        const [firstScope, ...restScopes] = GOOGLE_DRIVE_SCOPES
        if (!window.google!.accounts.oauth2.hasGrantedAllScopes(
          response,
          firstScope,
          ...restScopes,
        )) {
          reject(new Error(
            'Google Drive permission was not granted. Reconnect and allow the app to create and update its Drive files.',
          ))
          return
        }
        resolve(response.access_token)
      },
      error_callback: (error) => {
        reject(new Error(error.message ?? error.type ?? 'Google login was closed'))
      },
    })
    client.requestAccessToken({
      scope: GOOGLE_DRIVE_SCOPE,
      prompt: 'consent select_account',
      include_granted_scopes: false,
    })
  })
}

async function googleRequest(url: string, accessToken: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...init?.headers,
    },
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Google Drive request failed (${response.status}): ${detail || response.statusText}`)
  }
  return response
}

export async function getGoogleAccountEmail(accessToken: string) {
  const response = await googleRequest(
    'https://www.googleapis.com/oauth2/v2/userinfo?fields=email',
    accessToken,
  )
  const result = await response.json() as { email?: string }
  return result.email ?? 'Google account'
}

export async function saveGoogleDriveDocument(options: {
  accessToken: string
  fileId?: string
  name: string
  content: string
}) {
  const boundary = `llm-pipeline-${crypto.randomUUID()}`
  const metadata = JSON.stringify({
    name: options.name,
    mimeType: 'application/json',
    appProperties: { application: 'llm-pipeline' },
  })
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    options.content,
    `--${boundary}--`,
  ].join('\r\n')
  const base = options.fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(options.fileId)}`
    : 'https://www.googleapis.com/upload/drive/v3/files'
  const response = await googleRequest(
    `${base}?uploadType=multipart&fields=id,name,modifiedTime`,
    options.accessToken,
    {
      method: options.fileId ? 'PATCH' : 'POST',
      headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      body,
    },
  )
  return response.json() as Promise<{ id: string; name: string; modifiedTime?: string }>
}

export async function loadGoogleDriveDocument(accessToken: string, fileId: string) {
  const response = await googleRequest(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    accessToken,
  )
  return response.text()
}

export function revokeGoogleToken(accessToken: string) {
  return new Promise<void>((resolve) => {
    if (!window.google?.accounts.oauth2) {
      resolve()
      return
    }
    window.google.accounts.oauth2.revoke(accessToken, resolve)
  })
}
