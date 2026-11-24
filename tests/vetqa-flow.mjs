// ZENO 수의사 Q&A 흐름 자동 테스트
// - worker.js를 wrangler dev --local로 띄우고, 로컬 D1(임시 폴더)에서만 실행합니다.
// - 운영 데이터베이스(--remote)에는 접속하지 않습니다.
// - 비밀번호·비밀키는 테스트 전용 가짜 값이며 실제 값과 무관합니다.
// 실행: node tests/vetqa-flow.mjs
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {webcrypto as crypto} from 'node:crypto';

const PORT = Number(process.env.ZENO_TEST_PORT || 8798);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = 'zeno-test-only-secret-not-production';
const PINS = {soo: 'soo-test-pin', naeum: 'naeum-test-pin', pub045: 'tplus-test-pin'};
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
const legacyQuestion = '00000000-0000-4000-8000-000000000001';
function localSql(sql) {
  run(WRANGLER, ['d1', 'execute', 'zeno-live-db', '--local', '--persist-to', PERSIST, '--command', sql]);
}
async function startServer() {
  // 로컬 D1에만 스키마 적용
  run(WRANGLER, ['d1', 'execute', 'zeno-live-db', '--local', '--persist-to', PERSIST, '--file=schema.sql']);
  // Model an existing installation with answers written before points were available.
  localSql(`DROP TABLE hospital_point_entries;
    INSERT INTO vetqa_questions VALUES('${legacyQuestion}','legacy-owner','이전 질문','방문 준비물 질문','기타','일반','open','2026-01-01','2026-01-01');
    INSERT INTO vetqa_answers VALUES('legacy-answer','${legacyQuestion}','soo','','이전에 등록한 답변','visible','2026-01-01','2026-01-01');
    INSERT INTO questions VALUES('legacy-private','legacy-owner','soo','','이전 문의','기존 답변','answered','2026-01-01','2026-01-01');`);
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
  let qid = null, privateId = null;

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
    expect(r1.data.pointsAwarded === 100 && r2.data.pointsAwarded === 100, '병원별 첫 답변 적립 실패');
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
  await check(11, '진료 전 질문은 해당 병원에 진행 중인 예약이 있는 보호자만 작성', async () => {
    const ask = hospitalId => api('POST', '/api/questions', {token: A, body: {hospitalId, text: '방문 전에 준비할 물건이 있나요?'}});
    expect((await ask('soo')).status === 403, '예약 전에는 질문이 제한되어야 함');
    const booked = await api('POST', '/api/bookings', {token: A, body: bookingBody('soo','나비')});
    expect(booked.status === 201, '질문 테스트 예약 실패');
    expect((await ask('naeum')).status === 403, '예약하지 않은 병원을 선택할 수 없음');
    const cancelled = await api('POST', '/api/bookings', {token: A, body: bookingBody('pub045','나비')});
    expect(cancelled.status === 201, '취소 테스트 예약 실패');
    expect((await api('PATCH','/api/bookings/'+cancelled.data.id,{token:A,body:{side:'owner',status:'cancelled'}})).status === 200,'예약 취소 실패');
    expect((await ask('pub045')).status === 403, '취소한 예약만 있으면 질문이 제한되어야 함');
    const r = await api('POST', '/api/questions', {token: A, body: {hospitalId: 'soo', petName: '나비', text: '내원 전에 금식이 필요한가요?'}});
    expect(r.status === 201, '기존 질문 실패: ' + r.status);
    privateId = r.data.id;
  });

  const wallet = (hid = 'soo', token = soo) => api('GET', '/api/hospital/points?hospitalId=' + hid, {token});
  const buy = (requestId, token = soo, expectedCost = 300) => api('POST', '/api/hospital/point-ads',
    {token, body: {hospitalId: 'soo', requestId, expectedCost}});
  const ads = () => api('GET', '/api/public/hospital-ads');
  await check(12, '병원별 잔액·접근 권한과 잔액 부족 처리', async () => {
    const w = (await wallet()).data;
    expect(w.balance === 100 && w.history.length === 1 && w.history[0].kind === 'vetqa', '재답변 중복 적립');
    expect((await wallet('naeum', naeum)).data.balance === 100, '병원별 잔액 불일치');
    for (const token of [A, naeum, null]) {
      expect((await wallet('soo', token)).status === 401, '다른 계정의 잔액 조회 허용');
      expect((await buy(crypto.randomUUID(), token)).status === 401, '권한 없는 광고 구매 허용');
    }
    expect((await buy(crypto.randomUUID())).status === 409, '잔액 부족 구매 허용');
    expect((await ads()).data.ads.length === 0, '신청 전 광고 노출');
  });
  await check(13, '기존 공개·비공개 답변 수정은 미적립', async () => {
    const pub = await api('PUT', '/api/hospital/vetqa/' + legacyQuestion + '/answer',
      {token: soo, body: {hospitalId: 'soo', body: '이전에 등록한 답변을 수정합니다.'}});
    const priv = await api('PATCH', '/api/questions/legacy-private', {token: soo, body: {answer: '이전 안내 수정'}});
    expect(pub.data.pointsAwarded === 0 && priv.data.pointsAwarded === 0 && (await wallet()).data.balance === 100, '기존 답변에 신규 포인트 적립');
  });
  await check(14, '비공개 질문 첫 답변 동시 저장과 수정', async () => {
    const answer = token => api('PATCH', '/api/questions/' + privateId, {token, body: {answer: '방문 시 진료 기록을 가져와 주세요.'}});
    expect((await answer(naeum)).status === 401, '다른 병원의 비공개 답변 허용');
    const attempts = await Promise.all([answer(soo), answer(soo)]);
    expect(attempts.every(r => r.status === 200) && attempts.map(r => r.data.pointsAwarded).sort().join() === '0,100', '동시 비공개 답변 중복 적립');
    expect((await answer(soo)).data.pointsAwarded === 0 && (await wallet()).data.balance === 200, '비공개 답변 수정 중복 적립');
  });
  await check(15, '공개 질문 첫 답변 동시 저장', async () => {
    const q = await api('POST', '/api/vetqa', {token: B, body: {species:'고양이', field:'일반', title:'방문 준비물 문의', body:'방문할 때 어떤 기록을 가져가야 하나요?'}});
    const answer = () => api('PUT', '/api/hospital/vetqa/' + q.data.id + '/answer',
      {token:soo, body:{hospitalId:'soo', body:'방문 시 기존 기록을 지참해 주세요.'}});
    const attempts = await Promise.all([answer(), answer()]);
    expect(attempts.every(r => r.status === 200) && attempts.map(r => r.data.pointsAwarded).sort().join() === '0,100', '동시 공개 답변 중복 적립');
    expect((await wallet()).data.balance === 300, '광고에 사용할 잔액이 다름');
  });
  let paidId;
  await check(16, '광고 동시 신청·재전송은 한 번만 차감하고 24시간 공개', async () => {
    expect((await buy(crypto.randomUUID(), soo, 1)).status === 409, '다른 가격으로 구매 허용');
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    const attempts = await Promise.all(ids.map(id => buy(id)));
    const created = attempts.findIndex(r => r.status === 201);
    expect(created >= 0 && attempts[1-created].status === 409, '동시 광고 신청 처리 실패');
    paidId = ids[created];
    const replay = await buy(paidId), ad = attempts[created].data.ad;
    expect(replay.status === 200 && replay.data.ad.expiresAt === ad.expiresAt, '재전송에 새 광고 생성');
    expect(Date.parse(ad.expiresAt)-Date.parse(ad.startedAt) === 24*3600000, '광고 기간 오류');
    const w = (await wallet()).data;
    expect(w.balance === 0 && w.activeUntil === ad.expiresAt && w.history.filter(x => x.kind === 'home_ad' && x.points === -300).length === 1, '잔액·광고 내역 불일치');
    expect((await wallet('naeum', naeum)).data.balance === 100, '다른 병원의 포인트 차감');
    const feed = (await ads()).data.ads;
    expect(feed.length === 1 && feed[0].hospitalId === 'soo' && Object.keys(feed[0]).sort().join() === 'expiresAt,hospitalId', '보호자 광고 공개 필드 오류');
  });
  await check(17, '만료 시 광고 종료, 적립 내역 보존 및 새 포인트로 재집행', async () => {
    localSql("UPDATE hospital_point_entries SET created_at='2026-01-01T00:00:00.000Z', expires_at='2026-01-02T00:00:00.000Z' WHERE kind='home_ad'");
    expect((await ads()).data.ads.length === 0, '만료 광고가 공개됨');
    expect((await wallet()).data.activeUntil === null && (await buy(paidId)).status === 200, '만료 처리 또는 기존 요청 재전송 오류');
    expect((await wallet()).data.balance === 0 && (await buy(crypto.randomUUID())).status === 409, '만료 시 차감 복원');
    for (let i=0; i<3; i++) {
      const {data:q} = await api('POST','/api/questions',{token:A,body:{hospitalId:'soo',text:'방문 시 필요한 준비물이 있나요?'}});
      await api('PATCH','/api/questions/'+q.id,{token:soo,body:{answer:'기존 진료 기록을 가져와 주세요.'}});
    }
    expect((await buy(crypto.randomUUID())).status === 201 && (await ads()).data.ads.length === 1, '만료 후 다시 광고를 시작할 수 없음');
  });

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 통과`);
  if (failed.length) process.exitCode = 1;
}
main().catch(err => { console.error(err); process.exitCode = 1; }).finally(stopServer);
