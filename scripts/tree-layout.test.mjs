import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clampLevel, forestSpacing, layoutLeaves, layoutTrees, metersPerPixel, slotSizes, treeGrowthDiff, treeWidth } from '../frontend/src/lib/treeLayout.js';
import { hitPolygons } from '../frontend/src/lib/watercolorLayer.js';
import { insideCity } from '../frontend/src/lib/seoulViewport.js';

const boundary = JSON.parse(readFileSync(new URL('../backend/app/data/seoul_districts_20261001.geojson', import.meta.url), 'utf8'));
const districts = boundary.features.map(f => ({
  id: f.id, name: f.properties.name, hit: hitPolygons(f.geometry),
  longitude: f.properties.center[0], latitude: f.properties.center[1],
}));
const sizesOf = (level, id) => new Map(layoutTrees(districts.find(d => d.id === id), level).map(t => [t.key, t.size]));

test('tree counts follow the interest level', () => {
  for (const { id } of districts) {
    assert.deepEqual(slotSizes(0, id), []);
    assert.deepEqual(slotSizes(1, id), ['small']);
    const two = slotSizes(2, id);
    assert.ok(two.length === 2 || two.length === 3);
    assert.ok(two.every(size => size !== 'large'));
    const three = slotSizes(3, id);
    assert.ok(three.length >= 5 && three.length <= 7, `${id}: ${three.length}`);
    assert.equal(three[0], 'large');
    assert.equal(three.filter(size => size === 'large').length, 1);
  }
  assert.equal(clampLevel(9), 3);
  assert.equal(clampLevel(-1), 0);
  assert.equal(clampLevel('2'), 2);
});

const spacings = [...new Set([9, 10, 11, 12, 13, 14, 15].flatMap(zoom => [forestSpacing(zoom), forestSpacing(zoom, true)]))];

test('every tree and leaf lands inside its own district at every zoom spacing', () => {
  for (const spacing of spacings) {
    for (const district of districts) {
      for (const level of [1, 2, 3]) {
        for (const item of [...layoutTrees(district, level, spacing), ...layoutLeaves(district, level, spacing)]) {
          const where = `${district.name} L${level} ${item.key} @${spacing}m`;
          assert.ok(insideCity({ x: item.lng, y: item.lat }, district.hit), where);
          const others = districts.filter(d => d.id !== district.id && insideCity({ x: item.lng, y: item.lat }, d.hit));
          assert.deepEqual(others.map(d => d.name), [], `${where} also inside another district`);
        }
      }
    }
  }
});

test('level-3 forests keep at least three fallen leaves at the overview spacing', () => {
  const spacing = forestSpacing(10.7);
  const counts = districts.map(d => layoutLeaves(d, 3, spacing).length);
  assert.ok(counts.filter(n => n >= 3).length >= 22, counts.join(','));
  assert.ok(districts.every(d => layoutLeaves(d, 2, spacing).length === 0));
});

test('forest spacing keeps trees about half a tree apart on screen, never under 210 m', () => {
  assert.ok(Math.abs(metersPerPixel(0, 0) - 156543.03392) < 1e-6);
  for (const zoom of [9, 10, 11, 12, 13, 14, 15, 16]) {
    const spacing = forestSpacing(zoom);
    assert.ok(spacing >= 210);
    const pixels = spacing / metersPerPixel(Math.floor(zoom), 37.55);
    assert.ok(pixels >= treeWidth('medium', zoom) * 0.5 - 1, `zoom ${zoom}: ${pixels.toFixed(1)}px`);
  }
  assert.equal(forestSpacing(11.2), forestSpacing(11.9)); // whole-zoom steps only
  assert.ok(forestSpacing(10) > forestSpacing(13));
});

test('layout is deterministic and a level-up keeps existing slots in place', () => {
  for (const district of districts) {
    const spacing = forestSpacing(11);
    const a = layoutTrees(district, 3, spacing), b = layoutTrees(district, 3, spacing);
    assert.deepEqual(a, b);
    const byKey = new Map(a.map(t => [t.key, t]));
    for (const tree of layoutTrees(district, 2, spacing)) {
      assert.equal(byKey.get(tree.key).lng, tree.lng);
      assert.equal(byKey.get(tree.key).lat, tree.lat);
    }
  }
});

test('the forest spreads out: level-3 trees are not stacked on one point', () => {
  for (const district of districts) {
    const trees = layoutTrees(district, 3, forestSpacing(11));
    const distinct = new Set(trees.map(t => `${t.lng.toFixed(5)},${t.lat.toFixed(5)}`));
    assert.ok(distinct.size >= trees.length - 1, district.name);
  }
});

test('growth diff: level-ups add or grow trees, level-downs remove them', () => {
  const id = districts[0].id;
  const empty = new Map();
  assert.deepEqual(treeGrowthDiff(empty, sizesOf(1, id)), { added: [`${id}:0`], grown: [], shrunk: [], removed: [] });
  const up = treeGrowthDiff(sizesOf(1, id), sizesOf(3, id));
  assert.deepEqual(up.grown, [`${id}:0`]);
  assert.equal(up.added.length, sizesOf(3, id).size - 1);
  const down = treeGrowthDiff(sizesOf(3, id), sizesOf(1, id));
  assert.deepEqual(down.shrunk, [`${id}:0`]);
  assert.equal(down.removed.length, sizesOf(3, id).size - 1);
  assert.deepEqual(treeGrowthDiff(sizesOf(2, id), sizesOf(2, id)), { added: [], grown: [], shrunk: [], removed: [] });
});

test('tree width scales with zoom within bounds and shrinks on phones', () => {
  assert.equal(treeWidth('small', 11), 30);
  assert.ok(treeWidth('large', 11) > treeWidth('medium', 11));
  assert.ok(treeWidth('medium', 14) > treeWidth('medium', 11));
  assert.equal(treeWidth('small', 3), Math.round(30 * 0.75));
  assert.equal(treeWidth('small', 11, true), 24);
});
