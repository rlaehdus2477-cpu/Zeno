// ZENO 입원·야간 관리 자동 테스트 (2026-11-27)
// - worker.js를 wrangler dev --local로 띄우고, 로컬 D1(임시 폴더)에서만 실행합니다.
// - 운영 데이터베이스(--remote)에는 접속하지 않습니다.
// - 비밀번호·비밀키는 테스트 전용 가짜 값이며 실제 값과 무관합니다.
// 실행: node tests/inpatient-care-flow.mjs
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {webcrypto as crypto} from 'node:crypto';

const PORT = Number(process.env.ZENO_TEST_PORT || 8797);
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
const UNKNOWN_KEYS = ['inpatient','nightVet','nightStaff','care24','monitoring','catWard','icu','nightSurgery'];
async function main() {
  await startServer();
  console.log('로컬 서버 준비 완료 (로컬 D1 전용)\n');
  const login = async id => {
    const r = await api('POST', '/api/login', {body: {hospitalId: id, pin: PINS[id]}});
    if (r.status !== 200) throw new Error('병원 로그인 실패 ' + id + ' ' + JSON.stringify(r.data));
    return r.data.token;
  };
  const SOO = await login('soo'), NAEUM = await login('naeum');
  const reg = await api('POST', '/api/auth/register', {body: {username: 'care_owner_a', password: 'care-password-a1', displayName: '입원테스트'}});
  const OWNER = reg.data?.token;

  await check(1, '등록 전: 공개 API에 병원 정보 없음(모두 미확인), 24시간 병원도 자동 설정 안 됨', async () => {
    const r = await api('GET', '/api/public/hospital-care');
    expect(r.status === 200, '공개 조회 실패 ' + r.status);
    expect(r.data.hospitals && Object.keys(r.data.hospitals).length === 0, '등록 전인데 값이 있음: ' + JSON.stringify(r.data.hospitals));
    const d = await api('GET', '/api/dashboard?hospitalId=naeum', {token: NAEUM});
    expect(d.status === 200 && d.data.careProfile === null, '24시간 병원(나음) 대시보드에 자동 값이 생김: ' + JSON.stringify(d.data.careProfile));
  });

  await check(2, '병원 저장 → 공개 API(보호자 앱) 반영, 값이 독립적으로 저장됨', async () => {
    const r = await api('PUT', '/api/hospital-care', {token: SOO, body: {inpatient: 'available', nightVet: 'oncall', nightStaff: 'resident', care24: 'available', monitoring: 'periodic', catWard: 'operated', icu: 'not_operated', nightSurgery: 'unknown', nightVetHours: '22:00~08:00', checkInterval: '2시간마다', monitoringNote: '무시되어야 함'}});
    expect(r.status === 200, '저장 실패 ' + r.status + ' ' + JSON.stringify(r.data));
    const p = r.data.careProfile;
    expect(p.nightVet === 'oncall' && p.nightStaff === 'resident' && p.care24 === 'available', '항목이 서로 섞임: ' + JSON.stringify(p));
    expect(p.monitoringNote === '', '기타가 아닌데 모니터링 메모가 저장됨');
    const pub = await api('GET', '/api/public/hospital-care');
    const soo = pub.data.hospitals.soo;
    expect(soo && soo.source === 'hospital' && soo.icu === 'not_operated' && soo.nightSurgery === 'unknown' && soo.checkInterval === '2시간마다' && soo.nightVetHours === '22:00~08:00', '공개 반영 오류: ' + JSON.stringify(soo));
    expect(!pub.data.hospitals.naeum, '다른 병원 값이 생김');
    const d = await api('GET', '/api/dashboard?hospitalId=soo', {token: SOO});
    expect(d.data.careProfile?.catWard === 'operated', '병원 대시보드에 저장값이 없음');
  });

  await check(3, '권한: 로그인 없음 401 · 보호자 토큰 401 · 다른 병원 지정 403', async () => {
    const a = await api('PUT', '/api/hospital-care', {body: {inpatient: 'available'}});
    expect(a.status === 401, '비로그인 저장 ' + a.status);
    const b = await api('PUT', '/api/hospital-care', {token: OWNER, body: {inpatient: 'available'}});
    expect(b.status === 401, '보호자 토큰 저장 ' + b.status);
    const c = await api('PUT', '/api/hospital-care', {token: NAEUM, body: {hospitalId: 'soo', inpatient: 'unavailable'}});
    expect(c.status === 403, '다른 병원 수정 ' + c.status);
    const g = await api('GET', '/api/hospital-care?hospitalId=soo', {token: NAEUM});
    expect(g.status === 403, '다른 병원 조회 ' + g.status);
    const forged = await signToken({role: 'hospital', hospitalId: 'soo', exp: Date.now() + 3600e3}, 'wrong-secret');
    const f = await api('PUT', '/api/hospital-care', {token: forged, body: {inpatient: 'unavailable'}});
    expect(f.status === 401, '위조 토큰 ' + f.status);
    const pub = await api('GET', '/api/public/hospital-care');
    expect(pub.data.hospitals.soo.inpatient === 'available', '권한 없는 요청으로 값이 바뀜');
  });

  await check(4, '검증: 잘못된 값·모순 저장 거부, 빈 값은 미확인', async () => {
    const bad = await api('PUT', '/api/hospital-care', {token: NAEUM, body: {inpatient: 'yes'}});
    expect(bad.status === 400, '잘못된 값 ' + bad.status);
    const contra = await api('PUT', '/api/hospital-care', {token: NAEUM, body: {inpatient: 'unavailable', icu: 'operated'}});
    expect(contra.status === 400, '입원 불가 + ICU 운영 ' + contra.status);
    const other = await api('PUT', '/api/hospital-care', {token: NAEUM, body: {inpatient: 'available', monitoring: 'other'}});
    expect(other.status === 400, '기타 메모 없음 ' + other.status);
    const ok = await api('PUT', '/api/hospital-care', {token: NAEUM, body: {nightVet: 'resident', nightVetHours: '<b>24시간</b>'}});
    expect(ok.status === 200, '부분 저장 ' + ok.status + JSON.stringify(ok.data));
    const p = ok.data.careProfile;
    expect(UNKNOWN_KEYS.filter(k => k !== 'nightVet').every(k => p[k] === 'unknown'), '보내지 않은 항목이 미확인이 아님: ' + JSON.stringify(p));
    expect(!/[<>]/.test(p.nightVetHours), '태그 문자가 저장됨');
    expect(p.checkInterval === '', '입원 미확인인데 확인 주기가 저장됨');
  });

  await check(5, '재저장: 기존 행 갱신(덮어쓰기는 같은 병원만), 다른 병원 값 유지', async () => {
    const r = await api('PUT', '/api/hospital-care', {token: SOO, body: {inpatient: 'available', nightVet: 'resident', monitoring: 'other', monitoringNote: 'CCTV 상시 확인'}});
    expect(r.status === 200, '재저장 실패');
    const pub = (await api('GET', '/api/public/hospital-care')).data.hospitals;
    expect(pub.soo.nightVet === 'resident' && pub.soo.monitoringNote === 'CCTV 상시 확인' && pub.soo.catWard === 'unknown', '재저장 반영 오류 ' + JSON.stringify(pub.soo));
    expect(pub.naeum.nightVet === 'resident', '다른 병원 값이 사라짐');
  });

  await check(7, '예약·외래·야간 정책 및 특수동물 진료를 독립적으로 저장', async () => {
    const extension={firstVisit:'available',followUp:'unavailable',walkIn:'available',outpatient24:'unavailable',
      nightEmergency:'available',bookingNote:'전화로 문의해 주세요.',electronicIntake:'available',
      species:{토끼:{general:'available',surgery:'unavailable'},도마뱀:{emergency:'available'}}};
    const write=await api('PUT','/api/hospital-care',{token:SOO,body:{inpatient:'available',nightVet:'resident',extension}});
    expect(write.status===200,JSON.stringify(write));
    const legacy=await api('PUT','/api/hospital-care',{token:SOO,body:{inpatient:'available',nightVet:'resident'}});
    expect(legacy.data?.careProfile?.extension?.bookingNote===extension.bookingNote,'기존 클라이언트가 새 정책을 덮어씀');
    const {hospitals}= (await api('GET','/api/public/hospital-care')).data;
    const profile=hospitals.soo;
    expect(profile.nightVet==='resident'&&profile.extension.outpatient24==='unavailable'&&profile.extension.nightEmergency==='available','운영 항목이 섞임');
    expect(profile.extension.followUp==='unavailable'&&profile.extension.sameDay==='unknown','예약 정책 상태가 섞임');
    expect(profile.extension.species.토끼.general==='available'&&profile.extension.species.토끼.emergency==='unknown'&&profile.extension.species.도마뱀.general==='unknown'&&!profile.extension.species.뱀,'특수동물 정책이 섞임');
    expect(!hospitals.naeum?.extension,'다른 병원 정보 변경');
  });

  await check(8, '무예약 문진 전송은 로그인·명시적 동의·병원 수신 허용 필요', async () => {
    const body={hospitalId:'soo',species:'도마뱀',visit:'followup',petName:'테스트',answers:{change:'식욕 변화',uvb:'사용',purpose:'이전 양식'},consent:true};
    expect((await api('POST','/api/visit-intakes',{body})).status===401,'비로그인 전송 허용');
    expect((await api('POST','/api/visit-intakes',{token:OWNER,body:{...body,consent:false}})).status===400,'미동의 전송 허용');
    expect((await api('POST','/api/visit-intakes',{token:OWNER,body:{...body,hospitalId:'naeum'}})).status===409,'미설정 병원에 전송 허용');
    const saved=await api('POST','/api/visit-intakes',{token:OWNER,body});
    expect(saved.status===201,JSON.stringify(saved));
    const own=await api('GET','/api/hospital/visit-intakes',{token:SOO});
    const other=await api('GET','/api/hospital/visit-intakes',{token:NAEUM});
    expect(own.data?.intakes?.[0]?.id===saved.data.id&&own.data.intakes[0].answers.uvb==='사용'&&!own.data.intakes[0].answers.purpose,'종·방문 유형과 무관한 필드가 저장됨');
    expect(other.data?.intakes?.length===0,'다른 병원에 문진 노출');
    expect((await api('GET','/api/hospital/visit-intakes',{token:OWNER})).status===401,'보호자에게 병원 문진 목록 노출');
  });

  await check(6, '회귀: 기존 예약 흐름과 공개 API 정상', async () => {
    const date = new Date(Date.now() + 9 * 3600e3 + 2 * 86400e3).toISOString().slice(0, 10);
    const body = {petName: '입원냥', species: '고양이', service: '일반 진료', date, time: '10:00', note: '', ownerPhone: '01012345678', visitType: '첫 방문'};
    // 수동물병원은 ZENO 신규 온라인 예약을 받지 않으므로(초진 현장 접수 · 재진 전화 예약) 다른 제휴 병원으로 흐름을 확인합니다.
    const blocked = await api('POST', '/api/bookings', {token: OWNER, body: {...body, hospitalId: 'soo'}});
    expect(blocked.status === 409 && blocked.data?.code === 'ONLINE_BOOKING_UNAVAILABLE', '수동물병원 신규 예약 차단 실패 ' + blocked.status);
    const b = await api('POST', '/api/bookings', {token: OWNER, body: {...body, hospitalId: 'naeum'}});
    expect(b.status === 201, '예약 생성 ' + b.status + JSON.stringify(b.data));
    const d = await api('GET', '/api/dashboard?hospitalId=naeum', {token: NAEUM});
    expect((d.data.bookings || []).some(x => x.id === b.data.id), '병원 화면에 예약 없음');
    const acc = await api('PATCH', '/api/bookings/' + b.data.id, {token: NAEUM, body: {status: 'accepted'}});
    expect(acc.status === 200, '수락 실패');
    for (const p of ['/api/public/hospital-status', '/api/public/hospital-specialties']) {
      const r = await api('GET', p);
      expect(r.status === 200, p + ' ' + r.status);
    }
  });

  const failed = results.filter(r => !r.ok);
  console.log(`\n입원·야간 관리 테스트: ${results.length - failed.length}/${results.length} 통과`);
  if (failed.length) process.exitCode = 1;
}
main().catch(err => { console.error(err); process.exitCode = 1; }).finally(stopServer);
