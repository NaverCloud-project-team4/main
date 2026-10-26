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

/**
 * The part of the view above a bottom sheet that covers `inset` of `height` px.
 * north: +1 if projected y grows northwards. shift moves the map centre to the
 * centre of the uncovered part (add it before clamping, subtract it after).
 * At most 80% counts as covered, so the limits never collapse to nothing.
 */
export function coveredView(view, inset, height, north = 1) {
  const cut = height > 0 ? (view.maxY - view.minY) * Math.min(0.8, Math.max(0, inset) / height) : 0;
  const seen = north > 0 ? { ...view, minY: view.minY + cut } : { ...view, maxY: view.maxY - cut };
  return { shift: north * cut / 2, seen };
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
  // +1 when the projection's y grows northwards (the bottom of the screen is minY).
  const northUp = Math.sign(projection.fromCoordToPoint(bounds.getNE()).y - projection.fromCoordToPoint(bounds.getSW()).y) || 1;
  let busy = false, lastDraggable = null, inset = 0, flight = null;
  // setCenter or setOptions while NAVER animates a zoom (wheel, pinch, +/− or morph)
  // cancels the animation, so this runs while dragging and once the map settles,
  // never on bounds_changed/zoom_changed.
  const enforce = () => {
    // A programmatic flight passes through zooms whose limits would snap the centre
    // back (and cancel the animation); it is checked once it lands instead.
    if (busy || flight) return;
    busy = true;
    try {
      const visible = map.getBounds();
      const view = pointBounds(projection.fromCoordToPoint(visible.getSW()), projection.fromCoordToPoint(visible.getNE()));
      // A bottom sheet covers `inset` px: limit the uncovered part, so districts under
      // the sheet can still be dragged up into view.
      const { shift, seen } = coveredView(view, inset, map.getSize().height, northUp);
      const limits = centreLimits(city, seen);
      const current = projection.fromCoordToPoint(map.getCenter());
      const fixed = clampSeoulCentre({ x: current.x, y: current.y + shift }, limits, polygons);
      const next = { x: fixed.x, y: fixed.y - shift };
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
  const land = () => {
    if (!flight) return;
    clearTimeout(flight.timer);
    maps.Event.removeListener(flight.idle);
    flight = null;
    enforce();
  };
  const listeners = ['drag', 'size_changed', 'dragend', 'idle']
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
    /** Smooth move + zoom (map.morph) that the Seoul limits do not interrupt mid-way. */
    flyTo(coord, zoom) {
      land();
      flight = { idle: null, timer: null };
      map.morph(coord, zoom);
      // NAVER fires idle once the morph settles; the timer covers an animation that never starts.
      const current = flight;
      setTimeout(() => {
        if (flight !== current) return;
        current.idle = maps.Event.addListener(map, 'idle', land);
        current.timer = setTimeout(land, 2500);
      }, 0);
    },
    /** Pixels at the bottom of the map hidden by a sheet (0 when closed). */
    setInset(px) {
      const next = Math.max(0, Math.round(px) || 0);
      if (next === inset) return;
      inset = next;
      lastDraggable = null;
      enforce();
    },
    destroy() {
      land();
      listeners.forEach(listener => maps.Event.removeListener(listener));
    },
  };
}
