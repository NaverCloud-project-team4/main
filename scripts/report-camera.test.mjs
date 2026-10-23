import test from 'node:test';
import assert from 'node:assert/strict';
import { openCamera, stopCamera, captureCameraPhoto } from '../frontend/src/lib/reportCamera.js';

test('requests the rear camera without audio; stops every track', async () => {
  let stopped = 0;
  const stream = { getTracks: () => [{ stop: () => stopped++ }, { stop: () => stopped++ }] };
  assert.equal(await openCamera({ getUserMedia: async constraints => {
    assert.equal(constraints.audio, false);
    assert.equal(constraints.video.facingMode.ideal, 'environment');
    return stream;
  } }, true), stream);
  stopCamera(stream);
  assert.equal(stopped, 2);
  stopCamera(null);
});
for (const [name, expected] of [['NotAllowedError', /권한/], ['NotFoundError', /연결된 카메라/], ['NotReadableError', /다른 앱/]]) {
  test(`camera ${name} is actionable without a file-picker fallback`, async () => {
    await assert.rejects(openCamera({getUserMedia:async()=>{throw {name};}},true), expected);
  });
}
test('unsupported/insecure camera fails clearly', async () => {
  await assert.rejects(openCamera(null,true), /브라우저/);
  await assert.rejects(openCamera(null,false), /HTTPS/);
});
test('capture requires a ready video frame and creates a bounded JPEG', async () => {
  await assert.rejects(captureCameraPhoto({videoWidth:0,videoHeight:0,readyState:0}), /준비/);
  const video = {videoWidth:4000,videoHeight:3000,readyState:2};
  const canvas = { getContext:() => ({drawImage:(...args)=>assert.deepEqual(args,[video,0,0,1600,1200])}),
    toBlob: (callback,type,quality) => { assert.equal(type,'image/jpeg'); assert.equal(quality,0.9); callback(new Blob(['frame'],{type})); } };
  const photo = await captureCameraPhoto(video,()=>canvas);
  assert.equal(canvas.width,1600); assert.equal(canvas.height,1200);
  assert.equal(photo.type,'image/jpeg'); assert.match(photo.name,/^camera-\d+\.jpg$/);
  assert.equal(await photo.text(),'frame');
});
test('capture reports encoding failure instead of submitting empty bytes', async () => {
  await assert.rejects(captureCameraPhoto({videoWidth:10,videoHeight:10,readyState:2},()=>({getContext:()=>({drawImage(){}}),toBlob:fn=>fn(null)})), /저장하지/);
});
