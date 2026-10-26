import React, { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { api } from '../api';
import anchors from '../lib/treeAnchors.json';
import { TREE_ASSETS, TREE_PARTS } from '../lib/treeAssets';
import { loadBrushFont } from '../lib/brushFont';
import {
  draftReducer, fits, GROUP_LABEL, GROUPS, groupOfSlot, isDirty, itemAction, replayGrowthFrom, savePayload, sceneSlots, SLOT_LABEL, STAGE_BECAME,
  SLOT_UNLOCK, sortItems, SPECIES, SPECIES_LABEL, SPECIES_SHORT, speciesAction, STAGE_LABEL, targetSlot, unlockHint,
} from '../lib/treeDraft';
import LayeredTree from './LayeredTree';

const GUEST_TREE = { species: 'maple', balance: 0, growth: { earned: 0, stage: 'sprout', stage_index: 0, next_stage: 'sapling', next_at: 60, remaining: 60, thresholds: { sprout: 0, sapling: 60, young: 200, grown: 500 } },
  slots: Object.entries(SLOT_UNLOCK).map(([slot, stage]) => ({ slot, item_id: null, unlocked: stage === 'sprout', unlock_stage: stage })) };
const thumb = item => (item.group === 'background' ? TREE_ASSETS.background(item.id) : TREE_ASSETS.item(item.id));
const pct = v => `${(v / anchors.canvas * 100).toFixed(2)}%`;
const GROWTH_REPLAY_MS = 700;
// The last stage this person saw, so growth earned elsewhere (on the map) plays when they come back.
const seenKey = userId => `kauroong.treeStage.${userId}`;
const readSeen = userId => { try { return localStorage.getItem(seenKey(userId)); } catch { return null; } };
const writeSeen = (userId, stage) => { try { localStorage.setItem(seenKey(userId), stage); } catch { /* private mode: no replay */ } };

function GrowthPanel({ tree }) {
  const g = tree.growth;
  const from = g.thresholds[g.stage], to = g.next_at ?? from;
  const progress = g.next_stage ? Math.min(1, (g.earned - from) / Math.max(1, to - from)) : 1;
  return <section className="tp-growth" aria-label="성장 단계">
    <div className="tp-points"><small>내 포인트</small><strong>{tree.balance.toLocaleString()}<span>P</span></strong></div>
    <div className="tp-stage">
      <p><b className="tp-brush">{STAGE_LABEL[g.stage]}</b> · 모은 포인트 {g.earned.toLocaleString()}P</p>
      <div className="tp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><i style={{ width: `${progress * 100}%` }}/></div>
      <small>{g.next_stage ? `${STAGE_LABEL[g.next_stage]}까지 ${g.remaining.toLocaleString()}P · 아이템을 사도 나무는 작아지지 않아요` : '다 자란 큰나무예요'}</small>
    </div>
  </section>;
}

function SpeciesPicker({ state, speciesItems, balance, onChoose, onBuy, busy }) {
  return <section className="tp-species" aria-label="나무 종류">
    {SPECIES.map(species => {
      const item = speciesItems[species];
      if (!item) return null;
      const action = speciesAction(state, item, balance);
      return <button key={species} type="button" className={`tp-species-card ${action.kind}`} aria-pressed={action.kind === 'current'} disabled={busy || action.kind === 'poor'}
        onClick={() => (action.kind === 'buy' ? onBuy(item) : action.kind === 'choose' ? onChoose(species) : null)}>
        {/* Grown silhouettes: a sprout is too small to tell the species apart. */}
        <span className="tp-species-thumb" aria-hidden="true">{TREE_PARTS.map(part => <img key={part} src={TREE_ASSETS.layer(species, 'grown', part)} alt=""/>)}</span>
        <b>{SPECIES_LABEL[species]}</b>
        <small>{action.kind === 'buy' || action.kind === 'poor' ? `🔒 ${action.label}` : action.label}</small>
      </button>;
    })}
  </section>;
}

function SlotPins({ state, onSelect }) {
  const tree = anchors.trees[state.draft.species]?.[state.tree.growth.stage];
  if (!tree) return null;
  return state.tree.slots.filter(s => s.slot !== 'background').map(s => {
    const a = tree.slots[s.slot];
    const group = groupOfSlot(s.slot);
    // Pins sit where the item hangs/stands: below a branch's hook, on top of the topper/ground spot.
    const y = group === 'branch' ? a.y + 34 : a.y - 40 * a.scale;
    const hint = s.unlocked ? null : unlockHint(state, s.slot);
    const filled = state.draft.slots[s.slot];
    return <button key={s.slot} type="button" className={`tp-pin${s.unlocked ? '' : ' locked'}${filled ? ' filled' : ''}${state.selectedSlot === s.slot ? ' selected' : ''}`}
      style={{ left: pct(a.x), top: pct(y) }} onClick={() => onSelect(s.slot)}
      aria-label={`${SLOT_LABEL[s.slot]} ${s.unlocked ? (filled ? '바꾸기' : '비어 있음') : `잠김 · ${hint?.label}부터`}`}>
      <span aria-hidden="true">{s.unlocked ? (filled ? '' : '+') : '🔒'}</span>
    </button>;
  });
}

export default function TreePage({ user, token, onLogin, onChanged, notify, setError }) {
  const [items, setItems] = useState([]);
  const [state, dispatch] = useReducer(draftReducer, null);
  const [busy, setBusy] = useState(false);
  const itemsById = useMemo(() => Object.fromEntries(items.map(i => [i.id, i])), [items]);
  const speciesItems = useMemo(() => Object.fromEntries(items.filter(i => i.group === 'species').map(i => [i.species, i])), [items]);
  useEffect(loadBrushFont, []);

  const load = useCallback(async (mode = 'load') => {
    const [list, tree] = await Promise.all([api('/api/items', { token }), token ? api('/api/me/tree', { token }) : GUEST_TREE]);
    setItems(list);
    dispatch({ type: mode, tree });
  }, [token]);
  useEffect(() => { load().catch(e => setError(e.message)); }, [load, setError]);

  // Grew since the last visit? Show the old stage for a moment, then grow into the new one.
  const actualStage = state?.tree.growth.stage;
  const [replayFrom, setReplayFrom] = useState(null);
  useEffect(() => {
    if (!token || !user || !actualStage) return undefined;
    const from = replayGrowthFrom(readSeen(user.id), actualStage);
    writeSeen(user.id, actualStage);
    if (!from) return undefined;
    setReplayFrom(from);
    const timer = setTimeout(() => {
      setReplayFrom(null);
      notify?.(`나무가 ${STAGE_BECAME[actualStage]} 자랐어요!`);
    }, GROWTH_REPLAY_MS);
    return () => clearTimeout(timer);
  }, [token, user?.id, actualStage]);

  const guard = async fn => {
    setBusy(true);
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const buy = (item, then) => guard(async () => {
    if (!token) return onLogin();
    await api(`/api/me/items/${item.id}`, { token, method: 'PUT' });
    await load('server'); // new balance, draft kept
    then?.();
    onChanged?.();
    notify?.(`${item.name}을(를) 샀어요.`);
  });
  const save = () => guard(async () => {
    const tree = await api('/api/me/tree', { token, method: 'PUT', body: savePayload(state) });
    dispatch({ type: 'load', tree });
    notify?.('나무를 저장했어요.');
  });

  if (!state) return <div className="tp-page tp-loading" role="status">나무를 불러오고 있어요.</div>;
  const balance = state.tree.balance;
  const stage = replayFrom || state.tree.growth.stage;
  const background = itemsById[state.draft.slots.background];
  const effect = background && fits(background, state.draft.species) ? background.effect : null;
  const dirty = token && isDirty(state);
  const group = state.tab;
  const target = targetSlot(state, group);
  const groupItems = sortItems(items.filter(i => i.group === group), state.draft.species);

  return <div className="tp-page">
    <div className="tp-tree-col">
      <LayeredTree species={state.draft.species} stage={stage} slots={sceneSlots(state, itemsById)} effect={effect} label={`${SPECIES_LABEL[state.draft.species]} ${STAGE_LABEL[stage]}`}>
        {token && <SlotPins state={state} onSelect={slot => dispatch({ type: 'select', slot })}/>}
      </LayeredTree>
      {!token && <div className="tp-guest"><p>로그인하면 제보로 모은 포인트로 나만의 나무를 키우고 꾸밀 수 있어요.</p><button type="button" className="button" onClick={onLogin}>로그인하고 시작하기</button></div>}
    </div>
    <div className="tp-controls">
      <h2 className="tp-title">{user ? `${user.nickname}님의 나무` : '나만의 나무'}</h2>
      <GrowthPanel tree={state.tree}/>
      <SpeciesPicker state={state} speciesItems={speciesItems} balance={balance} busy={busy || !token}
        onChoose={species => dispatch({ type: 'species', species })}
        onBuy={item => buy(item, () => dispatch({ type: 'species', species: item.species }))}/>
      <section className="tp-shop" aria-label="아이템">
        <div className="tp-tabs" role="tablist">
          {GROUPS.map(g => <button key={g} type="button" role="tab" aria-selected={group === g} className={group === g ? 'active' : ''} onClick={() => dispatch({ type: 'tab', tab: g })}>{GROUP_LABEL[g]}</button>)}
        </div>
        <p className="tp-target">{target
          ? <>달 자리: <b>{SLOT_LABEL[target]}</b>{group === 'branch' && <small> · 나무의 + 표시를 눌러 다른 가지를 고를 수 있어요</small>}</>
          : (() => { const hint = unlockHint(state, state.tree.slots.find(s => groupOfSlot(s.slot) === group)?.slot); return hint ? `${hint.subject} 되면 열려요 · 앞으로 ${hint.remaining.toLocaleString()}P` : '아직 열린 자리가 없어요'; })()}</p>
        <ul className="tp-items">
          {groupItems.map(item => {
            const action = itemAction(state, item, balance);
            const run = () => {
              if (!token) return onLogin();
              if (action.kind === 'buy') return buy(item, () => dispatch({ type: 'equip', slot: action.slot, itemId: item.id }));
              if (action.kind === 'equip') return dispatch({ type: 'equip', slot: action.slot, itemId: item.id });
              if (action.kind === 'unequip') return dispatch({ type: 'unequip', slot: action.slot });
              return null;
            };
            const disabled = busy || ['unfit', 'locked', 'poor'].includes(action.kind);
            return <li key={item.id} className={`tp-item ${action.kind}`}>
              <img src={thumb(item)} alt="" loading="lazy"/>
              <div><b>{item.name}</b><small>{item.owned ? (item.price ? '보유 중' : '기본') : `${item.price}P`}{item.tags.length < SPECIES.length ? ` · ${item.tags.map(t => SPECIES_SHORT[t]).join('·')} 전용` : ''}{item.effect ? ' · 움직이는 효과' : ''}</small></div>
              <button type="button" className="button secondary" disabled={disabled} onClick={run}>{action.label}</button>
            </li>;
          })}
        </ul>
      </section>
      {token && <div className={`tp-savebar${dirty ? ' dirty' : ''}`}>
        <span>{dirty ? '저장하지 않은 변경이 있어요' : '저장된 모습이에요'}</span>
        <button type="button" className="text-button" disabled={!dirty || busy} onClick={() => dispatch({ type: 'reset' })}>되돌리기</button>
        <button type="button" className="button" disabled={!dirty || busy} onClick={save}>{busy ? '저장 중…' : '저장'}</button>
      </div>}
    </div>
  </div>;
}
