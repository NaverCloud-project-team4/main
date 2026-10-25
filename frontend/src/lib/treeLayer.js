import { forestSpacing, layoutLeaves, layoutTrees, treeGrowthDiff, treeWidth, TREE_ASPECT, TREE_BASE } from './treeLayout.js';

const STAGGER_MS = 80;
const LEAVE_MS = 350;
const zIndexFor = lat => Math.max(0, Math.round((37.75 - lat) * 20000)); // south = in front

/**
 * Interest trees drawn as DOM inside the watercolor stage.
 * update() diffs the forest against the previous refresh and animates growth;
 * paint() only moves elements (called every frame while the map moves).
 */
export function createTreeLayer({ container, districts, assets, onSelect }) {
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
    body.addEventListener('click', event => { event.stopPropagation(); onSelect(zoneId); });
    container.append(el);
    return { el, body, img };
  }

  function makeLeaf(key) {
    const el = document.createElement('div');
    el.className = 'wc-leaf';
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
    if (entity.kind === 'leaf') {
      const width = Math.round(treeWidth('small', zoom, compact) * 0.42);
      entity.body.style.width = `${width}px`;
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
    paint(toScreen) {
      for (const entity of entities.values()) {
        const p = toScreen(entity.lng, entity.lat);
        entity.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      }
    },
    hasTrees: zoneId => sizes.has(`${zoneId}:0`),
  };
}
