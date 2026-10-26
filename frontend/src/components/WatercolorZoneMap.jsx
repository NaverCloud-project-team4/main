import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { installSeoulViewport } from '../lib/seoulViewport';
import { loadNaverMaps, onNaverMapAuthFailure, NAVER_MAP_STYLE_ID, waitForNaverMapInit } from '../lib/naverMaps';
import { createWatercolorStage } from '../lib/watercolorLayer';
import { STAGE_ORDER, STAGE_WASH } from '../lib/watercolorPalette';
import { loadBrushFont } from '../lib/brushFont';
import '../watercolor.css';

// Every map image goes through these names; replace a file in public/map-assets/ to restyle.
export const MAP_ASSETS = Object.freeze({
  paper: '/map-assets/paper-texture.webp',
  grain: '/map-assets/pigment-grain.png',
  river: '/map-assets/han-river.geojson',
  maple: '/map-assets/tree-maple.png',
  ginkgo: '/map-assets/tree-ginkgo.png',
  shadow: '/map-assets/tree-shadow.png',
  mapleLeaves: ['/map-assets/leaf-maple-1.png', '/map-assets/leaf-maple-2.png', '/map-assets/leaf-maple-3.png'],
  ginkgoLeaves: ['/map-assets/leaf-ginkgo-1.png', '/map-assets/leaf-ginkgo-2.png'],
});
const STYLE_ID = (import.meta.env.VITE_NAVER_MAP_STYLE_ID_WATERCOLOR || '').trim() || NAVER_MAP_STYLE_ID;

// Screen y of the sheet's top edge once it settles in `mode` (it may still be sliding):
// the untransformed box plus the mode's resting offset. null while closed.
function sheetTop(frame, mode) {
  const el = frame?.querySelector('.wc-sheet');
  if (!el || mode === 'closed') return null;
  const style = getComputedStyle(el);
  const box = el.getBoundingClientRect();
  const top = box.top - (style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m42);
  return mode === 'full' ? top : top + box.height - (parseFloat(style.getPropertyValue('--wc-peek')) || 0);
}

// The map area a person can see: inside the window and above the sheet.
function visibleBand(frame, mode) {
  const map = frame.getBoundingClientRect();
  const cover = sheetTop(frame, mode);
  const top = Math.max(map.top, 0);
  const bottom = Math.min(map.bottom, window.innerHeight, cover ?? Infinity);
  return { map, top, bottom: Math.max(bottom, top + 40), inset: cover == null ? 0 : Math.max(0, map.bottom - cover) };
}
// children: the district sheet, rendered inside the map frame (fixed to the screen on phones).
export default function WatercolorZoneMap({ zones, selected, onSelect, onSpotSelect, onEmptyClick, focusSpot, sheetMode = 'closed', children }) {
  const frameRef = useRef(null);
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const viewportRef = useRef(null);
  const latest = useRef({ zones, selected, onSelect, onSpotSelect, onEmptyClick });
  latest.current = { zones, selected, onSelect, onSpotSelect, onEmptyClick };
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    let map, observer, viewport, stage;
    const showError = failure => {
      if (disposed) return;
      setError(failure);
      setStatus('error');
    };
    const unsubscribe = onNaverMapAuthFailure(showError);
    const river = fetch(MAP_ASSETS.river).then(r => (r.ok ? r.json() : null)).then(doc => doc?.features?.[0]?.geometry || null).catch(() => null);
    Promise.all([loadNaverMaps(), api('/api/zones/boundaries'), river]).then(async ([maps, boundaries, riverGeometry]) => {
      if (disposed || !canvasRef.current) return;
      loadBrushFont();
      map = new maps.Map(canvasRef.current, {
        gl: true, customStyleId: STYLE_ID,
        center: new maps.LatLng(37.565, 126.98), zoom: 11,
        minZoom: 9, maxZoom: 18, disableKineticPan: true,
        // The small +/− control sits top-right, above any open sheet; the wheel zooms too.
        zoomControl: true, zoomControlOptions: { position: maps.Position.TOP_RIGHT, style: maps.ZoomControlStyle.SMALL },
        scaleControl: false, logoControl: true, mapDataControl: false, scrollWheel: true,
      });
      await waitForNaverMapInit(maps, map, controller.signal);
      if (disposed) return;
      viewport = installSeoulViewport(maps, map, boundaries);
      viewportRef.current = viewport;
      stage = createWatercolorStage(maps, map, {
        boundaries, river: riverGeometry, paperUrl: MAP_ASSETS.paper, grainUrl: MAP_ASSETS.grain, treeAssets: MAP_ASSETS,
        onSelect: id => latest.current.onSelect(id),
        onSpotSelect: spot => latest.current.onSpotSelect?.(spot),
        onEmptyClick: () => latest.current.onEmptyClick?.(),
        moveTo: (coord, zoom) => viewport.flyTo(coord, zoom),
      });
      stageRef.current = stage;
      stage.update(latest.current);
      // Every forecast spot gets a pop-up-book tree from zoom 14; the map still works without them.
      api('/api/forecast-spots').then(spots => { if (!disposed) stage.setSpots(spots); }).catch(() => {});
      viewport.fit();
      observer = new ResizeObserver(() => {
        if (disposed) return;
        map.autoResize();
        viewport.fit();
        stage.resize();
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
      stage?.destroy();
      if (stageRef.current === stage) stageRef.current = null;
      map?.destroy();
    };
  }, []);

  useEffect(() => {
    if (status === 'ready') stageRef.current?.update({ zones, selected });
  }, [zones, selected, status]);

  // The sheet hides the bottom of the map: let the limits use only the part above it.
  useEffect(() => {
    if (status === 'ready' && frameRef.current) viewportRef.current?.setInset(visibleBand(frameRef.current, sheetMode).inset);
  }, [sheetMode, status]);

  // A picked spot lands in the middle of the map left visible above the sheet.
  useEffect(() => {
    if (status !== 'ready' || !frameRef.current) return;
    if (!focusSpot) { stageRef.current?.focusSpot(null); return; }
    const band = visibleBand(frameRef.current, sheetMode);
    const offsetY = (band.top + band.bottom) / 2 - (band.map.top + band.map.height / 2);
    stageRef.current?.focusSpot(focusSpot, { offsetY });
  }, [focusSpot, status]); // the sheet mode is only read at focus time

  return <>
    <div ref={frameRef} className="zone-map naver-zone-map wc-map" data-map-status={status} data-map-theme="watercolor">
      <div ref={canvasRef} className="naver-map-canvas" role="region" aria-label="수채화 서울 지도 · 25개 자치구 단풍 단계" />
      {status === 'ready' && <div className="naver-map-toolbar wc-toolbar"><span>구를 눌러 단풍 소식 보기</span><button type="button" onClick={() => viewportRef.current?.fit()}>서울 전체 보기</button></div>}
      {status === 'loading' && <div className="naver-map-message wc-message" role="status"><span className="map-loading-ring"/><strong>서울의 단풍 지도를 그리고 있어요.</strong></div>}
      {status === 'error' && <div className="naver-map-message wc-message" role="alert"><strong>{error?.message || '지도를 불러오지 못했어요.'}</strong><p>아래 목록에서도 자치구를 선택할 수 있어요.</p><button type="button" className="button secondary" onClick={() => window.location.reload()}>지도 다시 불러오기</button></div>}
      {children}
    </div>
    <div className="map-interest-legend wc-legend" role="group" aria-label="단풍 단계 색상 범례">
      <span className="legend-title">단풍 단계</span>
      {STAGE_ORDER.map(stage => <span key={stage} className="legend-step" title={`${STAGE_WASH[stage].label} · ${STAGE_WASH[stage].colorName}`}><i style={{ background: `radial-gradient(circle, ${STAGE_WASH[stage].inner} 35%, ${STAGE_WASH[stage].edge})` }} aria-hidden="true"/>{STAGE_WASH[stage].label}<span className="sr-only"> {STAGE_WASH[stage].colorName}</span></span>)}
      <span className="legend-trees" title="관심도가 오를수록 나무가 커지고 숲이 돼요"><img src={MAP_ASSETS.maple} alt="" aria-hidden="true"/>관심도: 나무 1그루 → 숲</span>
      <span className="legend-selection">먹선 테두리: 선택한 구</span>
    </div>
    <p className="map-attribution">경계: 통계청 SGIS · <a href="https://github.com/vuski/admdongkor" target="_blank" rel="noreferrer">vuski/admdongkor</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a> · 서울 자치구로 병합 · 한강: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>, ODbL</p>
  </>;
}
