import { chromium } from "playwright"

async function main() {
  const context = await chromium.launchPersistentContext("./profile", {
    headless: false
  })

  const page = await context.newPage()

  await page.goto("https://chatgpt.com")

  console.log("👉 Log in manually in the opened browser")
  console.log("👉 Then close ONLY after you see chat UI")

  await new Promise(() => {}) // keep alive
}

main()