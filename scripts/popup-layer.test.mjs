import test from 'node:test';
import assert from 'node:assert/strict';
import { POPUP_STAGGER_MS, POPUP_ZOOM, SPOT_FOCUS_ZOOM, popupTargets, riseOrder, spotTreeBox } from '../frontend/src/lib/popupLayer.js';
import { TREE_BASE } from '../frontend/src/lib/treeLayout.js';

const points = new Map([
  ['a', { x: 300, y: 200 }],
  ['b', { x: 100, y: 400 }],
  ['c', { x: -50, y: 100 }], // just off the left edge, within the margin
  ['d', { x: 2000, y: 100 }], // far off screen
  ['e', { x: 100, y: 120 }],
]);

test('spot trees stand at every zoom: spots on screen (plus a margin) are up, far ones are not', () => {
  assert.deepEqual([...popupTargets(points, 800, 600)].sort(), ['a', 'b', 'c', 'e']);
  assert.deepEqual([...popupTargets(points, 800, 600, 0)].sort(), ['a', 'b', 'e']);
});

test('the trunk foot sits exactly on the spot coordinate, at every zoom', () => {
  for (const zoom of [10.5, 11, 13.9, 14, SPOT_FOCUS_ZOOM, 18]) {
    for (const compact of [false, true]) {
      const box = spotTreeBox(zoom, compact);
      assert.equal(box.left + box.width / 2, 0, 'centred horizontally');
      assert.ok(Math.abs(box.top + box.height * TREE_BASE) < 1e-9, 'foot (94% down) on the point');
    }
  }
  assert.ok(spotTreeBox(POPUP_ZOOM).width > spotTreeBox(POPUP_ZOOM - 0.1).width, 'larger trees (and names) from zoom 14');
  assert.equal(SPOT_FOCUS_ZOOM, 16);
});

test('newly shown trees rise left to right, ties top to bottom, with a 60 ms stagger', () => {
  assert.deepEqual(riseOrder(['a', 'b', 'c', 'e'], points), ['c', 'e', 'b', 'a']);
  assert.equal(POPUP_STAGGER_MS, 60);
  assert.deepEqual(riseOrder([], points), []);
});
