// ZENO 예약 흐름 자동 테스트
// - worker.js를 wrangler dev --local로 띄우고, 로컬 D1(임시 폴더)에서만 실행합니다.
// - 운영 데이터베이스(--remote)에는 접속하지 않습니다.
// - 비밀번호·비밀키는 테스트 전용 가짜 값이며 실제 값과 무관합니다.
// 실행: node tests/booking-flow.mjs
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {webcrypto as crypto} from 'node:crypto';

const PORT = Number(process.env.ZENO_TEST_PORT || 8799);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = 'zeno-test-only-secret-not-production';
const PINS = {soo: 'soo-test-pin', naeum: 'naeum-test-pin', tnd: 'tnd-test-pin'};
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
  const vars = [['SESSION_SECRET', SECRET], ['HOSPITAL_SOO_PIN', PINS.soo], ['HOSPITAL_NAEUM_PIN', PINS.naeum], ['HOSPITAL_TND_PIN', PINS.tnd]]
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
async function main() {
  await startServer();
  console.log('로컬 서버 준비 완료 (로컬 D1 전용)\n');

  // 준비: 보호자 A, B 가입 / 병원 로그인
  const regA = await api('POST', '/api/auth/register', {body: {username: 'test_owner_a', password: 'test-password-a1', displayName: '테스트A'}});
  const regB = await api('POST', '/api/auth/register', {body: {username: 'test_owner_b', password: 'test-password-b1', displayName: '테스트B'}});
  if (regA.status !== 201 || regB.status !== 201) throw new Error('보호자 가입 실패: ' + JSON.stringify([regA, regB]));
  const A = regA.data.token, B = regB.data.token;
  const sooLogin = await api('POST', '/api/login', {body: {hospitalId: 'soo', pin: PINS.soo}});
  const naeumLogin = await api('POST', '/api/login', {body: {hospitalId: 'naeum', pin: PINS.naeum}});
  if (sooLogin.status !== 200 || naeumLogin.status !== 200) throw new Error('병원 로그인 실패: ' + JSON.stringify([sooLogin, naeumLogin]));
  const SOO = sooLogin.data.token, NAEUM = naeumLogin.data.token;
  const ownerBookings = async t => (await api('GET', '/api/bootstrap', {token: t})).data?.bookings || [];
  const sooBookings = async () => (await api('GET', '/api/dashboard?hospitalId=soo', {token: SOO})).data?.bookings || [];

  let b1, b2, b3, b4;

  await check(1, '예약 기본 흐름: 보호자 A 예약 → 확인 대기(pending)', async () => {
    const r = await api('POST', '/api/bookings', {token: A, body: bookingBody('soo', '테스트냥1')});
    expect(r.status === 201, `예약 생성 응답 ${r.status} ${JSON.stringify(r.data)}`);
    b1 = r.data.id;
    const mine = findBooking(await ownerBookings(A), b1);
    expect(mine, 'A의 내 예약에 없음');
    expect(mine.status === 'pending', `상태가 pending이 아님: ${mine.status}`);
  });

  await check(2, '병원 확인: 수동물병원 화면에 A의 예약이 보임', async () => {
    const found = findBooking(await sooBookings(), b1);
    expect(found, '병원 dashboard에 예약이 없음');
    expect(found.ownerPhone === '01012345678' && found.visitType === '첫 방문', '보호자 연락처·방문 구분이 병원에 전달되지 않음');
  });

  await check(3, '수락 반영: 병원 수락 → 보호자 화면 accepted', async () => {
    const r = await api('PATCH', `/api/bookings/${b1}`, {token: SOO, body: {status: 'accepted'}});
    expect(r.status === 200, `수락 응답 ${r.status} ${JSON.stringify(r.data)}`);
    expect(findBooking(await ownerBookings(A), b1)?.status === 'accepted', '보호자 화면에 accepted 반영 안 됨');
  });

  await check(4, '시간 제안: 과거 시각 거절, 미래 시각 제안 → 보호자 확정', async () => {
    const r = await api('POST', '/api/bookings', {token: A, body: bookingBody('soo', '테스트냥2')});
    expect(r.status === 201, '예약 생성 실패');
    b2 = r.data.id;
    const past = await api('PATCH', `/api/bookings/${b2}`, {token: SOO, body: {status: 'suggested', proposedAt: '2020-01-01T10:00'}});
    expect(past.status === 400, `과거 시각 제안이 거절되지 않음 (${past.status})`);
    const future = kstDate(3) + 'T14:00';
    const s = await api('PATCH', `/api/bookings/${b2}`, {token: SOO, body: {status: 'suggested', proposedAt: future}});
    expect(s.status === 200, `시간 제안 응답 ${s.status} ${JSON.stringify(s.data)}`);
    const seen = findBooking(await ownerBookings(A), b2);
    expect(seen?.status === 'suggested' && seen.proposedAt === future, '보호자 화면에 제안 시간이 반영 안 됨');
    const c = await api('PATCH', `/api/bookings/${b2}`, {token: A, body: {status: 'confirmed', side: 'owner'}});
    expect(c.status === 200, `보호자 확정 응답 ${c.status} ${JSON.stringify(c.data)}`);
    expect(findBooking(await sooBookings(), b2)?.status === 'confirmed', '병원 화면에 confirmed 반영 안 됨');
  });

  await check(5, '거절·취소 반영: 병원 거절, 보호자 취소가 양쪽에 반영', async () => {
    b3 = (await api('POST', '/api/bookings', {token: A, body: bookingBody('soo', '테스트냥3')})).data?.id;
    b4 = (await api('POST', '/api/bookings', {token: A, body: bookingBody('soo', '테스트냥4')})).data?.id;
    expect(b3 && b4, '예약 생성 실패');
    const rej = await api('PATCH', `/api/bookings/${b3}`, {token: SOO, body: {status: 'rejected', hospitalNote: '테스트 거절'}});
    expect(rej.status === 200, `거절 응답 ${rej.status}`);
    const can = await api('PATCH', `/api/bookings/${b4}`, {token: A, body: {status: 'cancelled', side: 'owner'}});
    expect(can.status === 200, `취소 응답 ${can.status}`);
    expect(findBooking(await ownerBookings(A), b3)?.status === 'rejected', '보호자 화면에 거절 반영 안 됨');
    expect(findBooking(await sooBookings(), b4)?.status === 'cancelled', '병원 화면에 취소 반영 안 됨');
  });

  await check(6, '다시 불러와도 유지: 모든 상태가 새 요청에서도 그대로', async () => {
    const owner = await ownerBookings(A), hosp = await sooBookings();
    const want = {[b1]: 'accepted', [b2]: 'confirmed', [b3]: 'rejected', [b4]: 'cancelled'};
    for (const [id, st] of Object.entries(want)) {
      expect(findBooking(owner, id)?.status === st, `보호자 쪽 ${id.slice(0, 8)} 상태 ${findBooking(owner, id)?.status} ≠ ${st}`);
      expect(findBooking(hosp, id)?.status === st, `병원 쪽 ${id.slice(0, 8)} 상태 ${findBooking(hosp, id)?.status} ≠ ${st}`);
    }
  });

  await check(7, '보호자 분리: B에게 A의 예약이 안 보이고, 바꿀 수도 없음', async () => {
    const bList = await ownerBookings(B);
    expect(![b1, b2, b3, b4].some(id => findBooking(bList, id)), 'B의 화면에 A의 예약이 보임');
    const asOwner = await api('PATCH', `/api/bookings/${b1}`, {token: B, body: {status: 'cancelled', side: 'owner'}});
    expect(asOwner.status === 403, `B가 A 예약 취소 시도 → ${asOwner.status} (403이어야 함)`);
    const asHospital = await api('PATCH', `/api/bookings/${b1}`, {token: B, body: {status: 'rejected'}});
    expect(asHospital.status === 401, `B가 병원처럼 변경 시도 → ${asHospital.status} (401이어야 함)`);
  });

  await check(8, '병원 분리: 나음 병원은 수동물병원 예약을 보거나 바꿀 수 없음', async () => {
    const n = await api('GET', '/api/dashboard?hospitalId=naeum', {token: NAEUM});
    expect(n.status === 200, `나음 dashboard 응답 ${n.status}`);
    expect(!findBooking(n.data?.bookings, b1), '나음 화면에 수동물병원 예약이 보임');
    const other = await api('GET', '/api/dashboard?hospitalId=soo', {token: NAEUM});
    expect(other.status === 401, `나음 토큰으로 수동물병원 dashboard 조회 → ${other.status} (401이어야 함)`);
    const p = await api('PATCH', `/api/bookings/${b1}`, {token: NAEUM, body: {status: 'rejected'}});
    expect(p.status === 401, `나음 토큰으로 수동물병원 예약 변경 → ${p.status} (401이어야 함)`);
  });

  await check(9, '비제휴 병원: 제휴 3곳 외에는 예약 불가', async () => {
    for (const id of ['pub015', 'unknown', '']) {
      const r = await api('POST', '/api/bookings', {token: A, body: bookingBody(id, '테스트냥9')});
      expect(r.status === 400, `병원 ID "${id}" 예약 → ${r.status} (400이어야 함)`);
    }
  });

  await check(10, '병원 로그인: 비밀번호가 틀리면 401', async () => {
    const r = await api('POST', '/api/login', {body: {hospitalId: 'tnd', pin: 'wrong-pin'}});
    expect(r.status === 401, `틀린 비밀번호 → ${r.status}`);
    expect(!r.data?.token, '틀린 비밀번호에 토큰이 발급됨');
  });

  await check(11, '위조·만료 토큰 거절', async () => {
    const forged = await signToken({role: 'owner', ownerId: regA.data.owner.id, iat: Date.now(), exp: Date.now() + 3600e3}, 'wrong-secret');
    expect((await api('GET', '/api/bootstrap', {token: forged})).status === 401, '다른 키로 서명한 토큰이 통과됨');
    const tampered = A.slice(0, -2) + (A.endsWith('AA') ? 'BB' : 'AA');
    expect((await api('GET', '/api/bootstrap', {token: tampered})).status === 401, '변조한 토큰이 통과됨');
    const expired = await signToken({role: 'owner', ownerId: regA.data.owner.id, iat: Date.now() - 7200e3, exp: Date.now() - 1000}, SECRET);
    expect((await api('GET', '/api/bootstrap', {token: expired})).status === 401, '만료된 토큰이 통과됨');
    const fakeHospital = await signToken({role: 'hospital', hospitalId: 'soo', exp: Date.now() + 3600e3}, 'wrong-secret');
    expect((await api('PATCH', `/api/bookings/${b1}`, {token: fakeHospital, body: {status: 'rejected'}})).status === 401, '위조 병원 토큰이 통과됨');
  });

  await check(12, '후기: 진료 완료 전 불가, 완료 후 1번만', async () => {
    const review = {bookingId: b1, stars: 5, text: '자동 테스트 후기입니다. 친절했어요.'};
    const early = await api('POST', '/api/reviews', {token: A, body: review});
    expect(early.status === 403, `진료 완료 전 후기 → ${early.status} (403이어야 함)`);
    for (const st of ['confirmed', 'in_progress', 'done']) {
      const r = await api('PATCH', `/api/bookings/${b1}`, {token: SOO, body: {status: st}});
      expect(r.status === 200, `${st} 변경 응답 ${r.status}`);
    }
    const byB = await api('POST', '/api/reviews', {token: B, body: review});
    expect(byB.status === 403, `다른 보호자가 후기 작성 → ${byB.status} (403이어야 함)`);
    const ok = await api('POST', '/api/reviews', {token: A, body: review});
    expect(ok.status === 201, `완료 후 후기 → ${ok.status} ${JSON.stringify(ok.data)}`);
    const again = await api('POST', '/api/reviews', {token: A, body: review});
    expect(again.status === 409, `두 번째 후기 → ${again.status} (409여야 함)`);
  });
}

let fatal = null;
try { await main(); } catch (err) { fatal = err; }
finally { stopServer(); }

const failed = results.filter(r => !r.ok);
console.log(`\n결과: ${results.length - failed.length}/${results.length} 통과`);
if (fatal) { console.error('테스트 준비 중 오류:', fatal.message); process.exit(1); }
if (results.length !== 12 || failed.length) process.exit(1);
