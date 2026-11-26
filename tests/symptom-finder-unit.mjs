// 증상으로 병원 찾기: 증상 데이터 무결성, 응급 신호 판정, 맞춤 병원 정렬 (브라우저 없이 실행)
// owner.html의 증상 모듈을 그대로 읽어 계산합니다. 실행: node tests/symptom-finder-unit.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const owner = fs.readFileSync(path.join(ROOT, 'owner.html'), 'utf8');
const m = owner.match(/<script id="zeno-symptom-module">([\s\S]*?)<\/script>/);
if (!m) throw new Error('owner.html에서 증상 모듈을 찾지 못했습니다.');

// 가짜 병원: 분야별 근거(origin)·운영 상태·거리·고양이 대기실 등급을 직접 지정
const H = [
  {id: 'a', name: '가병원', phone: '043-111-1111', origin: {내과: 'official'}, open: false, km: 8, tier: 1},
  {id: 'b', name: '나병원', phone: '043-222-2222', origin: {내과: 'inquiry'}, open: true, km: 1, tier: 3},
  {id: 'c', name: '다병원', phone: '043-333-3333', origin: {내과: 'public', 피부·귀: 'official'}, open: true, km: 6, tier: 2},
  {id: 'd', name: '라병원', phone: '', origin: {특수동물: 'official'}, open: false, km: 4, tier: 0, h24: true},
];
const ctx = {
  state: {page: 'symptoms', specialty: ''}, HOSPITALS: H, EXOTIC: [['토끼'], ['햄스터']],
  e: s => String(s ?? ''), topbar: t => '<h1>' + t + '</h1>', render() {}, navTo() {}, openModal() {},
  document: {addEventListener() {}},
  zenoSpecialtyOrigin: h => h.origin[ctx.state.specialty] || '',
  zenoSearchClinicStatus: h => ({kind: h.open ? 'is-open' : 'is-closed', text: h.open ? '진료 중' : '진료 종료'}),
  zeno24HourEmergency: h => !!h.h24, zenoNightSchedule: () => ({within: false}),
  zenoNearbyDistanceKm: h => h.km, zenoCatWaitingTier: h => h.tier, zenoExoticMatches: () => true,
  zenoBookEligible: () => true, zenoMemorialGet: () => null, zenoSymptomPage: null, console,
};
vm.createContext(ctx);
vm.runInContext(m[1] + ';globalThis.T={ZS_FIELDS,ZS_FLAGS,ZS_COMMON_FLAGS,ZS_SYMPTOMS,ZS_GROUPS,zs,zsFlagList,zsLevel,zsFields,zsRank};', ctx);
const T = ctx.T;
const reset = o => { ctx.state.zs = {who: '', species: '', exotic: '', symptoms: [], flags: [], q: '', openOnly: false, catRoom: true, more: false, ...o}; };

const results = [];
function check(no, title, fn) {
  try { fn(); results.push(true); console.log(`PASS  ${no}. ${title}`); }
  catch (err) { results.push(false); console.log(`FAIL  ${no}. ${title}\n      → ${err.message}`); }
}
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); }
function ok(v, msg) { if (!v) throw new Error(msg); }

check('S1', '증상 데이터: 분야·그룹·신호가 모두 정의돼 있고 id가 겹치지 않음', () => {
  const ids = new Set();
  for (const s of T.ZS_SYMPTOMS) {
    ok(!ids.has(s.id), '중복 id ' + s.id); ids.add(s.id);
    ok(T.ZS_GROUPS.includes(s.group), s.id + ' 그룹 없음');
    ok(s.fields.length && s.fields.every(f => T.ZS_FIELDS.includes(f)), s.id + ' 분야 오류');
    ok(s.flags.every(f => T.ZS_FLAGS[f]), s.id + ' 신호 오류');
  }
  ok(T.ZS_COMMON_FLAGS.every(f => T.ZS_FLAGS[f]), '공통 신호 오류');
  ok(Object.values(T.ZS_FLAGS).every(f => f.level === 'now' || f.level === 'today'), '신호 단계 오류');
});

check('S2', '진단 표현 없음: 증상·신호 문구에 질병명 단정이 없음', () => {
  const text = [...T.ZS_SYMPTOMS.map(s => s.label), ...Object.values(T.ZS_FLAGS).map(f => f.label)].join(' ');
  for (const w of ['진단', '확진', '입니다', '의심됩니다']) ok(!text.includes(w), '금지 표현: ' + w);
});

check('S3', '종별 신호: 백합은 고양이만, 위 확장은 강아지만', () => {
  reset({species: '강아지', symptoms: ['vomit']});
  let l = T.zsFlagList(); ok(l.includes('bloat') && !l.includes('lily'), '강아지 목록 오류');
  reset({species: '고양이', symptoms: ['vomit']});
  l = T.zsFlagList(); ok(l.includes('lily') && !l.includes('bloat'), '고양이 목록 오류');
  ok(T.ZS_FLAGS[l[0]].level === 'now', '바로 전화 신호가 먼저 나와야 함');
});

check('S4', '응급 단계: now 신호가 하나라도 있으면 now, today만 있으면 today', () => {
  reset({species: '강아지', symptoms: ['vomit'], flags: ['repeatVomit']}); eq(T.zsLevel(), 'today', 'today');
  reset({species: '강아지', symptoms: ['vomit'], flags: ['repeatVomit', 'breath']}); eq(T.zsLevel(), 'now', 'now');
  reset({species: '강아지', symptoms: [], flags: ['repeatVomit']}); eq(T.zsLevel(), '', '목록에 없는 신호는 무시');
});

check('S5', '정렬: 근거(공식>공개>문의) 우선, 진료 중·거리 가점, 광고 요소 없음', () => {
  reset({species: '강아지', symptoms: ['vomit']});
  const r = T.zsRank().map(x => x.h.id);
  eq(r, ['a', 'c', 'b'], '내과 순서');           // a 30+1 / c 20+6 / b 10+6+5
  reset({species: '강아지', symptoms: ['vomit'], openOnly: true});
  eq(T.zsRank().map(x => x.h.id), ['c', 'b'], '진료 중만');
});

check('S6', '고양이 대기실: 켜면 2등급 이상만, 끄면 전체', () => {
  reset({species: '고양이', symptoms: ['vomit']});
  eq(T.zsRank().map(x => x.h.id), ['c', 'b'], '대기실 켬');
  reset({species: '고양이', symptoms: ['vomit'], catRoom: false});
  eq(T.zsRank().length, 3, '대기실 끔');
});

check('S7', '특수동물: 특수동물 진료 근거가 있는 병원만', () => {
  reset({species: '토끼', exotic: '토끼'});
  eq(T.zsFields(), ['특수동물'], '분야');
  eq(T.zsRank().map(x => x.h.id), ['d'], '병원');
});

check('S8', '여러 증상: 병원마다 가장 근거가 강한 분야로 표시', () => {
  reset({species: '강아지', symptoms: ['vomit', 'itch']});
  const c = T.zsRank().find(x => x.h.id === 'c');
  eq(c.field, '피부·귀', '다병원 분야');
});

const failed = results.filter(x => !x).length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
if (failed) process.exit(1);
