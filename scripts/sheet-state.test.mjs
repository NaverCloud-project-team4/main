import test from 'node:test';
import assert from 'node:assert/strict';
import { initialSheet, sheetReducer, snapMode } from '../frontend/src/lib/sheetState.js';

const run = (...actions) => actions.reduce(sheetReducer, initialSheet);

test('starts closed; choosing a district opens the preview', () => {
  assert.equal(initialSheet.mode, 'closed');
  assert.equal(run({ type: 'select' }).mode, 'preview');
});

test('choosing another district keeps the current height', () => {
  const full = run({ type: 'select' }, { type: 'expand' });
  assert.equal(sheetReducer(full, { type: 'select' }), full);
  const preview = run({ type: 'select' });
  assert.equal(sheetReducer(preview, { type: 'select' }), preview);
});

test('tapping empty map closes from any height', () => {
  assert.equal(run({ type: 'select' }, { type: 'close' }).mode, 'closed');
  assert.equal(run({ type: 'select' }, { type: 'expand' }, { type: 'close' }).mode, 'closed');
  assert.equal(sheetReducer(initialSheet, { type: 'close' }), initialSheet);
});

test('dragging snaps one step by distance or fling direction', () => {
  assert.equal(snapMode('preview', -80), 'full');
  assert.equal(snapMode('preview', -30), 'preview'); // too short
  assert.equal(snapMode('full', 90), 'preview');
  assert.equal(snapMode('preview', 90), 'closed');
  assert.equal(snapMode('full', 400), 'preview'); // never skips preview
  assert.equal(snapMode('preview', 10, -0.9), 'full'); // short fast fling up
  assert.equal(snapMode('full', -10, 0.8), 'preview'); // fling wins over distance
  assert.equal(snapMode('full', -200), 'full');
  assert.equal(snapMode('closed', -200), 'preview');
  assert.equal(run({ type: 'select' }, { type: 'drag', dy: -120, velocity: 0 }).mode, 'full');
});

test('handle toggles between preview and full; collapse only shrinks', () => {
  const preview = run({ type: 'select' });
  assert.equal(sheetReducer(preview, { type: 'toggle' }).mode, 'full');
  assert.equal(run({ type: 'select' }, { type: 'toggle' }, { type: 'toggle' }).mode, 'preview');
  assert.equal(run({ type: 'select' }, { type: 'expand' }, { type: 'collapse' }).mode, 'preview');
  assert.equal(sheetReducer(initialSheet, { type: 'collapse' }), initialSheet);
});

test('tabs switch content; picking a tab from the preview expands', () => {
  const posts = run({ type: 'select' }, { type: 'tab', tab: 'posts' });
  assert.deepEqual(posts, { mode: 'full', tab: 'posts' });
  assert.equal(sheetReducer(posts, { type: 'tab', tab: 'spots' }).tab, 'spots');
  assert.equal(sheetReducer(initialSheet, { type: 'tab', tab: 'posts' }).mode, 'closed');
  assert.equal(sheetReducer(posts, { type: 'unknown' }), posts);
});
