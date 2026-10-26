// Every image path of the "나만의 나무" page. Overwrite a file under public/tree-assets/
// with final art of the same name, size and anchor (see public/tree-assets/README.md).
const BASE = '/tree-assets';

export const TREE_PARTS = Object.freeze(['back', 'trunk', 'front']);
export const DEFAULT_BACKGROUND = 'bg-hanji';

export const TREE_ASSETS = Object.freeze({
  layer: (species, stage, part) => `${BASE}/trees/${species}-${stage}-${part}.webp`,
  item: id => `${BASE}/items/${id}.webp`,
  background: id => `${BASE}/bg/${id}.webp`,
  shadow: `${BASE}/shadow.webp`,
  fx: name => `${BASE}/fx/${name}.webp`,
});
