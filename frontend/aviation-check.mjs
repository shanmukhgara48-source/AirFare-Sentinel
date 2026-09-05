// Focused UI contract checks. Run against an isolated preview database.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const baseUrl = process.env.FAREPULSE_BASE_URL ?? 'http://127.0.0.1:5173'
const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.getByTestId('aviation-scene').waitFor()
  const ribbon = page.getByTestId('operating-mode')
  assert.match(await ribbon.textContent(), /Demo Mode/)
  const canvas = page.getByTestId('aviation-scene').locator('canvas')
  const frame = () => canvas.evaluate((element) => element.toDataURL())
  await page.getByRole('button', { name: 'Pause scene animation', exact: true }).click()
  await page.waitForTimeout(100)
  const paused = await frame()
  await page.waitForTimeout(180)
  assert.equal(await frame(), paused, 'Paused scene should stay still')
  await page.getByRole('button', { name: 'Resume scene animation', exact: true }).click()
  await page.waitForTimeout(100)
  const moving = await frame()
  await page.waitForTimeout(180)
  assert.notEqual(await frame(), moving, 'Resumed scene should animate')
  await page.screenshot({ path: '/tmp/airfare-overview-desktop.png' })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(100)
  const reduced = await frame()
  await page.waitForTimeout(180)
  assert.equal(await frame(), reduced, 'Reduced-motion preference should stop animation')
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  // Exercise presentation of different verified backend states without any
  // real provider call, environment change, or database mutation.
  const version = await (await context.request.get(`${baseUrl}/api/version`)).json()
  const cases = [
    { values: { demo_mode: true, operating_mode: 'demo' }, label: 'Demo Mode' },
    { values: { demo_mode: false, operating_mode: 'live', active_analysis_source: 'demo' }, label: 'Live fetch enabled' },
    { values: { demo_mode: false, operating_mode: 'live', active_analysis_source: 'live', available_analysis_sources: ['live'], dataset_label: 'Live quote snapshots' }, label: 'Live fare quote snapshots' },
  ]
  for (const test of cases) {
    await page.route('**/api/version', (route) => route.fulfill({ json: { ...version, ...test.values } }))
    await page.reload({ waitUntil: 'networkidle' })
    assert.equal(await ribbon.locator('strong').textContent(), test.label)
    await page.unroute('**/api/version')
  }
  await page.route('**/api/version', (route) => route.abort())
  await page.reload({ waitUntil: 'networkidle' })
  assert.equal(await ribbon.locator('strong').textContent(), 'Status unavailable')
  await page.unroute('**/api/version')
  await page.reload({ waitUntil: 'networkidle' })

  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    await page.locator('.overview-stat-grid').scrollIntoViewIfNeeded()
    const bounds = await ribbon.boundingBox()
    assert.ok(bounds && bounds.y >= 0 && bounds.y < 100, 'Operating mode remains visible while scrolling')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    assert.ok(overflow <= 2, `Page overflow at ${width}px: ${overflow}px`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: '/tmp/airfare-overview-mobile.png', fullPage: true })
  await page.goto(`${baseUrl}/admin`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Live fare quote snapshots', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Fetch all routes', exact: true }).count(), 0)
  assert.deepEqual(errors, [])
  console.log('PASS: aircraft pause/resume, reduced motion, honest demo/live/unavailable labels, sticky mode status, mobile/tablet/desktop overflow, and demo-gated Admin')
} finally {
  await browser.close()
}
