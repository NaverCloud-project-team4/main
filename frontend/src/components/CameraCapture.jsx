import React, { useEffect, useRef, useState } from 'react';
import { openCamera, captureCameraPhoto, stopCamera } from '../lib/reportCamera';
import Icon from './Icon';

export default function CameraCapture({ onCapture, onActiveChange, disabled, hasPhoto, token, login }) {
  const video = useRef(null), stream = useRef(null), generation = useRef(0);
  const [phase, setPhase] = useState('closed'), [error, setError] = useState('');
  const [taking, setTaking] = useState(false);
  const close = () => {
    generation.current++;
    stopCamera(stream.current);
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setPhase('closed');
    onActiveChange(false);
  };
  useEffect(() => () => { generation.current++; stopCamera(stream.current); }, []);
  const start = async () => {
    if (!token) return login();
    const attempt = ++generation.current;
    setError(''); setPhase('opening'); onActiveChange(true);
    try {
      const next = await openCamera();
      if (generation.current !== attempt) { stopCamera(next); return; }
      stream.current = next;
      video.current.srcObject = next;
      await video.current.play();
      if (generation.current === attempt) setPhase('live');
    } catch (failure) {
      if (generation.current !== attempt) return;
      close(); setError(failure.message);
    }
  };
  const shoot = async () => {
    const attempt = generation.current;
    setTaking(true); setError('');
    try {
      const photo = await captureCameraPhoto(video.current);
      if (generation.current !== attempt) return;
      onCapture(photo); close();
    } catch (failure) {
      if (generation.current === attempt) setError(failure.message);
    } finally { setTaking(false); }
  };
  const active = phase !== 'closed';
  return <div className="camera-capture" data-camera-status={phase}>
    {active ? <div className="camera-session">
      <video ref={video} autoPlay playsInline muted aria-label="촬영할 카메라 화면"/>
      {phase === 'opening' && <p role="status">카메라 권한을 허용해주세요. 연결하고 있어요…</p>}
      <div className="camera-controls"><button type="button" className="button secondary" onClick={close} disabled={taking}>카메라 닫기</button><button type="button" className="button" onClick={shoot} disabled={phase !== 'live' || taking}>{taking ? '사진 저장 중…' : '사진 찍기'}</button></div>
    </div> : <button type="button" className={`camera-open ${hasPhoto ? 'has-photo' : ''}`} onClick={start} disabled={disabled}><span className="photo-picker-icon"><Icon name="camera" size={28}/></span><strong>{!token ? '로그인하고 카메라 켜기' : hasPhoto ? '다시 촬영하기' : '카메라 켜기'}</strong><small>지금 보이는 풍경을 직접 찍어주세요</small></button>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </div>;
}
