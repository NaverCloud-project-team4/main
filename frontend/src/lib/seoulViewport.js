// NAVER maxBounds restricts the centre, not the visible viewport. Shrink the
// allowed centre range by the current viewport and also respect Seoul's polygon.
const EPSILON = 1e-9;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function centreLimits(city, view) {
  const axis = (min, max, span) => span >= max - min
    ? [(min + max) / 2, (min + max) / 2]
    : [min + span / 2, max - span / 2];
  const [minX, maxX] = axis(city.minX, city.maxX, view.maxX - view.minX);
  const [minY, maxY] = axis(city.minY, city.maxY, view.maxY - view.minY);
  return { minX, maxX, minY, maxY };
}

function onSegment(point, a, b) {
  const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!length) return Math.hypot(point.x - a.x, point.y - a.y) <= EPSILON;
  return Math.abs(cross) <= EPSILON * length
    && point.x >= Math.min(a.x, b.x) - EPSILON && point.x <= Math.max(a.x, b.x) + EPSILON
    && point.y >= Math.min(a.y, b.y) - EPSILON && point.y <= Math.max(a.y, b.y) + EPSILON;
}
function ringLocation(point, ring) {
  let inside = false;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], b = ring[i];
    if (onSegment(point, a, b)) return 2;
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside ? 1 : 0;
}
export function insideCity(point, polygons) {
  return polygons.some(rings => ringLocation(point, rings[0]) > 0
    && !rings.slice(1).some(hole => ringLocation(point, hole) === 1));
}

// Clip each boundary segment to the permitted centre rectangle. This also works
// when an axis is locked (a zero-width rectangle in the full-city overview).
function clipSegment(a, b, bounds) {
  let start = 0, end = 1;
  for (const [axis, min, max] of [['x', bounds.minX, bounds.maxX], ['y', bounds.minY, bounds.maxY]]) {
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < Number.EPSILON) {
      if (a[axis] < min || a[axis] > max) return null;
      continue;
    }
    const first = (min - a[axis]) / delta, last = (max - a[axis]) / delta;
    start = Math.max(start, Math.min(first, last));
    end = Math.min(end, Math.max(first, last));
    if (start > end) return null;
  }
  const at = t => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  return [at(start), at(end)];
}
export function clampSeoulCentre(point, limits, polygons) {
  const bounded = { x: clamp(point.x, limits.minX, limits.maxX), y: clamp(point.y, limits.minY, limits.maxY) };
  if (insideCity(bounded, polygons)) return bounded;
  let nearest = null, best = Infinity;
  for (const rings of polygons) for (const ring of rings) for (let i = 1; i < ring.length; i++) {
    const clipped = clipSegment(ring[i - 1], ring[i], limits);
    if (!clipped) continue;
    const [a, b] = clipped, dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length ? clamp(((bounded.x - a.x) * dx + (bounded.y - a.y) * dy) / length, 0, 1) : 0;
    const candidate = { x: a.x + t * dx, y: a.y + t * dy };
    const distance = (candidate.x - bounded.x) ** 2 + (candidate.y - bounded.y) ** 2;
    if (distance < best) { nearest = candidate; best = distance; }
  }
  // Seoul's bounding-box centre lies in Seoul, so its viewport always intersects
  // the city. Fail explicitly if a future boundary dataset breaks that invariant.
  if (!nearest) throw new Error('서울 지도 이동 범위를 계산하지 못했어요.');
  return nearest;
}

export function installSeoulViewport(maps, map, boundaries) {
  // Use a stable world projection, independent of GL's screen-pixel adapter.
  const projection = maps.EPSG3857;
  const [west, south, east, north] = boundaries.bbox;
  const bounds = new maps.LatLngBounds(new maps.LatLng(south, west), new maps.LatLng(north, east));
  const pointBounds = (a, b) => ({ minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) });
  const city = pointBounds(projection.fromCoordToPoint(bounds.getSW()), projection.fromCoordToPoint(bounds.getNE()));
  const geometry = boundaries.city_geometry;
  const polygons = (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates)
    .map(rings => rings.map(ring => ring.map(([lng, lat]) => projection.fromCoordToPoint(new maps.LatLng(lat, lng)))));
  let busy = false, lastDraggable = null;
  const enforce = () => {
    if (busy) return;
    busy = true;
    try {
      const visible = map.getBounds();
      const view = pointBounds(projection.fromCoordToPoint(visible.getSW()), projection.fromCoordToPoint(visible.getNE()));
      const limits = centreLimits(city, view);
      const current = projection.fromCoordToPoint(map.getCenter());
      const next = clampSeoulCentre(current, limits, polygons);
      const draggable = limits.maxX > limits.minX || limits.maxY > limits.minY;
      if (draggable !== lastDraggable) {
        lastDraggable = draggable;
        map.setOptions({ draggable, disableKineticPan: true });
      }
      const actual = projection.fromCoordToPoint(map.getCenter());
      if (Math.abs(actual.x - next.x) > EPSILON || Math.abs(actual.y - next.y) > EPSILON) {
        map.setCenter(projection.fromPointToCoord(new maps.Point(next.x, next.y)));
      }
    } finally { busy = false; }
  };
  const listeners = ['bounds_changed', 'zoom_changed', 'size_changed', 'dragend', 'idle']
    .map(event => maps.Event.addListener(map, event, enforce));
  return {
    fit() {
      busy = true;
      try {
        const vector = map.getOptions('gl');
        // GL maxBounds also forces the viewport to fill the city rectangle,
        // cropping its edges. Our polygon/viewport constraint already limits pan.
        map.setOptions({ minZoom: 5, ...(vector ? {} : { maxBounds: bounds }), draggable: true, disableKineticPan: true });
        const side = map.getSize().width < 500 ? 0 : 16;
        if (vector) {
          // GL fitBounds animates; reading its zoom immediately would lock the
          // previous zoom as minZoom. Fit synchronously using screen-pixel span.
          const size = map.getSize();
          const mercatorY = lat => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2;
          const zoom = Math.log2(Math.min((size.width - side * 2) / ((east - west) / 360 * 512),
            (size.height - 48) / ((mercatorY(south) - mercatorY(north)) * 512)));
          map.setZoom(Math.min(13, zoom), false);
          map.setCenter(projection.fromPointToCoord(new maps.Point((city.minX + city.maxX) / 2, (city.minY + city.maxY) / 2)));
        } else {
          map.fitBounds(bounds, { top: 24, bottom: 24, left: side, right: side, maxZoom: 13 });
        }
        map.setOptions({ minZoom: map.getZoom() });
        lastDraggable = null;
      } finally { busy = false; }
      enforce();
    },
    focus(latitude, longitude, minZoom = 14) {
      if (map.getZoom() < minZoom) map.setZoom(minZoom);
      map.setCenter(new maps.LatLng(latitude, longitude));
      enforce();
    },
    destroy() { listeners.forEach(listener => maps.Event.removeListener(listener)); },
  };
}
