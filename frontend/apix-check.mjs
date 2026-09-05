import { chromium } from 'playwright'

const baseUrl = process.env.FAREPULSE_BASE_URL ?? 'http://127.0.0.1:5173'
const routes = [
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
const failures = []

function monitor(page, name) {
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
}

async function step(name, action) {
  try {
    await action()
  } catch (error) {
    failures.push(`[${name}] ${error.message}`)
  }
}

const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
try {
  const response = await context.request.get(baseUrl)
  if (!response.ok()) throw new Error(`frontend returned HTTP ${response.status()}`)
} catch (error) {
  console.error(`FAIL: smoke-test preflight could not reach ${baseUrl}: ${error.message}`)
  await context.close()
  await browser.close()
  process.exit(1)
}
await context.addInitScript(() => {
  if (localStorage.getItem('apix_judge_mode') === null) {
    localStorage.setItem('apix_judge_mode', 'false')
  }
})
const page = await context.newPage()
monitor(page, 'interaction')

const runtime = await (await context.request.get(`${baseUrl}/api/version`)).json()
if (runtime.demo_mode !== true || runtime.live_only) {
  await browser.close()
  throw new Error('This destructive demo suite requires an isolated DEMO_MODE=true, LIVE_ONLY=false server.')
}

await step('start-judge-demo', async () => {
  const cleared = await context.request.delete(`${baseUrl}/api/admin/data`)
  if (!cleared.ok()) throw new Error(`clear-data returned ${cleared.status()}`)
  await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'No data loaded yet' }).waitFor()
  await page.getByRole('button', { name: 'Start Judge Demo' }).click()
  await page.locator('.overview-analysis > summary').click()
  await page.getByRole('heading', { name: 'Experimental Basket Indicator' }).waitFor({ timeout: 30000 })
  await page.getByTestId('publication-gate').waitFor()
})

await step('judge-mode-toggle', async () => {
  const toggle = page.getByRole('button').filter({ hasText: 'Judge Mode' }).first()
  await toggle.click()
  await page.getByTestId('judge-panel').waitFor()
  await toggle.click()
  if (await page.getByTestId('judge-panel').count()) {
    throw new Error('Judge panel remained mounted after Judge Mode was switched off')
  }
  await toggle.click()
  await page.getByTestId('judge-panel').waitFor()
})

await step('overview-filter', async () => {
  const routeSelect = page.locator('.overview-filters').getByLabel('Route').first()
  const routeValue = await routeSelect.locator('option').nth(1).getAttribute('value')
  if (!routeValue) throw new Error('No route option available')
  const response = page.waitForResponse((r) => r.url().includes('/api/trends') && r.status() === 200)
  await routeSelect.selectOption(routeValue)
  await response
  await page.getByText('Filters active', { exact: false }).waitFor()
  await page.getByRole('button', { name: 'Reset' }).click()
})

await step('case-file', async () => {
  await page.goto(`${baseUrl}/spikes`, { waitUntil: 'networkidle' })
  const thresholdResponse = page.waitForResponse(
    (r) => r.url().includes('/api/spikes?threshold=5') && r.status() === 200,
  )
  await page.getByLabel('Sensitivity (robust z)').selectOption('5')
  await thresholdResponse
  await page.getByRole('button', { name: 'Case File' }).first().click()
  const dialog = page.getByTestId('case-file-dialog')
  await dialog.waitFor()
  await dialog.getByText('Evidence Trail', { exact: true }).waitFor()
  await dialog.getByText('Robust z > 5 AND ≥ 25% from cell median', { exact: true }).waitFor()
  await dialog.getByText('Calculation ID', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
})

await step('competition-drawer', async () => {
  await page.goto(`${baseUrl}/competition`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Route Competition Monitor' }).waitFor()
  await page.getByRole('button', { name: 'Details' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
})

await step('vulnerability-filter', async () => {
  await page.goto(`${baseUrl}/vulnerability`, { waitUntil: 'networkidle' })
  const routeSelect = page.getByLabel('Route')
  const routeValue = await routeSelect.locator('option').nth(1).getAttribute('value')
  if (!routeValue) throw new Error('No vulnerability route option available')
  const response = page.waitForResponse((r) => r.url().includes('/api/vulnerability?') && r.status() === 200)
  await routeSelect.selectOption(routeValue)
  await response
  await page.getByText(/observations ·/).waitFor()
  await page.getByText('Within-cell volatility', { exact: true }).first().waitFor()
})

await step('fairness-drawer', async () => {
  await page.goto(`${baseUrl}/fairness`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Fairness Lens' }).waitFor()
  await page.getByText('Details', { exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await dialog.getByText('Index change', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
})

await step('what-if-sliders', async () => {
  await page.goto(`${baseUrl}/whatif`, { waitUntil: 'networkidle' })
  const slider = page.getByLabel('Passenger demand change')
  const output = page.getByTestId('whatif-projected-change')
  const before = (await output.textContent())?.trim()
  const response = page.waitForResponse(
    (r) => r.url().includes('/api/whatif') && r.url().includes('demand_change_pct=20') && r.status() === 200,
  )
  await slider.fill('20')
  if (await slider.count() !== 1) throw new Error('Slider unmounted during recalculation')
  await response
  await page.waitForFunction(
    ({ testId, previous }) => document.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() !== previous,
    { testId: 'whatif-projected-change', previous: before },
  )
  await page.getByText('Uncalibrated illustrative model.', { exact: true }).waitFor()
})

await context.addInitScript(() => localStorage.setItem('apix_judge_mode', 'true'))
for (const [path, name] of routes) {
  await step(`${name}-judge-route`, async () => {
    await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle' })
    await page.locator('main').waitFor({ state: 'visible' })
    await page.getByTestId('judge-panel').waitFor({ timeout: 15000 })
  })
}

const mobile = await context.newPage()
monitor(mobile, 'mobile')
await mobile.setViewportSize({ width: 390, height: 844 })
for (const [path, name] of [['/', 'overview'], ['/spikes', 'alerts'], ['/whatif', 'what-if']]) {
  await step(`mobile-${name}`, async () => {
    await mobile.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle' })
    await mobile.locator('main').waitFor({ state: 'visible' })
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    if (overflow > 2) {
      const offenders = await mobile.evaluate(() =>
        Array.from(document.querySelectorAll('body *'))
          .map((element) => ({
            tag: element.tagName,
            text: element.textContent?.trim().slice(0, 40),
            right: Math.round(element.getBoundingClientRect().right),
            width: Math.round(element.getBoundingClientRect().width),
          }))
          .filter((item) => item.right > window.innerWidth + 2)
          .slice(0, 8),
      )
      throw new Error(`document overflows viewport by ${overflow}px: ${JSON.stringify(offenders)}`)
    }
  })
}
await mobile.screenshot({ path: '/tmp/farepulse-mobile.png', fullPage: true })

await context.close()
await browser.close()

if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log(
    'PASS: Start Judge Demo, filters, Case File, drawers, Judge Mode, What-If sliders, '
      + '10 routes, mobile layout, console errors, page errors, and API failures',
  )
}
