import { treeWidth, TREE_ASPECT, TREE_BASE } from './treeLayout.js';

// Pop-up-book trees at forecast spots: from POPUP_ZOOM up, trees on screen rise from the
// page (rotateX 90° → 0 around their base, staggered); zooming out folds them back down.
export const POPUP_ZOOM = 14;
export const POPUP_STAGGER_MS = 60;
const FOLD_MS = 420;
const MARGIN = 80; // px outside the viewport that still counts as on screen

/** Pure: should each spot be up? points: Map(id → {x, y}) in screen px. */
export function popupTargets(points, zoom, width, height, margin = MARGIN) {
  const up = new Set();
  if (zoom < POPUP_ZOOM) return up;
  for (const [id, p] of points) {
    if (p.x >= -margin && p.x <= width + margin && p.y >= -margin && p.y <= height + margin) up.add(id);
  }
  return up;
}

/** Pure: rise order for newly shown spots — left to right, so the page "opens" across the map. */
export function riseOrder(ids, points) {
  return [...ids].sort((a, b) => points.get(a).x - points.get(b).x || points.get(a).y - points.get(b).y);
}

export function createPopupLayer({ container, assets, onSelect }) {
  const items = new Map(); // id → { spot, el, body, state: 'down' | 'up' | 'folding', timer }
  let lastZoom = null, lastCompact = null;

  function size(item, zoom, compact) {
    const width = Math.round(treeWidth('large', zoom, compact) * 1.15);
    const height = Math.round(width * TREE_ASPECT);
    Object.assign(item.body.style, { width: `${width}px`, height: `${height}px`, marginLeft: `${-width / 2}px`, marginTop: `${-height * TREE_BASE}px` });
  }

  return {
    setSpots(spots) {
      for (const [id, item] of items) {
        if (!spots.some(s => s.id === id)) { clearTimeout(item.timer); item.el.remove(); items.delete(id); }
      }
      for (const spot of spots) {
        let item = items.get(spot.id);
        if (!item) {
          const el = document.createElement('div');
          el.className = 'wc-pop wc-pop--down';
          el.dataset.spotId = spot.id;
          const body = document.createElement('button');
          body.type = 'button';
          body.className = 'wc-pop-body';
          body.setAttribute('aria-label', `${spot.name} 명소`);
          body.tabIndex = -1; // reachable from the sheet's spot list instead
          const shadow = document.createElement('img');
          shadow.className = 'wc-tree-shadow';
          shadow.src = assets.shadow;
          shadow.alt = '';
          const img = document.createElement('img');
          img.className = 'wc-tree-img';
          img.alt = '';
          img.draggable = false;
          const name = document.createElement('span');
          name.className = 'wc-pop-name';
          body.append(shadow, img, name);
          body.addEventListener('click', event => { event.stopPropagation(); onSelect(item.spot); });
          el.append(body);
          container.append(el);
          item = { el, body, img, name, state: 'down', timer: null };
          items.set(spot.id, item);
        }
        item.spot = spot;
        item.img.src = spot.kind === 'GINKGO' ? assets.ginkgo : assets.maple;
        item.name.textContent = spot.name;
        item.el.style.zIndex = String(Math.max(0, Math.round((37.75 - spot.latitude) * 20000)));
      }
      lastZoom = null; // re-size on the next paint
    },
    /** Called every frame while the map moves. toScreen(lng, lat) → {x, y}. */
    paint(toScreen, zoom, width, height, compact) {
      const points = new Map();
      for (const [id, item] of items) {
        const p = toScreen(item.spot.longitude, item.spot.latitude);
        points.set(id, p);
        item.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      }
      if (zoom !== lastZoom || compact !== lastCompact) {
        for (const item of items.values()) size(item, zoom, compact);
        lastZoom = zoom;
        lastCompact = compact;
      }
      const targets = popupTargets(points, zoom, width, height);
      const rising = [];
      for (const [id, item] of items) {
        const want = targets.has(id);
        if (want && item.state !== 'up') rising.push(id);
        if (!want && item.state === 'up') {
          item.state = 'folding';
          item.el.classList.replace('wc-pop--up', 'wc-pop--fold');
          item.timer = setTimeout(() => {
            if (item.state !== 'folding') return;
            item.state = 'down';
            item.el.classList.replace('wc-pop--fold', 'wc-pop--down');
          }, FOLD_MS);
        }
      }
      riseOrder(rising, points).forEach((id, n) => {
        const item = items.get(id);
        clearTimeout(item.timer);
        item.state = 'up';
        item.el.style.setProperty('--wc-delay', `${n * POPUP_STAGGER_MS}ms`);
        item.el.classList.remove('wc-pop--down', 'wc-pop--fold');
        item.el.classList.add('wc-pop--up');
      });
    },
    states: () => new Map([...items].map(([id, item]) => [id, item.state])),
  };
}
