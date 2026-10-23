/* Real frontend/API/worker; deterministic synthetic camera and browser location for QA.
 * Run only against a local test database: creates labelled reports/users.
 */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const OUT = path.resolve('artifacts');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 },
    permissions: ['geolocation', 'camera'], geolocation: { latitude: 37.5964, longitude: 127.0525, accuracy: 15 } });
  const page = await context.newPage();
  const errors = [], serverErrors = [], apiCalls = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', response => {
    if (response.url().startsWith('http://127.0.0.1:8000/')) {
      const record = { method: response.request().method(), path: new URL(response.url()).pathname, status: response.status() };
      apiCalls.push(record);
      if (record.status >= 500) serverErrors.push(record);
    }
  });
  const nav = name => page.locator('.sidebar nav').getByRole('button', {name,exact:true}).click();
  const adminLogin = async () => {
    await page.getByRole('button',{name:'로그인',exact:true}).click();
    await page.getByRole('button',{name:'운영자로 시작',exact:true}).click();
    await page.getByRole('button',{name:'내 프로필 · 운영자',exact:true}).waitFor();
  };
  const run = Date.now(), email = `camera-${run}@example.com`, password = 'BrowserPass123!';
  const cameraDescription = `카메라 QA ${run}`, adminDescription = `운영자 파일/좌표 QA ${run}`;
  try {
    await page.goto('http://127.0.0.1:5173/');
    await page.locator('.naver-zone-marker').first().waitFor();
    assert.equal(await page.locator('.naver-zone-marker').count(),25);
    await page.getByRole('button',{name:'로그인',exact:true}).click();
    await page.getByRole('button',{name:'처음 오셨나요? · 회원가입'}).click();
    await page.getByLabel('닉네임',{exact:true}).fill('카메라테스터');
    await page.getByLabel('이메일',{exact:true}).fill(email);
    await page.getByLabel('비밀번호',{exact:true}).fill(password);
    await page.getByRole('button',{name:'회원가입',exact:true}).click();
    await page.getByRole('button',{name:'내 프로필 · 카메라테스터',exact:true}).waitFor();
    await nav('사진 제보하기');
    await page.locator('.report-location[data-location-status="ready"]').waitFor();
    assert.equal(await page.locator('input[type=file]').count(),0);
    assert.equal(await page.locator('.admin-location-picker').count(),0);
    await page.getByRole('button',{name:/^카메라 켜기/}).click();
    await page.locator('.camera-capture[data-camera-status="live"]').waitFor();
    await page.getByRole('button',{name:'사진 찍기',exact:true}).click();
    await page.getByRole('img',{name:'제보할 사진 미리보기',exact:true}).waitFor();
    assert.equal(await page.locator('video').count(),0);
    await page.getByLabel('한 줄 기록').fill(cameraDescription);
    await page.screenshot({path:path.join(OUT,'camera-user-desktop.png'),fullPage:true});
    await page.getByRole('button',{name:'사진 제보하기 →',exact:true}).click();
    await page.locator('.verification.review').waitFor({timeout:30000});
    await page.getByRole('button',{name:'로그아웃',exact:true}).click();
    await adminLogin();
    await nav('운영자 검토');
    await page.locator('.report-card').filter({hasText:cameraDescription}).getByRole('button',{name:'승인',exact:true}).click();
    await page.locator('.report-card').filter({hasText:cameraDescription}).waitFor({state:'detached'});
    await nav('사진 제보하기');
    await page.getByRole('combobox',{name:'제보할 자치구',exact:true}).selectOption('seongdong');
    await page.getByRole('heading',{name:'성동구',exact:true}).waitFor();
    await page.locator('input[type=file]').setInputFiles(path.resolve('frontend/public/sample-ginkgo.jpg'));
    await page.getByLabel('한 줄 기록').fill(adminDescription);
    await page.locator('select[name=demo_outcome]').selectOption('REJECTED');
    await page.screenshot({path:path.join(OUT,'camera-admin-desktop.png'),fullPage:true});
    await page.getByRole('button',{name:'사진 제보하기 →',exact:true}).click();
    await page.locator('.verification.rejected').waitFor({timeout:30000});
    await page.getByRole('button',{name:'로그아웃',exact:true}).click();
    await page.getByRole('button',{name:'로그인',exact:true}).click();
    await page.getByLabel('이메일',{exact:true}).fill(email);
    await page.getByLabel('비밀번호',{exact:true}).fill(password);
    await page.locator('.auth-modal').getByRole('button',{name:'로그인',exact:true}).click();
    await page.getByRole('button',{name:'내 프로필 · 카메라테스터',exact:true}).click();
    await page.locator('.report-card').filter({hasText:cameraDescription}).getByText('승인됨',{exact:true}).waitFor();
    assert.match(await page.locator('.profile-summary').innerText(),/20P/);
    await page.setViewportSize({width:390,height:844});
    await nav('사진 제보하기');
    assert.equal(await page.locator('input[type=file]').count(),0);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(errors,[]); assert.deepEqual(serverErrors,[]);
    fs.writeFileSync(path.join(OUT,'browser-smoke.json'),JSON.stringify({passed:true,fixtures:['synthetic camera','fixed geolocation'],apiCalls,browserErrors:errors,serverErrors},null,2));
    console.log('PASS camera-only user, operator upload/manual location, approval/rejection, mobile layout');
  } catch(error) {
    await page.screenshot({path:path.join(OUT,'browser-failure.png'),fullPage:true});
    console.error(error); process.exitCode=1;
  } finally { await browser.close(); }
})();
