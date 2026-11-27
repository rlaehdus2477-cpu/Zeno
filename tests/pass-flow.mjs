// ZENO PASS 자동 테스트 (2026-11-26)
// - worker.js를 wrangler dev --local로 띄우고, 임시 로컬 D1에서만 실행합니다.
// - 운영 데이터베이스(--remote)에는 접속하지 않습니다. 비밀번호·비밀키는 테스트 전용 가짜 값입니다.
// 실행: node tests/pass-flow.mjs
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.ZENO_PASS_TEST_PORT || 8798);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = 'zeno-pass-test-only-secret';
const PINS = {soo: 'soo-test-pin', naeum: 'naeum-test-pin', pub045: 'tplus-test-pin'};
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PERSIST = fs.mkdtempSync(path.join(os.tmpdir(), 'zeno-pass-d1-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');

const results = [];
async function check(no, title, fn) {
  const cur = {no, title, ok: true, notes: []};
  try { await fn(); } catch (err) { cur.ok = false; cur.notes.push(err.message); }
  results.push(cur);
  console.log(`${cur.ok ? 'PASS' : 'FAIL'}  ${no}. ${title}${cur.ok ? '' : '\n      → ' + cur.notes.join('\n      → ')}`);
}
function expect(cond, message) { if (!cond) throw new Error(message); }
async function api(method, url, {token, body} = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: {'content-type': 'application/json', ...(token ? {authorization: 'Bearer ' + token} : {})},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get('content-type') || '';
  let data = null;
  if (type.includes('json')) { try { data = await res.json(); } catch {} }
  else { data = await res.text(); }
  return {status: res.status, data, type};
}
const kstDate = d => new Date(Date.now() + 9 * 3600e3 + d * 86400e3).toISOString().slice(0, 10);

function run(cmd, args) {
  const r = spawnSync(cmd, args, {cwd: ROOT, encoding: 'utf8'});
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} 실패\n${r.stdout}\n${r.stderr}`);
}
let server;
async function startServer() {
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
    try { const r = await api('GET', '/api/ping'); if (r.status === 200 && r.data?.connected) return; } catch {}
  }
  throw new Error('로컬 서버가 시작되지 않았습니다.\n' + log.slice(-3000));
}
function stopServer() {
  if (server?.pid) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
  fs.rmSync(PERSIST, {recursive: true, force: true});
}
async function register(name) {
  const r = await api('POST', '/api/auth/register', {body: {username: name, password: 'test-password-' + name.slice(-4), displayName: name}});
  if (r.status !== 201) throw new Error('보호자 가입 실패: ' + JSON.stringify(r));
  return {token: r.data.token, id: r.data.owner.id};
}
async function hospitalLogin(id) {
  const r = await api('POST', '/api/login', {body: {hospitalId: id, pin: PINS[id]}});
  if (r.status !== 200) throw new Error('병원 로그인 실패: ' + JSON.stringify(r));
  return r.data.token;
}

const ctx = {};
async function sectionCore() {
  ctx.A = await register('pass_owner_a');
  ctx.B = await register('pass_owner_b');
  await check('P1', 'PASS 상태: 비로그인 401, 가입 직후 미가입', async () => {
    expect((await api('GET', '/api/pass')).status === 401, '비로그인 조회가 401이 아님');
    const r = await api('GET', '/api/pass', {token: ctx.A.token});
    expect(r.status === 200 && r.data.pass.active === false && r.data.pass.status === 'none', '가입 직후 상태 이상: ' + JSON.stringify(r.data));
    expect(r.data.pass.priceKrw === 1800 && r.data.pass.billing === 'pilot-free', '요금·결제 표시 이상');
  });
  await check('P2', 'PASS 시작: 동의 없으면 거절, 동의하면 이용 중', async () => {
    const no = await api('POST', '/api/pass/start', {token: ctx.A.token, body: {}});
    expect(no.status === 400, '동의 없이 시작됨: ' + no.status);
    const ok = await api('POST', '/api/pass/start', {token: ctx.A.token, body: {agree: true}});
    expect(ok.status === 200 && ok.data.pass.active, '시작 실패: ' + JSON.stringify(ok.data));
    const b = await api('GET', '/api/pass', {token: ctx.B.token});
    expect(b.data.pass.active === false, '다른 보호자에게 PASS가 적용됨');
  });
  await check('P3', 'PASS 해지·재시작', async () => {
    const c = await api('POST', '/api/pass/cancel', {token: ctx.A.token, body: {}});
    expect(c.status === 200 && c.data.pass.status === 'cancelled' && c.data.pass.cancelledAt, '해지 실패');
    const again = await api('POST', '/api/pass/cancel', {token: ctx.A.token, body: {}});
    expect(again.status === 409, '중복 해지가 409가 아님: ' + again.status);
    const re = await api('POST', '/api/pass/start', {token: ctx.A.token, body: {agree: true}});
    expect(re.status === 200 && re.data.pass.active, '재시작 실패');
  });
}

async function sectionRx() {
  const A = ctx.A.token, B = ctx.B.token;
  const SOO = await hospitalLogin('soo'), NAEUM = await hospitalLogin('naeum');
  let custom, req1;
  await check('R1', '처방식 재고: PASS 없으면 403, PASS 회원은 조회', async () => {
    expect((await api('GET', '/api/pass/rx-stock', {token: B})).status === 403, 'PASS 없는 보호자가 재고를 봄');
    const r = await api('GET', '/api/pass/rx-stock', {token: A});
    expect(r.status === 200 && Array.isArray(r.data.items), 'PASS 회원 조회 실패');
  });
  await check('R2', '병원 재고 등록: 목록 제품·직접 입력, 잘못된 값 거절, 보호자 토큰 거절', async () => {
    const a = await api('PUT', '/api/hospital/rx/stock', {token: SOO, body: {productId: 'rc-cat-renal-select-dry', status: 'in'}});
    expect(a.status === 200 && a.data.productName.includes('레날 셀렉트') && a.data.checkedAt, '목록 제품 등록 실패 ' + JSON.stringify(a.data));
    const c = await api('PUT', '/api/hospital/rx/stock', {token: SOO, body: {productName: '테스트 처방식 캔', status: 'out'}});
    expect(c.status === 200 && c.data.productId.startsWith('custom-'), '직접 입력 등록 실패');
    custom = c.data.productId;
    expect((await api('PUT', '/api/hospital/rx/stock', {token: SOO, body: {productId: 'rc-cat-renal-pouch', status: 'many'}})).status === 400, '잘못된 상태가 저장됨');
    expect((await api('PUT', '/api/hospital/rx/stock', {token: A, body: {productId: 'rc-cat-renal-pouch', status: 'in'}})).status === 401, '보호자가 병원 재고를 바꿈');
    const n = await api('GET', '/api/hospital/rx', {token: NAEUM});
    expect(n.status === 200 && n.data.stock.length === 0, '다른 병원 재고가 보임');
    expect(n.data.catalog.every(p => p.id && p.name) && n.data.catalog.length >= 1, '처방식 목록 없음');
  });
  await check('R3', '확보 요청: 처방 확인·품절·비제휴·PASS 검증', async () => {
    const base = {hospitalId: 'soo', productId: 'rc-cat-renal-select-dry', petName: '테스트냥', quantity: 2, note: '토요일 방문'};
    expect((await api('POST', '/api/pass/rx-requests', {token: A, body: base})).status === 400, '처방 확인 없이 요청됨');
    expect((await api('POST', '/api/pass/rx-requests', {token: A, body: {...base, prescribed: true, productId: custom}})).status === 409, '품절 제품 요청됨');
    expect((await api('POST', '/api/pass/rx-requests', {token: A, body: {...base, prescribed: true, hospitalId: 'tnd'}})).status === 400, '비제휴 병원 요청됨');
    expect((await api('POST', '/api/pass/rx-requests', {token: B, body: {...base, prescribed: true}})).status === 403, 'PASS 없는 보호자 요청됨');
    expect((await api('POST', '/api/pass/rx-requests', {token: A, body: {...base, prescribed: true, quantity: 50}})).status === 400, '수량 제한 없음');
    const ok = await api('POST', '/api/pass/rx-requests', {token: A, body: {...base, prescribed: true}});
    expect(ok.status === 201 && ok.data.status === 'pending' && ok.data.payment === '현장 결제', '요청 실패 ' + JSON.stringify(ok.data));
    req1 = ok.data.id;
  });
  await check('R4', '병원 처리: 다른 병원 403, 수량·기한 검증, 수락 → 보호자 반영', async () => {
    const list = await api('GET', '/api/hospital/rx', {token: SOO});
    const seen = list.data.requests.find(q => q.id === req1);
    expect(seen && seen.ownerName && seen.petName === '테스트냥' && seen.quantity === 2, '병원 화면에 요청이 안 보임');
    expect((await api('PATCH', `/api/hospital/rx/requests/${req1}`, {token: NAEUM, body: {action: 'accept', availableQty: 1, visitBy: kstDate(2)}})).status === 403, '다른 병원이 수락함');
    expect((await api('PATCH', `/api/hospital/rx/requests/${req1}`, {token: SOO, body: {action: 'accept', availableQty: 3, visitBy: kstDate(2)}})).status === 400, '요청보다 많은 수량 수락');
    expect((await api('PATCH', `/api/hospital/rx/requests/${req1}`, {token: SOO, body: {action: 'accept', availableQty: 2, visitBy: '2020-01-01'}})).status === 400, '지난 날짜 기한 허용');
    const ok = await api('PATCH', `/api/hospital/rx/requests/${req1}`, {token: SOO, body: {action: 'accept', availableQty: 2, visitBy: kstDate(3), note: '접수처에서 이름 말씀해 주세요'}});
    expect(ok.status === 200 && ok.data.status === 'accepted', '수락 실패');
    const mine = (await api('GET', '/api/pass/rx', {token: A})).data.requests.find(q => q.id === req1);
    expect(mine?.status === 'accepted' && mine.availableQty === 2 && mine.visitBy === kstDate(3) && mine.hospitalNote, '보호자 화면에 수락 내용 미반영');
    expect(!(await api('GET', '/api/pass/rx', {token: B})).data.requests.length, '다른 보호자에게 요청이 보임');
    expect((await api('POST', `/api/pass/rx-requests/${req1}/cancel`, {token: B, body: {}})).status === 403, '다른 보호자가 취소함');
    const picked = await api('PATCH', `/api/hospital/rx/requests/${req1}`, {token: SOO, body: {action: 'picked_up'}});
    expect(picked.status === 200 && picked.data.status === 'picked_up', '수령 완료 실패');
  });
  await check('R5', '거절은 사유 필수, 보호자 취소 반영', async () => {
    const mk = async () => (await api('POST', '/api/pass/rx-requests', {token: A, body: {hospitalId: 'soo', productId: 'rc-cat-renal-select-dry', petName: '테스트냥', quantity: 1, prescribed: true}})).data.id;
    const r2 = await mk(), r3 = await mk();
    expect((await api('PATCH', `/api/hospital/rx/requests/${r2}`, {token: SOO, body: {action: 'reject'}})).status === 400, '사유 없이 거절됨');
    expect((await api('PATCH', `/api/hospital/rx/requests/${r2}`, {token: SOO, body: {action: 'reject', note: '다음 주 입고 예정'}})).data.status === 'rejected', '거절 실패');
    expect((await api('POST', `/api/pass/rx-requests/${r3}/cancel`, {token: A, body: {}})).data.status === 'cancelled', '취소 실패');
    const hosp = (await api('GET', '/api/hospital/rx', {token: SOO})).data.requests;
    expect(hosp.find(q => q.id === r3)?.status === 'cancelled', '병원 화면에 취소 미반영');
  });
  await check('R6', '입고 알림: 품절 제품만 신청, 품절 → 재고 있음 변경 시 알림 표시', async () => {
    expect((await api('POST', '/api/pass/rx-alerts', {token: A, body: {hospitalId: 'soo', productId: 'rc-cat-renal-select-dry'}})).status === 409, '재고 있는 제품에 알림 신청됨');
    expect((await api('POST', '/api/pass/rx-alerts', {token: A, body: {hospitalId: 'soo', productId: custom}})).status === 201, '알림 신청 실패');
    expect((await api('GET', '/api/hospital/rx', {token: SOO})).data.waitingAlerts[custom] === 1, '병원에 대기 인원 미표시');
    await api('PUT', '/api/hospital/rx/stock', {token: SOO, body: {productName: '테스트 처방식 캔', status: 'low'}});
    const al = (await api('GET', '/api/pass/rx', {token: A})).data.alerts.find(a => a.productId === custom);
    expect(al?.status === 'notified' && al.notifiedAt, '입고 알림이 표시되지 않음');
  });
  await check('R7', 'PASS 해지 후: 기록 열람 가능, 재고 조회·새 요청 불가', async () => {
    await api('POST', '/api/pass/cancel', {token: A, body: {}});
    const hist = await api('GET', '/api/pass/rx', {token: A});
    expect(hist.status === 200 && hist.data.requests.length >= 3, '해지 후 기록이 안 보임');
    expect((await api('GET', '/api/pass/rx-stock', {token: A})).status === 403, '해지 후 재고 조회됨');
    expect((await api('POST', '/api/pass/rx-requests', {token: A, body: {hospitalId: 'soo', productId: 'rc-cat-renal-select-dry', petName: 'x', quantity: 1, prescribed: true}})).status === 403, '해지 후 요청됨');
    await api('POST', '/api/pass/start', {token: A, body: {agree: true}});
  });
}

async function sectionFees() {
  const A = ctx.A.token, B = ctx.B.token;
  await check('F1', '진료비 통합 비교 설정: PASS 전용, 값 검증, 저장 유지', async () => {
    expect((await api('GET', '/api/pass/fee-plan', {token: B})).status === 403, 'PASS 없는 보호자 조회됨');
    expect((await api('PUT', '/api/pass/fee-plan', {token: B, body: {items: [{name: '초진 진찰료', count: 1}]}})).status === 403, 'PASS 없는 보호자 저장됨');
    expect((await api('PUT', '/api/pass/fee-plan', {token: A, body: {items: [{name: '초진 진찰료', count: 0}]}})).status === 400, '0회 저장됨');
    expect((await api('PUT', '/api/pass/fee-plan', {token: A, body: {items: [{name: '초진 진찰료', count: 1}, {name: '초진 진찰료', count: 2}]}})).status === 400, '중복 항목 저장됨');
    expect((await api('PUT', '/api/pass/fee-plan', {token: A, body: {items: Array.from({length: 13}, (_, i) => ({name: '항목' + i, count: 1}))}})).status === 400, '13개 저장됨');
    const items = [{name: '초진 진찰료', count: 2}, {name: '고양이 종합백신', count: 1}];
    expect((await api('PUT', '/api/pass/fee-plan', {token: A, body: {items}})).status === 200, '저장 실패');
    const got = await api('GET', '/api/pass/fee-plan', {token: A});
    expect(JSON.stringify(got.data.plan.items) === JSON.stringify(items), '저장한 설정이 다름 ' + JSON.stringify(got.data));
  });
}

async function sectionNutrition() {
  const A = ctx.A.token, B = ctx.B.token;
  await api('PUT', '/api/profile', {token: A, body: {pets: [{id: 'cat1', name: '노아', species: '고양이', age: '5살', weight: '4kg', homeHospitalId: ''}, {id: 'dog1', name: '콩이', species: '강아지', age: '3살', weight: '3kg', homeHospitalId: ''}], records: [], favorites: []}});
  await check('N1', '영양 관리: PASS 전용, 공식 출처 있는 일반 사료·처방식 목록, 브랜드 상태', async () => {
    expect((await api('GET', '/api/pass/nutrition', {token: B})).status === 403, 'PASS 없는 보호자 조회됨');
    const r = await api('GET', '/api/pass/nutrition', {token: A});
    expect(r.status === 200 && r.data.pets.length === 2, '조회 실패');
    const gen = r.data.catalog.filter(p => p.kind === '일반식'), rx = r.data.catalog.filter(p => p.kind === '처방식');
    expect(gen.length >= 30 && rx.length === 17, '사료 수 이상 ' + gen.length + '/' + rx.length);
    expect(r.data.generalCatalogStatus === 'ready', '일반 사료 상태가 준비 중');
    const official = /^https:\/\/(www\.royalcanin\.com\/kr\/|www\.hillspet\.co\.kr\/|apac\.acana\.com\/ko-KR\/|apac\.orijenpetfoods\.com\/ko-KR\/|www\.doowonpet\.co\.kr\/orijen\/|healmedix\.com\/)/;
    expect(r.data.catalog.every(p => official.test(p.url) && p.checked && p.source), '공식 출처·확인일 없는 제품 있음');
    expect(gen.every(p => p.analysis && ['asFed', 'dryMatter'].includes(p.analysis.basis) && ['건식', '습식'].includes(p.form) && ['강아지', '고양이'].includes(p.species)), '일반 사료 필드 누락');
    expect(gen.every(p => !p.price && !p.priceKrw), '판매가가 들어 있음');
    const brands = Object.fromEntries(r.data.brands.map(b => [b.brand, b.status]));
    expect(brands['퓨리나 프로플랜'] === 'unverified' && !gen.some(p => p.brand === '퓨리나 프로플랜'), '미확인 브랜드 제품이 등록됨');
    expect(rx.filter(p => p.brand === '닥터 힐메딕스').length === 11 && rx.filter(p => p.brand === '닥터 힐메딕스').every(p => p.conditions.length && p.analysis && p.feeding), '닥터 힐메딕스 처방식 이상');
    expect(gen.filter(p => p.species === '고양이').length >= 10 && gen.filter(p => p.species === '강아지').length >= 20, '종별 제품 수 이상');
  });
  await check('N2', '아이 정보 저장: 체형·활동량, 처방식 권고는 진단 필요, 남의 아이·잘못된 값 거절', async () => {
    expect((await api('PUT', '/api/pass/nutrition/profile/cat1', {token: A, body: {vetRecommended: true, conditions: []}})).status === 400, '진단 없이 권고 저장됨');
    expect((await api('PUT', '/api/pass/nutrition/profile/nope', {token: A, body: {}})).status === 404, '없는 아이 저장됨');
    expect((await api('PUT', '/api/pass/nutrition/profile/cat1', {token: A, body: {budgetMonthly: -1}})).status === 400, '음수 예산 저장됨');
    const ok = await api('PUT', '/api/pass/nutrition/profile/cat1', {token: A, body: {neutered: 'yes', bodyCondition: 'over', activity: 'low', conditions: ['신장 질환', '없는질환'], vetRecommended: true, allergies: ['닭'], budgetMonthly: 60000}});
    expect(ok.status === 200 && ok.data.profile.conditions.join() === '신장 질환' && ok.data.profile.bodyCondition === 'over' && ok.data.profile.activity === 'low', '저장 실패 ' + JSON.stringify(ok.data));
    const bad = await api('PUT', '/api/pass/nutrition/profile/dog1', {token: A, body: {bodyCondition: 'huge', activity: 'x'}});
    expect(bad.status === 200 && bad.data.profile.bodyCondition === 'unknown' && bad.data.profile.activity === 'unknown', '잘못된 체형·활동량이 그대로 저장됨');
    expect((await api('PUT', '/api/pass/nutrition/profile/cat1', {token: B, body: {}})).status === 403, 'PASS 없는 보호자 저장됨');
  });
  await check('N3', '가격·용량·하루 급여량: 저장·수정·삭제, 아이별 분리, 값 검증', async () => {
    const pid = 'rc-cat-indoor-27';
    expect((await api('PUT', '/api/pass/nutrition/prices', {token: A, body: {productId: pid, price: 50000, packageG: 5}})).status === 400, '너무 작은 용량 저장됨');
    expect((await api('PUT', '/api/pass/nutrition/prices', {token: A, body: {productId: 'nope', price: 50000, packageG: 2000}})).status === 404, '없는 제품 저장됨');
    expect((await api('PUT', '/api/pass/nutrition/prices', {token: A, body: {productId: pid, price: 52000, packageG: 4000}})).status === 200, '가격 저장 실패');
    const up = await api('PUT', '/api/pass/nutrition/prices', {token: A, body: {productId: pid, price: 48000, packageG: 4000}});
    expect(up.data.prices[pid].price === 48000, '가격 수정 실패');
    expect((await api('PUT', '/api/pass/nutrition/daily', {token: A, body: {petId: 'cat1', productId: pid, dailyG: 0}})).status === 400, '0g 저장됨');
    expect((await api('PUT', '/api/pass/nutrition/daily', {token: A, body: {petId: 'ghost', productId: pid, dailyG: 50}})).status === 404, '없는 아이 급여량 저장됨');
    const d = await api('PUT', '/api/pass/nutrition/daily', {token: A, body: {petId: 'cat1', productId: pid, dailyG: 55.5}});
    expect(d.status === 200 && d.data.daily.cat1[pid] === 55.5 && !d.data.daily.dog1, '급여량 저장 실패');
    expect((await api('PUT', '/api/pass/nutrition/daily', {token: B, body: {petId: 'cat1', productId: pid, dailyG: 50}})).status === 403, 'PASS 없는 보호자 저장됨');
    const r = await api('GET', '/api/pass/nutrition', {token: A});
    expect(r.data.prices[pid].packageG === 4000 && r.data.daily.cat1[pid] === 55.5, '다시 불러온 값 다름');
    // 계산식 확인: 48,000원 / 4,000g × 55.5g = 666원/일, 30일 19,980원, 소진 72일
    const day = 48000 / 4000 * 55.5;
    expect(Math.round(day) === 666 && Math.round(day * 30) === 19980 && Math.floor(4000 / 55.5) === 72, '비용 계산식 확인 실패');
    const del = await api('PUT', '/api/pass/nutrition/prices', {token: A, body: {productId: pid, price: null}});
    const deld = await api('PUT', '/api/pass/nutrition/daily', {token: A, body: {petId: 'cat1', productId: pid, dailyG: null}});
    expect(del.status === 200 && !del.data.prices[pid] && !deld.data.daily.cat1[pid], '삭제 실패');
  });
}

async function sectionReceipts() {
  const A = ctx.A.token, B = ctx.B.token;
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  let r1, photoId;
  await check('C1', '영수증 등록: PASS 전용, 사진 비공개 저장, 자동 인식 없으면 직접 입력', async () => {
    expect((await api('POST', '/api/pass/receipts/photo', {token: B, body: {image: png}})).status === 403, 'PASS 없는 보호자 사진 업로드됨');
    expect((await api('POST', '/api/pass/receipts/photo', {token: A, body: {image: 'data:text/html;base64,PGI+'}})).status === 400, '이미지가 아닌 파일 허용');
    const up = await api('POST', '/api/pass/receipts/photo', {token: A, body: {image: png}});
    expect(up.status === 201 && up.data.photoId && ['unavailable', 'failed', 'done'].includes(up.data.ocr.status), '사진 업로드 실패 ' + JSON.stringify(up.data));
    photoId = up.data.photoId;
    const base = {petId: 'cat1', hospitalId: 'soo', hospitalName: '수동물병원', visitDate: kstDate(-3), total: 55000, items: [{name: '진찰료', amount: 10000}, {name: '혈액검사', amount: 45000}], memo: '정기 검진'};
    expect((await api('POST', '/api/pass/receipts', {token: A, body: {...base, petId: 'other'}})).status === 400, '남의 아이로 저장됨');
    expect((await api('POST', '/api/pass/receipts', {token: A, body: {...base, visitDate: kstDate(5)}})).status === 400, '미래 날짜 저장됨');
    expect((await api('POST', '/api/pass/receipts', {token: B, body: base})).status === 403, 'PASS 없는 보호자 저장됨');
    const ok = await api('POST', '/api/pass/receipts', {token: A, body: {...base, photoId}});
    expect(ok.status === 201 && ok.data.hasPhoto && ok.data.source === 'photo' && ok.data.items.length === 2, '저장 실패 ' + JSON.stringify(ok.data));
    r1 = ok.data.id;
    const nonPartner = await api('POST', '/api/pass/receipts', {token: A, body: {...base, hospitalId: '', hospitalName: '서울 어느 동물병원', total: 12000, items: []}});
    expect(nonPartner.status === 201, '비제휴·목록 밖 병원 영수증 저장 실패');
    expect((await api('POST', '/api/pass/receipts', {token: A, body: {...base, photoId}})).status === 404, '같은 사진을 두 영수증에 연결함');
  });
  await check('C2', '사진·기록 접근: 본인만, 다른 보호자 403/404', async () => {
    const mine = await api('GET', `/api/receipts/${r1}/photo`, {token: A});
    expect(mine.status === 200 && mine.type.startsWith('image/png'), '본인 사진 조회 실패');
    expect((await api('GET', `/api/receipts/${r1}/photo`, {token: B})).status === 404, '다른 보호자가 사진 조회');
    expect((await api('GET', `/api/receipts/${r1}/photo`)).status === 401, '비로그인 사진 조회');
    expect(!(await api('GET', '/api/receipts', {token: B})).data.receipts.length, '다른 보호자에게 영수증 보임');
    expect((await api('PATCH', `/api/receipts/${r1}`, {token: B, body: {}})).status === 403, '다른 보호자가 수정');
    expect((await api('DELETE', `/api/receipts/${r1}`, {token: B})).status === 403, '다른 보호자가 삭제');
  });
  await check('C3', '수정·통계용 목록·내보내기, 해지 후에도 열람·내보내기 가능', async () => {
    const ed = await api('PATCH', `/api/receipts/${r1}`, {token: A, body: {petId: 'cat1', hospitalId: 'soo', hospitalName: '수동물병원', visitDate: kstDate(-3), total: 60000, items: [], memo: '수정함'}});
    expect(ed.status === 200 && ed.data.total === 60000 && ed.data.memo === '수정함', '수정 실패');
    await api('POST', '/api/pass/cancel', {token: A, body: {}});
    const list = await api('GET', '/api/receipts', {token: A});
    expect(list.status === 200 && list.data.receipts.length === 2, '해지 후 목록이 안 보임');
    const csv = await api('GET', '/api/receipts/export', {token: A});
    expect(csv.status === 200 && csv.type.startsWith('text/csv') && csv.data.includes('수동물병원') && csv.data.includes('노아'), 'CSV 내보내기 실패');
    const js = await api('GET', '/api/receipts/export?format=json', {token: A});
    expect(js.status === 200 && js.data.receipts.length === 2, 'JSON 내보내기 실패');
    expect((await api('GET', `/api/receipts/${r1}/photo`, {token: A})).status === 200, '해지 후 사진 열람 불가');
    expect((await api('POST', '/api/pass/receipts/photo', {token: A, body: {image: png}})).status === 403, '해지 후 새 등록 가능');
    const del = await api('DELETE', `/api/receipts/${r1}`, {token: A});
    expect(del.status === 200 && (await api('GET', `/api/receipts/${r1}/photo`, {token: A})).status === 404, '삭제 후 사진이 남음');
    await api('POST', '/api/pass/start', {token: A, body: {agree: true}});
  });
  await check('C4', '큰 사진 업로드(약 800KB)도 저장', async () => {
    const big = 'data:image/jpeg;base64,' + Buffer.alloc(600000, 7).toString('base64');
    const up = await api('POST', '/api/pass/receipts/photo', {token: A, body: {image: big, ocr: false}});
    expect(up.status === 201, '큰 사진 저장 실패 ' + up.status + ' ' + JSON.stringify(up.data));
  });
  await check('C5', '같은 날 두 아이를 함께 진료한 영수증 1장: 아이별 금액 저장·검증·수정·내보내기', async () => {
    const base = {petId: 'cat1', hospitalId: '', hospitalName: '센트동물병원', visitDate: kstDate(-1), total: 150000, items: [], memo: ''};
    const two = [{petId: 'cat1', amount: 80000}, {petId: 'dog1', amount: 70000}];
    expect((await api('POST', '/api/pass/receipts', {token: A, body: {...base, pets: [{petId: 'cat1', amount: 80000}, {petId: 'dog1', amount: 60000}]}})).status === 400, '합계가 총액과 다른데 저장됨');
    expect((await api('POST', '/api/pass/receipts', {token: A, body: {...base, pets: [{petId: 'cat1', amount: 75000}, {petId: 'cat1', amount: 75000}]}})).status === 400, '같은 아이 중복 저장됨');
    expect((await api('POST', '/api/pass/receipts', {token: A, body: {...base, pets: [{petId: 'cat1', amount: 80000}, {petId: 'other', amount: 70000}]}})).status === 400, '남의 아이 포함 저장됨');
    expect((await api('POST', '/api/pass/receipts', {token: A, body: {...base, pets: []}})).status === 400, '아이 없이 저장됨');
    expect((await api('POST', '/api/pass/receipts', {token: A, body: {...base, pets: [{petId: 'cat1', amount: -1}, {petId: 'dog1', amount: 150001}]}})).status === 400, '음수 금액 저장됨');
    for (const amount of [null, '', ' ', false]) {
      expect((await api('POST', '/api/pass/receipts', {token: A, body: {...base, pets: [{petId: 'cat1', amount}, {petId: 'dog1', amount: 150000}]}})).status === 400, '빈 금액 또는 불리언 허용');
    }
    expect((await api('POST', '/api/pass/receipts', {token: A, body: {...base, total: null, pets: [{petId: 'cat1', amount: 0}]}})).status === 400, '빈 총액 허용');
    const ok = await api('POST', '/api/pass/receipts', {token: A, body: {...base, pets: two}});
    expect(ok.status === 201 && ok.data.pets.length === 2 && ok.data.pets[1].amount === 70000 && ok.data.petId === 'cat1', '두 아이 저장 실패 ' + JSON.stringify(ok.data));
    const id = ok.data.id;
    const list = (await api('GET', '/api/receipts', {token: A})).data.receipts;
    const mine = list.find(x => x.id === id);
    expect(mine && mine.pets.map(x => x.petId).join() === 'cat1,dog1', '목록에 아이별 금액 없음');
    expect(list.filter(x => x.id !== id).every(x => x.pets.length === 1 && x.pets[0].amount === x.total), '예전 한 마리 영수증 호환 깨짐');
    const ed = await api('PATCH', `/api/receipts/${id}`, {token: A, body: {...base, total: 160000, pets: [{petId: 'dog1', amount: 100000}, {petId: 'cat1', amount: 60000}]}});
    expect(ed.status === 200 && ed.data.pets[0].petId === 'dog1' && ed.data.pets[0].amount === 100000 && ed.data.petId === 'dog1', '아이별 금액 수정 실패');
    const one = await api('PATCH', `/api/receipts/${id}`, {token: A, body: {...base, pets: [{petId: 'cat1'}]}});
    expect(one.status === 200 && one.data.pets.length === 1 && one.data.pets[0].amount === 150000, '한 마리로 되돌리기 실패');
    await api('PATCH', `/api/receipts/${id}`, {token: A, body: {...base, pets: two}});
    const csv = await api('GET', '/api/receipts/export', {token: A});
    const rows = csv.data.split('\r\n').filter(l => l.includes('센트동물병원'));
    expect(rows.length === 2 && rows.some(l => l.includes('노아,80000')) && rows.some(l => l.includes('콩이,70000')), 'CSV 아이별 줄 없음\n' + rows.join('\n'));
    const js = await api('GET', '/api/receipts/export?format=json', {token: A});
    expect(js.data.receipts.find(x => x.id === id).pets.map(x => x.petName).join() === '노아,콩이', 'JSON 아이 이름 없음');
    expect((await api('DELETE', `/api/receipts/${id}`, {token: A})).status === 200, '삭제 실패');
    expect(!(await api('GET', '/api/receipts', {token: A})).data.receipts.some(x => x.id === id), '삭제 후 남음');
  });
}

const SECTIONS = [sectionCore, sectionRx, sectionFees, sectionNutrition, sectionReceipts];
let fatal = null;
try {
  await startServer();
  console.log('로컬 서버 준비 완료 (로컬 D1 전용)\n');
  for (const section of SECTIONS) await section();
} catch (err) { fatal = err; }
stopServer();
if (fatal) { console.error('\n테스트 실행 실패: ' + fatal.message); process.exit(1); }
const failed = results.filter(r => !r.ok);
console.log(`\n결과: ${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
