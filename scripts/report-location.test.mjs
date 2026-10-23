import test from 'node:test';
import assert from 'node:assert/strict';
import { readCurrentPosition } from '../frontend/src/lib/reportLocation.js';

test('fresh positions are read for each request, with high accuracy and a bounded timeout', async () => {
  let call = 0;
  const geo = { getCurrentPosition(success, _failure, options) {
    assert.equal(options.maximumAge, 0);
    assert.equal(options.enableHighAccuracy, true);
    assert.ok(options.timeout > 0 && options.timeout <= 15000);
    success({ coords: { latitude: 37 + call++, longitude: 127, accuracy: 15 } });
  } };
  assert.equal((await readCurrentPosition(geo, true)).latitude, 37);
  assert.equal((await readCurrentPosition(geo, true)).latitude, 38);
});

for (const [code, message] of [[1, /위치 권한/], [2, /위치 서비스/], [3, /시간이 오래/]]) {
  test(`location error ${code} provides an actionable message`, async () => {
    await assert.rejects(readCurrentPosition({ getCurrentPosition(_success, failure) { failure({ code }); } }, true), message);
  });
}

test('unsupported and insecure environments cannot request or fabricate a position', async () => {
  await assert.rejects(readCurrentPosition(null, true), /브라우저/);
  await assert.rejects(readCurrentPosition(null, false), /HTTPS/);
});

test('invalid coordinates are not accepted as a location', async () => {
  await assert.rejects(readCurrentPosition({ getCurrentPosition(success) {
    success({ coords: { latitude: NaN, longitude: 127, accuracy: 10 } });
  } }, true), /올바른 위치/);
});
