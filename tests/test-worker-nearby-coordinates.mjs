// '내 주변' 서버 좌표 API 회귀 테스트
// - 실제 worker.js 핸들러를 가짜 D1·가짜 네이버 응답으로 실행합니다(네트워크·운영 DB 미사용).
// - 2026-11-18 운영 오류: worker.js에 HOSPITALS가 없어 ReferenceError → 500이 나던 문제를 막습니다.
import assert from 'node:assert/strict';

const cache = new Map();
const db = {
  prepare(sql) {
    let args = [];
    const stmt = {
      bind(...values) { args = values; return stmt; },
      async run() {
        if (/^INSERT INTO hospital_geo_cache/.test(sql)) {
          const [id, address, lat, lon, updatedAt] = args;
          cache.set(id, {hospital_id: id, address, lat, lon, updated_at: updatedAt});
        }
        return {success: true};
      },
      async all() {
        if (/FROM hospital_geo_cache/.test(sql)) return {results: [...cache.values()]};
        return {results: []};
      },
      async first() { return null; },
    };
    return stmt;
  },
  async batch(statements) { for (const s of statements) await s.run(); return []; },
};

let naverCalls = 0;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  assert.equal(url.hostname, 'maps.apigw.ntruss.com', 'only NAVER geocoding may be called');
  assert.equal(init.headers['x-ncp-apigw-api-key-id'], 'test-id');
  assert.equal(init.headers['x-ncp-apigw-api-key'], 'test-secret');
  naverCalls++;
  const query = url.searchParams.get('query') || '';
  assert.ok(query.includes('청주'), 'query must be a Cheongju hospital address');
  return new Response(JSON.stringify({status: 'OK', addresses: [{x: '127.48', y: '36.63'}]}), {headers: {'content-type': 'application/json'}});
};

const {default: worker} = await import('../worker.js');
const env = {DB: db, NAVER_MAPS_CLIENT_ID: 'test-id', NAVER_MAPS_CLIENT_SECRET: 'test-secret'};
const ownerPage = await worker.fetch(new Request('https://zeno.test/owner'), env);
assert.match(ownerPage.headers.get('permissions-policy') || '', /geolocation=\(self\)/);
const hospitalPage = await worker.fetch(new Request('https://zeno.test/hospital'), env);
assert.match(hospitalPage.headers.get('permissions-policy') || '', /geolocation=\(\)/);
const call = () => worker.fetch(new Request('https://zeno.test/api/public/hospital-coordinates'), env);

const check = await worker.fetch(new Request('https://zeno.test/api/public/hospital-coordinates?check=1'), env);
assert.equal(check.status, 200);
assert.deepEqual(await check.json(), {ready: true});

let body = null;
for (let i = 0; i < 12; i++) {
  const res = await call();
  const text = await res.text();
  assert.equal(res.status, 200, 'coordinate API must not fail: ' + text);
  body = JSON.parse(text);
  if (body.complete) break;
}
assert.ok(body && body.complete, 'all hospitals must finish within the 12 client retries');
assert.ok(body.total >= 60, 'hospital list must come from the owner app (got ' + body.total + ')');
assert.equal(Object.keys(body.coordinates).length, body.total);
assert.equal(body.missing, 0);
assert.ok(body.coordinates.soo && body.coordinates.naeum && body.coordinates.tnd, 'partner hospitals included');
assert.equal(naverCalls, body.total, 'each hospital geocoded exactly once, then cached');

const again = await (await call()).json();
assert.equal(again.complete, true);
assert.equal(naverCalls, body.total, 'cached coordinates must not call NAVER again');

const noKey = await worker.fetch(new Request('https://zeno.test/api/public/hospital-coordinates'), {DB: db});
assert.equal(noKey.status, 503, 'missing NAVER keys still reports the setup message');

console.log('PASS worker nearby coordinates:', body.total, 'hospitals, NAVER calls', naverCalls);
