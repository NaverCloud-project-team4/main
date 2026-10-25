// Interest trees per district. Pure module (no DOM) so node --test can import it.
// Level → forest: 0 none, 1 one small tree, 2 two–three medium trees, 3 a large tree with 4–6 more (5–7 total).
import { insideCity } from './seoulViewport.js';
import { seeded } from './watercolorPalette.js';

export const TREE_WIDTH = Object.freeze({ small: 30, medium: 42, large: 60 }); // px at zoom 11
export const TREE_ASPECT = 640 / 512;
export const TREE_BASE = 0.94; // trunk foot at 94% of the image height
const SLOT_SPACING_M = 210; // minimum metres between rings of trees (close zooms)
const MAX_TRIES = 20;

// Web-Mercator ground resolution (NAVER GL uses the standard 256px tile pyramid).
export const metersPerPixel = (zoom, lat) => 156543.03392 * Math.cos(lat * Math.PI / 180) / 2 ** zoom;

/**
 * Ring spacing for a zoom: about half a medium tree apart on screen, so a level-3
 * forest reads as a cluster even at the city overview. Quantised to whole zoom
 * levels so trees do not shuffle during a zoom animation.
 */
export function forestSpacing(zoom, compact = false, lat = 37.55) {
  const z = Math.floor(zoom);
  return Math.max(SLOT_SPACING_M, Math.round(metersPerPixel(z, lat) * treeWidth('medium', z, compact) * 0.5));
}

// Small deterministic PRNG (mulberry32) seeded from text.
export function random(seedText) {
  let a = Math.floor(seeded(seedText) * 2 ** 32);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clampLevel = level => Math.max(0, Math.min(3, Math.trunc(Number(level) || 0)));

// Tree sizes for each slot at a level. Counts within a level are fixed per zone (seeded).
export function slotSizes(level, zoneId) {
  const roll = seeded(`${zoneId}:count`);
  switch (clampLevel(level)) {
    case 1: return ['small'];
    case 2: return roll < 0.5 ? ['medium', 'medium'] : ['medium', 'medium', 'small'];
    case 3: {
      const extra = 4 + Math.floor(roll * 3); // 4–6 companions
      return ['large', ...Array.from({ length: extra }, (_, i) => (i < 3 ? 'medium' : 'small'))];
    }
    default: return [];
  }
}

const metresToDegrees = (dx, dy, lat) => [dx / (111320 * Math.cos(lat * Math.PI / 180)), dy / 111320];

/**
 * Geographic position of slot `index` in a district. Slot positions never depend on
 * the level, so a level-up only resizes existing trees and adds new slots.
 * district: { id, latitude, longitude, hit } (hit = polygons from hitPolygons()).
 */
export function slotPosition(district, index, spacing = SLOT_SPACING_M) {
  const centre = { lng: district.longitude, lat: district.latitude };
  if (index === 0) return centre;
  const rng = random(`${district.id}:slot:${index}`);
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    // Golden-angle spiral with jitter; later attempts pull inwards.
    const shrink = 1 - attempt / (MAX_TRIES + 2);
    const radius = spacing * Math.sqrt(index) * (0.8 + rng() * 0.4) * shrink;
    const angle = index * 2.39996 + (rng() - 0.5) * 0.9;
    // Trees spread wider than tall so the forest reads as a ground cluster.
    const [dLng, dLat] = metresToDegrees(Math.cos(angle) * radius * 1.3, Math.sin(angle) * radius * 0.8, centre.lat);
    const point = { lng: centre.lng + dLng, lat: centre.lat + dLat };
    if (!district.hit || insideCity({ x: point.lng, y: point.lat }, district.hit)) return point;
  }
  return centre; // the zone centre is guaranteed inside its own district
}

/** All trees for a district: [{ key, slot, size, lng, lat }], back-to-front (north first). */
export function layoutTrees(district, level, spacing = SLOT_SPACING_M) {
  return slotSizes(level, district.id)
    .map((size, slot) => ({ key: `${district.id}:${slot}`, slot, size, ...slotPosition(district, slot, spacing) }))
    .sort((a, b) => b.lat - a.lat);
}

/** Decorative fallen leaves around a level-3 forest: [{ key, lng, lat, variant, rotate }]. */
export function layoutLeaves(district, level, spacing = SLOT_SPACING_M) {
  if (clampLevel(level) < 3) return [];
  const rng = random(`${district.id}:leaves`);
  const count = 3 + Math.floor(rng() * 3);
  const leaves = [];
  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const base = spacing * (0.7 + rng() * 1.1); // scattered within and just around the forest
    const rotate = Math.round(rng() * 360);
    // Pull inwards until the leaf is inside the district; drop it if it never is.
    for (const pull of [1, 0.75, 0.5, 0.3]) {
      const radius = base * pull;
      const [dLng, dLat] = metresToDegrees(Math.cos(angle) * radius * 1.3, Math.sin(angle) * radius * 0.7, district.latitude);
      const point = { lng: district.longitude + dLng, lat: district.latitude + dLat };
      if (!district.hit || insideCity({ x: point.lng, y: point.lat }, district.hit)) {
        leaves.push({ key: `${district.id}:leaf:${i}`, ...point, variant: i, rotate });
        break;
      }
    }
  }
  return leaves;
}

/** Pixel width of a tree at a zoom: grows gently with zoom, 80% on narrow maps. */
export function treeWidth(size, zoom, compact = false) {
  const factor = Math.max(0.75, Math.min(2.4, 2 ** ((zoom - 11) * 0.5)));
  return Math.round(TREE_WIDTH[size] * factor * (compact ? 0.8 : 1));
}

/**
 * What changed between two refreshes, for the growth animation.
 * prev/next: Map(key → size). grown = same slot, bigger size.
 */
const RANK = { small: 1, medium: 2, large: 3 };
export function treeGrowthDiff(prev, next) {
  const added = [], grown = [], shrunk = [], removed = [];
  for (const [key, size] of next) {
    if (!prev.has(key)) added.push(key);
    else if (RANK[size] > RANK[prev.get(key)]) grown.push(key);
    else if (RANK[size] < RANK[prev.get(key)]) shrunk.push(key);
  }
  for (const key of prev.keys()) if (!next.has(key)) removed.push(key);
  return { added, grown, shrunk, removed };
}
