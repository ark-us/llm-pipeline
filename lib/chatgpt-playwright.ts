import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Browser, BrowserContext, chromium, Page } from 'playwright'

const PROFILE_PATH = path.join(process.cwd(), '.playwright', 'chatgpt-chrome-profile')
const DEBUG_PORT = 9333
const DEBUG_URL = `http://127.0.0.1:${DEBUG_PORT}`

declare global {
  var __llmPipelineChatGptBrowser: Promise<Browser> | undefined
}

function chromeExecutable() {
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : process.platform === 'win32'
      ? [
          `${process.env.PROGRAMFILES ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env['PROGRAMFILES(X86)'] ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
        ]
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
        ]
  return candidates.find((candidate) => candidate && fs.existsSync(candidate))
}

async function debuggingReady() {
  try {
    const response = await fetch(`${DEBUG_URL}/json/version`, {
      signal: AbortSignal.timeout(800),
    })
    return response.ok
  } catch {
    return false
  }
}

async function waitForDebugging() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await debuggingReady()) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Chrome did not expose its local debugging connection')
}

async function launchLoginChrome() {
  const executable = chromeExecutable()
  if (!executable) throw new Error('Google Chrome was not found')
  fs.mkdirSync(PROFILE_PATH, { recursive: true })
  const child = spawn(executable, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${PROFILE_PATH}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--start-minimized',
    'https://chatgpt.com/',
  ], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  await waitForDebugging()
}

async function getContext(): Promise<BrowserContext> {
  if (!(await debuggingReady())) {
    await launchLoginChrome()
  }
  if (!globalThis.__llmPipelineChatGptBrowser) {
    globalThis.__llmPipelineChatGptBrowser = chromium.connectOverCDP(DEBUG_URL)
      .then((browser) => {
        browser.once('disconnected', () => {
          globalThis.__llmPipelineChatGptBrowser = undefined
        })
        return browser
      })
      .catch((error) => {
        globalThis.__llmPipelineChatGptBrowser = undefined
        throw error
      })
  }
  const browser = await globalThis.__llmPipelineChatGptBrowser
  const context = browser.contexts()[0]
  if (!context) throw new Error('Chrome did not provide a browser context')
  return context
}

async function getChatPage(context: BrowserContext) {
  const existing = context.pages().find((page) => page.url().startsWith('https://chatgpt.com'))
  const page = existing ?? await context.newPage()
  if (!page.url().startsWith('https://chatgpt.com')) {
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' })
  } else {
    await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {})
  }
  return page
}

async function findComposer(page: Page) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const candidates = [
      page.locator('[data-testid="prompt-textarea"]'),
      page.locator('#prompt-textarea'),
      page.locator('textarea[placeholder*="Message"]'),
    ]
    for (const candidate of candidates) {
      if (await candidate.count() > 0 && await candidate.first().isVisible()) {
        return candidate.first()
      }
    }
    await page.waitForTimeout(250)
  }
  return null
}

export async function getChatGptSessionStatus() {
  if (!(await debuggingReady())) {
    return {
      status: 'disconnected' as const,
      message: 'The dedicated ChatGPT browser is not running.',
    }
  }
  const context = await getContext()
  const page = await getChatPage(context)
  const composer = await findComposer(page)
  return composer
    ? {
        status: 'connected' as const,
        message: 'The dedicated Chrome profile is signed in and ready.',
      }
    : {
        status: 'login_required' as const,
        message: 'Finish signing in to ChatGPT in the opened Chrome window.',
      }
}

export async function openChatGptSession() {
  const context = await getContext()
  const page = await getChatPage(context)
  await page.bringToFront()
  const composer = await findComposer(page)
  return composer
    ? {
        status: 'connected' as const,
        message: 'The dedicated Chrome profile is signed in and ready.',
      }
    : {
        status: 'login_required' as const,
        message: 'Finish signing in to ChatGPT, then return here and check the session.',
      }
}

export async function runChatGptPrompt(prompt: string) {
  const context = await getContext()
  const page = await getChatPage(context)
  const composer = await findComposer(page)
  if (!composer) {
    return {
      status: 'login_required' as const,
      message: 'Finish signing in to ChatGPT, then click Run prompt again.',
    }
  }

  const assistantMessages = page.locator('[data-message-author-role="assistant"]')
  const previousCount = await assistantMessages.count()
  await composer.fill(prompt)

  const sendButton = page.locator('[data-testid="send-button"]')
  if (await sendButton.count() > 0 && await sendButton.first().isEnabled()) {
    await sendButton.first().click()
  } else {
    await composer.press('Enter')
  }

  await assistantMessages.nth(previousCount).waitFor({ state: 'visible', timeout: 120_000 })
  const stopButton = page.locator('[data-testid="stop-button"]')
  if (await stopButton.count() > 0) {
    await stopButton.first().waitFor({ state: 'hidden', timeout: 300_000 }).catch(() => {})
  }
  await page.waitForTimeout(800)
  const text = (await assistantMessages.nth(previousCount).innerText()).trim()
  if (!text) throw new Error('ChatGPT returned an empty response')
  return { status: 'completed' as const, text }
}
