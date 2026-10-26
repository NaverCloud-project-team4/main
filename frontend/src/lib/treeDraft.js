// "나만의 나무" decorate screen: an unsaved draft on top of GET /api/me/tree.
// Pure (no DOM, no fetch) so node --test covers the rules; TreePage only wires it to the API.

export const SPECIES = Object.freeze(['maple', 'ginkgo', 'cherry', 'xmas']);
export const SPECIES_LABEL = Object.freeze({ maple: '단풍나무', ginkgo: '은행나무', cherry: '벚나무', xmas: '크리스마스 트리' });
export const SPECIES_SHORT = Object.freeze({ maple: '단풍', ginkgo: '은행', cherry: '벚꽃', xmas: '크리스마스' });
export const SPECIES_ITEM = Object.freeze({ maple: 'tree-maple', ginkgo: 'tree-ginkgo', cherry: 'tree-cherry', xmas: 'tree-xmas' });
export const STAGE_LABEL = Object.freeze({ sprout: '새싹', sapling: '묘목', young: '어린나무', grown: '큰나무' });
// With the subject particle (새싹이 / 어린나무가) for "…가 되면 열려요".
export const STAGE_SUBJECT = Object.freeze({ sprout: '새싹이', sapling: '묘목이', young: '어린나무가', grown: '큰나무가' });
// "…으로 자랐어요" for the growth announcement.
export const STAGE_BECAME = Object.freeze({ sprout: '새싹으로', sapling: '묘목으로', young: '어린나무로', grown: '큰나무로' });
const STAGE_KEYS = Object.keys(STAGE_LABEL);

/** Stage to replay growth from: the last stage this person saw, if the tree has grown since (else null). */
export function replayGrowthFrom(lastSeen, current) {
  const from = STAGE_KEYS.indexOf(lastSeen), to = STAGE_KEYS.indexOf(current);
  return from >= 0 && to > from ? lastSeen : null;
}
export const SLOT_UNLOCK = Object.freeze({ background: 'sprout', ground: 'sprout', 'branch-1': 'sapling', 'branch-2': 'sapling', 'branch-3': 'young', 'branch-4': 'young', topper: 'grown' });
export const GROUPS = Object.freeze(['topper', 'branch', 'ground', 'background']);
export const GROUP_LABEL = Object.freeze({ topper: '꼭대기', branch: '가지', ground: '바닥', background: '배경' });
export const SLOT_LABEL = Object.freeze({
  topper: '꼭대기', 'branch-1': '가지 1', 'branch-2': '가지 2', 'branch-3': '가지 3', 'branch-4': '가지 4', ground: '바닥', background: '배경',
});
export const groupOfSlot = slot => (slot.startsWith('branch') ? 'branch' : slot);

const slotMap = tree => Object.fromEntries(tree.slots.map(s => [s.slot, s.item_id ?? null]));

export function initDraft(tree) {
  const saved = { species: tree.species, slots: slotMap(tree) };
  return { tree, saved, draft: { species: saved.species, slots: { ...saved.slots } }, selectedSlot: null, tab: 'branch' };
}

export function draftReducer(state, action) {
  switch (action.type) {
    case 'load': // fresh server state (first load, after saving): the draft starts over from it
      return { ...initDraft(action.tree), selectedSlot: state?.selectedSlot ?? null, tab: state?.tab ?? 'branch' };
    case 'server': // new balance/growth after a purchase; the unsaved draft is kept
      return { ...state, tree: action.tree };
    case 'species':
      return { ...state, draft: { ...state.draft, species: action.species } };
    case 'select': // tapping a slot pin opens its group's tab
      return { ...state, selectedSlot: action.slot, tab: groupOfSlot(action.slot) };
    case 'tab':
      return { ...state, tab: action.tab, selectedSlot: state.selectedSlot && groupOfSlot(state.selectedSlot) === action.tab ? state.selectedSlot : null };
    case 'equip':
      return { ...state, draft: { ...state.draft, slots: { ...state.draft.slots, [action.slot]: action.itemId } }, selectedSlot: action.slot };
    case 'unequip':
      return { ...state, draft: { ...state.draft, slots: { ...state.draft.slots, [action.slot]: null } } };
    case 'reset':
      return { ...state, draft: { species: state.saved.species, slots: { ...state.saved.slots } } };
    default:
      return state;
  }
}

export const slotInfo = (state, slot) => state.tree.slots.find(s => s.slot === slot);
export const fits = (item, species) => !item || item.group === 'species' || !item.tags?.length || item.tags.includes(species);

/** Changes since the last save, in the PUT /api/me/tree shape (only what changed is sent). */
export function savePayload(state) {
  const payload = { slots: {} };
  if (state.draft.species !== state.saved.species) payload.species = state.draft.species;
  for (const [slot, itemId] of Object.entries(state.draft.slots)) {
    if (itemId !== state.saved.slots[slot]) payload.slots[slot] = itemId;
  }
  return payload;
}
export const isDirty = state => Object.keys(savePayload(state).slots).length > 0 || 'species' in savePayload(state);

/** Slots for <LayeredTree>: the draft's items, hidden when they don't fit the chosen species (kept, not removed). */
export function sceneSlots(state, itemsById) {
  return state.tree.slots.map(s => {
    const itemId = state.draft.slots[s.slot];
    return { slot: s.slot, item_id: itemId, unlocked: s.unlocked, visible: !!itemId && fits(itemsById[itemId], state.draft.species) };
  });
}

/** Where an item from this group would go: the picked slot, else the first open empty one, else the first open one. */
export function targetSlot(state, group) {
  const open = state.tree.slots.filter(s => s.unlocked && groupOfSlot(s.slot) === group).map(s => s.slot);
  if (!open.length) return null;
  if (state.selectedSlot && open.includes(state.selectedSlot)) return state.selectedSlot;
  return open.find(slot => !state.draft.slots[slot]) || open[0];
}

/** Points still needed before a locked slot opens (growth is by points earned, never by balance). */
export function unlockHint(state, slot) {
  const info = slotInfo(state, slot);
  if (!info || info.unlocked) return null;
  const { earned, thresholds } = state.tree.growth;
  return { stage: info.unlock_stage, label: STAGE_LABEL[info.unlock_stage], subject: STAGE_SUBJECT[info.unlock_stage], remaining: Math.max(0, thresholds[info.unlock_stage] - earned) };
}

/**
 * What the button on an item card does right now.
 * kind: 'unfit' | 'locked' | 'buy' | 'poor' | 'equip' | 'unequip'
 */
export function itemAction(state, item, balance) {
  if (!fits(item, state.draft.species)) return { kind: 'unfit', label: '이 나무엔 안 어울려요' };
  const slot = targetSlot(state, item.group);
  if (!slot) {
    const locked = state.tree.slots.find(s => groupOfSlot(s.slot) === item.group);
    const hint = locked && unlockHint(state, locked.slot);
    return { kind: 'locked', label: hint ? `${hint.subject} 되면 열려요` : '아직 잠겨 있어요' };
  }
  if (!item.owned) return balance >= item.price ? { kind: 'buy', slot, label: `${item.price}P 구매` } : { kind: 'poor', slot, label: `${item.price}P · 포인트 부족` };
  if (state.draft.slots[slot] === item.id) return { kind: 'unequip', slot, label: `${SLOT_LABEL[slot]}에서 빼기` };
  return { kind: 'equip', slot, label: `${SLOT_LABEL[slot]}에 달기` };
}

/** Item list order: what fits this tree first, then what you own, then by price. */
export function sortItems(list, species) {
  return [...list].sort((a, b) => fits(b, species) - fits(a, species) || b.owned - a.owned || a.price - b.price || String(a.name ?? a.id).localeCompare(String(b.name ?? b.id), 'ko'));
}

/** Species card state: chosen, ready to choose, or buyable/unaffordable unlock. */
export function speciesAction(state, item, balance) {
  if (state.draft.species === item.species) return { kind: 'current', label: '지금 나무' };
  if (item.owned) return { kind: 'choose', label: '이 나무로' };
  return balance >= item.price ? { kind: 'buy', label: `${item.price}P 해금` } : { kind: 'poor', label: `${item.price}P · 포인트 부족` };
}
