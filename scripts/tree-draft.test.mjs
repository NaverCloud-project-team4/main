import test from 'node:test';
import assert from 'node:assert/strict';
import { draftReducer, initDraft, isDirty, itemAction, replayGrowthFrom, savePayload, sceneSlots, sortItems, speciesAction, targetSlot, unlockHint } from '../frontend/src/lib/treeDraft.js';

// Shapes copied from GET /api/me/tree and GET /api/items.
const tree = {
  species: 'maple', balance: 100,
  growth: { earned: 220, stage: 'young', thresholds: { sprout: 0, sapling: 60, young: 200, grown: 500 } },
  slots: [
    { slot: 'background', unlocked: true, unlock_stage: 'sprout', item_id: 'bg-hanji' },
    { slot: 'ground', unlocked: true, unlock_stage: 'sprout', item_id: 'snowman' },
    { slot: 'branch-1', unlocked: true, unlock_stage: 'sapling', item_id: 'fairy-lights' },
    { slot: 'branch-2', unlocked: true, unlock_stage: 'sapling', item_id: null },
    { slot: 'branch-3', unlocked: true, unlock_stage: 'young', item_id: null },
    { slot: 'branch-4', unlocked: true, unlock_stage: 'young', item_id: null },
    { slot: 'topper', unlocked: false, unlock_stage: 'grown', item_id: null },
  ],
};
const item = (id, group, extra = {}) => ({ id, group, price: 40, owned: true, tags: ['maple', 'ginkgo', 'cherry', 'xmas'], ...extra });
const items = {
  'fairy-lights': item('fairy-lights', 'branch'),
  snowman: item('snowman', 'ground', { tags: ['xmas'] }),
  'bg-hanji': item('bg-hanji', 'background', { price: 0 }),
  bench: item('bench', 'ground', { owned: false, price: 60 }),
  star: item('star', 'topper', { owned: false, price: 60 }),
  'maple-mobile': item('maple-mobile', 'branch', { tags: ['maple'] }),
};
const run = (...actions) => actions.reduce(draftReducer, initDraft(tree));

test('a fresh draft is clean; changes are diffed against the last save', () => {
  const s = initDraft(tree);
  assert.equal(isDirty(s), false);
  assert.deepEqual(savePayload(s), { slots: {} });
  const changed = run({ type: 'equip', slot: 'branch-2', itemId: 'fairy-lights' }, { type: 'unequip', slot: 'branch-1' }, { type: 'species', species: 'cherry' });
  assert.ok(isDirty(changed));
  assert.deepEqual(savePayload(changed), { species: 'cherry', slots: { 'branch-2': 'fairy-lights', 'branch-1': null } });
  assert.equal(isDirty(draftReducer(changed, { type: 'reset' })), false);
});

test('switching species keeps decorations but hides ones that do not fit', () => {
  const s = run({ type: 'species', species: 'xmas' });
  const ground = sceneSlots(s, items).find(x => x.slot === 'ground');
  assert.deepEqual(ground, { slot: 'ground', item_id: 'snowman', unlocked: true, visible: true });
  const maple = sceneSlots(initDraft(tree), items).find(x => x.slot === 'ground');
  assert.equal(maple.visible, false, 'snowman is xmas-only: kept but hidden on a maple');
  assert.equal(maple.item_id, 'snowman');
  assert.deepEqual(savePayload(run({ type: 'species', species: 'ginkgo' })), { species: 'ginkgo', slots: {} }, 'hidden items are not re-sent');
});

test('tapping a slot opens its tab and becomes the target; otherwise the first empty open slot', () => {
  const s = run({ type: 'select', slot: 'branch-3' });
  assert.equal(s.tab, 'branch');
  assert.equal(targetSlot(s, 'branch'), 'branch-3');
  assert.equal(targetSlot(initDraft(tree), 'branch'), 'branch-2', 'branch-1 is taken');
  assert.equal(targetSlot(initDraft(tree), 'topper'), null, 'topper is locked');
  assert.equal(draftReducer(s, { type: 'tab', tab: 'ground' }).selectedSlot, null);
});

test('item buttons follow ownership, balance, fit, lock and duplicates on branches', () => {
  const s = initDraft(tree);
  assert.deepEqual(itemAction(s, items.bench, 100), { kind: 'buy', slot: 'ground', label: '60P 구매' });
  assert.equal(itemAction(s, items.bench, 10).kind, 'poor');
  assert.equal(itemAction(s, items.star, 1000).kind, 'locked');
  assert.match(itemAction(s, items.star, 1000).label, /큰나무/);
  assert.equal(itemAction(s, items.snowman, 100).kind, 'unfit');
  // the same lights already hang on branch 1 but can go on branch 2 as well
  assert.deepEqual(itemAction(s, items['fairy-lights'], 0), { kind: 'equip', slot: 'branch-2', label: '가지 2에 달기' });
  assert.equal(itemAction(run({ type: 'select', slot: 'branch-1' }), items['fairy-lights'], 0).kind, 'unequip');
  assert.equal(itemAction(run({ type: 'species', species: 'ginkgo' }), items['maple-mobile'], 0).kind, 'unfit');
});

test('locked slots explain how many points are still needed', () => {
  assert.deepEqual(unlockHint(initDraft(tree), 'topper'), { stage: 'grown', label: '큰나무', subject: '큰나무가', remaining: 280 });
  assert.equal(itemAction(initDraft(tree), items.star, 1000).label, '큰나무가 되면 열려요');
  assert.equal(unlockHint(initDraft(tree), 'branch-1'), null);
});

test('species cards: current, choose, unlock or not enough points', () => {
  const s = initDraft(tree);
  assert.equal(speciesAction(s, { species: 'maple', owned: true, price: 0 }, 0).kind, 'current');
  assert.equal(speciesAction(s, { species: 'ginkgo', owned: true, price: 0 }, 0).kind, 'choose');
  assert.deepEqual(speciesAction(s, { species: 'cherry', owned: false, price: 120 }, 200), { kind: 'buy', label: '120P 해금' });
  assert.equal(speciesAction(s, { species: 'xmas', owned: false, price: 180 }, 100).kind, 'poor');
});

test('a purchase refreshes balance without throwing away unsaved changes', () => {
  const s = run({ type: 'equip', slot: 'branch-2', itemId: 'fairy-lights' });
  const after = draftReducer(s, { type: 'server', tree: { ...tree, balance: 40 } });
  assert.equal(after.tree.balance, 40);
  assert.deepEqual(savePayload(after), { slots: { 'branch-2': 'fairy-lights' } });
});

test('reloading after a save keeps the open tab and picked slot', () => {
  const s = run({ type: 'select', slot: 'branch-4' }, { type: 'equip', slot: 'branch-4', itemId: 'fairy-lights' });
  const saved = { ...tree, slots: tree.slots.map(x => (x.slot === 'branch-4' ? { ...x, item_id: 'fairy-lights' } : x)) };
  const after = draftReducer(s, { type: 'load', tree: saved });
  assert.equal(isDirty(after), false);
  assert.equal(after.tab, 'branch');
  assert.equal(after.selectedSlot, 'branch-4');
});

test('item lists show what fits this tree first, then owned, then cheapest', () => {
  const list = [items.snowman, items.bench, items['maple-mobile'], items['fairy-lights'], items.star];
  assert.deepEqual(sortItems(list, 'maple').map(i => i.id), ['fairy-lights', 'maple-mobile', 'bench', 'star', 'snowman']);
});

test('growth is replayed only when the tree grew since the last visit', () => {
  assert.equal(replayGrowthFrom('sapling', 'young'), 'sapling');
  assert.equal(replayGrowthFrom('sprout', 'grown'), 'sprout');
  assert.equal(replayGrowthFrom('young', 'young'), null);
  assert.equal(replayGrowthFrom(null, 'young'), null, 'first visit: nothing to replay');
  assert.equal(replayGrowthFrom('garbage', 'young'), null);
});
