import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { loadNaverMaps, onNaverMapAuthFailure, NAVER_MAP_STYLE_OPTIONS, waitForNaverMapInit } from '../lib/naverMaps';
import { createSeoulMask } from '../lib/seoulMask';
import { installSeoulViewport } from '../lib/seoulViewport';

export default function AdminLocationPicker({ zones, location, onPick, disabled }) {
  const canvas = useRef(null), mapRef = useRef(null), markerRef = useRef(null);
  const viewportRef = useRef(null);
  const latest = useRef({ onPick, disabled });
  latest.current = { onPick, disabled };
  const [status, setStatus] = useState('loading'), [error, setError] = useState('');
  const [latitude, setLatitude] = useState(''), [longitude, setLongitude] = useState('');
  const [inputError, setInputError] = useState('');
  const point = location.point;
  useEffect(() => {
    setLatitude(point ? point.latitude.toFixed(6) : '');
    setLongitude(point ? point.longitude.toFixed(6) : '');
  }, [point]);
  useEffect(() => {
    let disposed = false, map, listener, observer, mask, viewport;
    const controller = new AbortController();
    const fail = e => { if (!disposed) { setStatus('error'); setError(e.message); } };
    const unsubscribe = onNaverMapAuthFailure(fail);
    Promise.all([loadNaverMaps(), api('/api/zones/boundaries')]).then(async ([maps, boundaries]) => {
      if (disposed || !canvas.current) return;
      map = new maps.Map(canvas.current, {
        ...NAVER_MAP_STYLE_OPTIONS,
        center: new maps.LatLng(37.5663, 126.9779), zoom: 12, minZoom: 10, maxZoom: 18, disableKineticPan: true,
        scrollWheel: false, zoomControl: true, zoomControlOptions: { position: maps.Position.RIGHT_CENTER },
        logoControl: true, mapDataControl: true, scaleControl: true,
      });
      mapRef.current = map;
      await waitForNaverMapInit(maps, map, controller.signal);
      if (disposed) return;
      viewport = installSeoulViewport(maps, map, boundaries);
      viewportRef.current = viewport;
      map.data.addGeoJson(boundaries);
      map.data.setStyle({ fillColor: '#dce8f8', fillOpacity: 0.1, strokeColor: '#8b9bae', strokeWeight: 1, clickable: false });
      mask = createSeoulMask(maps, map, boundaries.city_geometry);
      listener = maps.Event.addListener(map, 'click', event => {
        if (!latest.current.disabled) latest.current.onPick({ latitude: event.coord.lat(), longitude: event.coord.lng(), accuracy: null });
      });
      viewport.fit();
      observer = new ResizeObserver(() => { map.autoResize(); viewport.fit(); });
      observer.observe(canvas.current);
      setStatus('ready');
    }).catch(fail);
    return () => {
      disposed = true; controller.abort(); unsubscribe(); observer?.disconnect();
      viewport?.destroy();
      if (viewportRef.current === viewport) viewportRef.current = null;
      if (listener) window.naver.maps.Event.removeListener(listener);
      markerRef.current?.setMap(null); markerRef.current = null;
      mask?.setMap(null); map?.destroy();
      if (mapRef.current === map) mapRef.current = null;
    };
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready' || !point) return;
    const maps = window.naver.maps, position = new maps.LatLng(point.latitude, point.longitude);
    markerRef.current?.setMap(null);
    markerRef.current = new maps.Marker({ map, position, title: '직접 지정한 제보 위치' });
    viewportRef.current?.focus(point.latitude, point.longitude, 12);
  }, [point, status]);
  const choose = point => { setInputError(''); onPick(point); };
  return <div className="admin-location-picker">
    <p className="subtle">지도를 눌러 사진을 찍은 지점을 지정해주세요.</p>
    <div className="admin-location-map" data-map-status={status}>
      <div ref={canvas} className="admin-location-canvas" role="region" aria-label="운영자 제보 위치 선택 지도"/>
      {status === 'loading' && <span className="picker-map-message" role="status">지도를 불러오고 있어요…</span>}
      {status === 'error' && <span className="picker-map-message" role="alert">{error} 아래에서 구나 좌표를 지정할 수 있어요.</span>}
    </div>
    <p className="map-attribution">경계: SGIS · <a href="https://github.com/vuski/admdongkor" target="_blank" rel="noreferrer">vuski/admdongkor</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a> · 자치구 병합</p>
    <label>자치구로 이동<select aria-label="제보할 자치구" disabled={disabled} value={location.zone?.id || ''} onChange={event => {
      const zone = zones.find(z => z.id === event.target.value);
      if (zone) choose({ latitude: zone.latitude, longitude: zone.longitude, accuracy: null });
    }}><option value="" disabled>서울의 구를 선택해주세요</option>{zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></label>
    <details className="manual-coordinates"><summary>좌표로 직접 지정</summary><div className="form-row"><label>위도<input aria-label="제보 위치 위도" type="number" step="any" min="-90" max="90" disabled={disabled} value={latitude} onChange={e => setLatitude(e.target.value)}/></label><label>경도<input aria-label="제보 위치 경도" type="number" step="any" min="-180" max="180" disabled={disabled} value={longitude} onChange={e => setLongitude(e.target.value)}/></label></div><button className="button secondary" type="button" disabled={disabled} onClick={() => {
      const lat = Number(latitude), lng = Number(longitude);
      if (!latitude.trim() || !longitude.trim() || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return setInputError('올바른 위도와 경도를 입력해주세요.');
      choose({ latitude: lat, longitude: lng, accuracy: null });
    }}>이 좌표로 지정</button>{inputError && <p role="alert" className="field-error">{inputError}</p>}</details>
  </div>;
}
