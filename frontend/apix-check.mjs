import { chromium } from 'playwright';
const pages = [
  ['/', 'overview'], ['/trends','trends'], ['/compare','compare'],
  ['/spikes','spikes'], ['/admin','admin'], ['/method','method'],
];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const errors = [];
for (const [path, name] of pages) {
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type()==='error') errors.push(`[${name}] console: ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[${name}] pageerror: ${e.message}`));
  await page.goto('http://localhost:5173'+path, { waitUntil:'networkidle' });
  await page.waitForTimeout(1800);
  await page.screenshot({ path:`/tmp/apix-${name}.png`, fullPage:true });
  await page.close();
}
await browser.close();
console.log(errors.length ? errors.join('\n') : 'NO CONSOLE ERRORS');
