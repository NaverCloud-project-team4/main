import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { installSeoulViewport } from '../lib/seoulViewport';
import { loadNaverMaps, onNaverMapAuthFailure, NAVER_MAP_STYLE_ID, waitForNaverMapInit } from '../lib/naverMaps';
import { createWatercolorStage } from '../lib/watercolorLayer';
import { STAGE_ORDER, STAGE_WASH } from '../lib/watercolorPalette';
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
const FONT_ID = 'kauroong-brush-font';
// Fixed glyphs for headings, legend and (later) the sheet; district names are added at load.
const FONT_TEXT = '서울의단풍지도구를눌러소식보기전체단계대표명소사용자게시물물들기전드는중절정낙엽제보기다리는예상일현재0123456789·';

// Load only the glyphs the map uses (district names + headings) from Google Fonts.
function loadBrushFont(names) {
  if (document.getElementById(FONT_ID)) return;
  const text = [...new Set(FONT_TEXT + names.join(''))].join('');
  const link = document.createElement('link');
  link.id = FONT_ID;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=Nanum+Brush+Script&display=swap&text=${encodeURIComponent(text)}`;
  document.head.appendChild(link);
}

export default function WatercolorZoneMap({ zones, selected, onSelect, onEmptyClick }) {
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const viewportRef = useRef(null);
  const latest = useRef({ zones, selected, onSelect, onEmptyClick });
  latest.current = { zones, selected, onSelect, onEmptyClick };
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
      loadBrushFont(boundaries.features.map(f => f.properties.name));
      map = new maps.Map(canvasRef.current, {
        gl: true, customStyleId: STYLE_ID,
        center: new maps.LatLng(37.565, 126.98), zoom: 11,
        minZoom: 9, maxZoom: 18, disableKineticPan: true,
        // The small +/− control keeps phone-width maps uncovered.
        zoomControl: true, zoomControlOptions: { position: maps.Position.RIGHT_CENTER, style: maps.ZoomControlStyle.SMALL },
        scaleControl: false, logoControl: true, mapDataControl: false, scrollWheel: false,
      });
      await waitForNaverMapInit(maps, map, controller.signal);
      if (disposed) return;
      viewport = installSeoulViewport(maps, map, boundaries);
      viewportRef.current = viewport;
      stage = createWatercolorStage(maps, map, {
        boundaries, river: riverGeometry, paperUrl: MAP_ASSETS.paper, grainUrl: MAP_ASSETS.grain, treeAssets: MAP_ASSETS,
        onSelect: id => latest.current.onSelect(id),
        onEmptyClick: () => latest.current.onEmptyClick?.(),
      });
      stageRef.current = stage;
      stage.update(latest.current);
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

  return <>
    <div className="zone-map naver-zone-map wc-map" data-map-status={status} data-map-theme="watercolor">
      <div ref={canvasRef} className="naver-map-canvas" role="region" aria-label="수채화 서울 지도 · 25개 자치구 단풍 단계" />
      {status === 'ready' && <div className="naver-map-toolbar wc-toolbar"><span>구를 눌러 단풍 소식 보기</span><button type="button" onClick={() => viewportRef.current?.fit()}>서울 전체 보기</button></div>}
      {status === 'loading' && <div className="naver-map-message wc-message" role="status"><span className="map-loading-ring"/><strong>서울의 단풍 지도를 그리고 있어요.</strong></div>}
      {status === 'error' && <div className="naver-map-message wc-message" role="alert"><strong>{error?.message || '지도를 불러오지 못했어요.'}</strong><p>아래 목록에서도 자치구를 선택할 수 있어요.</p><button type="button" className="button secondary" onClick={() => window.location.reload()}>지도 다시 불러오기</button></div>}
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
