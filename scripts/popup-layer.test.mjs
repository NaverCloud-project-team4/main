import test from 'node:test';
import assert from 'node:assert/strict';
import { POPUP_STAGGER_MS, POPUP_ZOOM, popupTargets, riseOrder } from '../frontend/src/lib/popupLayer.js';

const points = new Map([
  ['a', { x: 300, y: 200 }],
  ['b', { x: 100, y: 400 }],
  ['c', { x: -50, y: 100 }], // just off the left edge, within the margin
  ['d', { x: 2000, y: 100 }], // far off screen
  ['e', { x: 100, y: 120 }],
]);

test('nothing pops up below zoom 14', () => {
  assert.equal(POPUP_ZOOM, 14);
  assert.equal(popupTargets(points, 13.9, 800, 600).size, 0);
});

test('from zoom 14, spots on screen (plus a margin) rise; far ones stay folded', () => {
  assert.deepEqual([...popupTargets(points, 14, 800, 600)].sort(), ['a', 'b', 'c', 'e']);
  assert.deepEqual([...popupTargets(points, 16.5, 800, 600, 0)].sort(), ['a', 'b', 'e']);
});

test('newly shown trees rise left to right, ties top to bottom, with a 60 ms stagger', () => {
  assert.deepEqual(riseOrder(['a', 'b', 'c', 'e'], points), ['c', 'e', 'b', 'a']);
  assert.equal(POPUP_STAGGER_MS, 60);
  assert.deepEqual(riseOrder([], points), []);
});
