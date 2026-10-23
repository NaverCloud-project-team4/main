// A viewport-pinned mask: it cannot be dragged away and expose neighbouring tiles.
// Projected city holes are repainted after NAVER's pane transforms each frame.
export function createSeoulMask(maps, map, geometry) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  svg.classList.add('seoul-map-mask');
  svg.setAttribute('aria-hidden', 'true');
  Object.assign(svg.style, { position: 'absolute', left: '0', top: '0', zIndex: '1', pointerEvents: 'none', overflow: 'hidden' });
  path.setAttribute('fill', '#f2f4f6');
  path.setAttribute('fill-opacity', '1');
  path.setAttribute('fill-rule', 'evenodd');
  svg.appendChild(path);
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const rings = polygons.flat().map(ring => ring.map(([lng, lat]) => new maps.LatLng(lat, lng)));
  const overlay = new maps.OverlayView();
  let frame = null, listeners = [];
  const render = () => {
    frame = null;
    if (!overlay.getMap()) return;
    const root = map.getElement(), rect = root.getBoundingClientRect();
    const pane = overlay.getPanes().overlayLayer.getBoundingClientRect();
    const projection = overlay.getProjection();
    const width = root.clientWidth, height = root.clientHeight;
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const holes = rings.map(ring => ring.map((coordinate, index) => {
      const point = projection.fromCoordToOffset(coordinate);
      return `${index ? 'L' : 'M'}${point.x + pane.left - rect.left},${point.y + pane.top - rect.top}`;
    }).join(' ') + 'Z').join(' ');
    path.setAttribute('d', `M0,0H${width}V${height}H0Z ${holes}`);
  };
  const redraw = () => { if (frame === null) frame = requestAnimationFrame(render); };
  overlay.onAdd = function () {
    // Controls have z-index 100; the mask stays above tiles and below controls.
    map.getElement().appendChild(svg);
    listeners = ['bounds_changed', 'zoom_changed', 'size_changed', 'drag', 'dragend', 'idle']
      .map(event => maps.Event.addListener(map, event, redraw));
    redraw();
  };
  overlay.onRemove = function () {
    listeners.forEach(listener => maps.Event.removeListener(listener));
    listeners = [];
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    svg.remove();
  };
  overlay.draw = redraw;
  overlay.setMap(map);
  return overlay;
}
