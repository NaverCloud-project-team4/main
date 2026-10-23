/* Live NAVER SDK/tiles + existing API data. Only the final error-path checks use explicit test fixtures. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const OUT = path.resolve('artifacts');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const errors = [], vendorFailures = [], tiles = [];
  let sdkLoaded = false;
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && /naver|Authentication|인증/i.test(m.text())) vendorFailures.push(m.text()); });
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.hostname === 'oapi.map.naver.com' && url.pathname.endsWith('/maps.js')) sdkLoaded = response.status() === 200;
    if (response.request().resourceType() === 'image' && /(?:pstatic\.net|map\.naver\.(?:com|net))$/.test(url.hostname) && response.status() === 200) {
      tiles.push({ host: url.hostname, path: url.pathname, status: response.status() });
    }
  });
  let checks = 0;
  const mark = message => { checks++; console.log(`PASS ${message}`); };
  try {
    await page.goto('http://127.0.0.1:5173/');
    await page.locator('.naver-zone-map[data-map-status="ready"]').waitFor({ timeout: 30000 });
    await page.locator('.naver-zone-marker').first().waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.naver-map-canvas img')].some(img => img.complete && img.naturalWidth >= 128));
    assert.ok(sdkLoaded, 'Actual NAVER SDK responded with 200');
    assert.equal(await page.locator('.naver-zone-marker').count(), 5);
    assert.ok(tiles.length > 0, 'Actual NAVER map images loaded');
    await page.screenshot({ path: path.join(OUT, 'naver-map-desktop.png'), fullPage: true });
    mark('live NAVER SDK, map images and five API-backed zone markers');

    await page.getByRole('button', { name: '서울숲 선택', exact: true }).click();
    await page.locator('.zone-detail').getByRole('heading', { name: '서울숲', exact: true }).waitFor();
    assert.equal(await page.locator('[data-zone-id="seoulforest"]').getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: '이 구역 사진 제보하기', exact: true }).click();
    assert.equal(await page.getByLabel('제보 구역', { exact: true }).inputValue(), 'seoulforest');
    assert.equal(await page.locator('.naver-zone-map').count(), 0);
    mark('native map marker selects zone and passes it to photo submission');

    await page.locator('.sidebar nav').getByRole('button', { name: '지도', exact: true }).click();
    await page.locator('.naver-zone-map[data-map-status="ready"]').waitFor();
    await page.getByRole('button', { name: '전체 구역 보기', exact: true }).click();
    assert.equal(await page.locator('script#kauroong-naver-maps-sdk').count(), 1);
    assert.equal(await page.locator('.naver-zone-marker').count(), 5);
    // Native keyboard input selects the HTML marker without a mouse.
    await page.getByRole('button', { name: '남산 산책길 선택', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.locator('.zone-detail').getByRole('heading', { name: '남산 산책길', exact: true }).waitFor();
    mark('map unmount/remount, singleton SDK and keyboard marker selection');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '전체 구역 보기', exact: true }).click();
    await page.waitForTimeout(500); // Allow native map resize and tile repaint.
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile page does not overflow');
    assert.ok((await page.locator('.naver-map-canvas').boundingBox()).width > 300);
    await page.screenshot({ path: path.join(OUT, 'naver-map-mobile.png'), fullPage: true });
    assert.deepEqual(errors, [], 'No uncaught JS errors');
    assert.deepEqual(vendorFailures, [], 'No NAVER authentication errors');
    mark('native map resizes for mobile without overflow or SDK errors');

    // Separate fresh contexts: these validate error UI, not live NAVER authentication.
    const offline = await browser.newContext();
    await offline.route('https://oapi.map.naver.com/openapi/v3/maps.js?*', route => route.abort());
    const offlinePage = await offline.newPage();
    await offlinePage.goto('http://127.0.0.1:5173/');
    await offlinePage.locator('.naver-zone-map[data-map-status="error"]').waitFor();
    await offlinePage.locator('.zone-chip').filter({ hasText: '서울숲' }).click();
    await offlinePage.locator('.zone-detail').getByRole('heading', { name: '서울숲', exact: true }).waitFor();
    await offline.close();
    mark('network error shown; zone selection still works without the SDK');

    const authFailure = await browser.newContext();
    await authFailure.route('https://oapi.map.naver.com/openapi/v3/maps.js?*', route => route.fulfill({ contentType: 'application/javascript', body: 'window.navermap_authFailure();' }));
    const authPage = await authFailure.newPage();
    await authPage.goto('http://127.0.0.1:5173/');
    await authPage.getByRole('alert').getByText('네이버 지도 인증 정보를 확인해주세요.', { exact: true }).waitFor();
    await authFailure.close();
    mark('explicit auth-failure fixture displays actionable error');

    fs.writeFileSync(path.join(OUT, 'naver-map-smoke.json'), JSON.stringify({ passed: true, checks, liveSdkLoaded: sdkLoaded,
      liveMapImageResponses: tiles.length, tileHosts: [...new Set(tiles.map(t => t.host))], browserErrors: errors,
      authenticationErrors: vendorFailures, fixtureChecks: ['blocked SDK network', 'authentication failure callback'] }, null, 2));
  } catch (error) {
    await page.screenshot({ path: path.join(OUT, 'naver-map-failure.png'), fullPage: true });
    console.error(error);
    console.error('Map status:', await page.locator('.naver-zone-map').getAttribute('data-map-status'));
    console.error('Map message:', await page.locator('.naver-zone-map').innerText());
    console.error('JS errors:', errors, 'NAVER errors:', vendorFailures);
    process.exitCode = 1;
  } finally { await browser.close(); }
})();
