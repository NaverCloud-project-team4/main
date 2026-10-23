// New NCP Maps applications use ncpKeyId, not the legacy ncpClientId parameter.
// This is a public browser Client ID. Never put Client Secret in a VITE_ variable.
export const NAVER_MAP_CLIENT_ID = (import.meta.env.VITE_NAVER_MAP_CLIENT_ID || '').trim();
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

export function loadNaverMaps() {
  if (!NAVER_MAP_CLIENT_ID) {
    return Promise.reject(mapError('MISSING_KEY', '네이버 지도 연결 정보가 필요해요.'));
  }
  if (authError) return Promise.reject(authError);
  if (window.naver?.maps?.Map) return Promise.resolve(window.naver.maps);
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    let settled = false;
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
      if (typeof window.naver?.maps?.Map === 'function') return done();
      clearTimeout(readinessTimer);
      readinessTimer = setTimeout(checkReady, 25);
    };
    window[CALLBACK] = checkReady;
    script.onload = checkReady;
    script.onerror = () => done(mapError('NETWORK_ERROR', '네이버 지도를 불러오지 못했어요.'));
    const timeout = setTimeout(() => done(mapError('TIMEOUT', '네이버 지도 연결이 지연되고 있어요.')), 20000);
    const params = new URLSearchParams({ ncpKeyId: NAVER_MAP_CLIENT_ID, callback: CALLBACK });
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?${params}`;
    document.head.appendChild(script);
  });
  return sdkPromise;
}
