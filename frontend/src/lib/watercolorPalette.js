// Watercolor map palette and tunables. Pure module (no DOM) so node --test can import it.

// Paper covers the NAVER tiles. From closeZoom upward it turns slightly translucent so
// 15–25% of the tiles show through; keep `close` within 0.75–0.85.
export const PAPER_OPACITY = Object.freeze({ base: 1, closeZoom: 15, close: 0.8 });
export const paperOpacity = zoom => (zoom >= PAPER_OPACITY.closeZoom ? PAPER_OPACITY.close : PAPER_OPACITY.base);

export const PAPER_COLOR = '#f3ecdc';
export const INK = '#5b4a3a';
export const RIVER = Object.freeze({ inner: '#a9bcc4', edge: '#7d939d' });

// District colour = foliage stage. inner is the pale centre, edge the pooled rim.
export const STAGE_WASH = Object.freeze({
  GREEN: { inner: '#ece6c4', edge: '#b7c98a', label: '물들기 전', colorName: '연두' },
  STARTING: { inner: '#f6dc8a', edge: '#f4a259', label: '물드는 중', colorName: '노랑·연주황' },
  PEAK: { inner: '#f08a5d', edge: '#b8321e', label: '절정', colorName: '주홍·붉은색' },
  FALLEN: { inner: '#d4a373', edge: '#8a5a34', label: '낙엽', colorName: '갈색·탁한 주황' },
  UNKNOWN: { inner: '#efe8d8', edge: '#cfc5b0', label: '제보 기다리는 중', colorName: '옅은 회미색' },
});
export const STAGE_ORDER = ['GREEN', 'STARTING', 'PEAK', 'FALLEN', 'UNKNOWN'];

// Stable 32-bit FNV-1a hash → [0, 1). Same zone id, same variation on every render.
export function seeded(text) {
  let hash = 0x811c9dc5;
  for (const char of String(text)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash / 2 ** 32;
}

const SELECTED_BOOST = 0.15;
const VARIATION = 0.08;

// Opacity of the wash for one district: ±8% per-zone variation, +15% when selected.
export function washFor(stage, zoneId, selected = false) {
  const colors = STAGE_WASH[stage] || STAGE_WASH.UNKNOWN;
  const variation = 1 + (seeded(zoneId) * 2 - 1) * VARIATION;
  const strength = Math.min(1, 0.78 * variation * (selected ? 1 + SELECTED_BOOST : 1));
  return { inner: colors.inner, edge: colors.edge, strength };
}

// Brush-label size by zoom: small at the city overview, larger when zoomed in.
// Narrow maps (phones) use 80% so neighbouring district names do not collide.
export const labelSize = (zoom, compact = false) => Math.round(Math.max(17, Math.min(30, (zoom - 7) * 4.8)) * (compact ? 0.8 : 1));
