import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { readCurrentPosition } from '../lib/reportLocation';
import { stages } from '../lib/reportLabels';
import Icon from './Icon';
import CameraCapture from './CameraCapture';
import AdminLocationPicker from './AdminLocationPicker';

export default function PhotoReportPage({ token, user, zones, config, busy, submit, login, setError, onLocated, viewMap }) {
  const isAdmin = user?.role === 'admin';
  const [mode, setMode] = useState(isAdmin ? 'manual' : 'current');
  const manual = isAdmin && mode === 'manual';
  const [location, setLocation] = useState({ phase: isAdmin ? 'empty' : 'locating' });
  const generation = useRef(0);

  const locate = useCallback(async (manualPoint = null) => {
    const attempt = ++generation.current;
    setLocation({ phase: manualPoint ? 'resolving' : 'locating', point: manualPoint });
    try {
      const point = manualPoint || await readCurrentPosition();
      if (attempt !== generation.current) return null;
      const result = await api('/api/zones/resolve', {
        method: 'POST', body: { latitude: point.latitude, longitude: point.longitude },
      });
      if (attempt !== generation.current) return null;
      const next = { phase: result.zone ? 'ready' : 'outside', point, zone: result.zone, source: manualPoint ? 'manual' : 'current' };
      setLocation(next);
      if (result.zone) onLocated(result.zone.id);
      return next;
    } catch (error) {
      if (attempt === generation.current) setLocation({ phase: 'error', message: error.message });
      return null;
    }
  }, [onLocated]);

  useEffect(() => {
    if (manual) setLocation({ phase: 'empty' });
    else locate();
    return () => { generation.current += 1; };
  }, [locate, manual]);

  const send = async form => {
    // Refresh at submission time so walking to another area cannot reuse an old location.
    const current = manual ? location : await locate();
    if (current?.phase !== 'ready') return;
    form.set('latitude', String(current.point.latitude));
    form.set('longitude', String(current.point.longitude));
    form.set('location_source', manual ? 'manual' : 'current');
    form.delete('zone_id'); // The server determines the zone again from these coordinates.
    await submit(form);
  };
  const locating = ['locating', 'resolving'].includes(location.phase);
  const ready = location.phase === 'ready';

  return <div className="report-page-layout">
    <section className={`panel report-guide report-location ${location.phase}`} data-location-status={location.phase}>
      <span className="guide-icon"><Icon name="pin" size={26}/></span>
      <p className="location-caption">{manual ? '운영자 · 위치 직접 지정' : '현재 위치로 자동 설정'}</p>
      {isAdmin && <div className="segmented location-mode" aria-label="제보 위치 설정"><button type="button" aria-pressed={!manual} className={!manual ? 'active' : ''} disabled={busy} onClick={() => setMode('current')}>현재 위치</button><button type="button" aria-pressed={manual} className={manual ? 'active' : ''} disabled={busy} onClick={() => setMode('manual')}>직접 지정</button></div>}
      <div aria-live="polite" role="status">
        <h2>{locating ? manual ? '선택한 위치를 확인하고 있어요' : '지금 있는 곳을 찾고 있어요' : ready ? location.zone.name : location.phase === 'outside' ? '서울 밖의 위치예요' : manual ? '제보할 위치를 지정해주세요' : '위치를 확인해주세요'}</h2>
        <p className="subtle">{locating ? manual ? '좌표가 속한 자치구를 찾고 있어요.' : '위치를 허용하면 서울의 어느 구인지 자동으로 찾아요.' : ready ? manual ? '선택한 위치에 사진 제보를 등록해요.' : '지금 있는 장소의 단풍 소식을 남겨주세요.' : location.phase === 'outside' ? '지금은 서울 25개 자치구 안에서만 제보할 수 있어요.' : location.message || (manual ? '서울 안에서 사진을 찍은 곳을 선택해주세요.' : '')}</p>
      </div>
      {manual && <AdminLocationPicker zones={zones} location={location} onPick={point => locate(point)} disabled={busy}/>}
      {ready && <div className="selected-zone-summary"><span aria-hidden="true">🍂</span><div><strong>제보할 자치구를 찾았어요</strong><p>사진을 올리면 {location.zone.name}에 등록돼요.</p></div></div>}
      {location.point && <details className="coordinates location-coordinates"><summary>확인한 위치 정보</summary><dl><div><dt>위도</dt><dd>{location.point.latitude.toFixed(6)}</dd></div><div><dt>경도</dt><dd>{location.point.longitude.toFixed(6)}</dd></div>{Number.isFinite(location.point.accuracy) && <div><dt>예상 오차</dt><dd>약 {Math.ceil(location.point.accuracy).toLocaleString()}m</dd></div>}</dl></details>}
      {!manual && <button className="button secondary location-retry" type="button" disabled={locating || busy} onClick={() => locate()}><Icon name="refresh" size={17}/>{locating ? '위치 확인 중…' : '현재 위치 다시 확인'}</button>}
      {location.phase === 'outside' && <button className="text-button location-map-link" onClick={viewMap}>서울 지도 보기 <Icon name="chevron" size={14}/></button>}
      <p className="location-help">{manual ? '운영자만 사진과 위치를 직접 지정할 수 있어요.' : '제보를 보내기 전에 현재 위치를 한 번 더 확인해요.'}</p>
      <ol className="report-steps"><li><span>01</span><div><strong>{manual ? '사진을 찍은 위치 지정' : '현재 위치 확인'}</strong><p>{manual ? '지도나 좌표로 제보 장소를 지정해요.' : '위치 권한을 허용하면 장소가 자동으로 정해져요.'}</p></div></li><li><span>02</span><div><strong>사진과 단풍 상태 기록</strong><p>지금 본 나무와 잎이 잘 보이도록 남겨주세요.</p></div></li><li><span>03</span><div><strong>확인 후 지도에 반영</strong><p>승인된 사진은 피드에 공개되고 포인트가 적립돼요.</p></div></li></ol>
    </section>
    <PhotoReportForm isAdmin={isAdmin} manual={manual} location={location} token={token} config={config} busy={busy} submit={send} login={login} setError={setError}/>
  </div>;
}

function PhotoReportForm({ isAdmin, manual, location, token, config, busy, submit, login, setError }) {
  const [photo, setPhoto] = useState(null);
  const file = photo?.file;
  const [cameraActive, setCameraActive] = useState(false);
  const [preview, setPreview] = useState('');
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const sample = async () => {
    try {
      const response = await fetch('/sample-ginkgo.jpg');
      if (!response.ok) throw new Error('샘플 사진 로딩 실패');
      setPhoto({ file: new File([await response.blob()], 'sample-ginkgo.jpg', { type: 'image/jpeg' }), source: 'upload' });
    } catch (error) { setError(error.message); }
  };
  const ready = location.phase === 'ready';
  return <form className="panel report-form" onSubmit={event => {
    event.preventDefault();
    if (!token) return login();
    if (!ready || busy || cameraActive) return;
    if (!file) return setError(isAdmin ? '사진을 촬영하거나 선택해주세요.' : '카메라로 사진을 촬영해주세요.');
    const form = new FormData(event.currentTarget);
    form.set('photo', file);
    form.set('photo_source', photo.source);
    submit(form);
  }}>
    <div className="panel-heading"><h2>사진 제보하기</h2><span className="reward-label">승인되면 +{config?.report_points || 20}P</span></div>
    <p className="subtle">{isAdmin ? '직접 촬영하거나 저장된 사진을 선택할 수 있어요.' : '지금 보고 있는 풍경을 카메라로 찍어주세요.'}</p>
    {preview && <div className="report-photo-preview"><img src={preview} alt="제보할 사진 미리보기"/><span>{photo.source === 'camera' ? '직접 촬영한 사진' : '운영자가 선택한 사진'}</span></div>}
    <CameraCapture token={token} login={login} hasPhoto={Boolean(file)} disabled={busy} onActiveChange={setCameraActive} onCapture={file => setPhoto({ file, source: 'camera' })}/>
    {isAdmin && <><label className="admin-photo-upload" htmlFor="photo-upload">사진 파일 선택<input id="photo-upload" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || cameraActive} onChange={event => { const file = event.target.files?.[0]; if (file) setPhoto({ file, source: 'upload' }); event.target.value = ''; }}/></label><p className="photo-upload-hint">JPG · PNG · WEBP / 최대 10MB</p></>}
    {isAdmin && config?.demo_enabled && <button className="text-button sample-button" type="button" disabled={busy || cameraActive} onClick={sample}>샘플 은행 사진 넣기</button>}
    <div className="form-row"><label>종류<select name="species" defaultValue="GINKGO"><option value="GINKGO">은행</option><option value="MAPLE">단풍</option><option value="MIXED">혼합</option></select></label><label>현재 상태<select name="stage" defaultValue="PEAK">{Object.entries(stages).filter(([id]) => id !== 'UNKNOWN').map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
    <label>한 줄 기록<textarea name="description" maxLength="1000" placeholder="지금 이곳은 어떤 모습인가요?" rows="2"/></label>
    {isAdmin && config?.demo_enabled && <label className="demo-select">테스트 검증 시나리오<select name="demo_outcome" defaultValue="APPROVED"><option value="APPROVED">승인 흐름 확인</option><option value="REVIEW">운영자 검토 흐름 확인</option><option value="REJECTED">반려 흐름 확인</option></select><small>사진 내용에 따른 실제 AI 판별이 아닙니다.</small></label>}
    <button disabled={busy || !ready || cameraActive || !file} className="button submit-button">{busy ? location.phase === 'locating' ? '현재 위치 확인 중…' : '사진 전송 중…' : !ready ? '위치를 먼저 확인해주세요' : cameraActive ? '촬영을 마쳐주세요' : !file ? isAdmin ? '사진을 먼저 촬영하거나 선택해주세요' : '사진을 먼저 촬영해주세요' : token ? '사진 제보하기 →' : '로그인하고 제보하기 →'}</button>
    <p className="form-footnote">{manual ? '직접 지정한 위치에 등록돼요.' : '현재 위치가 자동으로 등록돼요.'} 승인되면 포인트가 적립돼요.</p>
  </form>;
}
