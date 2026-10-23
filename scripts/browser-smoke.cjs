/* Browser integration test against REAL running frontend/API/worker. No route mocks. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const OUT = path.resolve('artifacts');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const errors = [], apiCalls = [], unexpected = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', response => {
    if (response.url().startsWith('http://127.0.0.1:8000/')) {
      const request = response.request();
      apiCalls.push({ method: request.method(), path: new URL(response.url()).pathname, status: response.status() });
      if (response.status() >= 500) unexpected.push(`${request.method()} ${new URL(response.url()).pathname} ${response.status()}`);
    }
  });
  const wait = async fn => { for (let i = 0; i < 120; i++) { if (await fn()) return; await page.waitForTimeout(250); } throw new Error('Condition timed out'); };
  const nav = label => page.locator('.sidebar nav').getByRole('button', { name: new RegExp(label) }).click();
  let checks = 0;
  const mark = name => { checks += 1; console.log(`PASS ${name}`); };
  try {
    await page.goto('http://127.0.0.1:5173/');
    await page.getByText('API 연결됨', { exact: true }).waitFor();
    await page.getByRole('heading', { name: '경희대 일대', exact: true }).waitFor();
    await page.screenshot({ path: path.join(OUT, 'frontend-desktop.png'), fullPage: true });
    mark('cross-origin frontend → FastAPI health/zones/feed');
    assert.equal(await page.locator('.report-form').count(), 0);
    assert.equal(await page.locator('.profile-trigger').count(), 0);
    assert.equal(await page.locator('.sidebar nav').getByRole('button', { name: '내 제보', exact: true }).count(), 0);
    mark('map is separate from submission; guest has no profile entry');

    const run = Date.now();
    const email = `browser-${run}@example.com`, password = 'BrowserPass123!';
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await page.getByRole('button', { name: '처음 오셨나요? · 회원가입' }).click();
    await page.getByLabel('닉네임', { exact: true }).fill('브라우저테스터');
    await page.getByLabel('이메일', { exact: true }).fill(email);
    await page.getByLabel('비밀번호', { exact: true }).fill(password);
    await page.getByRole('button', { name: '회원가입', exact: true }).click();
    await page.locator('.user-label').filter({ hasText: '브라우저테스터' }).waitFor();
    mark('registration and JWT login through UI');

    await page.locator('.zone-chip').filter({ hasText: '남산 산책길' }).click();
    await page.getByRole('button', { name: '이 구역 사진 제보하기', exact: true }).click();
    assert.equal(await page.locator('.zone-map').count(), 0);
    assert.equal(await page.getByLabel('제보 구역', { exact: true }).inputValue(), 'namsan');
    await page.getByLabel('제보 구역', { exact: true }).selectOption('kyunghee');
    mark('map CTA opens dedicated report screen and preserves selected zone');

    const approvedText = `승인 테스트 ${run}`;
    await page.getByRole('button', { name: '샘플 은행 사진 넣기' }).click();
    await page.locator('.photo-picker img').waitFor();
    await page.getByLabel('한 줄 기록').fill(approvedText);
    await page.screenshot({ path: path.join(OUT, 'frontend-report.png'), fullPage: true });
    await page.getByRole('button', { name: '사진 제보하기 →', exact: true }).click();
    await page.locator('.verification.approved').waitFor({ timeout: 30000 });
    await wait(async () => (await page.locator('.user-label').innerText()).includes('20P'));
    mark('multipart photo → 202 → real worker → polling → approval/20 points');

    await nav('제보 피드');
    const card = page.locator('.report-card').filter({ hasText: approvedText });
    await card.waitFor();
    await card.getByRole('button', { name: '좋아요 0', exact: true }).click();
    await card.getByRole('button', { name: '좋아요 취소 1', exact: true }).waitFor();
    await page.screenshot({ path: path.join(OUT, 'frontend-feed.png'), fullPage: true });
    await nav('지도');
    await wait(async () => { const text = await page.locator('.stats .stat').nth(2).innerText(); return Number(text.replace(/[^0-9]/g, '')) >= 1; });
    mark('approved feed, like persistence and zone aggregate refresh');

    await nav('나만의 나무');
    const shopItem = page.locator('.shop-item').filter({ hasText: '작은 버섯' });
    await shopItem.getByRole('button', { name: '구매·적용' }).click();
    await shopItem.getByRole('button', { name: '적용 중' }).waitFor();
    await wait(async () => (await page.locator('.user-label').innerText()).includes('0P'));
    mark('points purchase, inventory and equipment persist through API');

    await page.waitForTimeout(5200); // Intentional: honor the backend's 5-second report cooldown.
    await nav('사진 제보하기');
    await page.getByRole('button', { name: '샘플 은행 사진 넣기' }).click();
    const reviewText = `검토 테스트 ${run}`;
    await page.getByLabel('한 줄 기록').fill(reviewText);
    await page.locator('select[name="demo_outcome"]').selectOption('REVIEW');
    await page.getByRole('button', { name: '사진 제보하기 →', exact: true }).click();
    await page.locator('.verification.review').waitFor({ timeout: 30000 });
    await nav('제보 피드');
    assert.equal(await page.locator('.report-card').filter({ hasText: reviewText }).count(), 0);
    mark('review reports withheld from public feed and points');

    await page.getByRole('button', { name: '로그아웃', exact: true }).click();
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await page.getByRole('button', { name: '운영자로 시작', exact: true }).click();
    await page.locator('.user-label').filter({ hasText: '운영자' }).waitFor();
    await nav('운영자 검토');
    const reviewCard = page.locator('.report-card').filter({ hasText: reviewText });
    await reviewCard.getByRole('button', { name: '승인', exact: true }).click();
    await wait(async () => await page.locator('.report-card').filter({ hasText: reviewText }).count() === 0);
    mark('admin review authorization and approval through UI');

    await page.getByRole('button', { name: '로그아웃', exact: true }).click();
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await page.getByLabel('이메일', { exact: true }).fill(email);
    await page.getByLabel('비밀번호', { exact: true }).fill(password);
    await page.locator('.auth-modal').getByRole('button', { name: '로그인', exact: true }).click();
    await wait(async () => (await page.locator('.user-label').innerText()).includes('20P'));
    await page.getByRole('button', { name: '내 프로필 · 브라우저테스터', exact: true }).click();
    await page.getByRole('heading', { name: '내 제보', exact: true }).waitFor();
    assert.equal(await page.locator('.profile-summary').count(), 1);
    await page.screenshot({ path: path.join(OUT, 'frontend-profile.png'), fullPage: true });
    await page.locator('.report-card').filter({ hasText: reviewText }).getByText('승인됨', { exact: true }).waitFor();
    await page.reload();
    await wait(async () => (await page.locator('.user-label').innerText()).includes('브라우저테스터'));
    mark('relogin/reload sees persisted account, reports and balance');

    await page.waitForTimeout(5200);
    await nav('사진 제보하기');
    await page.getByRole('button', { name: '샘플 은행 사진 넣기' }).click();
    const rejectedText = `반려 테스트 ${run}`;
    await page.getByLabel('한 줄 기록').fill(rejectedText);
    await page.locator('select[name="demo_outcome"]').selectOption('REJECTED');
    await page.getByRole('button', { name: '사진 제보하기 →', exact: true }).click();
    await page.locator('.verification.rejected').waitFor({ timeout: 30000 });
    assert.ok((await page.locator('.user-label').innerText()).includes('20P'));
    await nav('제보 피드');
    assert.equal(await page.locator('.report-card').filter({ hasText: rejectedText }).count(), 0);
    mark('rejected report withheld; no points awarded');

    await nav('지도');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(OUT, 'frontend-mobile.png'), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Map mobile overflow');
    for (const screen of ['report', 'profile']) {
      if (screen === 'report') await nav('사진 제보하기');
      else await page.getByRole('button', { name: '내 프로필 · 브라우저테스터', exact: true }).click();
      await page.screenshot({ path: path.join(OUT, `frontend-${screen}-mobile.png`), fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${screen} mobile overflow`);
    }
    assert.deepEqual(errors, [], 'No uncaught browser JS errors');
    assert.deepEqual(unexpected, [], 'No server errors during browser flow');
    assert.ok(apiCalls.some(c => c.method === 'POST' && c.path === '/api/reports' && c.status === 202));
    assert.ok(apiCalls.some(c => c.method === 'PUT' && c.path.endsWith('/like') && c.status === 200));
    fs.writeFileSync(path.join(OUT, 'browser-smoke.json'), JSON.stringify({ passed: true, checks: checks + 1, apiCalls, browserErrors: errors, serverErrors: unexpected }, null, 2));
    mark(`mobile layout + ${apiCalls.length} actual HTTP responses; no browser/server errors`);
  } catch (error) {
    await page.screenshot({ path: path.join(OUT, 'browser-failure.png'), fullPage: true });
    console.error(error);
    console.error('Browser errors:', errors);
    process.exitCode = 1;
  } finally { await browser.close(); }
})();
