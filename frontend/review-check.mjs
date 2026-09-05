import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const baseUrl = process.env.FAREPULSE_BASE_URL
if (!baseUrl || process.env.FAREPULSE_TEST_ALLOW_RESET !== '1') {
  throw new Error('Point FAREPULSE_BASE_URL at an isolated demo test server and set FAREPULSE_TEST_ALLOW_RESET=1. This suite resets its data.')
}
const output = process.env.FAREPULSE_TEST_OUTPUT ?? '/private/tmp/airfare-review-qa'
await mkdir(output, { recursive: true })
const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true })
  const runtime = await (await context.request.get(`${baseUrl}/api/version`)).json()
  assert.equal(runtime.demo_mode, true)
  assert.equal(runtime.live_only, false)
  const loaded = await context.request.post(`${baseUrl}/api/admin/load-sample`)
  assert.equal(loaded.status(), 200)
  const errors = []
  const page = await context.newPage()
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()) })
  await page.goto(`${baseUrl}/review`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Regulatory Review', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Create review case', exact: true }).first().waitFor()
  await page.screenshot({ path: `${output}/queue-desktop.png`, fullPage: false })
  await page.getByRole('button', { name: 'Create review case', exact: true }).first().click()
  const detail = page.getByTestId('regulatory-case-detail')
  await detail.waitFor()
  assert.match(page.url(), /case=AFS-/)
  assert.match(await detail.innerText(), /Tariff anomaly/i)
  assert.match(await detail.innerText(), /New Alert/)
  assert.equal(await detail.getByRole('checkbox').count(), 8)

  await detail.getByRole('combobox', { name: /case status/i }).selectOption('Evidence Pending')
  await detail.getByRole('button', { name: 'Save review', exact: true }).click()
  await detail.getByText('Saved · version 2', { exact: true }).waitFor()
  await page.reload({ waitUntil: 'networkidle' })
  await detail.waitFor()
  assert.equal(await detail.getByRole('combobox', { name: /case status/i }).inputValue(), 'Evidence Pending')

  // Document every stage, with references, before a recommendation.
  const checkLabels = await detail.getByRole('checkbox').evaluateAll(elements => elements.map(el => el.closest('label').innerText))
  for (const [i, label] of checkLabels.entries()) {
    const plain = label.replace(/^\d+\.\s*/, '')
    await detail.getByRole('textbox', { name: `${plain} — evidence notes`, exact: true }).fill(`QA reference ${i + 1}: synthetic exercise; original evidence remains unavailable.`)
    await detail.getByRole('checkbox', { name: label, exact: true }).check()
  }
  await detail.getByRole('textbox', { name: /analyst notes \/ closure reason/i }).fill('Synthetic test review: unresolved questions documented. No regulatory finding.')
  await detail.getByRole('combobox', { name: /case status/i }).selectOption('Recommended Escalation')
  assert.equal(await detail.getByRole('button', { name: 'Generate evidence pack', exact: true }).isDisabled(), true)
  await detail.getByRole('button', { name: 'Save review', exact: true }).click()
  await detail.getByText('Saved · version 3', { exact: true }).waitFor()
  await detail.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${output}/case-desktop.png`, fullPage: false })

  for (const [button, kind] of [['Generate evidence pack', 'evidence'], ['Case summary · JSON', 'json'], ['Case summary · CSV', 'csv']]) {
    const downloadPromise = page.waitForEvent('download')
    await detail.getByRole('button', { name: button, exact: true }).click()
    const download = await downloadPromise
    const file = `${output}/${download.suggestedFilename()}`
    await download.saveAs(file)
    const body = await readFile(file, 'utf8')
    if (kind !== 'csv') {
      const data = JSON.parse(body)
      assert.equal((data.summary ?? data).status, 'Recommended Escalation')
      assert.equal((data.summary ?? data).source_type, 'demo')
      if (kind === 'evidence') {
        assert.equal(data.history.length, 3)
        assert.equal(data.summary.checklist.every(check => check.done), true)
        assert.match(data.grievance_routing_summary, /SYNTHETIC DEMO EXERCISE/)
      }
    } else {
      assert.match(body, /source_type,provider/)
      assert.match(body, /Decision support, not a legal finding/)
    }
  }

  await detail.getByRole('button', { name: 'Generate evidence pack', exact: true }).waitFor({ state: 'visible' })
  await detail.getByRole('combobox', { name: /case status/i }).selectOption('Closed')
  await detail.getByRole('button', { name: 'Save review', exact: true }).click()
  await detail.getByText('Saved · version 4', { exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await detail.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${output}/case-mobile.png`, fullPage: false })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)

  // Existing Fare Alerts modal can convert or reopen the same observation.
  await page.setViewportSize({ width: 1440, height: 1050 })
  await page.goto(`${baseUrl}/spikes`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Case File', exact: true }).first().click()
  const modal = page.getByTestId('case-file-dialog')
  await modal.getByRole('button', { name: 'Create review case', exact: true }).click()
  await detail.waitFor()
  assert.match(await page.locator('main').innerText(), /Decision support, not a legal finding/)
  assert.deepEqual(errors, [])
  console.log('PASS: alert-to-case, persisted status/checklist, escalation, three downloads, modal integration, mobile overflow and browser errors.')
  console.log(`Screenshots and downloads: ${output}`)
  await context.close()
} finally { await browser.close() }
