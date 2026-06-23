'use client'

import { useEffect, useState } from 'react'
import { AiProvider } from '@/lib/ai-client'

export type StorageProvider = 'local' | 'google-drive'

export type AppSettings = {
  storageProvider: StorageProvider
  aiProvider: AiProvider
  openAiModel: string
  remotePlaywrightUrl: string
  googleClientId: string
  googleDriveFileId: string
  googleDriveFileName: string
}

type SettingsOverlayProps = {
  settings: AppSettings
  chatGptStatus: 'checking' | 'connected' | 'login_required' | 'disconnected' | 'error'
  chatGptMessage: string
  openAiApiKey: string
  remotePlaywrightToken: string
  googleStatus: 'disconnected' | 'connecting' | 'connected' | 'saving' | 'saved' | 'error'
  googleMessage: string
  googleEmail: string
  onSettingsChange: (settings: AppSettings) => void
  onOpenAiApiKeyChange: (value: string) => void
  onRemotePlaywrightTokenChange: (value: string) => void
  onChatGptLogin: () => void
  onGoogleConnect: () => void
  onGoogleDisconnect: () => void
  onGoogleSave: () => void
  onGoogleLoad: () => void
  onClose: () => void
}

export default function SettingsOverlay({
  settings,
  chatGptStatus,
  chatGptMessage,
  openAiApiKey,
  remotePlaywrightToken,
  googleStatus,
  googleMessage,
  googleEmail,
  onSettingsChange,
  onOpenAiApiKeyChange,
  onRemotePlaywrightTokenChange,
  onChatGptLogin,
  onGoogleConnect,
  onGoogleDisconnect,
  onGoogleSave,
  onGoogleLoad,
  onClose,
}: SettingsOverlayProps) {
  const staticExport = process.env.NEXT_PUBLIC_STATIC_EXPORT === 'true'
  const [chapter, setChapter] = useState<'ai' | 'storage'>('ai')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const googleConnected = Boolean(googleEmail)

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="Settings">
      <header className="settings-header">
        <div>
          <p className="settings-eyebrow">llm-pipeline</p>
          <h1>Settings</h1>
        </div>
        <button type="button" className="settings-close-button" onClick={onClose} aria-label="Close settings">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </header>
      <div className="settings-layout">
        <nav className="settings-chapters" aria-label="Settings chapters">
          <button
            type="button"
            className={chapter === 'ai' ? 'is-active' : undefined}
            onClick={() => setChapter('ai')}
          >
            <span>01</span>
            AI connections
          </button>
          <button
            type="button"
            className={chapter === 'storage' ? 'is-active' : undefined}
            onClick={() => setChapter('storage')}
          >
            <span>02</span>
            Documents & storage
          </button>
        </nav>
        <section className="settings-content">
          {chapter === 'ai' ? (
            <>
              <div className="settings-section-heading">
                <p>AI connections</p>
                <h2>Choose how prompts are executed</h2>
                <span>
                  Use the OpenAI API directly, automate a local ChatGPT browser session,
                  or connect this static application to a remote Playwright service.
                </span>
              </div>
              <fieldset className="ai-provider-choice">
                <legend>Prompt provider</legend>
                {([
                  ['openai-api', 'OpenAI API', 'Works on GitHub Pages using your API key.'],
                  ...(staticExport ? [] : [[
                    'local-playwright',
                    'Local Playwright',
                    'Uses the Chrome profile on this computer.',
                  ] as const]),
                  ['remote-playwright', 'Remote Playwright', 'Calls a separately hosted Playwright service.'],
                ] as const).map(([value, title, detail]) => (
                  <label key={value} className={settings.aiProvider === value ? 'is-selected' : undefined}>
                    <input
                      type="radio"
                      name="ai-provider"
                      checked={settings.aiProvider === value}
                      onChange={() => onSettingsChange({ ...settings, aiProvider: value })}
                    />
                    <span>
                      <b>{title}</b>
                      <small>{detail}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
              {settings.aiProvider === 'openai-api' ? (
                <div className="settings-card settings-form-card">
                  <div className="settings-card-title">
                    <span className="service-mark">API</span>
                    <div>
                      <h3>OpenAI API</h3>
                      <p>{openAiApiKey ? 'API key configured for this tab' : 'API key required'}</p>
                    </div>
                  </div>
                  <label className="settings-field">
                    <span>OpenAI API key</span>
                    <input
                      type="password"
                      value={openAiApiKey}
                      onChange={(event) => onOpenAiApiKeyChange(event.target.value)}
                      placeholder="sk-…"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <small>The key is kept in session storage and removed when this tab session ends.</small>
                  </label>
                  <label className="settings-field">
                    <span>Model</span>
                    <input
                      type="text"
                      value={settings.openAiModel}
                      onChange={(event) => onSettingsChange({
                        ...settings,
                        openAiModel: event.target.value.trim(),
                      })}
                      placeholder="gpt-5.5"
                      spellCheck={false}
                    />
                  </label>
                  <div className="settings-warning">
                    A GitHub Pages app must send this key from the browser. OpenAI recommends
                    keeping API keys on a server; use a restricted project key and revoke it
                    if the browser or device is shared.
                  </div>
                </div>
              ) : (
                <div className="settings-card settings-form-card">
                  <div className="settings-card-title">
                    <span className="service-mark">AI</span>
                    <div>
                      <h3>
                        {settings.aiProvider === 'local-playwright'
                          ? 'Local ChatGPT session'
                          : 'Remote ChatGPT session'}
                      </h3>
                      <p>Playwright browser connection</p>
                    </div>
                  </div>
                  {settings.aiProvider === 'remote-playwright' && (
                    <>
                      <label className="settings-field">
                        <span>Remote service URL</span>
                        <input
                          type="url"
                          value={settings.remotePlaywrightUrl}
                          onChange={(event) => onSettingsChange({
                            ...settings,
                            remotePlaywrightUrl: event.target.value.trim(),
                          })}
                          placeholder="https://playwright.example.com"
                          spellCheck={false}
                        />
                        <small>
                          The service must expose `/api/prompt` and `/api/chatgpt/session`
                          and allow this site through CORS.
                        </small>
                      </label>
                      <label className="settings-field">
                        <span>Service bearer token</span>
                        <input
                          type="password"
                          value={remotePlaywrightToken}
                          onChange={(event) => onRemotePlaywrightTokenChange(event.target.value)}
                          placeholder="Optional private service token"
                          autoComplete="off"
                          spellCheck={false}
                        />
                        <small>The token is kept in session storage only.</small>
                      </label>
                    </>
                  )}
                  <div className={`connection-status is-${chatGptStatus}`}>
                    <i />
                    {chatGptStatus === 'checking'
                      ? 'Checking session'
                      : chatGptStatus === 'connected'
                        ? 'Connected'
                        : 'Not connected'}
                  </div>
                  {chatGptMessage && <p className="settings-help">{chatGptMessage}</p>}
                  <div className="settings-button-row">
                    <button
                      type="button"
                      className="settings-action-button"
                      onClick={onChatGptLogin}
                      disabled={chatGptStatus === 'checking'
                        || (settings.aiProvider === 'remote-playwright'
                          && !settings.remotePlaywrightUrl)}
                    >
                      {chatGptStatus === 'connected' ? 'Check session' : 'Open ChatGPT login'}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="settings-section-heading">
                <p>Documents & storage</p>
                <h2>Choose where pipeline documents are saved</h2>
                <span>
                  Local storage works immediately. Google Drive keeps the document in your
                  Drive and maintains a local offline cache in this browser.
                </span>
              </div>
              <fieldset className="storage-choice">
                <legend>Primary storage</legend>
                <label className={settings.storageProvider === 'local' ? 'is-selected' : undefined}>
                  <input
                    type="radio"
                    name="storage-provider"
                    checked={settings.storageProvider === 'local'}
                    onChange={() => onSettingsChange({ ...settings, storageProvider: 'local' })}
                  />
                  <span>
                    <b>Browser local storage</b>
                    <small>Saved only in this browser profile.</small>
                  </span>
                </label>
                <label className={settings.storageProvider === 'google-drive' ? 'is-selected' : undefined}>
                  <input
                    type="radio"
                    name="storage-provider"
                    checked={settings.storageProvider === 'google-drive'}
                    disabled={!googleConnected}
                    onChange={() => onSettingsChange({ ...settings, storageProvider: 'google-drive' })}
                  />
                  <span>
                    <b>Google Drive</b>
                    <small>{googleConnected ? 'Autosaves to Drive.' : 'Connect Google Drive first.'}</small>
                  </span>
                </label>
              </fieldset>
              <div className="settings-card settings-form-card">
                <div className="settings-card-title">
                  <span className="service-mark is-google">G</span>
                  <div>
                    <h3>Google Drive</h3>
                    <p>{googleEmail || 'OAuth connection'}</p>
                  </div>
                </div>
                <label className="settings-field">
                  <span>Google OAuth client ID</span>
                  <input
                    type="text"
                    value={settings.googleClientId}
                    onChange={(event) => onSettingsChange({
                      ...settings,
                      googleClientId: event.target.value.trim(),
                    })}
                    placeholder="1234567890-abc.apps.googleusercontent.com"
                    spellCheck={false}
                  />
                  <small>
                    Use a Web application client ID with this app&apos;s origin added to
                    Authorized JavaScript origins.
                  </small>
                </label>
                <label className="settings-field">
                  <span>Drive document name</span>
                  <input
                    type="text"
                    value={settings.googleDriveFileName}
                    onChange={(event) => onSettingsChange({
                      ...settings,
                      googleDriveFileName: event.target.value,
                    })}
                    placeholder="Pipeline.llm-pipeline.json"
                  />
                </label>
                <div className="settings-button-row">
                  {googleConnected ? (
                    <>
                      <button type="button" className="settings-action-button" onClick={onGoogleSave}>
                        Save now
                      </button>
                      <button
                        type="button"
                        className="settings-secondary-button"
                        onClick={onGoogleLoad}
                        disabled={!settings.googleDriveFileId}
                      >
                        Load from Drive
                      </button>
                      <button
                        type="button"
                        className="settings-secondary-button"
                        onClick={onGoogleDisconnect}
                      >
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="settings-action-button"
                      onClick={onGoogleConnect}
                      disabled={!settings.googleClientId || googleStatus === 'connecting'}
                    >
                      {googleStatus === 'connecting' ? 'Connecting…' : 'Connect Google Drive'}
                    </button>
                  )}
                </div>
                {googleMessage && (
                  <p className={`settings-help ${googleStatus === 'error' ? 'is-error' : ''}`}>
                    {googleMessage}
                  </p>
                )}
                {settings.googleDriveFileId && (
                  <p className="settings-file-id">Drive file ID: {settings.googleDriveFileId}</p>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
