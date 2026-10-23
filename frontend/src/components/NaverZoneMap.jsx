import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { createSeoulMask } from '../lib/seoulMask';
import { installSeoulViewport } from '../lib/seoulViewport';
import { loadNaverMaps, onNaverMapAuthFailure, NAVER_MAP_STYLE_OPTIONS, waitForNaverMapInit } from '../lib/naverMaps';

// Shared by district fills and the visible legend; selection only changes the outline.
const interestLevels = [
  { color: '#facc15', opacity: 0.24, label: '0단계', colorName: '노랑' },
  { color: '#fb923c', opacity: 0.32, label: '1단계', colorName: '주황' },
  { color: '#ea580c', opacity: 0.40, label: '2단계', colorName: '진한 주황' },
  { color: '#dc2626', opacity: 0.48, label: '3단계', colorName: '빨강' },
];
const interestLevel = zone => Math.max(0, Math.min(3, Math.trunc(Number(zone?.tree_level) || 0)));

function makeMarkerContent(zone) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'naver-zone-marker district-marker';
  button.dataset.zoneId = zone.id;
  button.setAttribute('aria-label', `${zone.name} 선택`);
  const name = document.createElement('strong');
  const summary = document.createElement('small');
  button.append(name, summary);
  return { button, name, summary };
}

function makeTreeContent(zone) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'map-interest-tree';
  button.dataset.treeZoneId = zone.id;
  button.setAttribute('aria-label', `${zone.name} 관심 나무 선택`);
  const image = document.createElement('img');
  image.src = '/images/autumn-maple-tree.png';
  image.alt = '';
  image.setAttribute('aria-hidden', 'true');
  image.draggable = false;
  button.append(image);
  return { button, image };
}

function removeMarker(record) {
  if (!record) return;
  window.naver.maps.Event.removeListener(record.listener);
  record.marker.setMap(null);
}

function bindMarkerSelection(maps, marker, button, select) {
  const listener = maps.Event.addListener(marker, 'click', select);
  button.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); }
  });
  return listener;
}

export default function NaverZoneMap({ zones, selected, onSelect }) {
  const canvasRef = useRef(null);
  const mapRef = useRef(null);
  const viewportRef = useRef(null);
  const recordsRef = useRef(new Map());
  const previousSelection = useRef(selected);
  const latest = useRef({ zones, selected, onSelect });
  latest.current = { zones, selected, onSelect };
  const [status, setStatus] = useState('loading');
  const [compact, setCompact] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    let map;
    let observer;
    let districtListener;
    let mask;
    let viewport;
    const showError = failure => {
      if (disposed) return;
      setError(failure);
      setStatus('error');
    };
    const unsubscribe = onNaverMapAuthFailure(showError);
    Promise.all([loadNaverMaps(), api('/api/zones/boundaries')]).then(async ([maps, boundaries]) => {
      if (disposed || !canvasRef.current) return;
      map = new maps.Map(canvasRef.current, {
        ...NAVER_MAP_STYLE_OPTIONS,
        center: new maps.LatLng(37.565, 126.98), zoom: 11,
        minZoom: 9, maxZoom: 18, disableKineticPan: true,
        zoomControl: true, zoomControlOptions: { position: maps.Position.RIGHT_CENTER },
        scaleControl: true, logoControl: true, mapDataControl: true, scrollWheel: false,
      });
      mapRef.current = map;
      await waitForNaverMapInit(maps, map, controller.signal);
      if (disposed) return;
      viewport = installSeoulViewport(maps, map, boundaries);
      viewportRef.current = viewport;
      mask = createSeoulMask(maps, map, boundaries.city_geometry);
      map.data.addGeoJson(boundaries);
      districtListener = map.data.addListener('click', event => {
        const id = event.feature.getProperty('zone_id');
        if (id) latest.current.onSelect(id);
      });
      previousSelection.current = latest.current.selected;
      viewport.fit();
      observer = new ResizeObserver(() => {
        if (!disposed && mapRef.current === map) {
          setCompact(canvasRef.current.clientWidth < 500);
          map.autoResize();
          viewport.fit();
        }
      });
      observer.observe(canvasRef.current);
      setStatus('ready');
    }).catch(showError);
    return () => {
      disposed = true;
      controller.abort();
      unsubscribe();
      observer?.disconnect();
      viewport?.destroy();
      if (viewportRef.current === viewport) viewportRef.current = null;
      if (districtListener) window.naver.maps.Event.removeListener(districtListener);
      for (const record of recordsRef.current.values()) {
        removeMarker(record.tree);
        removeMarker(record);
      }
      recordsRef.current.clear();
      mask?.setMap(null);
      map?.destroy();
      if (mapRef.current === map) mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map) return;
    const maps = window.naver.maps;
    const byId = new Map(zones.map(zone => [zone.id, zone]));
    map.data.setStyle(feature => {
      const id = feature.getProperty('zone_id');
      const style = interestLevels[interestLevel(byId.get(id))];
      return {
        fillColor: style.color,
        fillOpacity: style.opacity,
        strokeColor: id === selected ? '#3182f6' : '#8b9bae',
        strokeWeight: id === selected ? 2.5 : 1.2, strokeOpacity: 0.85,
        clickable: true, zIndex: id === selected ? 3 : 2,
      };
    });
    for (const [id, record] of recordsRef.current) {
      if (!byId.has(id)) {
        removeMarker(record.tree);
        removeMarker(record);
        recordsRef.current.delete(id);
      }
    }
    for (const zone of zones) {
      const level = interestLevel(zone);
      const hasTree = level > 0;
      const position = new maps.LatLng(zone.latitude, zone.longitude);
      let record = recordsRef.current.get(zone.id);
      if (!record) {
        const content = makeMarkerContent(zone);
        const marker = new maps.Marker({
          map, position: new maps.LatLng(zone.latitude, zone.longitude), title: zone.name,
          icon: { content: content.button, size: new maps.Size(64, 24), anchor: new maps.Point(32, hasTree ? -8 : 12) },
        });
        const select = () => latest.current.onSelect(zone.id);
        const listener = bindMarkerSelection(maps, marker, content.button, select);
        record = { marker, listener, ...content, hasTree };
        recordsRef.current.set(zone.id, record);
      }
      const isSelected = zone.id === selected;
      record.button.classList.toggle('selected', isSelected);
      record.button.setAttribute('aria-pressed', String(isSelected));
      record.name.textContent = zone.name;
      record.button.title = `${zone.name} · 관심 ${level}단계`;
      record.summary.textContent = `제보 ${zone.report_count} · ♡ ${zone.like_count}`;
      record.marker.setZIndex(isSelected ? 400 : 300);
      record.marker.setPosition(position);
      if (record.hasTree !== hasTree) {
        record.marker.setIcon({ content: record.button, size: new maps.Size(64, 24), anchor: new maps.Point(32, hasTree ? -8 : 12) });
        record.hasTree = hasTree;
      }
      // The tree is a separate geographic marker. Its roots sit at the district's
      // interior centre, with a separate district label just below the roots.
      if (hasTree) {
        const width = Math.round([0, 60, 78, 96][level] * (compact ? 0.75 : 1));
        const height = Math.round(width * 1230 / 1278);
        if (!record.tree) {
          const content = makeTreeContent(zone);
          const marker = new maps.Marker({ map, position, title: `${zone.name} 관심 나무`,
            icon: { content: content.button, size: new maps.Size(width, height), anchor: new maps.Point(width / 2, height * 0.94) },
          });
          const listener = bindMarkerSelection(maps, marker, content.button, () => latest.current.onSelect(zone.id));
          record.tree = { ...content, marker, listener, width };
        }
        const tree = record.tree;
        tree.button.classList.toggle('selected', isSelected);
        tree.button.setAttribute('aria-pressed', String(isSelected));
        tree.button.dataset.treeLevel = String(level);
        tree.button.title = `${zone.name} · 관심 ${level}단계 · 제보 ${zone.report_count}건 · 좋아요 ${zone.like_count}개`;
        tree.button.style.width = `${width}px`;
        tree.button.style.height = `${height}px`;
        if (tree.width !== width) {
          tree.marker.setIcon({ content: tree.button, size: new maps.Size(width, height), anchor: new maps.Point(width / 2, height * 0.94) });
          tree.width = width;
        }
        tree.marker.setPosition(position);
        tree.marker.setZIndex(isSelected ? 250 : 200 + level);
      } else if (record.tree) {
        removeMarker(record.tree);
        record.tree = null;
      }
    }
    if (previousSelection.current !== selected) {
      const zone = byId.get(selected);
      if (zone) {
        viewportRef.current?.focus(zone.latitude, zone.longitude);
      }
    }
    previousSelection.current = selected;
  }, [zones, selected, status, compact]);

  const showAll = () => {
    viewportRef.current?.fit();
  };

  return <>
    <div className="zone-map naver-zone-map" data-map-status={status}>
      <div ref={canvasRef} className="naver-map-canvas" role="region" aria-label="네이버 지도 · 서울 25개 자치구 단풍 제보" />
      {status === 'ready' && <div className="naver-map-toolbar"><span>구를 눌러 단풍 소식 보기</span><button type="button" onClick={showAll}>서울 전체 보기</button></div>}
      {status === 'loading' && <div className="naver-map-message" role="status"><span className="map-loading-ring"/><strong>서울의 단풍 지도를 불러오고 있어요.</strong></div>}
      {status === 'error' && <div className="naver-map-message" role="alert"><strong>{error?.message || '지도를 불러오지 못했어요.'}</strong><p>아래 목록에서도 자치구를 선택할 수 있어요.</p><button type="button" className="button secondary" onClick={() => window.location.reload()}>지도 다시 불러오기</button></div>}
    </div>
    <div className="map-interest-legend" role="group" aria-label="지역 관심도 색상 범례">
      <span className="legend-title">지역 관심도</span>
      {interestLevels.map((level, index) => <span key={index} className="legend-step" title={`${level.label} · ${level.colorName}`}><i style={{ backgroundColor: level.color }} aria-hidden="true"/>{level.label}<span className="sr-only"> {level.colorName}</span></span>)}
      <span className="legend-selection">파란 테두리: 선택한 구</span>
    </div>
    <p className="map-attribution">경계: 통계청 SGIS · <a href="https://github.com/vuski/admdongkor" target="_blank" rel="noreferrer">vuski/admdongkor</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a> · 서울 자치구로 병합</p>
  </>;
}
