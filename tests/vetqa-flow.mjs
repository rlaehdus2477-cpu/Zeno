// ZENO 수의사 Q&A 흐름 자동 테스트
// - worker.js를 wrangler dev --local로 띄우고, 로컬 D1(임시 폴더)에서만 실행합니다.
// - 운영 데이터베이스(--remote)에는 접속하지 않습니다.
// - 비밀번호·비밀키는 테스트 전용 가짜 값이며 실제 값과 무관합니다.
// 실행: node tests/booking-flow.mjs
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {webcrypto as crypto} from 'node:crypto';

const PORT = Number(process.env.ZENO_TEST_PORT || 8798);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = 'zeno-test-only-secret-not-production';
const PINS = {soo: 'soo-test-pin', naeum: 'naeum-test-pin', tnd: 'tnd-test-pin'};
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PERSIST = fs.mkdtempSync(path.join(os.tmpdir(), 'zeno-vetqa-test-'));
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
  const regA = await api('POST', '/api/auth/register', {body: {username: 'qa_owner_a', password: 'test-password-a1', displayName: '질문자A'}});
  const regB = await api('POST', '/api/auth/register', {body: {username: 'qa_owner_b', password: 'test-password-b1', displayName: '질문자B'}});
  expect(regA.status === 201 && regB.status === 201, '보호자 가입 실패');
  const A = regA.data.token, B = regB.data.token;
  const soo = (await api('POST', '/api/login', {body: {hospitalId: 'soo', pin: PINS.soo}})).data.token;
  const naeum = (await api('POST', '/api/login', {body: {hospitalId: 'naeum', pin: PINS.naeum}})).data.token;
  expect(soo && naeum, '병원 로그인 실패');
  let qid = null;

  await check(1, '로그인 없이 질문 작성 불가', async () => {
    const r = await api('POST', '/api/vetqa', {body: {title: '밥을 안 먹어요', body: '고양이가 이틀째 사료를 안 먹어요.', species: '고양이', field: '내과'}});
    expect(r.status === 401 || r.status === 403, '비로그인 작성이 허용됨: ' + r.status);
  });
  await check(2, '입력 검증 (짧은 제목·잘못된 종류)', async () => {
    const r1 = await api('POST', '/api/vetqa', {token: A, body: {title: '짧', body: '고양이가 이틀째 사료를 안 먹어요.', species: '고양이', field: '내과'}});
    const r2 = await api('POST', '/api/vetqa', {token: A, body: {title: '밥을 안 먹어요', body: '고양이가 이틀째 사료를 안 먹어요.', species: '공룡', field: '내과'}});
    expect(r1.status === 400 && r2.status === 400, '검증 실패: ' + r1.status + '/' + r2.status);
  });
  await check(3, '보호자 A 질문 작성 → 공개 목록에 표시, 작성자 정보 비공개', async () => {
    const r = await api('POST', '/api/vetqa', {token: A, body: {title: '고양이가 밥을 안 먹어요', body: '5살 고양이가 이틀째 사료를 거의 안 먹어요. 물은 마십니다.', species: '고양이', field: '내과'}});
    expect(r.status === 201 && r.data.id, '작성 실패: ' + JSON.stringify(r.data));
    qid = r.data.id;
    const list = await api('GET', '/api/public/vetqa');
    const item = (list.data.questions || []).find(q => q.id === qid);
    expect(item && item.answerCount === 0, '공개 목록에 없음');
    const raw = JSON.stringify(list.data);
    expect(!raw.includes('qa_owner_a') && !raw.includes('질문자A') && !raw.includes('owner'), '작성자 정보가 공개 응답에 포함됨');
  });
  await check(4, '검색·종류 필터', async () => {
    const hit = await api('GET', '/api/public/vetqa?q=' + encodeURIComponent('사료'));
    const miss = await api('GET', '/api/public/vetqa?species=' + encodeURIComponent('강아지'));
    expect((hit.data.questions || []).some(q => q.id === qid), '검색 결과에 없음');
    expect(!(miss.data.questions || []).some(q => q.id === qid), '강아지 필터에 고양이 질문이 나옴');
  });
  await check(5, '보호자는 답변 불가, 다른 병원 계정으로 남의 병원 답변 불가', async () => {
    const r1 = await api('PUT', '/api/hospital/vetqa/' + qid + '/answer', {token: A, body: {hospitalId: 'soo', body: '보호자가 답변을 시도합니다.'}});
    const r2 = await api('PUT', '/api/hospital/vetqa/' + qid + '/answer', {token: naeum, body: {hospitalId: 'soo', body: '나음이 수동물병원으로 답변 시도.'}});
    expect(r1.status >= 400 && r2.status >= 400, '권한 없는 답변 허용: ' + r1.status + '/' + r2.status);
  });
  await check(6, '병원 화면에 질문 표시 → 수의사 이름 선택 입력 답변', async () => {
    const list = await api('GET', '/api/hospital/vetqa?hospitalId=soo', {token: soo});
    expect((list.data.questions || []).some(q => q.id === qid && q.myAnswer === null), '병원 목록에 없음');
    const r1 = await api('PUT', '/api/hospital/vetqa/' + qid + '/answer', {token: soo, body: {hospitalId: 'soo', vetName: '김수의', body: '식욕 저하가 이틀 이상이면 내원을 권합니다. 구토가 있으면 바로 오세요.'}});
    const r2 = await api('PUT', '/api/hospital/vetqa/' + qid + '/answer', {token: naeum, body: {hospitalId: 'naeum', body: '물을 잘 마신다면 우선 관찰하되, 48시간이 넘으면 진료가 필요합니다.'}});
    expect(r1.status === 200 && r1.data.vetName === '김수의', '수동물병원 답변 실패');
    expect(r2.status === 200 && r2.data.vetName === '', '나음 답변(이름 없음) 실패');
  });
  await check(7, '공개 상세에 답변 2개, 답변 수 반영', async () => {
    const d = await api('GET', '/api/public/vetqa/' + qid);
    expect(d.status === 200 && d.data.answers.length === 2, '답변 수 불일치');
    expect(d.data.answers.some(a => a.hospitalId === 'soo' && a.vetName === '김수의'), '수의사 이름 없음');
    const list = await api('GET', '/api/public/vetqa');
    expect(list.data.questions.find(q => q.id === qid).answerCount === 2, '목록 답변 수 미반영');
  });
  await check(8, '같은 병원 재답변은 수정으로 처리(중복 없음)', async () => {
    await api('PUT', '/api/hospital/vetqa/' + qid + '/answer', {token: soo, body: {hospitalId: 'soo', vetName: '김수의', body: '수정: 이틀 이상 식욕 저하면 내원해 주세요.'}});
    const d = await api('GET', '/api/public/vetqa/' + qid);
    expect(d.data.answers.length === 2 && d.data.answers.find(a => a.hospitalId === 'soo').body.startsWith('수정'), '수정 처리 실패');
  });
  await check(9, '내 질문 목록은 본인 것만, 답변 달린 질문은 삭제 불가', async () => {
    const mineA = await api('GET', '/api/vetqa/mine', {token: A});
    const mineB = await api('GET', '/api/vetqa/mine', {token: B});
    expect(mineA.data.questions.some(q => q.id === qid) && !mineB.data.questions.some(q => q.id === qid), '내 질문 분리 실패');
    const delB = await api('DELETE', '/api/vetqa/' + qid, {token: B});
    const delA = await api('DELETE', '/api/vetqa/' + qid, {token: A});
    expect(delB.status === 404 && delA.status === 409, '삭제 권한 처리 실패: ' + delB.status + '/' + delA.status);
  });
  await check(10, '답변 없는 내 질문은 삭제되고 공개 목록에서 사라짐', async () => {
    const r = await api('POST', '/api/vetqa', {token: B, body: {title: '강아지 산책 거부', body: '3살 강아지가 산책을 나가려 하지 않아요.', species: '강아지', field: '행동·문제행동'}});
    const del = await api('DELETE', '/api/vetqa/' + r.data.id, {token: B});
    const list = await api('GET', '/api/public/vetqa');
    expect(del.status === 200 && !list.data.questions.some(q => q.id === r.data.id), '삭제 실패');
  });
  await check(11, '기존 진료 전 질문(/api/questions)은 그대로 동작', async () => {
    const r = await api('POST', '/api/questions', {token: A, body: {hospitalId: 'soo', petName: '나비', text: '내원 전에 금식이 필요한가요?'}});
    expect(r.status === 201, '기존 질문 실패: ' + r.status);
  });

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 통과`);
  if (failed.length) process.exitCode = 1;
}
main().catch(err => { console.error(err); process.exitCode = 1; }).finally(stopServer);
