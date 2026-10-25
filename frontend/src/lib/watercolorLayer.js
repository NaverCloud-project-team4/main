import { INK, RIVER, PAPER_COLOR, paperOpacity, washFor, labelSize } from './watercolorPalette.js';
import { insideCity } from './seoulViewport.js';
import { createTreeLayer } from './treeLayer.js';

// ---------- Pure SVG building (tested with node --test) ----------

export const polygonsOf = geometry => geometry?.type === 'Polygon' ? [geometry.coordinates]
  : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];

// One ring as an SVG path; drops points closer than minStep px to keep paths light.
export function ringPath(ring, project, minStep = 0.75) {
  let d = '', last = null;
  ring.forEach(([lng, lat], index) => {
    const p = project(lng, lat);
    if (last && index < ring.length - 1 && Math.abs(p.x - last.x) + Math.abs(p.y - last.y) < minStep) return;
    d += `${last ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    last = p;
  });
  return `${d}Z`;
}
export const geometryPath = (geometry, project) => polygonsOf(geometry).flat().map(ring => ringPath(ring, project)).join('');

// Lat/lng polygons as {x: lng, y: lat} rings for insideCity(), used for click hit-testing.
export const hitPolygons = geometry => polygonsOf(geometry).map(rings => rings.map(ring => ring.map(([x, y]) => ({ x, y }))));
export function zoneAt(lng, lat, districts) {
  return districts.find(d => insideCity({ x: lng, y: lat }, d.hit))?.id ?? null;
}

export const QUALITY = Object.freeze({
  high: { octaves: 3, displacement: 7, maxDpr: 2 },
  low: { octaves: 1, displacement: 4, maxDpr: 1 },
});

const rimWidth = zoom => Math.max(6, Math.min(18, (zoom - 8) * 3));

// Blur and edge wobble follow the rim width so close zooms stay soft instead of banded.
function filters(quality, rim) {
  const q = QUALITY[quality] || QUALITY.high;
  const wobble = q.displacement * Math.max(1, rim / 6);
  const turbulence = (freq, seed) => `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${q.octaves}" seed="${seed}" result="n"/>`;
  const displace = scale => `<feDisplacementMap in="SourceGraphic" in2="n" scale="${scale.toFixed(1)}" xChannelSelector="R" yChannelSelector="G" result="d"/>`;
  return `
<filter id="wc-bleed" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
  ${turbulence(0.035, 7)}${displace(wobble)}<feGaussianBlur in="d" stdDeviation="${(rim * 0.2).toFixed(1)}"/>
</filter>
<filter id="wc-rim" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
  ${turbulence(0.05, 11)}${displace(wobble * 0.8)}<feGaussianBlur in="d" stdDeviation="${(rim * 0.45).toFixed(1)}"/>
</filter>
<filter id="wc-ink" x="-2%" y="-2%" width="104%" height="104%">
  ${turbulence(0.09, 3)}${displace(1.6)}
</filter>`;
}

/**
 * The full static wash: district fills (stage colours), rims pooled inside each border,
 * pigment grain, ink borders and the Han River band on top.
 * districts: [{ id, geometry, stage }], river: GeoJSON geometry or null.
 * grain: data URI (external URLs are blocked when an SVG is drawn through <img>).
 */
export function buildWashSvg({ width, height, districts, river, project, zoom, grain, quality = 'high' }) {
  const rim = rimWidth(zoom);
  const paths = districts.map(d => ({ ...d, d: geometryPath(d.geometry, project), wash: washFor(d.stage, d.id) }));
  const clips = paths.map((p, i) => `<clipPath id="wc-c${i}"><path d="${p.d}" clip-rule="evenodd"/></clipPath>`).join('');
  const union = `<clipPath id="wc-all">${paths.map(p => `<path d="${p.d}" clip-rule="evenodd"/>`).join('')}</clipPath>`;
  const fills = paths.map(p => `<path d="${p.d}" fill="${p.wash.inner}" fill-opacity="${(p.wash.strength * 0.72).toFixed(3)}" fill-rule="evenodd"/>`).join('');
  const rims = paths.map((p, i) => `<path d="${p.d}" clip-path="url(#wc-c${i})" fill="none" stroke="${p.wash.edge}" stroke-opacity="${p.wash.strength.toFixed(3)}" stroke-width="${rim * 2}" stroke-linejoin="round"/>`).join('');
  const inner = paths.map((p, i) => `<path d="${p.d}" clip-path="url(#wc-c${i})" fill="none" stroke="${p.wash.edge}" stroke-opacity="${(p.wash.strength * 0.35).toFixed(3)}" stroke-width="${rim * 5}" stroke-linejoin="round"/>`).join('');
  const grainLayer = grain
    ? `<pattern id="wc-grain" patternUnits="userSpaceOnUse" width="256" height="256"><image href="${grain}" width="256" height="256"/></pattern>
       <rect width="${width}" height="${height}" fill="url(#wc-grain)" clip-path="url(#wc-all)" opacity="0.2" style="mix-blend-mode:multiply"/>`
    : '';
  const borders = `<g filter="url(#wc-ink)" fill="none" stroke="${INK}" stroke-opacity="0.62" stroke-width="0.9" stroke-linejoin="round">${paths.map(p => `<path d="${p.d}"/>`).join('')}</g>`;
  let riverLayer = '';
  if (river) {
    const r = geometryPath(river, project);
    riverLayer = `<clipPath id="wc-river"><path d="${r}" clip-rule="evenodd"/></clipPath>
      <path d="${r}" fill="${PAPER_COLOR}" fill-rule="evenodd" filter="url(#wc-bleed)"/>
      <path d="${r}" fill="${RIVER.inner}" fill-opacity="0.82" fill-rule="evenodd" filter="url(#wc-bleed)"/>
      <path d="${r}" clip-path="url(#wc-river)" fill="none" stroke="${RIVER.edge}" stroke-opacity="0.7" stroke-width="${Math.max(3, rim * 0.6)}" filter="url(#wc-rim)"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs>${filters(quality, rim)}${clips}${union}</defs>
<g filter="url(#wc-bleed)">${fills}</g>
<g filter="url(#wc-rim)">${inner}${rims}</g>
${grainLayer}${borders}${riverLayer}
</svg>`;
}

// ---------- DOM stage on top of the NAVER map ----------

let grainPromise;
// Fetch once and inline as a data URI; replacing the PNG takes effect after a reload.
export function loadGrain(url) {
  grainPromise ||= fetch(url).then(r => (r.ok ? r.blob() : null)).then(blob => blob && new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  })).catch(() => null);
  return grainPromise;
}

const MARGIN = 0.25;
const MOVE_EVENTS = ['bounds_changed', 'center_changed', 'zoom_changed', 'zooming', 'drag', 'size_changed', 'mousedown', 'touchstart', 'pinch'];

/**
 * Viewport-pinned watercolor stage (paper, cached wash bitmap, selection, brush labels).
 * The wash is rasterized once per zoom level; while dragging or zooming only CSS
 * transforms change, so the SVG filters never run per frame.
 */
export function createWatercolorStage(maps, map, { boundaries, river, paperUrl, grainUrl, treeAssets, onSelect, onEmptyClick, onGrowth }) {
  const root = document.createElement('div');
  root.className = 'wc-stage';
  root.setAttribute('aria-hidden', 'false');
  const paper = document.createElement('div');
  paper.className = 'wc-paper';
  paper.style.backgroundImage = `url("${paperUrl}")`;
  const world = document.createElement('div');
  world.className = 'wc-world';
  const canvas = document.createElement('canvas');
  canvas.className = 'wc-wash';
  const selection = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  selection.classList.add('wc-selection');
  const selectionFill = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const selectionLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  selectionFill.setAttribute('fill-rule', 'evenodd');
  selectionLine.setAttribute('fill', 'none');
  selectionLine.setAttribute('stroke', INK);
  selectionLine.setAttribute('stroke-width', '2');
  selectionLine.setAttribute('stroke-linejoin', 'round');
  selection.append(selectionFill, selectionLine);
  world.append(canvas, selection);
  const trees = document.createElement('div');
  trees.className = 'wc-trees';
  const labels = document.createElement('div');
  labels.className = 'wc-labels';
  root.append(paper, world, trees, labels);

  const districts = boundaries.features.map(f => ({ id: f.properties.zone_id, name: f.properties.name, geometry: f.geometry, hit: hitPolygons(f.geometry) }));
  const forest = createTreeLayer({ container: trees, districts, assets: treeAssets, onSelect });
  const compact = () => map.getElement().clientWidth < 500;
  const anchor = new maps.LatLng(37.5665, 126.978);
  const overlay = new maps.OverlayView();
  const state = { zones: new Map(), selected: null, raster: null, token: 0, stageKey: '', movingUntil: 0, frame: null, labelZoom: null, destroyed: false };
  const labelEls = new Map();
  let listeners = [];
  let highTimer = null;

  const offsets = () => {
    const rect = map.getElement().getBoundingClientRect();
    const pane = overlay.getPanes().overlayLayer.getBoundingClientRect();
    return { dx: pane.left - rect.left, dy: pane.top - rect.top };
  };
  const toScreen = (latlng, o) => {
    const p = overlay.getProjection().fromCoordToOffset(latlng);
    return { x: p.x + o.dx, y: p.y + o.dy };
  };
  const toCoord = (x, y, o) => overlay.getProjection().fromOffsetToCoord(new maps.Point(x - o.dx, y - o.dy));

  function paint() {
    state.frame = null;
    if (state.destroyed || !overlay.getMap()) return;
    const o = offsets();
    const zoom = map.getZoom();
    paper.style.opacity = String(paperOpacity(zoom));
    const a = toScreen(anchor, o);
    paper.style.backgroundPosition = `${a.x.toFixed(1)}px ${a.y.toFixed(1)}px`;
    if (state.raster) {
      const p1 = toScreen(state.raster.nw, o), p2 = toScreen(state.raster.se, o);
      const scale = (p2.x - p1.x) / state.raster.width;
      world.style.transform = `translate(${p1.x.toFixed(2)}px, ${p1.y.toFixed(2)}px) scale(${scale.toFixed(5)})`;
    }
    forest.paint((lng, lat) => toScreen(new maps.LatLng(lat, lng), o));
    for (const [id, el] of labelEls) {
      const zone = state.zones.get(id);
      if (!zone) continue;
      const p = toScreen(new maps.LatLng(zone.latitude, zone.longitude), o);
      // With a forest, the name sits just below the central tree's roots.
      const lift = forest.hasTrees(id) ? '2px' : '-50%';
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, ${lift})`;
    }
    if (performance.now() < state.movingUntil) state.frame = requestAnimationFrame(paint);
  }
  const schedule = (hold = 0) => {
    state.movingUntil = Math.max(state.movingUntil, performance.now() + hold);
    if (state.frame === null) state.frame = requestAnimationFrame(paint);
  };

  function drawSelection() {
    const raster = state.raster;
    const district = districts.find(d => d.id === state.selected);
    if (!raster || !district) {
      selectionFill.setAttribute('d', '');
      selectionLine.setAttribute('d', '');
      return;
    }
    const d = geometryPath(district.geometry, raster.project);
    const zone = state.zones.get(district.id);
    selectionFill.setAttribute('d', d);
    selectionFill.setAttribute('fill', washFor(zone?.stage, district.id).edge);
    selectionFill.setAttribute('fill-opacity', '0.15');
    selectionLine.setAttribute('d', d);
  }

  async function rasterize(quality) {
    if (state.destroyed || !overlay.getMap()) return;
    const token = ++state.token;
    const element = map.getElement();
    const width = element.clientWidth, height = element.clientHeight;
    if (!width || !height) return;
    const o = offsets();
    const zoom = map.getZoom();
    const left = -width * MARGIN, top = -height * MARGIN;
    const rasterWidth = Math.round(width * (1 + 2 * MARGIN)), rasterHeight = Math.round(height * (1 + 2 * MARGIN));
    const project = (lng, lat) => {
      const p = toScreen(new maps.LatLng(lat, lng), o);
      return { x: p.x - left, y: p.y - top };
    };
    const grain = await loadGrain(grainUrl);
    const svg = buildWashSvg({
      width: rasterWidth, height: rasterHeight, project, zoom, grain, quality, river,
      districts: districts.map(d => ({ id: d.id, geometry: d.geometry, stage: state.zones.get(d.id)?.stage })),
    });
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (token !== state.token || state.destroyed) return;
      const dpr = Math.min(window.devicePixelRatio || 1, (QUALITY[quality] || QUALITY.high).maxDpr);
      canvas.width = Math.round(rasterWidth * dpr);
      canvas.height = Math.round(rasterHeight * dpr);
      canvas.style.width = `${rasterWidth}px`;
      canvas.style.height = `${rasterHeight}px`;
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      selection.setAttribute('width', rasterWidth);
      selection.setAttribute('height', rasterHeight);
      selection.setAttribute('viewBox', `0 0 ${rasterWidth} ${rasterHeight}`);
      state.raster = {
        zoom, quality, width: rasterWidth, height: rasterHeight, project,
        nw: toCoord(left, top, o), se: toCoord(left + rasterWidth, top + rasterHeight, o),
        box: { left, top, right: left + rasterWidth, bottom: top + rasterHeight },
      };
      root.dataset.wcQuality = quality;
      drawSelection();
      schedule();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  function refreshRaster(force = false) {
    const raster = state.raster;
    if (!force && raster && raster.zoom === map.getZoom()) {
      // Same zoom: keep the bitmap while the viewport stays inside its margin.
      const o = offsets();
      const p1 = toScreen(raster.nw, o), p2 = toScreen(raster.se, o);
      const element = map.getElement();
      if (p1.x <= 1 && p1.y <= 1 && p2.x >= element.clientWidth - 1 && p2.y >= element.clientHeight - 1) {
        if (raster.quality === 'high') return;
      }
    }
    clearTimeout(highTimer);
    if (coarse) {
      rasterize('low');
      highTimer = setTimeout(() => rasterize('high'), 450);
    } else {
      rasterize('high');
    }
  }

  function renderLabels() {
    const size = labelSize(map.getZoom(), compact());
    for (const district of districts) {
      let el = labelEls.get(district.id);
      if (!el) {
        el = document.createElement('button');
        el.type = 'button';
        el.className = 'wc-label';
        el.dataset.zoneId = district.id;
        el.addEventListener('click', event => { event.stopPropagation(); onSelect(district.id); });
        labels.append(el);
        labelEls.set(district.id, el);
      }
      const zone = state.zones.get(district.id);
      el.textContent = zone?.name || district.name;
      el.style.fontSize = `${size}px`;
      const isSelected = district.id === state.selected;
      el.classList.toggle('selected', isSelected);
      el.setAttribute('aria-pressed', String(isSelected));
      el.setAttribute('aria-label', `${zone?.name || district.name} 선택`);
    }
    state.labelZoom = map.getZoom();
  }

  overlay.onAdd = function () {
    map.getElement().appendChild(root);
    listeners = MOVE_EVENTS.map(event => maps.Event.addListener(map, event, () => schedule(450)));
    listeners.push(maps.Event.addListener(map, 'idle', () => {
      schedule(120);
      if (state.labelZoom !== map.getZoom()) renderLabels();
      forest.resize(map.getZoom(), compact());
      refreshRaster();
    }));
    listeners.push(maps.Event.addListener(map, 'click', event => {
      const coord = event.coord;
      const id = coord && zoneAt(coord.x ?? coord.lng(), coord.y ?? coord.lat(), districts);
      if (id) onSelect(id);
      else onEmptyClick?.();
    }));
    renderLabels();
    refreshRaster(true);
  };
  overlay.onRemove = function () {
    listeners.forEach(listener => maps.Event.removeListener(listener));
    listeners = [];
    if (state.frame !== null) cancelAnimationFrame(state.frame);
    state.frame = null;
    root.remove();
  };
  overlay.draw = () => schedule();
  overlay.setMap(map);

  return {
    root,
    update({ zones, selected }) {
      state.zones = new Map(zones.map(z => [z.id, z]));
      state.selected = selected;
      const stageKey = zones.map(z => `${z.id}:${z.stage}`).sort().join('|');
      renderLabels();
      const growth = forest.update(state.zones, map.getZoom(), compact());
      if (growth.added.length || growth.grown.length || growth.removed.length) onGrowth?.(growth);
      if (stageKey !== state.stageKey) {
        state.stageKey = stageKey;
        if (overlay.getMap()) refreshRaster(true);
      } else {
        drawSelection();
      }
      schedule();
    },
    resize() { renderLabels(); forest.resize(map.getZoom(), compact()); refreshRaster(true); schedule(); },
    destroy() {
      state.destroyed = true;
      clearTimeout(highTimer);
      overlay.setMap(null);
    },
  };
}
