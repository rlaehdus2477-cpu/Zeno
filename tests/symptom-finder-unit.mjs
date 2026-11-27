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
  clinicProfile: () => ({}),
  zenoBookEligible: () => true, zenoMemorialGet: () => null, zenoSymptomPage: null, console,
};
vm.createContext(ctx);
vm.runInContext(m[1] + ';globalThis.T={ZS_FIELDS,ZS_FLAGS,ZS_COMMON_FLAGS,ZS_SYMPTOMS,ZS_GROUPS,ZS_SHORT_LABELS,zs,zsFlagList,zsLevel,zsFields,zsRank,zsUrgentList,zsStepFlags,zsEmergencyHospitals,zsEmergencyKind,zsEmergencyBlock,zsFlagCard,zsExoticSymptoms};', ctx);
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
  reset({species: '특수동물'});
  eq(T.zsRank().length, 0, '종 선택 전 병원');
  reset({species: '특수동물', exotic: '토끼', symptoms: ['exotic:식욕부진','exotic:무기력'], flags: ['breath']});
  eq(T.zsLevel(), '', '특수동물 자동 중증도 분류 비활성');
  ok(T.zsExoticSymptoms('토끼').some(x=>x.label==='식욕부진'),'토끼 식욕부진 없음');
  ok(!T.zsExoticSymptoms('토끼').some(x=>['산란 이상','탈피 이상'].includes(x.label)),'토끼에 부적절한 증상');
  ok(/수의사 검토 대기/.test(ctx.zenoSymptomPage()),'검토 상태 누락');
});

check('S8', '여러 증상: 병원마다 가장 근거가 강한 분야로 표시', () => {
  reset({species: '강아지', symptoms: ['vomit', 'itch']});
  const c = T.zsRank().find(x => x.h.id === 'c');
  eq(c.field, '피부·귀', '다병원 분야');
});

check('S9', '응급 카드 10개: 순서 고정, 종 분기(강아지 복부 팽창·고양이 백합), 문구·아이콘', () => {
  eq(T.ZS_COMMON_FLAGS, ['breath','seizure','bleed','gum','trauma','toxin','urineBlock','heat','bloat','lily'], '순서');
  reset({}); eq(T.zsUrgentList().length, 10, '종 선택 전 10개');
  reset({species: '강아지'}); ok(T.zsUrgentList().includes('bloat') && !T.zsUrgentList().includes('lily'), '강아지');
  reset({species: '고양이'}); ok(T.zsUrgentList().includes('lily') && !T.zsUrgentList().includes('bloat'), '고양이');
  for (const id of T.ZS_COMMON_FLAGS) { const f = T.ZS_FLAGS[id]; ok(f.level === 'now' && f.title && f.desc && f.icon, id + ' 카드 정보'); }
  const html = T.zsFlagCard('breath');
  ok(!/type="checkbox"/.test(html) && /aria-pressed="false"/.test(html) && html.includes('<svg') && html.includes('호흡곤란') && html.includes('숨쉬기 힘들어요'), '카드 마크업');
  ok(!/[\u{1F300}-\u{1FAFF}]/u.test(Object.values(T.ZS_FLAGS).map(f => f.title + f.desc).join('')), '이모지 없음');
});

check('S10', '혈뇨와 배뇨 불가 구분: 혈뇨는 당일 안내·비뇨기, 배뇨 불가가 함께면 즉시', () => {
  const u = T.ZS_SYMPTOMS.find(s => s.id === 'urineBlood');
  eq(u.fields, ['비뇨기'], '혈뇨 분야'); eq(T.ZS_SHORT_LABELS.urineBlood, '혈뇨', '혈뇨 이름');
  reset({species: '고양이', symptoms: ['urineBlood']}); eq(T.zsLevel(), 'today', '혈뇨만');
  ok(T.zsStepFlags().includes('urineBlock'), '혈뇨 선택 시 배뇨 불가 확인 카드');
  reset({species: '고양이', symptoms: ['urineBlood'], flags: ['urineBlock']}); eq(T.zsLevel(), 'now', '배뇨 불가 동반');
  reset({species: '고양이', symptoms: [], flags: ['urineBlock']}); eq(T.zsLevel(), 'now', '배뇨 불가만');
});

check('S11', '혈변·토혈·흑색변: 서로 다른 증상, 소화기(내과) 연결, 당일 안내, 다량 출혈·잇몸·의식이면 즉시', () => {
  const ids = ['bloodStool', 'hematemesis', 'melena'];
  for (const id of ids) {
    const s = T.ZS_SYMPTOMS.find(x => x.id === id); ok(s, id + ' 없음');
    eq(s.fields, ['내과'], id + ' 분야'); eq(s.care, 'today', id + ' 기본 단계');
    reset({species: '강아지', symptoms: [id]}); eq(T.zsLevel(), 'today', id + ' 단독');
    for (const f of ['giHeavy', 'gum', 'seizure']) { reset({species: '강아지', symptoms: [id], flags: [f]}); eq(T.zsLevel(), 'now', id + '+' + f); }
  }
  eq(new Set(ids.map(id => T.ZS_SHORT_LABELS[id])).size, 3, '이름 구분');
  ok(!T.ZS_SYMPTOMS.find(s => s.id === 'diarrhea').keys.includes('혈변'), '설사 검색어에 혈변이 섞이지 않음');
  ok(!T.ZS_FLAGS.bloodVomit, '토혈·혈변 묶음 신호 제거');
});

check('S12', '응급 결과: 24시간 응급 > 24시간 운영 순, 두 표기를 같게 다루지 않음, 일반 정렬에 응급 안내만 병원은 진료 중 아님', () => {
  const keep = [...ctx.HOSPITALS];
  ctx.HOSPITALS.length = 0;
  ctx.HOSPITALS.push(
    {id: 'x', name: '운영병원', phone: '043-111-0000', is24: true, origin: {내과: 'public'}, open: false, km: 1, tier: 3},
    {id: 'y', name: '응급병원', phone: '043-222-0000', emergency24: true, origin: {내과: 'public'}, open: false, km: 5, tier: 3},
    {id: 'z', name: '주간병원', phone: '043-333-0000', origin: {내과: 'public'}, open: false, km: 2, tier: 3});
  eq(T.zsEmergencyHospitals().map(h => h.id), ['y', 'x'], '응급 목록 순서');
  ok(T.zsEmergencyKind({emergency24: true}) !== T.zsEmergencyKind({is24: true}), '표기 구분');
  reset({species: '강아지', flags: ['breath']});
  const html = T.zsEmergencyBlock('now');
  ok(html.includes('zs-emergency-warning') && html.includes('zs-emergency-results') && html.includes('tel:0432220000') && html.includes('응급 접수 여부 전화 확인'), '경고·목록 분리와 전화');
  reset({species: '강아지', symptoms: ['vomit']});
  const r = T.zsRank();
  ok(!r.find(x => x.h.id === 'x').status.open && !r.find(x => x.h.id === 'y').status.open, '운영 또는 응급 안내만으로 외래 진료 중 처리 안 함');
  ctx.HOSPITALS.length = 0; ctx.HOSPITALS.push(...keep);
});

check('S13', '응급 증상은 일반 증상 3개 제한을 받지 않음', () => {
  reset({species: '강아지', flags: ['breath', 'seizure', 'bleed', 'gum', 'trauma']});
  eq(T.zsLevel(), 'now', '5개 선택');
  eq(T.zs().flags.length, 5, '응급 증상 5개 유지');
});

const failed = results.filter(x => !x).length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
if (failed) process.exit(1);
