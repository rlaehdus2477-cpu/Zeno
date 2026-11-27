// ZENO 입원·야간 관리 화면 테스트 (2026-11-27): 병원용 저장 → 보호자용 필터·상세 반영을 실제 브라우저로 확인
// - worker.js를 wrangler dev --local로 띄우고, 로컬 D1(임시 폴더)에서만 실행합니다.
// - 운영 데이터베이스(--remote)에는 접속하지 않습니다.
// - 비밀번호·비밀키는 테스트 전용 가짜 값이며 실제 값과 무관합니다.
// 실행: node tests/inpatient-care-ui.mjs (playwright 필요, 배포 전 Worker 빌드본에서 실행)
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {webcrypto as crypto} from 'node:crypto';
import {createRequire} from 'node:module';
let chromium;
try{({chromium}=await import('playwright'));}catch{({chromium}=createRequire(process.env.PLAYWRIGHT_REQUIRE_FROM||import.meta.url)('playwright'));}

const PORT = Number(process.env.ZENO_TEST_PORT || 8796);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = 'zeno-test-only-secret-not-production';
const PINS = {soo: 'soo-test-pin', naeum: 'naeum-test-pin', pub045: 'tplus-test-pin'};
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PERSIST = fs.mkdtempSync(path.join(os.tmpdir(), 'zeno-d1-test-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');

// ---------- helpers ----------
const results = [];
let current = null;
async function check(no, title, fn) {
  current = {no, title, ok: true, notes: []};
  try { await fn(); } catch (err) { current.ok = false; current.notes.push(err.message); }
  results.push(current);
  console.log(`${current.ok ? 'PASS' : 'FAIL'}  ${no}. ${title}${current.ok ? '' : '\n      → ' + current.notes.join('\n      → ')}`);
}
function expect(cond, message) { if (!cond) throw new Error(message); }

async function api(method, url, {token, body} = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: {'content-type': 'application/json', ...(token ? {authorization: 'Bearer ' + token} : {})},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return {status: res.status, data};
}

// KST 기준 날짜 (예약 검증이 +09:00 기준)
function kstDate(daysAhead) {
  return new Date(Date.now() + 9 * 3600e3 + daysAhead * 86400e3).toISOString().slice(0, 10);
}

function bookingBody(hospitalId, petName) {
  return {
    hospitalId, petName, species: '고양이', service: '일반 진료',
    date: kstDate(2), time: '10:00', note: '자동 테스트 예약',
    ownerPhone: '01012345678', visitType: '첫 방문',
  };
}

const b64 = bytes => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
async function signToken(payload, secret) {
  const p = b64(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return p + '.' + b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(p))));
}

const findBooking = (list, id) => (list || []).find(b => b.id === id);

// ---------- local server ----------
function run(cmd, args) {
  const r = spawnSync(cmd, args, {cwd: ROOT, encoding: 'utf8'});
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} 실패\n${r.stdout}\n${r.stderr}`);
}

let server;
async function startServer() {
  // 로컬 D1에만 스키마 적용
  run(WRANGLER, ['d1', 'execute', 'zeno-live-db', '--local', '--persist-to', PERSIST, '--file=schema.sql']);
  const vars = [['SESSION_SECRET', SECRET], ['HOSPITAL_SOO_PIN', PINS.soo], ['HOSPITAL_NAEUM_PIN', PINS.naeum], ['HOSPITAL_TPLUS_PIN', PINS.pub045]]
    .flatMap(([k, v]) => ['--var', `${k}:${v}`]);
  server = spawn(WRANGLER, ['dev', '--local', '--persist-to', PERSIST, '--ip', '127.0.0.1', '--port', String(PORT), ...vars],
    {cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
  let log = '';
  server.stdout.on('data', d => { log += d; });
  server.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const r = await api('GET', '/api/ping');
      if (r.status === 200 && r.data?.connected) return;
    } catch {}
  }
  throw new Error('로컬 서버가 시작되지 않았습니다.\n' + log.slice(-3000));
}
function stopServer() {
  if (server?.pid) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
  fs.rmSync(PERSIST, {recursive: true, force: true});
}

// ---------- tests ----------
const SHOTS = process.env.SCREENSHOT_DIR || path.join(ROOT, 'screenshots');
async function main() {
  fs.mkdirSync(SHOTS, {recursive: true});
  await startServer();
  console.log('로컬 서버 준비 완료 (로컬 D1 전용)\n');
  const login = await api('POST', '/api/login', {body: {hospitalId: 'soo', pin: PINS.soo}});
  const SOO = login.data.token;
  const browser = await chromium.launch({headless: true});
  const ctx = {viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR'};
  const errors = [];
  try {
    await check(1, '병원용: 병원 정보 탭에서 입원·야간 관리 저장 → 서버 저장', async () => {
      const page = await browser.newPage({...ctx, viewport: {width: 1280, height: 900}, isMobile: false, hasTouch: false});
      page.on('pageerror', err => errors.push('hospital: ' + err.message));
      await page.addInitScript(([t]) => { sessionStorage.setItem('zeno-h-token', t); sessionStorage.setItem('zeno-h-hospital', 'soo'); }, [SOO]);
      await page.goto(BASE + '/hospital', {waitUntil: 'domcontentloaded'});
      await page.waitForFunction(() => typeof state === 'object' && state.hospitalToken && Array.isArray(state.hospitalBookings));
      await page.evaluate(() => { state.hTab = 'info'; render(); });
      await page.locator('#hospital-care').waitFor();
      const opts = await page.locator('#hi-care-nightVet option').allTextContents();
      expect(JSON.stringify(opts) === JSON.stringify(['상주', '당직 호출', '비상주', '미확인']), '야간 수의사 선택지 ' + opts);
      expect(await page.locator('#hi-care-inpatient').inputValue() === 'unknown', '처음 값이 미확인이 아님');
      for (const [k, v] of Object.entries({inpatient: 'available', nightVet: 'resident', nightStaff: 'resident', care24: 'available', monitoring: 'periodic', catWard: 'operated', icu: 'operated', nightSurgery: 'unavailable'})) await page.selectOption('#hi-care-' + k, v);
      await page.fill('#hi-care-nightVetHours', '20:00~09:00');
      await page.fill('#hi-care-checkInterval', '1시간마다');
      await page.locator('#hi-care-settings').screenshot({path: path.join(SHOTS, 'hospital-care-form.png')});
      await page.click('#hospital-care button[type=submit]');
      await page.waitForFunction(() => state.hCareProfile && state.hCareProfile.icu === 'operated', null, {timeout: 15000});
      const pub = await api('GET', '/api/public/hospital-care');
      expect(pub.data.hospitals.soo?.nightVet === 'resident' && pub.data.hospitals.soo?.checkInterval === '1시간마다', '공개 API 반영 안 됨 ' + JSON.stringify(pub.data));
      await page.close();
    });

    let owner;
    await check(2, '보호자용: 상세 필터에 입원·야간 관리 5개 조건, 복수 선택 시 모두 충족 병원만', async () => {
      owner = await browser.newPage(ctx);
      owner.on('pageerror', err => errors.push('owner: ' + err.message));
      await owner.goto(BASE + '/owner', {waitUntil: 'domcontentloaded'});
      await owner.waitForFunction(() => typeof state === 'object' && state.hospitalCare && state.hospitalCare.soo, null, {timeout: 20000});
      await owner.evaluate(() => { state.page = 'search'; state.query = ''; render(); });
      await owner.locator('.zeno-filter-more summary').click();
      const chips = await owner.locator('.zeno-filter-care .filter').allTextContents();
      expect(JSON.stringify(chips.map(x => x.trim())) === JSON.stringify(['입원 가능', '야간 수의사 상주', '24시간 입원 관리', '고양이 분리 입원실', '중환자실(ICU)']), '필터 칩 ' + chips);
      await owner.locator('.zeno-filter-care .filter', {hasText: '입원 가능'}).click();
      const ids1 = await owner.evaluate(() => filteredHospitals().map(h => h.id).sort());
      expect(JSON.stringify(ids1) === JSON.stringify(['pub006', 'pub034', 'pub056', 'soo', 'tnd']), '입원 가능 결과 ' + ids1);
      await owner.evaluate(() => { document.querySelector('.zeno-filter-more').open = true; });
      await owner.locator('.zeno-filter-care .filter', {hasText: '야간 수의사 상주'}).click();
      await owner.evaluate(() => { document.querySelector('.zeno-filter-more').open = true; });
      await owner.locator('.zeno-filter-care .filter', {hasText: '중환자실(ICU)'}).click();
      const ids2 = await owner.evaluate(() => filteredHospitals().map(h => h.id));
      expect(JSON.stringify(ids2) === JSON.stringify(['soo']), '복수 조건 결과 ' + ids2);
      const cards = await owner.locator('.zeno-search-card').count();
      expect(cards === 1, '화면 카드 수 ' + cards);
      await owner.screenshot({path: path.join(SHOTS, 'owner-care-filter.png'), fullPage: false});
    });

    await check(3, '데이터 원칙: 24시간 병원(나음·이음·다옴)도 야간 수의사 상주 필터에서 제외(미확인)', async () => {
      const r = await owner.evaluate(() => {
        state.activeFilters = ['야간 수의사 상주']; state.filter = '전체';
        const night = filteredHospitals().map(h => h.id);
        state.activeFilters = ['24시', '야간 수의사 상주'];
        const both = filteredHospitals().map(h => h.id);
        state.activeFilters = ['고양이 분리 입원실'];
        const catWard = filteredHospitals().map(h => h.id);
        const waitingOnly = HOSPITALS.filter(h => h.catWaiting && h.id !== 'soo').map(h => h.id);
        return {night, both, catWard, waitingOnly, any24: HOSPITALS.filter(h => h.is24).map(h => h.id)};
      });
      expect(JSON.stringify(r.night) === '["soo"]', '야간 수의사 상주 ' + r.night);
      expect(!r.any24.some(id => r.night.includes(id)), '24시간 병원이 자동 포함됨');
      expect(r.both.length === 0 || r.both.every(id => id === 'soo'), '24시+상주 ' + r.both);
      expect(JSON.stringify(r.catWard) === '["soo"]' && !r.waitingOnly.some(id => r.catWard.includes(id)), '고양이 대기실 병원이 분리 입원실로 포함됨 ' + r.catWard);
    });

    await check(4, '진료과목·다른 필터 연동: 진료 분야 선택 + 입원 가능', async () => {
      const r = await owner.evaluate(() => {
        state.activeFilters = ['입원 가능']; state.specialty = '안과';
        const a = filteredHospitals().map(h => h.id);
        state.specialty = ''; state.activeFilters = ['입원 가능', '연결 병원'];
        const b = filteredHospitals().map(h => h.id);
        state.activeFilters = []; return {a, b};
      });
      const base = await owner.evaluate(() => { state.specialty = '안과'; const x = filteredHospitals().map(h => h.id); state.specialty = ''; return x; });
      expect(r.a.every(id => base.includes(id)), '진료 분야 결과 밖의 병원이 포함됨');
      expect(JSON.stringify(r.b) === '["soo"]', '연결 병원 + 입원 가능 ' + r.b);
    });

    await check(5, '보호자용 상세: 입원·야간 관리 8항목, 출처·확인일, 미확인/미운영 구분, 전화 문의', async () => {
      await owner.evaluate(() => { state.activeFilters = []; state.modal = {type: 'details', id: 'soo'}; state.detailTab = 'services'; render(); });
      const sec = owner.locator('.zeno-care-section');
      await sec.waitFor();
      const labels = await sec.locator('dt').allTextContents();
      for (const l of ['입원', '야간 수의사', '야간 입원 관리 인력', '24시간 입원 관리', '입원환자 모니터링', '고양이 분리 입원실', '중환자실(ICU)', '야간 응급수술']) expect(labels.includes(l), '항목 없음 ' + l);
      const text = await sec.innerText();
      expect(/상주 · 20:00~09:00/.test(text) && /1시간마다/.test(text) && /병원 직접 등록/.test(text) && /\d{4}\.\d{2}\.\d{2} 확인/.test(text), '상세 내용 ' + text);
      expect(await sec.locator('a[href^="tel:"]').count() === 1, '전화 문의 링크 없음');
      await sec.scrollIntoViewIfNeeded();
      await owner.screenshot({path: path.join(SHOTS, 'owner-care-detail-soo.png')});
      await owner.evaluate(() => { state.modal = {type: 'details', id: 'naeum'}; render(); });
      const t2 = await owner.locator('.zeno-care-section').innerText();
      expect((t2.match(/미확인/g) || []).length === 8 && /아직 확인된/.test(t2), '나음(24시간) 상세가 모두 미확인이 아님 ' + t2);
      await owner.evaluate(() => { state.modal = {type: 'details', id: 'pub006'}; render(); });
      const t3 = await owner.locator('.zeno-care-section').innerText();
      expect(/ZENO 확인/.test(t3) && /2026\.11\.14 확인/.test(t3) && (t3.match(/미확인/g) || []).length === 7, 'ZENO 확인 병원 표시 ' + t3);
      await owner.locator('.zeno-care-section').scrollIntoViewIfNeeded();
      await owner.screenshot({path: path.join(SHOTS, 'owner-care-detail-pub006.png')});
    });

    await check(6, '병원 수정 → 보호자 화면 반영 (ICU 미운영으로 변경)', async () => {
      const r = await api('PUT', '/api/hospital-care', {token: SOO, body: {inpatient: 'available', nightVet: 'resident', icu: 'not_operated'}});
      expect(r.status === 200, '저장 실패');
      await owner.evaluate(async () => { await zenoLoadPublicHospitalCare(); state.modal = {type: 'details', id: 'soo'}; render(); });
      const t = await owner.locator('.zeno-care-section').innerText();
      expect(/중환자실\(ICU\)\s*미운영/.test(t), '미운영 반영 안 됨 ' + t);
      const ids = await owner.evaluate(() => { state.modal = null; state.activeFilters = ['중환자실(ICU)']; const x = filteredHospitals().map(h => h.id); state.activeFilters = []; return x; });
      expect(ids.length === 0, 'ICU 미운영 병원이 필터에 남음 ' + ids);
    });

    await check(7, '홈 화면·병원 카드 변경 없음, 스크립트 오류 없음', async () => {
      await owner.evaluate(() => { state.modal = null; state.page = 'home'; render(); });
      const home = await owner.locator('#app').innerHTML();
      expect(!home.includes('zeno-care'), '홈에 입원·야간 관리 요소가 추가됨');
      await owner.evaluate(() => { state.page = 'search'; render(); });
      const cardHtml = await owner.locator('.zeno-search-card').first().innerHTML();
      expect(!/입원|야간 수의사/.test(cardHtml), '병원 카드에 입원 정보가 추가됨');
      expect(errors.length === 0, '페이지 오류: ' + errors.join(' / '));
    });
  } finally { await browser.close(); }
  const failed = results.filter(r => !r.ok);
  console.log(`\n입원·야간 관리 화면 테스트: ${results.length - failed.length}/${results.length} 통과`);
  if (failed.length) process.exitCode = 1;
}
main().catch(err => { console.error(err); process.exitCode = 1; }).finally(stopServer);
