// New NCP Maps applications use ncpKeyId, not the legacy ncpClientId parameter.
// This is a public browser Client ID. Never put Client Secret in a VITE_ variable.
export const NAVER_MAP_CLIENT_ID = (import.meta.env.VITE_NAVER_MAP_CLIENT_ID || '').trim();
// Published release: 20261023163956 (ordinary shop POIs hidden).
// The JS SDK accepts the style ID, not a separate release-version option.
export const NAVER_MAP_STYLE_ID = (import.meta.env.VITE_NAVER_MAP_STYLE_ID || '2ca6dae8-1af8-4390-b762-6f2736423d59').trim();
export const NAVER_MAP_STYLE_OPTIONS = Object.freeze({ gl: true, customStyleId: NAVER_MAP_STYLE_ID });
const SCRIPT_ID = 'kauroong-naver-maps-sdk';
const CALLBACK = '__kauroongNaverMapsReady';
const authListeners = new Set();
let sdkPromise;
let authError;

function mapError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function onNaverMapAuthFailure(listener) {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

// GL loads the published style asynchronously and then replaces the projection.
// Fit bounds and install geographic overlays only after that initialization.
export function waitForNaverMapInit(maps, map, signal) {
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer);
      maps.Event.removeListener(listener);
      signal.removeEventListener('abort', abort);
      error ? reject(error) : resolve();
    };
    const abort = () => finish(new DOMException('Map disposed', 'AbortError'));
    const listener = maps.Event.addListener(map, 'init', () => finish());
    const timer = setTimeout(() => finish(mapError('TIMEOUT', '지도 스타일을 불러오지 못했어요. 다시 시도해주세요.')), 20000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

export function loadNaverMaps() {
  if (!NAVER_MAP_CLIENT_ID) {
    return Promise.reject(mapError('MISSING_KEY', '네이버 지도 연결 정보가 필요해요.'));
  }
  if (authError) return Promise.reject(authError);
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    let settled = false;
    let modulesLoaded = false;
    let readinessTimer;
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    const done = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(readinessTimer);
      delete window[CALLBACK];
      if (error) {
        script.remove();
        reject(error);
      } else {
        resolve(window.naver.maps);
      }
    };
    // Authentication can fail after the SDK callback, so notify mounted maps too.
    window.navermap_authFailure = () => {
      authError = mapError('AUTH_FAILED', '네이버 지도 인증 정보를 확인해주세요.');
      for (const listener of authListeners) listener(authError);
      done(authError);
    };
    // The SDK callback may run before the new map-style metadata finishes
    // exporting Map. Wait for the constructor rather than rejecting that race.
    const checkReady = () => {
      if (settled) return;
      if (authError) return done(authError);
      if (!modulesLoaded) return;
      if (typeof window.naver?.maps?.Map === 'function') return done();
      clearTimeout(readinessTimer);
      readinessTimer = setTimeout(checkReady, 25);
    };
    // Unlike script.onload, the SDK callback waits for submodules (including GL).
    window[CALLBACK] = () => { modulesLoaded = true; checkReady(); };
    script.onload = checkReady;
    script.onerror = () => done(mapError('NETWORK_ERROR', '네이버 지도를 불러오지 못했어요.'));
    const timeout = setTimeout(() => done(mapError('TIMEOUT', '네이버 지도 연결이 지연되고 있어요.')), 20000);
    const params = new URLSearchParams({ ncpKeyId: NAVER_MAP_CLIENT_ID, submodules: 'gl', callback: CALLBACK });
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?${params}`;
    document.head.appendChild(script);
  });
  return sdkPromise;
}
