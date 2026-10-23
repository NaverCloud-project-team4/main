export const locationMessages = {
  1: '위치 권한이 꺼져 있어요. 주소창의 사이트 설정에서 위치를 허용한 뒤 다시 확인해주세요.',
  2: '현재 위치를 찾지 못했어요. 기기의 위치 서비스를 켜고 다시 확인해주세요.',
  3: '위치 확인에 시간이 오래 걸리고 있어요. 잠시 후 다시 확인해주세요.',
};

export function readCurrentPosition(geolocation = navigator.geolocation, secure = window.isSecureContext) {
  return new Promise((resolve, reject) => {
    if (!secure) return reject(new Error('위치 기능은 HTTPS로 접속해야 사용할 수 있어요. 로컬 개발은 localhost에서 확인할 수 있어요.'));
    if (!geolocation) return reject(new Error('이 브라우저에서는 위치 기능을 사용할 수 없어요. 다른 브라우저에서 열어주세요.'));
    geolocation.getCurrentPosition(position => {
      const { latitude, longitude, accuracy } = position.coords;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
        reject(new Error('올바른 위치를 가져오지 못했어요. 위치를 다시 확인해주세요.'));
        return;
      }
      resolve({ latitude, longitude, accuracy: Number.isFinite(accuracy) ? accuracy : null });
    }, error => reject(new Error(locationMessages[error.code] || '위치를 가져오지 못했어요. 다시 확인해주세요.')),
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  });
}
