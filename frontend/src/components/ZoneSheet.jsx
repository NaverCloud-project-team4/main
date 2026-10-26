import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { stages } from '../lib/reportLabels';
import { STAGE_WASH } from '../lib/watercolorPalette';
import Icon from './Icon';
import ReportCard from './ReportCard';

// Watercolor theme's district sheet: extends the classic .zone-detail summary with
// [대표 명소] (forecast spots) and [사용자 게시물] (the approved feed for this district).
const KIND = { MOUNTAIN: '단풍 명소', GINKGO: '은행나무길' };
const PAGE_SIZE = 6;
const POPULAR_MIN = 3; // recent reports near a spot before it is called popular
const dayText = iso => new Date(`${iso}T00:00:00`).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
const spotCache = new Map();

function StageBadge({ stage }) {
  const wash = STAGE_WASH[stage] || STAGE_WASH.UNKNOWN;
  return <span className="wc-stage-badge"><i style={{ background: `radial-gradient(circle, ${wash.inner} 35%, ${wash.edge})` }} aria-hidden="true"/>{stages[stage] || stages.UNKNOWN}</span>;
}

function SpotList({ zoneId, onFocus }) {
  const [spots, setSpots] = useState(() => spotCache.get(zoneId) || null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setError('');
    setSpots(spotCache.get(zoneId) || null);
    if (!spotCache.has(zoneId)) {
      api(`/api/forecast-spots?zone_id=${encodeURIComponent(zoneId)}`)
        .then(list => { spotCache.set(zoneId, list); if (live) setSpots(list); })
        .catch(e => live && setError(e.message));
    }
    return () => { live = false; };
  }, [zoneId]);
  if (error) return <p className="wc-sheet-empty" role="alert">명소를 불러오지 못했어요. {error}</p>;
  if (!spots) return <p className="wc-sheet-empty" role="status">명소를 불러오고 있어요.</p>;
  if (!spots.length) return <p className="wc-sheet-empty">이 구에는 등록된 대표 명소가 아직 없어요.</p>;
  // Spots with the most recent reports nearby come first; the top one gets "요즘 인기".
  const ranked = [...spots].sort((a, b) => (b.recent_reports ?? 0) - (a.recent_reports ?? 0));
  return <ul className="wc-spot-list">{ranked.map((spot, i) => <li key={spot.id}>
    <button type="button" className="wc-spot" onClick={() => onFocus(spot)} aria-label={`${spot.name} 지도에서 보기`}>
      <span className="wc-spot-name">{spot.name}{i === 0 && spot.recent_reports >= POPULAR_MIN ? <em className="wc-spot-hot">요즘 인기</em> : null}</span>
      <span className="wc-spot-meta"><span className="wc-spot-kind">{KIND[spot.kind] || spot.kind}</span><StageBadge stage={spot.stage}/></span>
      <span className="wc-spot-peak">예상 절정 <b>{dayText(spot.peak_date)}</b>{spot.recent_reports ? <> · 최근 제보 <b>{spot.recent_reports}</b>건</> : null}</span>
      <small className="wc-spot-source">예측: {spot.source}</small>
      <span className="wc-spot-go" aria-hidden="true"><Icon name="pin" size={16}/></span>
    </button>
  </li>)}</ul>;
}

function PostList({ zoneId, token, like }) {
  const [state, setState] = useState({ items: [], total: 0, pages: 0, hasMore: false, loading: true, error: '' });
  const load = async (pages, live = () => true) => {
    setState(s => ({ ...s, loading: true, error: '' }));
    try {
      // Reload every loaded page in one request so likes and new approvals stay in sync.
      const data = await api(`/api/reports?zone_id=${encodeURIComponent(zoneId)}&sort=recent&page=1&page_size=${Math.min(50, pages * PAGE_SIZE)}`, { token });
      if (live()) setState({ items: data.items, total: data.total, pages, hasMore: data.has_more, loading: false, error: '' });
    } catch (e) {
      if (live()) setState(s => ({ ...s, loading: false, error: e.message }));
    }
  };
  useEffect(() => {
    let alive = true;
    load(1, () => alive);
    return () => { alive = false; };
  }, [zoneId, token]);
  const likeAndRefresh = async report => { await like(report); await load(Math.max(1, state.pages)); };
  if (state.error) return <p className="wc-sheet-empty" role="alert">게시물을 불러오지 못했어요. {state.error}</p>;
  if (!state.items.length) return <p className="wc-sheet-empty" role="status">{state.loading ? '게시물을 불러오고 있어요.' : '아직 이 구의 승인된 게시물이 없어요. 첫 사진을 남겨보세요.'}</p>;
  return <>
    <p className="wc-sheet-count">승인된 게시물 {state.total}개</p>
    <div className="wc-post-grid">{state.items.map(r => <ReportCard key={r.id} report={r} like={likeAndRefresh}/>)}</div>
    {state.hasMore && state.pages * PAGE_SIZE < 50 && <button type="button" className="button secondary wc-more" disabled={state.loading} onClick={() => load(state.pages + 1)}>{state.loading ? '불러오는 중…' : '더 보기'}</button>}
  </>;
}

export default function ZoneSheet({ zone, sheet, dispatch, token, like, onReport, onSpotFocus }) {
  const ref = useRef(null);
  const drag = useRef(null);
  const justDragged = useRef(false); // swallow the click that ends a handle drag
  const [dragging, setDragging] = useState(false);
  const open = sheet.mode !== 'closed' && !!zone;

  useEffect(() => {
    if (!open) return;
    const onKey = event => { if (event.key === 'Escape') dispatch({ type: 'close' }); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dispatch]);

  // Drag the header: the sheet follows the pointer, then snaps by distance or fling speed.
  const onPointerDown = event => {
    if (event.button !== 0 || event.target.closest('button:not(.wc-sheet-handle)')) return;
    drag.current = { y: event.clientY, t: performance.now(), lastY: event.clientY, lastT: performance.now(), moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = event => {
    const d = drag.current;
    if (!d) return;
    const dy = event.clientY - d.y;
    if (!d.moved && Math.abs(dy) < 4) return;
    d.moved = true;
    setDragging(true);
    d.velocity = (event.clientY - d.lastY) / Math.max(1, performance.now() - d.lastT);
    d.lastY = event.clientY;
    d.lastT = performance.now();
    ref.current.style.setProperty('--wc-drag', `${dy}px`);
  };
  const onPointerUp = event => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    ref.current.style.setProperty('--wc-drag', '0px');
    setDragging(false);
    justDragged.current = d.moved;
    if (d.moved) dispatch({ type: 'drag', dy: event.clientY - d.y, velocity: d.velocity || 0 });
  };

  const focusSpot = spot => {
    dispatch({ type: 'collapse' }); // show the map again on phones
    onSpotFocus(spot);
  };

  return <section ref={ref} className={`wc-sheet${dragging ? ' dragging' : ''}`} data-mode={open ? sheet.mode : 'closed'}
    aria-label={zone ? `${zone.name} 단풍 소식` : '자치구 단풍 소식'} aria-hidden={!open} inert={!open}>
    <header className="wc-sheet-head" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      <button type="button" className="wc-sheet-handle" aria-label={sheet.mode === 'full' ? '시트 줄이기' : '시트 펼치기'} aria-expanded={sheet.mode === 'full'}
        onClick={() => { if (justDragged.current) justDragged.current = false; else dispatch({ type: 'toggle' }); }}><span aria-hidden="true"/></button>
      <div className="wc-sheet-title">
        <h3>{zone?.name}</h3>
        <p><StageBadge stage={zone?.stage}/>{zone?.source === 'FORECAST' ? <small> · 예측 기반</small> : zone?.source === 'REPORT' ? <small> · 제보 기반</small> : null}</p>
        <p className="wc-sheet-stats">최근 7일 제보 {zone?.report_count || 0}건 · 좋아요 {zone?.like_count || 0}개 · 관심 나무 {zone?.tree_level || 0}단계</p>
      </div>
      <div className="wc-sheet-actions">
        <button type="button" className="button wc-report" onClick={onReport}><Icon name="camera" size={17}/> 사진 제보</button>
        <button type="button" className="wc-sheet-close" aria-label="시트 닫기" onClick={() => dispatch({ type: 'close' })}>×</button>
      </div>
    </header>
    <div className="wc-sheet-tabs" role="tablist" aria-label="구 소식">
      {[['spots', '대표 명소'], ['posts', '사용자 게시물']].map(([id, label]) =>
        <button key={id} type="button" role="tab" id={`wc-tab-${id}`} aria-controls={`wc-pane-${id}`} aria-selected={sheet.tab === id}
          className={sheet.tab === id ? 'active' : ''} onClick={() => dispatch({ type: 'tab', tab: id })}>{label}</button>)}
      <span className="wc-tab-ink" data-tab={sheet.tab} aria-hidden="true"/>
    </div>
    <div className="wc-sheet-body">
      <div className="wc-sheet-panes" data-tab={sheet.tab}>
        <div className="wc-sheet-pane" role="tabpanel" id="wc-pane-spots" aria-labelledby="wc-tab-spots" aria-hidden={sheet.tab !== 'spots'}>
          {zone && open && <SpotList zoneId={zone.id} onFocus={focusSpot}/>}
        </div>
        <div className="wc-sheet-pane" role="tabpanel" id="wc-pane-posts" aria-labelledby="wc-tab-posts" aria-hidden={sheet.tab !== 'posts'}>
          {zone && open && sheet.tab === 'posts' && <PostList zoneId={zone.id} token={token} like={like}/>}
        </div>
      </div>
    </div>
  </section>;
}
