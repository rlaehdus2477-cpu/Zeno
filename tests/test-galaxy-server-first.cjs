'use strict';
// 갤럭시 APK에서도 서버(네이버 확인·D1 저장) 좌표를 먼저 쓰고, 휴대폰 주소 변환은 서버 실패 시에만 쓰는지 확인합니다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('owner.html', 'utf8');
const a = html.indexOf('async function zenoNearbyGeoRequest(');
const b = html.indexOf('async function zenoReadNearbyPosition(){');
assert.ok(a > 0 && b > a);
const run = async (serverOk) => {
  let nativeLaunched = 0, calls = 0;
  const state = {nearbyCoordinates: null};
  const ctx = {
    state, HOSPITALS: [{id: 'soo', address: '충북 청주시 서원구 모충로3번길 81'}],
    window: {ZenoNearbyAndroid: {resolveHospitalAddresses() { nativeLaunched++; setTimeout(() => ctx.window.zenoNearbyAndroidReport(JSON.stringify({coordinates: {soo: {lat: 36.6, lon: 127.4}}, processed: 1, total: 1, missing: 0, done: true})), 0); }}},
    document: {getElementById() { return null; }}, setTimeout, clearTimeout, AbortController,
    fetch: async () => { calls++; if (!serverOk) return {ok: false, json: async () => ({error: '네이버 오류'})}; return {ok: true, json: async () => ({complete: true, coordinates: {soo: {lat: 36.63, lon: 127.48}}, missing: 0, total: 1})}; },
  };
  vm.createContext(ctx);
  vm.runInContext(html.slice(a, b), ctx);
  await ctx.zenoLoadNearbyCoordinates();
  return {nativeLaunched, calls, coords: state.nearbyCoordinates};
};
(async () => {
  const ok = await run(true);
  assert.equal(ok.nativeLaunched, 0, 'server success must not start phone geocoding');
  assert.equal(ok.coords.soo.lat, 36.63);
  const fallback = await run(false);
  assert.equal(fallback.nativeLaunched, 1, 'server failure falls back to phone geocoding');
  assert.equal(fallback.coords.soo.lat, 36.6);
  console.log('Galaxy server-first nearby test passed.');
})().catch(e => { console.error(e); process.exit(1); });
