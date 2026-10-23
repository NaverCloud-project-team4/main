import React, { useEffect, useRef, useState } from 'react';
import { loadNaverMaps, onNaverMapAuthFailure } from '../lib/naverMaps';

const stageNames = { UNKNOWN: '제보 대기', GREEN: '물들기 전', STARTING: '물드는 중', PEAK: '절정', FALLEN: '낙엽' };

function makeMarkerContent(zone) {
  // Use textContent for API-provided strings; do not interpolate them into HTML.
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'naver-zone-marker';
  button.dataset.zoneId = zone.id;
  button.setAttribute('aria-label', `${zone.name} 선택`);
  const tree = document.createElement('span');
  tree.className = 'naver-zone-tree';
  tree.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'naver-zone-label';
  const name = document.createElement('strong');
  const summary = document.createElement('small');
  label.append(name, summary);
  button.append(tree, label);
  return { button, tree, name, summary };
}

export default function NaverZoneMap({ zones, selected, onSelect }) {
  const canvasRef = useRef(null);
  const mapRef = useRef(null);
  const recordsRef = useRef(new Map());
  const previousSelection = useRef(selected);
  const fitted = useRef(false);
  const latest = useRef({ zones, selected, onSelect });
  latest.current = { zones, selected, onSelect };
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);

  useEffect(() => {
    let disposed = false;
    let map;
    let observer;
    const showError = failure => {
      if (disposed) return;
      setError(failure);
      setStatus('error');
    };
    const unsubscribe = onNaverMapAuthFailure(showError);
    loadNaverMaps().then(maps => {
      if (disposed || !canvasRef.current) return;
      map = new maps.Map(canvasRef.current, {
        center: new maps.LatLng(37.5665, 127.035),
        zoom: 11,
        minZoom: 7,
        maxZoom: 19,
        zoomControl: true,
        zoomControlOptions: { position: maps.Position.RIGHT_CENTER },
        scaleControl: true,
        logoControl: true,
        mapDataControl: true,
        scrollWheel: false,
      });
      mapRef.current = map;
      previousSelection.current = latest.current.selected;
      observer = new ResizeObserver(() => {
        if (!disposed && mapRef.current === map) map.autoResize();
      });
      observer.observe(canvasRef.current);
      setStatus('ready');
    }).catch(showError);
    return () => {
      disposed = true;
      unsubscribe();
      observer?.disconnect();
      for (const { marker, listener } of recordsRef.current.values()) {
        window.naver.maps.Event.removeListener(listener);
        marker.setMap(null);
      }
      recordsRef.current.clear();
      fitted.current = false;
      map?.destroy();
      if (mapRef.current === map) mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map) return;
    const maps = window.naver.maps;
    const ids = new Set(zones.map(zone => zone.id));
    for (const [id, record] of recordsRef.current) {
      if (!ids.has(id)) {
        maps.Event.removeListener(record.listener);
        record.marker.setMap(null);
        recordsRef.current.delete(id);
      }
    }
    for (const zone of zones) {
      let record = recordsRef.current.get(zone.id);
      if (!record) {
        const content = makeMarkerContent(zone);
        const marker = new maps.Marker({
          map,
          position: new maps.LatLng(zone.latitude, zone.longitude),
          title: zone.name,
          icon: { content: content.button, size: new maps.Size(120, 90), anchor: new maps.Point(60, 25) },
        });
        const select = () => latest.current.onSelect(zone.id);
        const listener = maps.Event.addListener(marker, 'click', select);
        content.button.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            select();
          }
        });
        record = { marker, listener, ...content };
        recordsRef.current.set(zone.id, record);
      }
      const isSelected = zone.id === selected;
      record.button.classList.toggle('selected', isSelected);
      record.button.setAttribute('aria-pressed', String(isSelected));
      record.button.dataset.treeLevel = String(zone.tree_level);
      record.tree.textContent = zone.tree_level > 0 ? '🌳' : '🍂';
      record.tree.style.fontSize = `${22 + Math.min(3, zone.tree_level) * 2}px`;
      record.name.textContent = zone.name;
      record.summary.textContent = `${stageNames[zone.stage] || stageNames.UNKNOWN} · ♡ ${zone.like_count}`;
      record.marker.setPosition(new maps.LatLng(zone.latitude, zone.longitude));
      record.marker.setZIndex(isSelected ? 200 : 100);
    }
    if (zones.length && !fitted.current) {
      map.fitBounds(zones.map(z => new maps.LatLng(z.latitude, z.longitude)), { top: 90, right: 80, bottom: 100, left: 80, maxZoom: 13 });
      fitted.current = true;
    } else if (previousSelection.current !== selected) {
      const zone = zones.find(z => z.id === selected);
      if (zone) {
        map.panTo(new maps.LatLng(zone.latitude, zone.longitude));
        if (map.getZoom() < 13) map.setZoom(13);
      }
    }
    previousSelection.current = selected;
  }, [zones, selected, status]);

  const showAll = () => {
    if (!mapRef.current || !zones.length) return;
    const maps = window.naver.maps;
    mapRef.current.fitBounds(zones.map(z => new maps.LatLng(z.latitude, z.longitude)), { top: 90, right: 80, bottom: 100, left: 80, maxZoom: 13 });
  };

  return <div className="zone-map naver-zone-map" data-map-status={status}>
    <div ref={canvasRef} className="naver-map-canvas" role="region" aria-label="네이버 지도 · 서울의 가을 제보 구역" />
    {status === 'ready' && <div className="naver-map-toolbar"><span>🌳 관심 나무 · 마커를 눌러 구역 선택</span><button type="button" onClick={showAll}>전체 구역 보기</button></div>}
    {status === 'loading' && <div className="naver-map-message" role="status"><span className="map-loading-ring"/><strong>네이버 지도를 불러오고 있어요.</strong></div>}
    {status === 'error' && <div className="naver-map-message" role="alert"><span className="map-message-icon" aria-hidden="true">⌖</span><strong>{error?.message || '네이버 지도를 불러오지 못했어요.'}</strong><p>아래 구역 목록에서도 장소를 선택할 수 있어요.</p><button type="button" className="button secondary" onClick={() => window.location.reload()}>지도 다시 불러오기</button></div>}
  </div>;
}
