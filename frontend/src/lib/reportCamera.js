export function stopCamera(stream) {
  stream?.getTracks().forEach(track => track.stop());
}

export async function openCamera(mediaDevices = navigator.mediaDevices, secure = window.isSecureContext) {
  if (!secure) throw new Error('카메라는 HTTPS 또는 localhost에서 사용할 수 있어요.');
  if (!mediaDevices?.getUserMedia) throw new Error('이 브라우저에서는 카메라를 사용할 수 없어요. 카메라를 지원하는 브라우저에서 열어주세요.');
  try {
    return await mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1600 }, height: { ideal: 1200 } } });
  } catch (error) {
    const messages = {
      NotAllowedError: '카메라 권한이 꺼져 있어요. 사이트 설정에서 카메라를 허용한 뒤 다시 켜주세요.',
      NotFoundError: '연결된 카메라가 없어요. 카메라가 있는 기기에서 접속해주세요.',
      NotReadableError: '카메라를 사용할 수 없어요. 다른 앱에서 사용 중인지 확인해주세요.',
      OverconstrainedError: '이 카메라로 촬영을 시작하지 못했어요. 다른 기기에서 시도해주세요.',
    };
    throw new Error(messages[error.name] || '카메라를 켜지 못했어요. 권한과 기기 연결을 확인해주세요.');
  }
}

export async function captureCameraPhoto(video, createCanvas = () => document.createElement('canvas')) {
  if (!video?.videoWidth || !video?.videoHeight || video.readyState < 2) throw new Error('카메라 화면을 준비하고 있어요. 잠시 후 다시 찍어주세요.');
  const canvas = createCanvas();
  const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('사진을 만들지 못했어요. 카메라를 다시 켜주세요.');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) throw new Error('사진을 저장하지 못했어요. 다시 찍어주세요.');
  return new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
}
