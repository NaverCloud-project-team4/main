import { forestSpacing, layoutLeaves, layoutTrees, random, treeGrowthDiff, treeWidth, TREE_ASPECT, TREE_BASE } from './treeLayout.js';

const STAGGER_MS = 80;
const LEAVE_MS = 350;
const DRIFTS_PER_FOREST = 3; // looping falling leaves per level-3 district
const BURST_LEAVES = 4; // one-off leaves shaken loose when a forest grows
const FALLING = new Set(['leaf', 'drift', 'burst']);
const zIndexFor = lat => Math.max(0, Math.round((37.75 - lat) * 20000)); // south = in front

/**
 * Interest trees drawn as DOM inside the watercolor stage.
 * update() diffs the forest against the previous refresh and animates growth;
 * paint() only moves elements (called every frame while the map moves).
 */
export function createTreeLayer({ container, districts, assets }) {
  const entities = new Map(); // key → { el, body, img, lng, lat, size, kind, zoneId }
  let sizes = new Map(); // key → size, from the previous update (trees only)
  let first = true;
  let lastZoom = null, lastCompact = null, lastSpacing = null, lastZones = new Map();

  function makeTree(key, zoneId) {
    const el = document.createElement('div');
    el.className = 'wc-tree';
    el.dataset.key = key;
    const body = document.createElement('div');
    body.className = 'wc-tree-body';
    body.dataset.zoneId = zoneId; // clicks are hit-tested by the stage (the layer ignores the pointer)
    const shadow = document.createElement('img');
    shadow.className = 'wc-tree-shadow';
    shadow.src = assets.shadow;
    shadow.alt = '';
    const img = document.createElement('img');
    img.className = 'wc-tree-img';
    img.alt = '';
    img.draggable = false;
    body.append(shadow, img);
    el.append(body);
    el.setAttribute('aria-hidden', 'true');
    container.append(el);
    return { el, body, img };
  }

  function makeLeaf(key, className = 'wc-leaf') {
    const el = document.createElement('div');
    el.className = className;
    el.dataset.key = key;
    el.setAttribute('aria-hidden', 'true');
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    el.append(img);
    container.append(el);
    return { el, body: img, img };
  }

  function applySize(entity, zoom, compact) {
    if (FALLING.has(entity.kind)) {
      const width = Math.round(treeWidth('small', zoom, compact) * 0.42);
      entity.body.style.width = `${width}px`;
      // Falling leaves start in the crown of the central tree.
      if (entity.kind !== 'leaf') entity.el.style.setProperty('--wc-fall', `${Math.round(treeWidth('large', zoom, compact) * 1.05)}px`);
      return;
    }
    const width = treeWidth(entity.size, zoom, compact);
    const height = Math.round(width * TREE_ASPECT);
    Object.assign(entity.body.style, {
      width: `${width}px`, height: `${height}px`,
      marginLeft: `${-width / 2}px`, marginTop: `${-height * TREE_BASE}px`,
    });
  }

  function remove(key, animate) {
    const entity = entities.get(key);
    if (!entity) return;
    entities.delete(key);
    if (!animate) return entity.el.remove();
    entity.el.classList.add('wc-tree--leave');
    setTimeout(() => entity.el.remove(), LEAVE_MS);
  }

  /** Lay out the forest; animate=false for the first paint and zoom relayouts. */
  function render(zones, zoom, compact, animate) {
    const spacing = forestSpacing(zoom, compact);
    const nextTrees = new Map();
    const nextLeaves = new Map();
    for (const district of districts) {
      const zone = zones.get(district.id);
      if (!zone) continue;
      const species = zone.dominant_species === 'GINKGO' ? 'ginkgo' : 'maple';
      const place = { ...district, latitude: zone.latitude, longitude: zone.longitude };
      for (const tree of layoutTrees(place, zone.tree_level, spacing)) nextTrees.set(tree.key, { ...tree, zoneId: district.id, species });
      for (const leaf of layoutLeaves(place, zone.tree_level, spacing)) nextLeaves.set(leaf.key, { ...leaf, zoneId: district.id, species });
    }
    const diff = treeGrowthDiff(sizes, new Map([...nextTrees].map(([key, tree]) => [key, tree.size])));
    const order = new Map();
    for (const key of diff.removed) remove(key, animate);
    for (const [key, tree] of nextTrees) {
      let entity = entities.get(key);
      if (!entity) {
        entity = { ...makeTree(key, tree.zoneId), kind: 'tree' };
        entities.set(key, entity);
        if (animate) {
          // New trees in the same district rise one after another.
          const n = order.get(tree.zoneId) || 0;
          order.set(tree.zoneId, n + 1);
          entity.el.style.setProperty('--wc-delay', `${n * STAGGER_MS}ms`);
          entity.el.classList.add('wc-tree--enter');
          entity.el.addEventListener('animationend', () => entity.el.classList.remove('wc-tree--enter'), { once: true });
        }
      }
      Object.assign(entity, { lng: tree.lng, lat: tree.lat, size: tree.size, zoneId: tree.zoneId });
      const src = tree.species === 'ginkgo' ? assets.ginkgo : assets.maple;
      if (entity.img.getAttribute('src') !== src) entity.img.src = src;
      entity.el.dataset.size = tree.size;
      entity.el.style.zIndex = String(zIndexFor(tree.lat));
      applySize(entity, zoom, compact); // a size change transitions in CSS (growth)
    }
    for (const key of [...entities.keys()]) {
      if (entities.get(key).kind === 'leaf' && !nextLeaves.has(key)) remove(key, animate);
    }
    for (const [key, leaf] of nextLeaves) {
      let entity = entities.get(key);
      if (!entity) {
        entity = { ...makeLeaf(key), kind: 'leaf' };
        entities.set(key, entity);
        if (animate) entity.el.classList.add('wc-leaf--enter');
      }
      const files = leaf.species === 'ginkgo' ? assets.ginkgoLeaves : assets.mapleLeaves;
      const src = files[leaf.variant % files.length];
      if (entity.img.getAttribute('src') !== src) entity.img.src = src;
      Object.assign(entity, { lng: leaf.lng, lat: leaf.lat, zoneId: leaf.zoneId });
      entity.img.style.transform = `translate(-50%, -50%) rotate(${leaf.rotate}deg)`;
      entity.el.style.zIndex = String(Math.max(0, zIndexFor(leaf.lat) - 1));
      applySize(entity, zoom, compact);
    }
    // Looping falling leaves for level-3 forests (CSS animation, paused off screen).
    const nextDrifts = new Map();
    for (const [key, tree] of nextTrees) {
      if (tree.slot !== 0 || (zones.get(tree.zoneId)?.tree_level ?? 0) < 3) continue;
      for (let i = 0; i < DRIFTS_PER_FOREST; i++) nextDrifts.set(`${tree.zoneId}:drift:${i}`, { ...tree, key, i });
    }
    for (const key of [...entities.keys()]) {
      if (entities.get(key).kind === 'drift' && !nextDrifts.has(key)) remove(key, false);
    }
    for (const [key, drift] of nextDrifts) {
      let entity = entities.get(key);
      if (!entity) {
        entity = { ...makeLeaf(key, 'wc-drift'), kind: 'drift' };
        entities.set(key, entity);
        const rng = random(key);
        entity.el.style.setProperty('--wc-dx', `${Math.round((rng() - 0.5) * 70)}px`);
        entity.el.style.setProperty('--wc-dur', `${(5.5 + rng() * 3).toFixed(2)}s`);
        entity.el.style.setProperty('--wc-delay', `${(-rng() * 8).toFixed(2)}s`); // negative: start mid-fall
        entity.el.style.setProperty('--wc-spin', `${Math.round(180 + rng() * 260)}deg`);
      }
      const files = drift.species === 'ginkgo' ? assets.ginkgoLeaves : assets.mapleLeaves;
      const src = files[drift.i % files.length];
      if (entity.img.getAttribute('src') !== src) entity.img.src = src;
      Object.assign(entity, { lng: drift.lng, lat: drift.lat, zoneId: drift.zoneId });
      entity.el.style.zIndex = String(zIndexFor(drift.lat) + 1);
      applySize(entity, zoom, compact);
    }
    // A forest that just grew shakes a few leaves loose once.
    if (animate) {
      const grew = new Set([...diff.added, ...diff.grown].map(key => key.split(':')[0]));
      for (const zoneId of grew) {
        const centre = [...nextTrees.values()].find(tree => tree.zoneId === zoneId && tree.slot === 0);
        if (!centre) continue;
        const files = centre.species === 'ginkgo' ? assets.ginkgoLeaves : assets.mapleLeaves;
        for (let i = 0; i < BURST_LEAVES; i++) {
          const key = `${zoneId}:burst:${performance.now().toFixed(0)}:${i}`;
          const entity = { ...makeLeaf(key, 'wc-drift wc-drift--burst'), kind: 'burst', lng: centre.lng, lat: centre.lat, zoneId };
          entity.img.src = files[i % files.length];
          entity.el.style.setProperty('--wc-dx', `${Math.round((i - 1.5) * 26)}px`);
          entity.el.style.setProperty('--wc-dur', `${(1.6 + i * 0.25).toFixed(2)}s`);
          entity.el.style.setProperty('--wc-delay', `${300 + i * 120}ms`);
          entity.el.style.setProperty('--wc-spin', `${200 + i * 70}deg`);
          entity.el.style.zIndex = String(zIndexFor(centre.lat) + 1);
          entity.el.addEventListener('animationend', () => { entities.delete(key); entity.el.remove(); }, { once: true });
          entities.set(key, entity);
          applySize(entity, zoom, compact);
        }
      }
    }
    sizes = new Map([...nextTrees].map(([key, tree]) => [key, tree.size]));
    lastZones = zones;
    lastZoom = zoom;
    lastCompact = compact;
    lastSpacing = spacing;
    return diff;
  }

  return {
    /** zones: Map(id → zone). Returns the growth diff; the first call never animates. */
    update(zones, zoom, compact) {
      const diff = render(zones, zoom, compact, !first);
      first = false;
      return diff;
    },
    /** New zoom: resize (and re-space the forest) without the growth transition. */
    resize(zoom, compact) {
      if (zoom === lastZoom && compact === lastCompact) return;
      container.classList.add('wc-trees--instant');
      if (forestSpacing(zoom, compact) !== lastSpacing) {
        render(lastZones, zoom, compact, false);
      } else {
        lastZoom = zoom;
        lastCompact = compact;
        for (const entity of entities.values()) applySize(entity, zoom, compact);
      }
      requestAnimationFrame(() => requestAnimationFrame(() => container.classList.remove('wc-trees--instant')));
    },
    paint(toScreen, width = Infinity, height = Infinity) {
      for (const entity of entities.values()) {
        const p = toScreen(entity.lng, entity.lat);
        entity.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
        // Pause looping leaves that are off screen.
        if (entity.kind === 'drift') entity.el.classList.toggle('wc-off', p.x < -60 || p.y < -120 || p.x > width + 60 || p.y > height + 60);
      }
    },
    hasTrees: zoneId => sizes.has(`${zoneId}:0`),
  };
}
