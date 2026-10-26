// 2.5D layered tree: which images to stack, in what order, where, and how far each moves.
// Pure module (anchors and stage data are passed in) so node --test can check it without a DOM.
import { DEFAULT_BACKGROUND, TREE_ASSETS } from './treeAssets.js';

export const STAGE_ORDER = Object.freeze(['sprout', 'sapling', 'young', 'grown']);

// Back to front, as decided: background → back leaves → trunk → (branch items) → front leaves → ground props → shadow.
// "mid" branch items sit between trunk and front leaves (hung inside the crown); "front" ones and the topper sit on top.
export const DEPTH = Object.freeze({
  background: 0.15, back: 0.5, trunk: 0.65, mid: 0.72, front: 0.85, branchFront: 0.9, topper: 0.95, ground: 0.8, shadow: 0.8,
});
export const PARTICLE_DEPTH = Object.freeze({ litter: 0.82, falling: 1, effect: 0.25 });
export const MAX_SHIFT = 14; // px at depth 1 for a full tilt
export const MAX_TURN = { y: 6, x: 4 }; // degrees for a full tilt

const groupOf = slot => (slot.startsWith('branch') ? 'branch' : slot);

/** Item box in % of the 1024 canvas, anchored per group (topper/ground: bottom-centre, branch: top-centre). */
export function itemBox(anchors, slot, anchor) {
  const group = groupOf(slot);
  const [w, h] = anchors.itemBox[group];
  const width = w * anchor.scale, height = h * anchor.scale;
  const top = anchors.itemAnchor[group] === 'top' ? anchor.y : anchor.y - height;
  const pct = v => +(v / anchors.canvas * 100).toFixed(3);
  return { left: pct(anchor.x - width / 2), top: pct(top), width: pct(width), height: pct(height) };
}

// Small deterministic PRNG so particles keep their places between renders.
function seededRandom(text) {
  let a = 2166136261;
  for (const ch of text) a = Math.imul(a ^ ch.codePointAt(0), 16777619) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Leaf sprite for falling leaves and litter: green or ripe by the stage's ripeness; cherry sheds petals; none for the fir. */
export function particleSprite(stages, species, stage) {
  const data = stages.species[species];
  if (data.leaf === 'none') return null;
  if (data.leaf === 'cherry') return TREE_ASSETS.fx('petal-cherry');
  const ripe = (data.ripeness?.[STAGE_ORDER.indexOf(stage)] ?? 1) >= 0.5;
  return TREE_ASSETS.fx(`leaf-${data.leaf}-${ripe ? 'ripe' : 'green'}`);
}

/**
 * Falling leaves (from the crown to the ground, in front of the tree) and ground litter around the foot.
 * Counts come from treeStages.json, so a stage only changes numbers. Positions are % of the canvas.
 */
export function buildParticles(anchors, stages, species, stage) {
  const st = stages.stages[stage];
  const src = particleSprite(stages, species, stage);
  if (!st || !src) return { falling: [], litter: [] };
  const rand = seededRandom(`${species}:${stage}`);
  const [bx, by] = anchors.base;
  const height = anchors.canvas * st.height;
  const pct = v => +(v / anchors.canvas * 100).toFixed(2);
  // Leaves start where the foliage is: clumps, single leaves (sapling) or the cotyledons.
  const sources = (st.clumps || st.leaves || st.cotyledons || [[0, 0.8]]).map(([fx, fy]) => [bx + fx * height, by - fy * height]);
  const size = Math.max(16, Math.min(30, height * 0.05));
  const falling = Array.from({ length: st.falling }, (_, i) => {
    const [sx, sy] = sources[i % sources.length];
    const x = sx + (rand() - 0.5) * height * 0.2, y = sy + (rand() - 0.2) * height * 0.08;
    return {
      key: `fall-${i}`, src, left: pct(x - size / 2), top: pct(y - size / 2), size: pct(size),
      dx: pct((rand() - 0.5) * height * 0.35), dy: pct(by - y), spin: Math.round(160 + rand() * 300),
      duration: +(5 + rand() * 3).toFixed(2), delay: +(-rand() * 8).toFixed(2),
    };
  });
  const litter = Array.from({ length: st.groundLeaves }, (_, i) => {
    const spread = height * (0.2 + 0.32 * Math.sqrt(rand()));
    const side = i % 2 ? 1 : -1;
    const x = bx + side * spread * rand(), y = by - 4 + rand() * 14;
    return { key: `litter-${i}`, src, left: pct(x - size / 2), top: pct(y - size / 2), size: pct(size * (0.8 + rand() * 0.4)), rotate: Math.round(rand() * 360) };
  });
  return { falling, litter };
}

// Background effects that come with a background item: [sprite, count, mode]. "fall" drifts from the top
// to past the bottom; "wander" floats in place (fireflies). Counts are kept low for phones.
export const EFFECTS = Object.freeze({
  leaves: { sprite: 'leaf', count: 10, mode: 'fall', size: [2.4, 3.6], duration: [9, 14] },
  snow: { sprite: 'snow', count: 26, mode: 'fall', size: [1.2, 2.6], duration: [10, 16] },
  petals: { sprite: 'petal', count: 16, mode: 'fall', size: [1.8, 2.8], duration: [9, 13] },
  fireflies: { sprite: 'firefly', count: 12, mode: 'wander', size: [1.6, 2.6], duration: [6, 10] },
});

/** Particles for a background effect (null → none). Positions are % of the tree canvas; deterministic. */
export function buildEffect(effect) {
  const spec = EFFECTS[effect];
  if (!spec) return [];
  const rand = seededRandom(`effect:${effect}`);
  const between = ([a, b]) => a + (b - a) * rand();
  return Array.from({ length: spec.count }, (_, i) => {
    const size = +between(spec.size).toFixed(2);
    const wander = spec.mode === 'wander';
    return {
      key: `${effect}-${i}`, mode: spec.mode, src: TREE_ASSETS.fx(spec.sprite), size,
      left: +(rand() * 100 - size / 2).toFixed(2),
      top: +(wander ? 25 + rand() * 65 : -8 - rand() * 4).toFixed(2),
      dx: +((rand() - 0.5) * (wander ? 14 : 30)).toFixed(2),
      dy: +(wander ? (rand() - 0.5) * 10 : 112 + rand() * 6).toFixed(2),
      spin: Math.round(effect === 'snow' ? 90 : 160 + rand() * 300),
      duration: +between(spec.duration).toFixed(2), delay: +(-rand() * spec.duration[1]).toFixed(2),
    };
  });
}

/** Slots whose shown item changed since the last render (newly hung or swapped) → they get the "pop" animation. */
export function changedItems(previous, next) {
  if (!previous) return new Set(); // first render: nothing pops
  return new Set([...next].filter(([slot, itemId]) => itemId && previous.get(slot) !== itemId).map(([slot]) => slot));
}

/** Contact shadow box (% of canvas), scaled by the stage. */
export function shadowBox(anchors, stages, stage) {
  const scale = stages?.stages[stage]?.shadowScale ?? 1;
  const [bx, by] = anchors.base;
  const w = 768 * 0.75 * scale, h = 192 * 0.75 * scale;
  const pct = v => +(v / anchors.canvas * 100).toFixed(3);
  return { left: pct(bx - w / 2), top: pct(by - h / 2), width: pct(w), height: pct(h) };
}

/**
 * Ordered layers for a tree. slots: the API's [{ slot, item_id, unlocked, visible }].
 * Locked, empty and hidden (doesn't fit this species) slots are skipped; a missing background falls back to hanji.
 * With stage data, ground litter sits just before the ground props and falling leaves go on top, in front of the tree.
 */
export function buildScene(anchors, species, stage, slots = [], stages = null, effect = null) {
  const tree = anchors.trees[species]?.[stage];
  if (!tree) throw new Error(`No anchors for ${species}/${stage}`);
  const shown = new Map(slots.filter(s => s.unlocked && s.visible && s.item_id).map(s => [s.slot, s.item_id]));
  const item = (slot, depth, kind) => ({
    key: slot, kind, depth, slot, itemId: shown.get(slot), src: TREE_ASSETS.item(shown.get(slot)), box: itemBox(anchors, slot, tree.slots[slot]),
  });
  const part = (name, depth) => ({ key: name, kind: 'tree', depth, src: TREE_ASSETS.layer(species, stage, name) });
  const branches = ['branch-1', 'branch-2', 'branch-3', 'branch-4'].filter(slot => shown.has(slot));
  const background = shown.get('background') || DEFAULT_BACKGROUND;
  const particles = stages ? buildParticles(anchors, stages, species, stage) : { falling: [], litter: [] };
  return [
    { key: 'background', kind: 'background', depth: DEPTH.background, itemId: background, src: TREE_ASSETS.background(background) },
    // The background's own effect (snow, petals…) drifts behind the tree, as part of the scenery.
    ...(effect && EFFECTS[effect] ? [{ key: 'effect', kind: 'effect', depth: PARTICLE_DEPTH.effect, effect, particles: buildEffect(effect) }] : []),
    part('back', DEPTH.back),
    part('trunk', DEPTH.trunk),
    ...branches.filter(slot => tree.slots[slot].layer === 'mid').map(slot => item(slot, DEPTH.mid, 'branch')),
    part('front', DEPTH.front),
    ...branches.filter(slot => tree.slots[slot].layer !== 'mid').map(slot => item(slot, DEPTH.branchFront, 'branch')),
    ...(shown.has('topper') ? [item('topper', DEPTH.topper, 'topper')] : []),
    ...(particles.litter.length ? [{ key: 'litter', kind: 'litter', depth: PARTICLE_DEPTH.litter, particles: particles.litter }] : []),
    ...(shown.has('ground') ? [item('ground', DEPTH.ground, 'ground')] : []),
    { key: 'shadow', kind: 'shadow', depth: DEPTH.shadow, src: TREE_ASSETS.shadow, box: shadowBox(anchors, stages, stage) },
    ...(particles.falling.length ? [{ key: 'falling', kind: 'falling', depth: PARTICLE_DEPTH.falling, particles: particles.falling }] : []),
  ];
}

export const clampTilt = v => Math.max(-1, Math.min(1, Number.isFinite(v) ? v : 0));

/** Per-layer offset for a tilt in [-1, 1]²: nearer layers (higher depth) move further. */
export function parallax(tilt, depth) {
  const x = clampTilt(tilt.x), y = clampTilt(tilt.y);
  return { x: +(x * MAX_SHIFT * depth).toFixed(2), y: +(y * MAX_SHIFT * 0.6 * depth).toFixed(2) };
}

/** Whole-stage turn for a tilt: a slight rotateY/rotateX under CSS perspective. */
export function turn(tilt) {
  return { rotateY: +(clampTilt(tilt.x) * MAX_TURN.y).toFixed(2), rotateX: +(-clampTilt(tilt.y) * MAX_TURN.x).toFixed(2) };
}

/** Device orientation (degrees) → tilt, relative to how the phone was held when tilt started. */
export function tiltFromOrientation(gamma, beta, betaRest, range = 25) {
  return { x: clampTilt(gamma / range), y: clampTilt((beta - betaRest) / range) };
}
