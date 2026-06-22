import { chromium, BrowserContext, Page } from "playwright"

let context: BrowserContext | null = null
let page: Page | null = null
let initPromise: Promise<Page> | null = null

export async function getPage(): Promise<Page> {
  if (page) return page
  if (initPromise) return initPromise

  initPromise = (async () => {
    context = await chromium.launchPersistentContext("./profile", {
      headless: false
    })

    page = await context.newPage()

    await page.goto("https://chatgpt.com", {
      waitUntil: "domcontentloaded"
    })

    // IMPORTANT: give time for auth redirect
    await page.waitForTimeout(5000)

    return page
  })()

  return initPromise
}