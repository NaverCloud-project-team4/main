import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PAPER_OPACITY, paperOpacity, STAGE_WASH, STAGE_ORDER, washFor, seeded, labelSize } from '../frontend/src/lib/watercolorPalette.js';
import { buildWashSvg, zoneAt, hitPolygons, ringPath } from '../frontend/src/lib/watercolorLayer.js';

const boundary = JSON.parse(readFileSync(new URL('../backend/app/data/seoul_districts_20261001.geojson', import.meta.url), 'utf8'));
const river = JSON.parse(readFileSync(new URL('../frontend/public/map-assets/han-river.geojson', import.meta.url), 'utf8')).features[0].geometry;
const [west, south, east, north] = boundary.bbox;
const project = (lng, lat) => ({ x: (lng - west) / (east - west) * 900, y: (north - lat) / (north - south) * 640 });
const districts = boundary.features.map(f => ({ id: f.id, name: f.properties.name, geometry: f.geometry, hit: hitPolygons(f.geometry) }));

test('paper stays opaque below zoom 15 and lets 15–25% of tiles through from 15', () => {
  assert.equal(paperOpacity(11), 1);
  assert.equal(paperOpacity(14.9), PAPER_OPACITY.base);
  assert.equal(paperOpacity(15), PAPER_OPACITY.close);
  assert.ok(PAPER_OPACITY.close >= 0.75 && PAPER_OPACITY.close <= 0.85);
});

test('every stage has a pale centre and darker rim; unknown stages fall back', () => {
  for (const stage of STAGE_ORDER) assert.match(STAGE_WASH[stage].inner + STAGE_WASH[stage].edge, /^#[0-9a-f]{6}#[0-9a-f]{6}$/);
  assert.equal(washFor('NOPE', 'x').edge, STAGE_WASH.UNKNOWN.edge);
  assert.equal(washFor(undefined, 'x').inner, STAGE_WASH.UNKNOWN.inner);
});

test('per-zone variation is deterministic, within ±8%, and selection darkens', () => {
  for (const { id } of districts) {
    const a = washFor('PEAK', id), b = washFor('PEAK', id);
    assert.equal(a.strength, b.strength);
    assert.ok(a.strength >= 0.78 * 0.92 - 1e-9 && a.strength <= 0.78 * 1.08 + 1e-9);
    assert.ok(washFor('PEAK', id, true).strength > a.strength);
  }
  assert.ok(seeded('a') >= 0 && seeded('a') < 1);
  assert.notEqual(seeded('jongno'), seeded('jung'));
});

test('label size grows with zoom within readable bounds', () => {
  assert.equal(labelSize(5), 17);
  assert.ok(labelSize(11) < labelSize(14));
  assert.equal(labelSize(20), 30);
  assert.equal(labelSize(5, true), 14);
});

test('wash SVG inlines the grain as a data URI and references no external files', () => {
  const grain = 'data:image/png;base64,AAAA';
  const svg = buildWashSvg({ width: 900, height: 640, project, zoom: 11, grain, river,
    districts: districts.map(d => ({ ...d, stage: 'PEAK' })) });
  assert.ok(svg.includes(`href="${grain}"`));
  assert.doesNotMatch(svg, /href="(?!data:|#)/);
  assert.doesNotMatch(svg, /url\((?!#)/);
  assert.equal((svg.match(/<clipPath id="wc-c\d+"/g) || []).length, 25);
  assert.ok(svg.includes('wc-river'));
  assert.ok(svg.includes(STAGE_WASH.PEAK.edge));
  assert.ok(buildWashSvg({ width: 10, height: 10, project, zoom: 11, districts: [], river: null, quality: 'low' }).includes('numOctaves="1"'));
});

test('ring paths drop sub-pixel points but stay closed', () => {
  const ring = [[0, 0], [0.1, 0], [10, 0], [10, 10], [0, 0]];
  const d = ringPath(ring, (x, y) => ({ x, y }));
  assert.equal((d.match(/L/g) || []).length, 3);
  assert.ok(d.endsWith('Z'));
});

test('a click resolves to the district that contains it, and empty space to none', () => {
  for (const f of boundary.features) {
    const [lng, lat] = f.properties.center;
    assert.equal(zoneAt(lng, lat, districts), f.id, f.properties.name);
  }
  assert.equal(zoneAt(126.5, 37.2, districts), null);
});
