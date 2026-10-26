import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { buildParticles, buildScene, DEPTH, itemBox, parallax, particleSprite, shadowBox, tiltFromOrientation, turn } from '../frontend/src/lib/treeScene.js';
import { TREE_ASSETS, TREE_PARTS } from '../frontend/src/lib/treeAssets.js';

const anchors = JSON.parse(readFileSync(new URL('../frontend/src/lib/treeAnchors.json', import.meta.url), 'utf8'));
const publicFile = path => new URL(`../frontend/public${path}`, import.meta.url);
const SPECIES = ['maple', 'ginkgo', 'cherry', 'xmas'];
const STAGES = ['sprout', 'sapling', 'young', 'grown'];
const SLOTS = ['topper', 'branch-1', 'branch-2', 'branch-3', 'branch-4', 'ground', 'background'];
// Item ids and groups straight from the backend catalog, so art and data cannot drift apart.
const catalog = [...readFileSync(new URL('../backend/app/tree_catalog.py', import.meta.url), 'utf8')
  .matchAll(/CatalogItem\("([^"]+)", "[^"]+", \d+, "([^"]+)"/g)].map(([, id, group]) => ({ id, group }));
const all = () => SLOTS.map(slot => ({ slot, item_id: { topper: 'star', ground: 'bench', background: 'bg-hanji' }[slot] || 'fairy-lights', unlocked: true, visible: true }));

test('anchors cover every species × stage × slot inside the canvas', () => {
  assert.equal(anchors.canvas, 1024);
  for (const species of SPECIES) for (const stage of STAGES) {
    const tree = anchors.trees[species][stage];
    assert.deepEqual(Object.keys(tree.slots).sort(), [...SLOTS].sort(), `${species}/${stage}`);
    for (const slot of SLOTS.filter(s => s !== 'background')) {
      const box = itemBox(anchors, slot, tree.slots[slot]);
      assert.ok(box.left >= -2 && box.left + box.width <= 102, `${species}/${stage} ${slot} x ${box.left}`);
      assert.ok(box.top >= 0 && box.top + box.height <= 102, `${species}/${stage} ${slot} y ${box.top}`);
    }
    assert.ok(['mid', 'front'].includes(tree.slots['branch-1'].layer));
  }
});

test('trees grow taller stage by stage', () => {
  for (const species of SPECIES) {
    const tops = STAGES.map(stage => anchors.trees[species][stage].crown[1]);
    assert.deepEqual([...tops].sort((a, b) => b - a), tops, species);
  }
});

test('every layer, item, background and particle has an image file', () => {
  for (const species of SPECIES) for (const stage of STAGES) for (const part of TREE_PARTS) {
    assert.ok(existsSync(publicFile(TREE_ASSETS.layer(species, stage, part))), TREE_ASSETS.layer(species, stage, part));
  }
  assert.equal(catalog.length, 24);
  for (const { id, group } of catalog.filter(item => item.group !== 'species')) {
    const path = group === 'background' ? TREE_ASSETS.background(id) : TREE_ASSETS.item(id);
    assert.ok(existsSync(publicFile(path)), path);
  }
  assert.ok(existsSync(publicFile(TREE_ASSETS.shadow)));
  for (const fx of ['snow', 'petal', 'leaf', 'firefly']) assert.ok(existsSync(publicFile(TREE_ASSETS.fx(fx))), fx);
});

test('layers stack background → back → trunk → mid branches → front → front branches/topper → ground → shadow', () => {
  const scene = buildScene(anchors, 'maple', 'grown', all());
  const order = scene.map(l => l.key);
  const at = key => order.indexOf(key);
  const mids = ['branch-1', 'branch-2', 'branch-3', 'branch-4'].filter(s => anchors.trees.maple.grown.slots[s].layer === 'mid');
  const fronts = ['branch-1', 'branch-2', 'branch-3', 'branch-4'].filter(s => !mids.includes(s));
  assert.ok(mids.length && fronts.length, 'both branch layers are used');
  assert.equal(order[0], 'background');
  assert.ok(at('back') < at('trunk'));
  for (const s of mids) assert.ok(at('trunk') < at(s) && at(s) < at('front'), `${s} hangs inside the crown`);
  for (const s of fronts) assert.ok(at('front') < at(s), `${s} hangs in front`);
  assert.ok(at('topper') > at('front') && at('ground') > at('topper'));
  assert.equal(order.at(-1), 'shadow');
  assert.ok(scene.every(l => l.depth > 0 && l.depth <= 1));
  assert.ok(DEPTH.background < DEPTH.back && DEPTH.back < DEPTH.front);
});

test('locked, empty and hidden slots are not drawn; background falls back to hanji', () => {
  const slots = [
    { slot: 'topper', item_id: 'star', unlocked: false, visible: true },
    { slot: 'ground', item_id: 'snowman', unlocked: true, visible: false },
    { slot: 'branch-1', item_id: null, unlocked: true, visible: false },
    { slot: 'branch-2', item_id: 'fairy-lights', unlocked: true, visible: true },
  ];
  const keys = buildScene(anchors, 'cherry', 'sapling', slots).map(l => l.key);
  assert.deepEqual(keys.filter(k => k.startsWith('branch') || k === 'topper' || k === 'ground'), ['branch-2']);
  const bg = buildScene(anchors, 'cherry', 'sapling', []).find(l => l.key === 'background');
  assert.equal(bg.src, TREE_ASSETS.background('bg-hanji'));
  assert.throws(() => buildScene(anchors, 'oak', 'grown', []));
});

test('parallax: nearer layers move further; tilt is clamped; device tilt is relative to rest', () => {
  const t = { x: 1, y: 1 };
  assert.ok(parallax(t, DEPTH.front).x > parallax(t, DEPTH.background).x);
  assert.deepEqual(parallax({ x: 5, y: -5 }, 1), parallax({ x: 1, y: -1 }, 1));
  assert.deepEqual(parallax({ x: 0, y: 0 }, 1), { x: 0, y: 0 });
  assert.deepEqual(turn({ x: 1, y: 1 }), { rotateY: 6, rotateX: -4 });
  assert.deepEqual(tiltFromOrientation(50, 70, 45), { x: 1, y: 1 });
  assert.deepEqual(tiltFromOrientation(0, 45, 45), { x: 0, y: 0 });
  assert.deepEqual(parallax({ x: NaN, y: 0 }, 1), { x: 0, y: 0 });
});

// ---------- growth stages look different, not just bigger ----------
const stages = JSON.parse(readFileSync(new URL('../frontend/src/lib/treeStages.json', import.meta.url), 'utf8'));
const UNLOCKED_BRANCHES = { sprout: [], sapling: ['branch-1', 'branch-2'], young: ['branch-1', 'branch-2', 'branch-3', 'branch-4'], grown: ['branch-1', 'branch-2', 'branch-3', 'branch-4'] };
const ascending = (values, strict = true) => values.every((v, i) => i === 0 || (strict ? v > values[i - 1] : v >= values[i - 1]));
const px = (stage, fx, fy) => { const h = anchors.canvas * stages.stages[stage].height; return [anchors.base[0] + fx * h, anchors.base[1] - fy * h]; };
const distanceToSegment = ([x, y], [x1, y1], [x2, y2]) => {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
};

test('stage data grows in every dimension, and species change colour, bloom or tiers', () => {
  const s = STAGES.map(st => stages.stages[st]);
  assert.ok(ascending(s.map(x => x.height)));
  assert.equal(s[0].trunkWidth, 0, 'a sprout has no stem');
  assert.ok(ascending(s.map(x => x.trunkWidth)));
  assert.ok(ascending(s.map(x => x.falling), false) && s[0].falling === 0 && s[3].falling >= 6);
  assert.ok(ascending(s.map(x => x.groundLeaves), false) && s[3].groundLeaves > s[2].groundLeaves);
  assert.ok(ascending(s.map(x => x.shadowScale)));
  assert.ok(s[0].props.includes('mound') && s[1].props.includes('stake') && s[3].props.includes('roots'));
  assert.ok(s[1].leaves.length >= 5 && s[1].leaves.length <= 8, 'a sapling has 5-8 sparse leaves');
  assert.ok(s[2].clumps.length <= 2 && s[3].clumps.length >= 3, 'young: 1-2 clumps, grown: 3-5');
  assert.ok(ascending(stages.species.maple.ripeness) && stages.species.maple.ripeness[0] === 0);
  assert.ok(ascending(stages.species.ginkgo.ripeness));
  assert.ok(ascending(stages.species.cherry.bloom) && stages.species.cherry.bloom[3] === 1);
  assert.deepEqual(stages.species.xmas.tiers, [2, 3, 4, 5]);
});

test('every unlocked branch slot sits on a real branch (no ornaments in mid-air)', () => {
  for (const species of SPECIES) for (const stage of STAGES) {
    const slots = anchors.trees[species][stage].slots;
    for (const slot of UNLOCKED_BRANCHES[stage]) {
      const point = [slots[slot].x, slots[slot].y];
      if (species === 'xmas') {
        // on a needle tier: inside the cone between the tip and the lowest tier
        const h = anchors.canvas * stages.stages[stage].height, cone = stages.xmasCone, i = STAGES.indexOf(stage);
        const fy = (anchors.base[1] - point[1]) / h;
        assert.ok(fy > cone.base[i] && fy < 1 && Math.abs(point[0] - anchors.base[0]) <= cone.halfWidth[i] * h, `${stage} ${slot}`);
      } else {
        const st = stages.stages[stage];
        const segments = [[px(stage, 0, 0), px(stage, 0, st.trunkTop)], ...st.limbs.map(([a, b, c, d]) => [px(stage, a, b), px(stage, c, d)])];
        const nearest = Math.min(...segments.map(([p1, p2]) => distanceToSegment(point, p1, p2)));
        assert.ok(nearest <= 4, `${species}/${stage} ${slot} is ${nearest.toFixed(1)}px from a branch`);
      }
    }
  }
});

test('falling leaves and litter come from the stage data, in the species leaf', () => {
  for (const species of SPECIES) for (const stage of STAGES) {
    const { falling, litter } = buildParticles(anchors, stages, species, stage);
    const expected = species === 'xmas' ? 0 : null;
    assert.equal(falling.length, expected ?? stages.stages[stage].falling, `${species}/${stage} falling`);
    assert.equal(litter.length, expected ?? stages.stages[stage].groundLeaves, `${species}/${stage} litter`);
    for (const leaf of falling) assert.ok(leaf.dy > 0 && leaf.top + leaf.dy > 85, 'falls down to the ground');
    for (const leaf of litter) assert.ok(Math.abs(leaf.top - 92) < 4, 'lies on the ground');
  }
  assert.equal(particleSprite(stages, 'maple', 'sapling'), TREE_ASSETS.fx('leaf-maple-green'));
  assert.equal(particleSprite(stages, 'maple', 'grown'), TREE_ASSETS.fx('leaf-maple-ripe'));
  assert.equal(particleSprite(stages, 'cherry', 'young'), TREE_ASSETS.fx('petal-cherry'));
  assert.equal(particleSprite(stages, 'xmas', 'grown'), null);
  for (const fx of ['leaf-maple-green', 'leaf-maple-ripe', 'leaf-ginkgo-green', 'leaf-ginkgo-ripe', 'petal-cherry']) assert.ok(existsSync(publicFile(TREE_ASSETS.fx(fx))), fx);
  const a = buildParticles(anchors, stages, 'ginkgo', 'grown'), b = buildParticles(anchors, stages, 'ginkgo', 'grown');
  assert.deepEqual(a, b, 'deterministic');
});

test('litter lies before the ground props, falling leaves are the front-most layer, shadow grows', () => {
  const order = buildScene(anchors, 'maple', 'grown', all(), stages).map(l => l.key);
  assert.ok(order.indexOf('litter') > order.indexOf('front') && order.indexOf('litter') < order.indexOf('ground'));
  assert.equal(order.at(-1), 'falling');
  assert.ok(!buildScene(anchors, 'maple', 'sprout', [], stages).some(l => l.key === 'falling' || l.key === 'litter'));
  const widths = STAGES.map(stage => shadowBox(anchors, stages, stage).width);
  assert.ok(ascending(widths));
});
