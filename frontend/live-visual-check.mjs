import { chromium } from 'playwright'
const browser=await chromium.launch()
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}})
 await page.goto('http://127.0.0.1:5179/routes',{waitUntil:'networkidle'})
 await page.locator('.atlas-primary-fare strong').waitFor({timeout:30000})
 await page.locator('.route-atlas').screenshot({path:'/tmp/airfare-live-map-desktop.png'})
 await page.setViewportSize({width:390,height:844})
 await page.locator('.route-atlas').screenshot({path:'/tmp/airfare-live-map-mobile.png'})
 console.log('Live route map captured at desktop and mobile sizes')
}finally{await browser.close()}
