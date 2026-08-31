import { chromium } from 'playwright'

const baseUrl = process.env.FAREPULSE_BASE_URL ?? 'http://127.0.0.1:5173'
const pages = [
  ['/', 'overview'],
  ['/spikes', 'alerts'],
  ['/competition', 'competition'],
  ['/vulnerability', 'vulnerability'],
  ['/fairness', 'fairness'],
  ['/whatif', 'what-if'],
  ['/trends', 'trends'],
  ['/compare', 'compare'],
  ['/method', 'methodology'],
  ['/admin', 'admin'],
]

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
await context.addInitScript(() => localStorage.setItem('apix_judge_mode', 'true'))

const failures = []
for (const [path, name] of pages) {
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      failures.push(`[${name}] console ${message.type()}: ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => failures.push(`[${name}] page error: ${error.message}`))
  page.on('response', (response) => {
    if (response.url().includes('/api/') && response.status() >= 400) {
      failures.push(`[${name}] API ${response.status()}: ${response.url()}`)
    }
  })

  try {
    await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle' })
    await page.locator('main').waitFor({ state: 'visible' })
    await page.getByText('Judge Mode', { exact: true }).first().waitFor({ state: 'visible' })
    await page.screenshot({ path: `/tmp/farepulse-${name}.png`, fullPage: true })
  } catch (error) {
    failures.push(`[${name}] navigation/render: ${error.message}`)
  } finally {
    await page.close()
  }
}

await browser.close()

if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log(`PASS: ${pages.length} routes rendered in Judge Mode with no console or API errors`)
}
