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

const SECTIONS = [sectionCore, sectionRx];
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
