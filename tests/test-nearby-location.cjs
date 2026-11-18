'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const java = fs.readFileSync('android/owner/src/kr/zeno/owner/OwnerActivity.java', 'utf8');
const html = fs.readFileSync('owner.html', 'utf8');

// Android calls @JavascriptInterface methods on the private JS bridge thread.
// WebView methods must only be accessed once posted back to the UI thread.
const between = (text, from, to) => {
  const a = text.indexOf(from);
  const b = text.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, 'source anchors must be present');
  return text.slice(a, b);
};
const bridge = between(java, 'public void resolveHospitalAddresses(String data)', 'private boolean isOwnerUrl');
assert.ok(bridge.indexOf('target.post(() -> {') >= 0, 'bridge must post to UI thread');
assert.ok(bridge.indexOf('target.post(() -> {') < bridge.indexOf('target.getUrl()'), 'bridge must not getUrl on JS bridge thread');
const reporter = between(java, 'private void reportNativeCoordinates(JSONObject data)', 'private final class NearbyHospitalGeocoder');
assert.ok(reporter.indexOf('target.post(() -> {') >= 0, 'geocoder callback must post to UI thread');
assert.ok(reporter.indexOf('target.post(() -> {') < reporter.indexOf('target.getUrl()'), 'geocoder worker must not getUrl off UI thread');
assert.ok(java.includes('if (i + 1 == rows.length()) {'), 'invalid final hospital must emit completion');

const fnText = between(html, 'async function zenoLoadNearbyCoordinates(){', 'async function zenoReadNearbyPosition(){');
let launched = 0;
const state = {nearbyCoordinates:null,nearbyMissing:0};
const browser = {ZenoNearbyAndroid:{resolveHospitalAddresses(){launched++;}}};
const context = {window:browser,state,HOSPITALS:[{id:'test',address:'충북 청주시 흥덕구 테스트로 1'}],document:{getElementById(){return null}},setTimeout,clearTimeout};
vm.createContext(context);
vm.runInContext(fnText,context);
const send = value => {
  assert.equal(typeof browser.zenoNearbyAndroidReport, 'function');
  browser.zenoNearbyAndroidReport(JSON.stringify(value));
};

(async () => {
  const first = context.zenoLoadNearbyCoordinates();
  send({coordinates:{test:{lat:36.6,lon:127.4}},processed:1,total:2,missing:0,done:false});
  assert.equal(state.nearbyCoordinates,null,'partial coordinates must not be committed');
  send({error:'temporary geocoder failure'});
  await assert.rejects(first,/temporary geocoder failure/);
  assert.equal(state.nearbyCoordinates,null,'failed attempt must not cache partial coordinates');

  const second = context.zenoLoadNearbyCoordinates();
  send({coordinates:{test:{lat:36.6,lon:127.4}},processed:1,total:1,missing:0,done:true});
  await second;
  assert.equal(launched,2,'second attempt must launch geocoding again');
  assert.equal(state.nearbyCoordinates.test.lat,36.6);

  // Slow native geocoding should produce useful partial results after 12/62
  // and continue updating without wiping the user's existing search.
  context.zenoHasFilter = () => false;
  context.render = () => {};
  state.nearbyCoordinates = null;
  const third = context.zenoLoadNearbyCoordinates();
  const partial = {a:{lat:36.6,lon:127.4},b:{lat:36.61,lon:127.41},c:{lat:36.62,lon:127.42}};
  send({coordinates:partial,processed:12,total:62,missing:9,done:false});
  await third;
  assert.equal(launched,3,'progressive geocoding must still use the native bridge');
  assert.equal(Object.keys(state.nearbyCoordinates).length,3,'confirmed nearby coordinates should appear before completion');
  send({coordinates:{...partial,d:{lat:36.63,lon:127.43}},processed:62,total:62,missing:58,done:true});
  assert.equal(Object.keys(state.nearbyCoordinates).length,4,'later progress must complete the nearby list');
  assert.match(html,/state\.nearbyError=/,'nearby failures must remain visible');

  console.log('Nearby regression checks passed: UI thread + retry + progressive coordinates + visible error.');
})().catch(error=>{console.error(error);process.exitCode=1;});
