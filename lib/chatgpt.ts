import { chromium, Page } from 'playwright'

let page: Page | null = null

export async function getPage() {
  if (page) return page

  const context = await chromium.launchPersistentContext(
    './profile',
    {
      headless: false
    }
  )

  page = await context.newPage()

  await page.goto('https://chatgpt.com')

  return page
}