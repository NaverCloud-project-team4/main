import { treeWidth, TREE_ASPECT, TREE_BASE } from './treeLayout.js';

// Forecast-spot trees, pinned to each spot's exact coordinate at every zoom (no jitter):
// the trunk foot sits on the point. Trees coming on screen rise from the page like a
// pop-up book (rotateX 90° → 0 around their base, staggered); a focused spot rises again.
export const POPUP_ZOOM = 14; // from here every spot shows its name and a larger tree
export const SPOT_FOCUS_ZOOM = 16; // zoom used when a spot is picked in the sheet
export const POPUP_STAGGER_MS = 60;
const MARGIN = 80; // px outside the viewport that still counts as on screen

/** Pure: which spots are on screen (plus a margin)? points: Map(id → {x, y}) in screen px. */
export function popupTargets(points, width, height, margin = MARGIN) {
  const up = new Set();
  for (const [id, p] of points) {
    if (p.x >= -margin && p.x <= width + margin && p.y >= -margin && p.y <= height + margin) up.add(id);
  }
  return up;
}

/** Pure: rise order for newly shown spots — left to right, so the page "opens" across the map. */
export function riseOrder(ids, points) {
  return [...ids].sort((a, b) => points.get(a).x - points.get(b).x || points.get(a).y - points.get(b).y);
}

/** Pure: on-screen tree box for a spot. The trunk foot (TREE_BASE) lands on the coordinate. */
export function spotTreeBox(zoom, compact = false) {
  const width = Math.round(treeWidth(zoom >= POPUP_ZOOM ? 'large' : 'medium', zoom, compact) * 1.15);
  const height = Math.round(width * TREE_ASPECT);
  return { width, height, left: -width / 2, top: -height * TREE_BASE };
}

export function createPopupLayer({ container, assets }) {
  const items = new Map(); // id → { spot, el, body, img, name, state: 'down' | 'up' }
  let lastZoom = null, lastCompact = null, focused = null;

  function size(item, zoom, compact) {
    const box = spotTreeBox(zoom, compact);
    Object.assign(item.body.style, { width: `${box.width}px`, height: `${box.height}px`, marginLeft: `${box.left}px`, marginTop: `${box.top}px` });
  }
  function rise(item, delay = 0) {
    item.state = 'up';
    item.el.style.setProperty('--wc-delay', `${delay}ms`);
    item.el.classList.remove('wc-pop--down', 'wc-pop--up');
    void item.el.offsetWidth; // restart the animation
    item.el.classList.add('wc-pop--up');
  }

  return {
    setSpots(spots) {
      for (const [id, item] of items) {
        if (!spots.some(s => s.id === id)) { item.el.remove(); items.delete(id); }
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
          body.tabIndex = -1; // reachable from the sheet's spot list instead; clicks are hit-tested by the stage
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
          // The exact point: a small ink dot under the trunk.
          const foot = document.createElement('span');
          foot.className = 'wc-pop-foot';
          el.append(foot, body);
          container.append(el);
          item = { el, body, img, name, state: 'down' };
          items.set(spot.id, item);
        }
        item.spot = spot;
        item.img.src = spot.kind === 'GINKGO' ? assets.ginkgo : assets.maple;
        item.name.textContent = spot.name;
        // Southern trees stand in front; the focused spot stands in front of everything.
        item.el.style.zIndex = String(spot.id === focused ? 100000 : Math.max(0, Math.round((37.75 - spot.latitude) * 20000)));
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
        container.dataset.names = zoom >= POPUP_ZOOM ? 'on' : 'off';
        lastZoom = zoom;
        lastCompact = compact;
      }
      const targets = popupTargets(points, width, height);
      const rising = [];
      for (const [id, item] of items) {
        const want = targets.has(id);
        if (want && item.state !== 'up') rising.push(id);
        if (!want && item.state === 'up') {
          item.state = 'down';
          item.el.classList.replace('wc-pop--up', 'wc-pop--down');
        }
      }
      riseOrder(rising, points).forEach((id, n) => rise(items.get(id), n * POPUP_STAGGER_MS));
    },
    /** Mark one spot (name always shown, drawn on top); null clears. */
    focus(id) {
      for (const [key, item] of items) {
        const on = key === id;
        item.el.classList.toggle('wc-pop--focus', on);
        if (on || key === focused) item.el.style.zIndex = String(on ? 100000 : Math.max(0, Math.round((37.75 - item.spot.latitude) * 20000)));
      }
      focused = id ?? null;
    },
    /** Rise the spot again (on arriving at it). */
    replay(id) {
      const item = items.get(id);
      if (item) rise(item);
    },
    states: () => new Map([...items].map(([id, item]) => [id, item.state])),
    spot: id => items.get(id)?.spot ?? null,
  };
}
