import { chromium } from "playwright"

async function main() {
  const context = await chromium.launchPersistentContext("./profile", {
    headless: false
  })
  const page = await context.newPage()

  await page.goto("https://chatgpt.com")

  console.log("\n=== LOGIN REQUIRED ===")
  console.log("1. Sign in manually")
  console.log("2. Wait until you see a NEW chat input box")
  console.log("3. Create a test message like 'hello'")
  console.log("4. ONLY THEN close the browser window\n")

  // IMPORTANT: keep process alive
  await new Promise(() => {})
}

main()
