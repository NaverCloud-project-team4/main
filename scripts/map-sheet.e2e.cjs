/* Watercolor map + district sheet working together, against the running dev servers
 * (scripts/dev.ps1 or dev.sh: frontend :5173, API :8000). Read-only: creates no data.
 *   node scripts/map-sheet.e2e.cjs
 * Needs `playwright` (or `playwright-core`) resolvable; CHROME_EXECUTABLE picks a local Chrome.
 * Scenario, desktop 1440×900 and phone 375×812:
 *   district click → sheet opens → wheel zoom + drag on the map above the open sheet →
 *   another district (content changes, height kept) → spots tab → pick a spot → flies to
 *   zoom 16 with the spot in the middle of the map above the sheet, tree + name + rings →
 *   whole-Seoul view → empty paper click closes the sheet → map still zooms and drags.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }

const URL = process.env.APP_URL || 'http://127.0.0.1:5173/';
const OUT = path.resolve('artifacts');
const VIEWPORTS = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'mobile', viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
];

async function scenario(browser, { name, ...options }) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const step = text => console.log(`[${name}] ${text}`);

  const sheet = page.locator('.wc-sheet');
  const stage = page.locator('.wc-stage');
  const zoom = async () => Number(await stage.getAttribute('data-zoom'));
  const labelBox = id => page.locator(`.wc-label[data-zone-id="${id}"]`).boundingBox();
  // A point on the map that the sheet does not cover (and the window shows), as fractions of the visible band.
  const band = () => page.evaluate(() => {
    const map = document.querySelector('.wc-map').getBoundingClientRect();
    const s = document.querySelector('.wc-sheet');
    const cover = s.dataset.mode === 'closed' ? Infinity : s.getBoundingClientRect().top;
    const top = Math.max(map.top, 0), bottom = Math.min(map.bottom, innerHeight, cover);
    return { left: map.left, right: map.right, top, bottom, mapTop: map.top };
  });
  // A few notches, like a real mouse wheel (one huge event is not how wheels scroll).
  const wheelIn = async (x, y) => { await page.mouse.move(x, y); for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(40); } };
  const tap = async locator => (options.hasTouch ? locator.tap() : locator.click());
  // A district's own forest may cover its label; tapping either selects the district.
  const tapLabel = async id => { const l = page.locator(`.wc-label[data-zone-id="${id}"]`); return options.hasTouch ? l.tap({ force: true }) : l.click({ force: true }); };

  await page.goto(URL);
  await page.locator('.wc-label[data-zone-id="jung"]').waitFor();
  await page.evaluate(() => document.querySelector('.wc-map').scrollIntoView({ block: 'start' }));
  await page.waitForFunction(() => document.querySelector('.wc-stage')?.dataset.zoom);
  await page.waitForTimeout(800);
  await page.evaluate(() => { window.__mapStage = document.querySelector('.wc-stage'); });
  const fitZoom = await zoom();
  step(`map ready at zoom ${fitZoom.toFixed(2)}`);

  // 1) district click opens the sheet (preview)
  await tapLabel('jung');
  await assert.doesNotReject(page.waitForFunction(() => document.querySelector('.wc-sheet').dataset.mode === 'preview'));
  assert.match(await page.locator('.wc-sheet-title h3').textContent(), /중구/);
  await page.waitForTimeout(500);
  step('sheet opened in preview');

  // 2) with the sheet open: wheel zoom over the uncovered map, then drag
  let b = await band();
  const x = b.left + (b.right - b.left) * 0.5, y = b.top + (b.bottom - b.top) * 0.45;
  const hit = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.naver-map-canvas'), [x, y]);
  assert.ok(hit, 'the map, not the sheet, is under the pointer above the sheet');
  const scrollBefore = await page.evaluate(() => scrollY);
  await wheelIn(x, y);
  await page.waitForFunction(z => Number(document.querySelector('.wc-stage').dataset.zoom) > z + 0.4, fitZoom, { timeout: 5000 });
  assert.equal(await page.evaluate(() => scrollY), scrollBefore, 'the wheel zooms the map instead of scrolling the page');
  const zoomed = await zoom();
  step(`wheel zoom ${fitZoom.toFixed(2)} → ${zoomed.toFixed(2)}`);
  await page.waitForTimeout(400);
  const ref = (await page.evaluate(([x, y]) => {
    // the district label nearest the drag start, so it stays on screen
    const labels = [...document.querySelectorAll('.wc-label')].map(el => { const r = el.getBoundingClientRect(); return { id: el.dataset.zoneId, d: Math.hypot(r.x - x, r.y - y) }; });
    return labels.sort((a, c) => a.d - c.d)[0].id;
  }, [x, y]));
  const before = await labelBox(ref);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 30, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  const after = await labelBox(ref);
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) > 20, `drag moves the map (${ref} moved ${Math.round(after.x - before.x)}, ${Math.round(after.y - before.y)})`);
  assert.equal(await sheet.getAttribute('data-mode'), 'preview', 'map gestures leave the sheet alone');
  step('drag moved the map; sheet unchanged');

  // 3) another district: content changes, height stays
  const other = await page.evaluate(() => {
    const s = document.querySelector('.wc-sheet').getBoundingClientRect(), m = document.querySelector('.wc-map').getBoundingClientRect();
    const ok = [...document.querySelectorAll('.wc-label')].filter(el => !el.classList.contains('selected')).find(el => {
      const r = el.getBoundingClientRect();
      return r.top > Math.max(m.top, 0) + 50 && r.bottom < s.top - 4 && r.left > m.left + 10 && r.right < m.right - 50;
    });
    return ok?.dataset.zoneId;
  });
  assert.ok(other, 'another district label is visible above the sheet');
  const otherName = (await page.locator(`.wc-label[data-zone-id="${other}"]`).textContent()).trim();
  await tapLabel(other);
  await page.waitForFunction(n => document.querySelector('.wc-sheet-title h3')?.textContent === n, otherName);
  assert.equal(await sheet.getAttribute('data-mode'), 'preview');
  step(`switched to ${otherName}`);

  // 4) spots tab → a spot → fly there
  await tap(page.locator('#wc-tab-spots'));
  await page.locator('.wc-spot').first().waitFor();
  assert.ok(await page.locator('.wc-spot').count() >= 1, 'spots are listed');
  assert.equal(await page.evaluate(() => document.elementFromPoint(innerWidth / 2, Math.max(document.querySelector('.wc-map').getBoundingClientRect().top, 0) + 20)?.closest('.wc-sheet')), null,
    'even the full sheet leaves the top of the map visible');
  const spotName = (await page.locator('.wc-spot .wc-spot-name').first().evaluate(el => el.firstChild.textContent)).trim();
  await tap(page.locator('.wc-spot').first());
  await page.waitForFunction(() => document.querySelector('.wc-sheet').dataset.mode === 'preview', null, { timeout: 2000 });
  await page.waitForFunction(() => document.querySelector('.wc-stage').dataset.spotArrived, null, { timeout: 8000 });
  await page.waitForTimeout(700);
  assert.equal(await zoom(), 16, 'zoomed to the spot (SPOT_FOCUS_ZOOM)');
  const focus = page.locator('.wc-pop--focus');
  assert.equal(await focus.count(), 1);
  assert.equal((await focus.locator('.wc-pop-name').textContent()).trim(), spotName);
  assert.ok(await focus.locator('.wc-pop-name').isVisible(), 'the spot name is shown');
  assert.ok(await page.locator('.wc-spot-mark.wc-spot-mark--pulse').count(), 'rings spread from the spot');
  b = await band();
  const foot = await focus.locator('.wc-pop-foot').boundingBox();
  const fx = foot.x + foot.width / 2, fy = foot.y + foot.height / 2;
  const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
  step(`spot ${spotName} at (${fx.toFixed(0)}, ${fy.toFixed(0)}); visible-band centre (${cx.toFixed(0)}, ${cy.toFixed(0)})`);
  assert.ok(Math.abs(fx - cx) < 24 && Math.abs(fy - cy) < 24, 'the spot lands in the middle of the map above the sheet');
  assert.ok(fy < b.bottom - 10, 'the spot is not under the sheet');
  const paper = Number(await page.locator('.wc-paper').evaluate(el => getComputedStyle(el).opacity));
  assert.ok(paper < 1 && paper >= 0.75, `the NAVER tiles show faintly through the paper (opacity ${paper})`);
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `map-sheet-${name}-spot.png`) });

  // spot trees: every spot is drawn at its coordinate (foot dot), above the forest layer
  const order = await page.evaluate(() => {
    const kids = [...document.querySelector('.wc-stage').children].map(el => el.className);
    return kids.indexOf('wc-popups') > kids.indexOf('wc-trees');
  });
  assert.ok(order, 'spot trees are drawn over the interest forest');

  // 5) whole Seoul, then empty paper closes the sheet
  await tap(page.getByRole('button', { name: '서울 전체 보기' }));
  await page.waitForTimeout(1200);
  b = await band();
  const empty = await page.evaluate(({ left, top }) => {
    // the paper just inside the top-left corner is outside Seoul at the overview
    for (const [dx, dy] of [[24, 70], [40, 90], [16, 120]]) {
      const el = document.elementFromPoint(left + dx, top + dy);
      if (el?.closest('.naver-map-canvas') && !el.closest('.wc-label, .wc-tree-body, .wc-pop-body, .naver-map-toolbar')) return { x: left + dx, y: top + dy };
    }
    return null;
  }, b);
  assert.ok(empty, 'found empty paper outside Seoul');
  await page.mouse.click(empty.x, empty.y);
  await page.waitForFunction(() => document.querySelector('.wc-sheet').dataset.mode === 'closed', null, { timeout: 3000 });
  step('empty paper closed the sheet');

  // 6) the map still works
  const z0 = await zoom();
  b = await band();
  await wheelIn((b.left + b.right) / 2, (b.top + b.bottom) / 2);
  await page.waitForFunction(z => Number(document.querySelector('.wc-stage').dataset.zoom) > z + 0.4, z0, { timeout: 5000 });
  step(`after closing, wheel zoom ${z0.toFixed(2)} → ${(await zoom()).toFixed(2)}`);
  assert.ok(await page.evaluate(() => window.__mapStage === document.querySelector('.wc-stage') && window.__mapStage.isConnected),
    'the map was never re-mounted');
  await page.screenshot({ path: path.join(OUT, `map-sheet-${name}-end.png`) });
  assert.deepEqual(errors, [], 'no page errors');
  await context.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  let failed = false;
  try {
    for (const vp of VIEWPORTS) {
      try { await scenario(browser, vp); console.log(`PASS ${vp.name}`); }
      catch (e) { failed = true; console.error(`FAIL ${vp.name}: ${e.message}`); }
    }
  } finally { await browser.close(); }
  process.exit(failed ? 1 : 0);
})();
