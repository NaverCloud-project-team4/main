import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, API_BASE } from './api';
import NaverZoneMap from './components/NaverZoneMap';
import Icon from './components/Icon';
import './style.css';

const stages = { UNKNOWN: '제보 기다리는 중', GREEN: '물들기 전', STARTING: '물드는 중', PEAK: '절정', FALLEN: '낙엽' };
const speciesNames = { MAPLE: '단풍', GINKGO: '은행', MIXED: '혼합' };
const statuses = { PENDING_UPLOAD: '사진 저장 중', PENDING_AI: '사진 확인 중', APPROVED: '승인됨', REVIEW: '운영자 검토', REJECTED: '반려됨', UPLOAD_FAILED: '업로드 실패' };
const pending = status => ['PENDING_UPLOAD', 'PENDING_AI'].includes(status);
const dateText = x => new Date(x).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem('access_token') || '');
  const [user, setUser] = useState(null), [config, setConfig] = useState(null), [health, setHealth] = useState(false);
  const [zones, setZones] = useState([]), [selected, setSelected] = useState('kyunghee');
  const [feed, setFeed] = useState({ items: [], total: 0 }), [mine, setMine] = useState([]), [items, setItems] = useState([]), [reviews, setReviews] = useState([]);
  const [tab, setTab] = useState('map'), [sort, setSort] = useState('recent'), [filter, setFilter] = useState(''), [page, setPage] = useState(1);
  const [authOpen, setAuthOpen] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [active, setActive] = useState(null), [busy, setBusy] = useState(false), [logs, setLogs] = useState([]);
  const zone = zones.find(z => z.id === selected);
  const notify = text => { setNotice(text); setTimeout(() => setNotice(''), 6000); };
  const run = async fn => { setError(''); try { return await fn(); } catch (e) { setError(e.message); return null; } };
  const refresh = useCallback(async () => {
    const [z, f, it] = await Promise.all([
      api('/api/zones'), api(`/api/reports?sort=${sort}&page=${page}${filter ? `&zone_id=${filter}` : ''}`, { token }), api('/api/items', { token })
    ]);
    setZones(z); setFeed(f); setItems(it);
    if (token) {
      try {
        const [u, own] = await Promise.all([api('/api/me', { token }), api('/api/me/reports', { token })]);
        setUser(u); setMine(own.items);
        if (u.role === 'admin') setReviews((await api('/api/admin/reports', { token })).items);
      } catch (e) { if (e.status === 401) { sessionStorage.removeItem('access_token'); setToken(''); setUser(null); } throw e; }
    } else { setUser(null); setMine([]); setReviews([]); }
  }, [token, sort, page, filter]);

  useEffect(() => {
    const listener = event => setLogs(previous => [event.detail, ...previous].slice(0, 35));
    window.addEventListener('api-request', listener);
    api('/health/ready').then(() => setHealth(true)).catch(() => setHealth(false));
    api('/api/config').then(setConfig).catch(e => setError(`백엔드 연결 실패: ${e.message}`));
    return () => window.removeEventListener('api-request', listener);
  }, []);
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [tab]);
  useEffect(() => { refresh().catch(e => { if (e.status === 401) { sessionStorage.removeItem('access_token'); setToken(''); setActive(null); } setError(e.message); }); }, [refresh]);
  useEffect(() => {
    if (!active || !pending(active.status) || !token) return;
    let stopped = false;
    const interval = setInterval(async () => {
      try {
        const result = await api(`/api/reports/${active.id}/status`, { token });
        if (stopped) return;
        setActive(previous => ({ ...previous, ...result }));
        if (!pending(result.status)) { clearInterval(interval); refresh().catch(e => setError(e.message)); }
      } catch (e) { if (!stopped) setError(e.message); }
    }, 1200);
    return () => { stopped = true; clearInterval(interval); };
  }, [active?.id, active?.status, token, refresh]);
  // Resume observing a persisted pending report after a browser refresh.
  useEffect(() => { if (!active) { const unfinished = mine.find(r => pending(r.status)); if (unfinished) setActive(unfinished); } }, [mine, active]);

  const authenticated = data => { sessionStorage.setItem('access_token', data.access_token); setToken(data.access_token); setUser(data.user); setAuthOpen(false); notify(`${data.user.nickname}님, 로그인했어요.`); };
  const demoLogin = async admin => run(async () => authenticated(await api('/api/auth/login', { method: 'POST', body: {
    email: admin ? 'admin@example.com' : 'demo@example.com', password: admin ? 'AdminPass123!' : 'DemoPass123!'
  } })));
  const like = report => run(async () => {
    if (!token) return setAuthOpen(true);
    await api(`/api/reports/${report.id}/like`, { token, method: report.liked ? 'DELETE' : 'PUT' });
    await refresh();
  });
  const submit = async form => {
    setBusy(true);
    await run(async () => {
      const result = await api('/api/reports', { token, method: 'POST', body: form, headers: { 'Idempotency-Key': crypto.randomUUID() } });
      setActive(result); notify('제보를 접수했어요. 검증 결과를 확인하고 있어요.'); await refresh();
    });
    setBusy(false);
  };
  const purchase = item => run(async () => {
    if (!token) return setAuthOpen(true);
    if (!item.owned) await api(`/api/me/items/${item.id}`, { token, method: 'PUT' });
    await api(`/api/me/tree/equipment/${item.slot}`, { token, method: 'PUT', body: { item_id: item.id } });
    await refresh(); notify(`${item.name}을 적용했어요.`);
  });
  const decide = (report, decision) => run(async () => {
    await api(`/api/admin/reports/${report.id}/decision`, { token, method: 'POST', body: { decision, reason: decision === 'APPROVED' ? '운영자가 사진을 확인하고 승인했습니다.' : '운영자 검토 후 대상 사진이 아니어서 반려했습니다.' } });
    await refresh(); notify('검토 결과를 저장했어요.');
  });

  return <div className="app-shell">
    <header className="header"><a className="brand" href="#" onClick={e => { e.preventDefault(); setTab('map'); }}><span className="brand-icon"><Icon name="leaf" size={28}/></span><span>까우룽까우룽</span></a>
      <div className="header-right">{config?.demo_enabled && <span className="test-badge" title="로컬 테스트 환경 · 사진 검증은 데모 시나리오로 실행돼요.">테스트</span>}
        {user ? <><button className="header-points" onClick={() => setTab('tree')}>{user.points.toLocaleString()}<span>P</span></button><button className="text-button" onClick={() => { sessionStorage.removeItem('access_token'); setToken(''); setUser(null); setActive(null); setTab('map'); }}>로그아웃</button></> : <button className="button small" onClick={() => setAuthOpen(true)}>로그인</button>}
      </div></header>
    <div className="workspace"><aside className="sidebar">
      {user && <button className={`profile-trigger ${tab === 'profile' ? 'active' : ''}`} aria-label={`내 프로필 · ${user.nickname}`} aria-current={tab === 'profile' ? 'page' : undefined} onClick={() => setTab('profile')}>
        <span className="profile-avatar" aria-hidden="true">{user.nickname.slice(0, 1)}</span>
        <span className="profile-copy user-label"><strong>{user.nickname}</strong><small>내 제보 보기 · <b>{user.points}P</b></small></span><span className="profile-arrow" aria-hidden="true">›</span>
      </button>}
      <nav aria-label="주 메뉴">{[['map', 'map', '지도'], ['feed', 'feed', '제보 피드'], ['report', 'camera', '사진 제보하기'], ['tree', 'tree', '나만의 나무'], ...(user?.role === 'admin' ? [['review', 'check', '운영자 검토']] : [])].map(([id, icon, label]) => <button key={id} className={tab === id ? 'nav-link selected' : 'nav-link'} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}><Icon name={icon}/><span>{label}</span>{id === 'review' && reviews.length > 0 && <b>{reviews.length}</b>}</button>)}</nav>
      <div className="sidebar-bottom"><span className="season-icon"><Icon name="leaf"/></span><div><strong>함께 기록하는 가을</strong><p>우리 동네의 단풍을 만나보세요</p></div></div></aside>
    <main><section className="page-heading"><div>{tab === 'map' && <p className="location-label"><Icon name="pin" size={15}/> 서울 <span>· 가을 지도</span></p>}<h1>{({ map: '오늘, 어디로 걸을까요?', report: '오늘 만난 가을을 남겨요', feed: '지금 우리 동네는', profile: '나의 가을 기록', tree: '나만의 나무', review: '사진을 확인해주세요' })[tab]}</h1><p className="subtitle">{({ map: '다녀온 사람들의 사진으로 단풍 소식을 확인해요.', report: '사진 한 장으로 단풍 소식을 나눠주세요.', feed: '사람들이 직접 보고 남긴 가을 풍경이에요.', profile: '내가 남긴 사진과 제보 결과를 모아봤어요.', tree: '제보로 모은 포인트로 내 나무를 꾸며보세요.', review: '확인이 필요한 제보를 살펴봐주세요.' })[tab]}</p></div><button className="refresh-button" aria-label="새로고침" title="새로고침" onClick={() => run(refresh)}><Icon name="refresh" size={21}/></button></section>
    {error && <div className="alert error" role="alert">{error}<button aria-label="오류 닫기" onClick={() => setError('')}>×</button></div>}
    {notice && <div className="alert success" role="status">{notice}</div>}
    {tab === 'map' && <div className="stats"><Stat icon="camera" label="최근 7일 제보" value={zones.reduce((n, z) => n + z.report_count, 0)} unit="건"/><Stat icon="map" label="함께 보는 구역" value={zones.length} unit="곳"/><Stat icon="heart" label="모인 좋아요" value={zones.reduce((n, z) => n + z.like_count, 0)} unit="개"/></div>}
    {active && <div className={`verification ${active.status.toLowerCase()}`}><span className="verification-icon">{pending(active.status) ? '◌' : active.status === 'APPROVED' ? '✓' : '!'}</span><div><b>{statuses[active.status]}</b><p>{active.reason || '검증 작업을 기다리고 있어요. 결과가 자동으로 갱신돼요.'}</p></div><button className="text-button" onClick={() => { setTab('profile'); }}>내 제보 보기 →</button></div>}
    {tab === 'map' && <div className="map-page"><div className="panel map-panel"><div className="panel-heading"><div><h2>서울의 단풍 지도</h2><p className="subtle">나무가 클수록 관심이 많은 곳이에요</p></div><span className="map-count">{zones.length}개 구역</span></div><NaverZoneMap zones={zones} selected={selected} onSelect={setSelected} />
      <div className="zone-detail"><span className="zone-detail-icon" aria-hidden="true">🍂</span><div className="zone-detail-copy"><span className="stage-label">{stages[zone?.stage] || '제보 기다리는 중'}</span><h3>{zone?.name || '구역 불러오는 중'}</h3><p>최근 제보 {zone?.report_count || 0}건 · 좋아요 {zone?.like_count || 0}개</p></div><div className="zone-detail-actions"><button className="button secondary" onClick={() => { setFilter(selected); setPage(1); setTab('feed'); }}>구역 피드 <Icon name="chevron" size={16}/></button><button className="button" onClick={() => setTab('report')}><Icon name="camera" size={18}/> 이 구역 사진 제보하기</button></div></div>
      <div className="zone-list">{zones.map(z => <button key={z.id} onClick={() => setSelected(z.id)} className={selected === z.id ? 'zone-chip active' : 'zone-chip'}>{z.name}<small>{stages[z.stage]}</small></button>)}</div></div>
    </div>}
    {tab === 'report' && <div className="report-page-layout">
      <section className="panel report-guide"><span className="guide-icon"><Icon name="pin" size={26}/></span><h2>어디에서 만난 가을인가요?</h2><p className="subtle">사진을 찍은 구역을 먼저 선택해주세요.</p>
        <label className="report-zone-select">제보 구역<select aria-label="제보 구역" value={selected} onChange={e => setSelected(e.target.value)} disabled={!zones.length}>{zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></label>
        <div className="selected-zone-summary"><span aria-hidden="true">🍂</span><div><strong>{zone?.name || '구역을 불러오는 중'}</strong><p>{stages[zone?.stage] || '제보 기다리는 중'} · 최근 제보 {zone?.report_count || 0}건</p></div></div>
        <ol className="report-steps"><li><span>01</span><div><strong>촬영한 구역 선택</strong><p>사진을 찍은 곳과 같은 구역을 골라주세요.</p></div></li><li><span>02</span><div><strong>사진과 단풍 상태 기록</strong><p>지금 본 나무와 잎이 잘 보이도록 남겨주세요.</p></div></li><li><span>03</span><div><strong>확인 후 지도에 반영</strong><p>승인된 사진은 피드에 공개되고 포인트가 적립돼요.</p></div></li></ol>
      </section>
      <ReportForm zone={zone} token={token} config={config} busy={busy} submit={submit} login={() => setAuthOpen(true)} setError={setError} />
    </div>}
    {tab === 'feed' && <><div className="feed-controls"><div className="segmented"><button className={sort === 'recent' ? 'active' : ''} onClick={() => { setSort('recent'); setPage(1); }}>최신순</button><button className={sort === 'popular' ? 'active' : ''} onClick={() => { setSort('popular'); setPage(1); }}>좋아요순</button></div><select aria-label="피드 구역" value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}><option value="">모든 구역</option>{zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select><span>{feed.total}개의 승인된 제보</span></div><div className="feed-grid">{feed.items.map(r => <ReportCard key={r.id} report={r} like={like} />)}</div>{!feed.items.length && <Empty text="아직 공개된 제보가 없어요. 첫 번째 사진을 남겨보세요." />}<div className="pagination"><button disabled={page === 1} onClick={() => setPage(p => p - 1)}>← 이전</button><span>{page} 페이지</span><button disabled={!feed.has_more} onClick={() => setPage(p => p + 1)}>다음 →</button></div></>}
    {tab === 'profile' && <>{!user ? <div className="profile-login"><Empty text="로그인하면 내 프로필과 제보 내역을 볼 수 있어요." /><button className="button" onClick={() => setAuthOpen(true)}>로그인하기</button></div> : <>
      <section className="panel profile-summary"><span className="profile-avatar large" aria-hidden="true">{user.nickname.slice(0, 1)}</span><div className="profile-identity"><p className="profile-caption">내 프로필</p><h2>{user.nickname}</h2><p>{user.email}</p></div><div className="profile-balance"><small>보유 포인트</small><strong>{user.points}<span>P</span></strong></div></section>
      <div className="my-reports-heading"><div><h2>내 제보</h2><p className="subtle">지금까지 {mine.length}건을 남겼어요.</p></div><button className="button" onClick={() => setTab('report')}>사진 제보하기 →</button></div>
      {mine.length ? <div className="feed-grid">{mine.map(r => <ReportCard key={r.id} report={r} like={like} own />)}</div> : <Empty text="아직 남긴 제보가 없어요. 첫 번째 가을 사진을 남겨보세요." />}
    </>}</>}
    {tab === 'tree' && <div className="tree-layout"><div className="panel personal-tree"><p className="tree-caption">작은 제보로 쑥쑥 자라요</p><div className="tree-art"><div className="crown crown-one"/><div className="crown crown-two"/><div className="crown crown-three"/><div className="trunk"/><div className="tree-decoration">{items.filter(i => i.equipped && i.slot === 'decoration').map(i => i.icon)}</div><div className="tree-ground">{items.filter(i => i.equipped && i.slot === 'ground').map(i => i.icon)}</div></div><h2>{user ? `${user.nickname}님의 가을` : '나만의 가을 나무'}</h2><p>제보 승인 한 건에 {config?.report_points || 20}P가 쌓여요.</p><b>{user?.points || 0} P</b></div><div className="panel shop"><h2>나무 꾸미기</h2><p className="subtle">마음에 드는 아이템으로 나무를 꾸며보세요.</p>{items.map(i => <div className="shop-item" key={i.id}><span className="item-icon">{i.icon}</span><div><b>{i.name}</b><small>{i.owned ? '보유 중' : `${i.price}P`}</small></div><button className="button secondary" disabled={i.equipped} onClick={() => purchase(i)}>{i.equipped ? '적용 중' : i.owned ? '적용' : '구매·적용'}</button></div>)}</div></div>}
    {tab === 'review' && <>{reviews.length ? <div className="feed-grid">{reviews.map(r => <ReportCard key={r.id} report={r} admin><div className="review-actions"><button className="button" onClick={() => decide(r, 'APPROVED')}>승인</button><button className="button secondary" onClick={() => decide(r, 'REJECTED')}>반려</button></div></ReportCard>)}</div> : <Empty text="검토 대기 중인 사진이 없어요." />}</>}
    <details className="network-panel"><summary>개발자 도구 <span className={`connection ${health ? 'online' : ''}`}><i /> API {health ? '연결됨' : '연결 확인 중'}</span></summary>{config?.demo_enabled && <div className="demo-banner"><span><b>로컬 테스트 모드</b><br/>사진 검증은 데모 시나리오로 실행돼요. 실제 사진 내용에 따른 AI 판별이 아니에요.</span>{!user && <button className="button secondary" onClick={() => demoLogin(false)}>테스트 계정으로 시작</button>}</div>}<div className="network-heading"><span>API 통신 기록 · {logs.length}건</span><a href={`${API_BASE}/docs`} target="_blank" rel="noreferrer">API 문서 ↗</a></div><div className="network-table">{logs.map(log => <div key={log.id}><time>{log.time}</time><b>{log.method}</b><code>{log.path}</code><span className={log.status >= 200 && log.status < 400 ? 'ok' : 'fail'}>{log.status || '연결 실패'}</span><small>{log.ms}ms</small></div>)}</div></details>
    <footer>까우룽까우룽<span>우리 동네의 가을 기록</span></footer>
    </main></div>
    {authOpen && <AuthModal close={() => setAuthOpen(false)} onAuth={authenticated} demoEnabled={config?.demo_enabled} demoLogin={demoLogin} />}
  </div>;
}
function Stat({ icon, label, value, unit }) { return <div className={`stat stat-${icon}`}><span className="stat-icon"><Icon name={icon} size={21}/></span><div><span>{label}</span><strong>{value.toLocaleString()}<small>{unit}</small></strong></div></div>; }
function Empty({ text }) { return <div className="empty"><span><Icon name="leaf" size={36}/></span><p>{text}</p></div>; }
function ReportForm({ zone, token, config, busy, submit, login, setError }) {
  const [file, setFile] = useState(null), [preview, setPreview] = useState(''), [lat, setLat] = useState(''), [lng, setLng] = useState('');
  const input = useRef();
  useEffect(() => { setLat(zone?.latitude || ''); setLng(zone?.longitude || ''); }, [zone?.id]);
  useEffect(() => { if (!file) { setPreview(''); return; } const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url); }, [file]);
  const sample = async () => { try { const response = await fetch('/sample-ginkgo.jpg'); if (!response.ok) throw new Error('샘플 사진 로딩 실패'); setFile(new File([await response.blob()], 'sample-ginkgo.jpg', { type: 'image/jpeg' })); } catch(e) { setError(e.message); } };
  const locate = () => { if (!navigator.geolocation) return setError('위치 기능을 사용할 수 없습니다.'); navigator.geolocation.getCurrentPosition(p => { setLat(p.coords.latitude); setLng(p.coords.longitude); }, () => setError('위치 권한을 확인해주세요. 테스트는 구역 중앙 좌표를 사용할 수 있어요.')); };
  return <form className="panel report-form" onSubmit={e => { e.preventDefault(); if (!token) return login(); if (!file) return setError('사진을 선택해주세요.'); const form = new FormData(e.currentTarget); form.set('photo', file); form.set('zone_id', zone.id); submit(form); }}><div className="panel-heading"><h2>사진 제보하기</h2><span className="reward-label">승인되면 +{config?.report_points || 20}P</span></div><p className="subtle">{zone?.name || '구역을 선택해주세요.'}의 풍경을 남겨주세요.</p><label className={`photo-picker ${preview ? 'has-photo' : ''}`} htmlFor="photo">{preview ? <img src={preview} alt="업로드할 사진 미리보기"/> : <><span className="photo-picker-icon"><Icon name="camera" size={30}/></span><b>사진 촬영 또는 선택</b><small>JPG · PNG · WEBP / 최대 10MB</small></>}<input id="photo" ref={input} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={e => setFile(e.target.files?.[0] || null)}/></label><button className="text-button sample-button" type="button" onClick={sample}>샘플 은행 사진 넣기</button><div className="form-row"><label>종류<select name="species" defaultValue="GINKGO"><option value="GINKGO">은행</option><option value="MAPLE">단풍</option><option value="MIXED">혼합</option></select></label><label>현재 상태<select name="stage" defaultValue="PEAK">{Object.entries(stages).filter(([id]) => id !== 'UNKNOWN').map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div><label>한 줄 기록<textarea name="description" maxLength="1000" placeholder="지금 이곳은 어떤 모습인가요?" rows="2"/></label><details className="coordinates"><summary>제보 위치 확인</summary><p>기본 위치는 선택한 구역의 중심이에요. 촬영한 곳으로 수정할 수 있어요.</p><div className="form-row"><label>위도<input name="latitude" type="number" step="any" required value={lat} onChange={e => setLat(e.target.value)}/></label><label>경도<input name="longitude" type="number" step="any" required value={lng} onChange={e => setLng(e.target.value)}/></label></div><button type="button" className="text-button" onClick={locate}>현재 위치 가져오기</button></details>{config?.demo_enabled && <label className="demo-select">테스트 검증 시나리오<select name="demo_outcome" defaultValue="APPROVED"><option value="APPROVED">승인 흐름 확인</option><option value="REVIEW">운영자 검토 흐름 확인</option><option value="REJECTED">반려 흐름 확인</option></select><small>사진 내용에 따른 실제 AI 판별이 아닙니다.</small></label>}<button disabled={busy || !zone} className="button submit-button">{busy ? '사진 전송 중…' : token ? '사진 제보하기 →' : '로그인하고 제보하기 →'}</button><p className="form-footnote">승인된 제보만 공개되고 포인트가 적립돼요.</p></form>;
}
function ReportCard({ report: r, like, own, children }) {
  return <article className="report-card"><div className="report-photo">{r.photo_url && <img src={r.photo_url} alt={`${r.zone_name} 제보 사진`} loading="lazy"/>}<span className={`status-badge ${r.status.toLowerCase()}`}>{statuses[r.status]}</span></div><div className="report-body"><div className="report-meta"><span>{r.zone_name}</span><small>{dateText(r.created_at)}</small></div><h3>{speciesNames[r.species]} · {stages[r.stage]}</h3><p>{r.description || '오늘의 가을 풍경을 기록했어요.'}</p>{own && r.reason && <p className="report-reason">{r.reason}</p>}<div className="report-bottom"><span>{r.author}</span>{r.status === 'APPROVED' && <button aria-label={`${r.liked ? '좋아요 취소' : '좋아요'} ${r.like_count}`} aria-pressed={r.liked} className={r.liked ? 'like-button liked' : 'like-button'} onClick={() => like?.(r)}><Icon name="heart" size={18}/> {r.like_count}</button>}</div>{children}</div></article>;
}
function AuthModal({ close, onAuth, demoEnabled, demoLogin }) {
  const [register, setRegister] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <div className="modal-backdrop" onClick={close}><section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" onClick={e => e.stopPropagation()}><button className="modal-close" aria-label="닫기" onClick={close}>×</button><span className="brand-icon"><Icon name="leaf" size={28}/></span><h2 id="auth-title">{register ? '가을 기록을 시작해요.' : '다시 만나 반가워요.'}</h2><p className="subtle">계정으로 제보와 포인트를 관리하세요.</p><form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); const body = Object.fromEntries(new FormData(e.currentTarget)); try { onAuth(await api(`/api/auth/${register ? 'register' : 'login'}`, { method: 'POST', body })); } catch(e) { setError(e.message); } finally { setBusy(false); } }}>{register && <label>닉네임<input name="nickname" required maxLength="30"/></label>}<label>이메일<input type="email" name="email" required autoComplete="email"/></label><label>비밀번호<input type="password" name="password" required minLength="8" maxLength="128" autoComplete={register ? 'new-password' : 'current-password'}/></label>{error && <p className="field-error" role="alert">{error}</p>}<button className="button submit-button" disabled={busy}>{busy ? '확인 중…' : register ? '회원가입' : '로그인'}</button></form><button className="text-button auth-toggle" onClick={() => { setRegister(!register); setError(''); }}>{register ? '이미 계정이 있어요 · 로그인' : '처음 오셨나요? · 회원가입'}</button>{demoEnabled && <div className="demo-logins"><p>로컬 테스트 계정</p><button onClick={() => demoLogin(false)}>사용자로 시작</button><button onClick={() => demoLogin(true)}>운영자로 시작</button></div>}</section></div>;
}

createRoot(document.getElementById('root')).render(<App/>);
