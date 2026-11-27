// ZENO PASS 공개 진료비 통합 비교: 데이터 누락·기준 분리·합산 중복 방지·화면 노출 테스트 (브라우저 없이 실행)
// owner.html의 실제 HOSPITALS·ZENO_PUBLIC_FEES·ZENO_HEALTH_SCREENINGS와 PASS 모듈을 그대로 읽어 검사합니다.
// 실행: node tests/pass-fees-unit.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const owner = fs.readFileSync(path.join(ROOT, 'owner.html'), 'utf8');
const worker = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const moduleSrc = owner.match(/<script id="zeno-pass-module">([\s\S]*?)<\/script>/)[1];
function arrayLiteral(name) {
  const i = owner.indexOf('const ' + name + '=');
  if (i < 0) throw new Error(name + ' 없음');
  const st = owner.indexOf('[', i);
  let d = 0, j = st, str = false, q = '';
  for (; j < owner.length; j++) {
    const c = owner[j];
    if (str) { if (c === '\\') { j++; continue; } if (c === q) str = false; continue; }
    if (c === '"' || c === "'") { str = true; q = c; continue; }
    if (c === '[') d++;
    if (c === ']') { d--; if (!d) break; }
  }
  return owner.slice(st, j + 1);
}
const listeners = {};
const ctx = {
  state: {ownerToken: 'test', page: 'pass'}, APP_MODE: 'owner', ZENO_TAB_ICONS: {},
  e: s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])),
  topbar: t => '<h1>' + t + '</h1>', today: () => '2026-11-27', toast: () => {}, render: () => {}, navTo: () => {},
  api: async () => ({}), confirm: () => true, window: {scrollTo() {}, scrollY: 0},
  document: {addEventListener: (t, f) => { listeners[t] = f; }, getElementById: () => null},
  console,
};
vm.createContext(ctx);
vm.runInContext('var HOSPITALS=' + arrayLiteral('HOSPITALS') + ';var ZENO_PUBLIC_FEES=' + arrayLiteral('ZENO_PUBLIC_FEES') + ';var ZENO_HEALTH_SCREENINGS=' + arrayLiteral('ZENO_HEALTH_SCREENINGS') + ';var hospitalById=id=>HOSPITALS.find(x=>x.id===id);', ctx);
vm.runInContext(moduleSrc + ';globalThis.T={zpFeeCatalog,zpFeeHospitalTotals,zpFeeMigrate,zpFees,zpState,ZP_VIEWS,ZP_FEE_CATS};', ctx);
const {T} = ctx;
const F = vm.runInContext('ZENO_PUBLIC_FEES', ctx), H = vm.runInContext('ZENO_HEALTH_SCREENINGS', ctx);
const cat = T.zpFeeCatalog();
const item = k => { const it = cat.byKey.get(k); if (!it) throw new Error('항목 없음: ' + k); return it; };

const results = [];
function check(no, title, fn) {
  try { fn(); results.push(true); console.log(`PASS  ${no}. ${title}`); }
  catch (err) { results.push(false); console.log(`FAIL  ${no}. ${title}\n      → ${err.message}`); }
}
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); }
function ok(c, msg) { if (!c) throw new Error(msg); }

check('C1', 'ZENO_PUBLIC_FEES 모든 가격 행이 비교 항목에 들어감 (누락 0)', () => {
  eq(cat.stats.feeRowsCovered, cat.stats.feeRows, '진료비 행 누락');
  eq(cat.stats.missing, 0, '병원 정보 없음으로 빠진 행');
  for (const v of F) for (const p of v.prices) ok(cat.entries.some(x => x.hid === v.id && x.raw === p[0] && x.min === p[1] && x.max === p[2]), '빠진 행 ' + v.id + ' ' + p[0]);
});
check('C2', '건강검진 프로그램은 사용하거나, 진료비표의 같은 패키지와 가격이 일치할 때만 중복 제외', () => {
  eq(cat.stats.screenRowsUsed + cat.stats.screenRowsDuplicate, cat.stats.screenRows, '검진 행 합계');
  for (const s of cat.skipped) {
    const v = F.find(x => x.id === s.hid);
    ok(v && v.prices.some(p => p[1] <= s.price && s.price <= p[2] && /검진/.test(p[0])), '중복 근거 없음 ' + s.hid + ' ' + s.raw);
  }
});
check('C3', '모든 항목이 12개 분류 중 하나, 키는 서버 검증(2~40자, 중복 없음)을 통과', () => {
  for (const it of cat.items) {
    ok(T.ZP_FEE_CATS.includes(it.cat), '분류 밖 ' + it.key);
    ok(it.key.trim() === it.key && it.key.length >= 2 && it.key.length <= 40, '키 길이 ' + it.key);
  }
  eq(new Set(cat.items.map(i => i.key)).size, cat.items.length, '키 중복');
});
check('C4', '1개 병원만 공개한 항목도 포함 (이전 n>=2 조건 제거)', () => {
  ok(cat.items.filter(i => i.hospitals.size === 1).length > 60, '1곳 항목 수 부족');
  for (const k of ['MRI 검사 · 뇌 촬영', '슬개골 탈구 3기(양측)', '전십자인대 단열교정술 ECF-TR(편측)', '알레르기 검사 177종', '사이토포인트 20mg(4.6~9.1kg)', '강아지 C 종합 정밀검진 · 24시 청주이음동물의료센터', '고양이 B2 내시경 검진 · 24시 청주이음동물의료센터', '건강검진 프리미엄 · 웰니스동물병원', '강아지 수컷 중성화', '고양이 암컷 중성화'])
    eq(item(k).hospitals.size, 1, k);
});
check('C5', '기준이 다른 가격은 다른 항목: 혈액화학 항목당 vs 패널, 엑스레이 1장 vs 장수별, CT 부위', () => {
  eq([...item('혈액화학검사 · 항목당').hospitals], ['pub038'], '항목당');
  eq([...item('혈액화학검사 · 패널 1회').hospitals].sort(), ['pub006', 'pub009', 'pub039'], '패널');
  eq([...item('엑스레이 · 1장당').hospitals].sort(), ['pub016', 'pub038', 'pub039'], '1장당');
  eq([...item('엑스레이 · 1~3장 장수별').hospitals], ['pub009'], '장수별');
  ok(!cat.byKey.has('혈액화학검사') && !cat.byKey.has('엑스레이'), '기준 없는 합쳐진 항목 남음');
  ok(item('CT 검사 · 1개 부위').key !== item('CT 검사 · 전신·마취 포함').key, 'CT 기준');
});
check('C6', '동물종 구분과 필터', () => {
  eq(item('강아지 수컷 중성화').speciesLabel, '강아지', '강아지');
  eq(item('고양이 수컷 중성화').speciesLabel, '고양이', '고양이');
  eq(item('수컷 중성화 · 동물종 미표기').speciesLabel, '공통', '미표기');
  const f = T.zpFees(); f.loaded = true; f.mode = 'calc'; f.items = []; f.cat = '전체';
  T.zpState().passLoaded = true; T.zpState().pass = {active: true};
  f.species = '고양이'; const cat1 = T.ZP_VIEWS.fees.render();
  ok(!cat1.includes('data-value="강아지 수컷 중성화"') && cat1.includes('data-value="고양이 수컷 중성화"') && cat1.includes('data-value="수컷 중성화 · 동물종 미표기"'), '고양이 필터');
  f.species = '강아지'; const dog = T.ZP_VIEWS.fees.render();
  ok(dog.includes('data-value="강아지 수컷 중성화"') && !dog.includes('data-value="고양이 수컷 중성화"'), '강아지 필터');
  f.species = '전체';
});
check('C7', '행사가·정상가·마취 방식 구분', () => {
  const allergy = item('알레르기 검사 120종').entries[0];
  eq([allergy.promo, allergy.regular], ['행사가', 330000], '알레르기 120종');
  const narae = item('수컷 중성화 · 동물종 미표기').entries.find(x => x.hid === 'pub028');
  eq(narae.variants, [['주사마취', 160000], ['호흡마취', 190000]], '나래 마취');
  ok(item('강아지 시니어 · 센트럴동물병원').entries[0].regular === 816000, '센트럴 정상가');
  ok(/과거 행사가/.test(item('T&D 라이트 (과거 행사) · 티앤디동물병원').entries[0].promo), 'T&D 과거 행사');
  eq(item('초진 진찰료').entries.every(x => !x.promo), true, '정상가 항목에 행사 표시');
});
check('C8', '상위·세부 항목, 상위·하위 검진을 함께 고르면 한쪽만 합산', () => {
  let t = T.zpFeeHospitalTotals('pub028', [{name: '슬개골 탈구 수술 · 2~4기 전체 범위', count: 1}, {name: '슬개골 탈구 2기(편측)', count: 1}]);
  eq([t.sMin, t.sMax], [600000, 600000], '나래 슬개골');
  t = T.zpFeeHospitalTotals('pub007', [{name: '강아지 A 기본 건강검진 · 24시 청주이음동물의료센터', count: 1}, {name: '강아지 C 종합 정밀검진 · 24시 청주이음동물의료센터', count: 1}]);
  eq([t.sMin, t.sMax], [2230000, 2890000], '이음 검진');
  t = T.zpFeeHospitalTotals('pub039', [{name: '심장사상충 예방(제품별) · 여러 제품 범위', count: 12}, {name: '하트가드', count: 12}]);
  eq([t.yMin, t.yMax], [108000, 192000], '와와 심장사상충');
  t = T.zpFeeHospitalTotals('pub038', [{name: '초진 진찰료', count: 1}, {name: '재진 진찰료', count: 3}]);
  eq([t.yMin, t.yMax], [32000, 58000], '고려 진찰료 연간');
  t = T.zpFeeHospitalTotals('pub028', [{name: '수컷 중성화 · 동물종 미표기', count: 1}, {name: '중성화 수술 후 회복관리(추가)', count: 1}]);
  eq([t.sMin, t.sMax], [210000, 240000], '추가 관리비는 별도 합산');
});
check('C9', '미공개는 추정하지 않음', () => {
  const t = T.zpFeeHospitalTotals('central2026', [{name: '초진 진찰료', count: 1}, {name: '강아지 수컷 중성화', count: 1}]);
  eq([t.missing, t.sMin, t.sMax], [1, 170000, 170000], '센트럴 초진 미공개');
});
check('C10', '화면: 모든 항목 노출(8개 제한·더 보기 없음), 공개 병원 수 표시, 가격순 정렬 없음', () => {
  const f = T.zpFees(); f.loaded = true; f.mode = 'calc'; f.species = '전체'; f.cat = '전체'; f.q = '';
  f.items = [{name: '초진 진찰료', count: 1}, {name: 'MRI 검사 · 뇌 촬영', count: 1}];
  const html = T.ZP_VIEWS.fees.render();
  const picks = [...html.matchAll(/class="zp-fee-pick"[^>]*data-value="([^"]+)"[^>]*?(hidden)?>/g)];
  eq(picks.length, cat.items.length, '노출 항목 수');
  ok(!picks.some(m => m[2]), '숨긴 항목 있음');
  ok(!html.includes('항목 더 보기') && !html.includes('zp-more'), '더 보기 구조 남음');
  ok(html.includes('1개 병원 공개') && /\d+곳 공개/.test(html), '공개 병원 수');
  ok(!/최저가|낮은 순|순위:/.test(html), '가격 순위 문구');
  const names = [...html.slice(html.indexOf('id="zp-fee-compare"')).matchAll(/<div class="zp-item"><div class="zp-item-top"><strong>([^<]+)<\/strong>/g)].map(m => m[1]);
  eq(names, [...names].sort((a, b) => a.localeCompare(b, 'ko')), '병원 이름순');
  ok(html.includes('병원 가격표 원문') && html.includes('제노 확인'), '원문·확인 날짜');
});
check('C11', '검색: 항목명·병원명·동의어', () => {
  const s = k => item(k).search;
  ok(s('엑스레이 · 1장당').includes('xray'), '엑스레이 동의어');
  ok(s('슬개골 탈구 3기(양측)').includes('나래동물의료센터'), '병원명 검색');
  const f = T.zpFees(); f.mode = 'calc'; f.q = '슬개골';
  const html = T.ZP_VIEWS.fees.render();
  const shown = [...html.matchAll(/class="zp-fee-pick"[^>]*data-value="([^"]+)"[^>]*?(hidden)?>/g)].filter(m => !m[2]).map(m => m[1]);
  ok(shown.length >= 8 && shown.every(k => k.includes('슬개골')), '검색 결과 ' + shown.join(','));
  f.q = '';
});
check('C12', '예전 저장 설정 이전 (n>=2 시절 항목명)', () => {
  const m = T.zpFeeMigrate([{name: '혈액화학검사', count: 2}, {name: '초진 진찰료', count: 1}, {name: '없는 항목', count: 1}, {name: 'CT 검사', count: 1}]);
  eq(JSON.parse(JSON.stringify(m.items)), [{name: '혈액화학검사 · 패널 1회', count: 2}, {name: '초진 진찰료', count: 1}], '이전 결과');
  eq(m.changed, true, '변경 표시');
  eq(T.zpFeeMigrate([{name: '초진 진찰료', count: 2}, {name: '고양이 종합백신', count: 1}]).changed, false, '그대로인 설정');
});
check('C13', '서버 /api/pass/fee-plan 검증 규칙과 충돌 없음', () => {
  ok(worker.includes("data.items.length<=12") && worker.includes('clean(it?.name,40)') && worker.includes('count>=1&&count<=52'), '서버 규칙 변경됨');
  for (const it of cat.items) eq(it.key.trim().slice(0, 40), it.key, '서버 정리 후 키 달라짐');
});

const before = (() => { const c = new Map(); for (const v of F) for (const n of new Set(v.prices.map(p => p[0]))) c.set(n, (c.get(n) || 0) + 1); return c; })();
const beforeShown = [...before.values()].filter(n => n >= 2).length;

// ── 건강검진 병원별 묶음 (PR #270) ──
function checkupRender(species) {
  const f = T.zpFees(); f.loaded = true; f.mode = 'checkup'; f.species = species; f.cat = '전체'; f.q = '';
  const html = T.ZP_VIEWS.fees.render();
  const parts = html.split('<details class="zp-fee-entry zp-checkup-hospital" ').slice(1);
  const blocks = parts.map(p => {
    const m = p.match(/^data-hid="([^"]+)" data-count="(\d+)"><summary>([^<]+) <small>검진 (\d+)개<\/small><\/summary>/);
    return {hid: m[1], count: +m[2], name: m[3].trim(), shown: +m[4], body: p};
  });
  const head = html.match(/건강검진 <small>병원 (\d+)곳 · 검진 (\d+)개<\/small>/);
  const expected = cat.items.filter(it => it.cat === '건강검진' && (species === '전체' || it.speciesLabel === species || it.speciesLabel === '공통')).flatMap(it => it.entries);
  return {html, blocks, head, expected};
}
for (const sp of ['전체', '강아지', '고양이']) {
  check('G1-' + sp, '건강검진(' + sp + '): 전체 검진 수 = 병원별 검진 수 합계 = 실제 검진 행 수, 병원 수 일치', () => {
    const {blocks, head, expected} = checkupRender(sp);
    ok(head, '머리글 없음');
    const sum = blocks.reduce((n, b) => n + b.count, 0);
    eq(+head[2], sum, '머리글 검진 수 vs 병원별 합계');
    eq(sum, expected.length, '병원별 합계 vs 실제 검진 행');
    eq(+head[1], blocks.length, '머리글 병원 수');
    eq(blocks.length, new Set(expected.map(x => x.hid)).size, '검진 있는 병원 수');
    for (const b of blocks) { eq(b.shown, b.count, b.hid + ' 표시 개수'); eq((b.body.match(/class="zp-fee-result"/g) || []).length, b.count, b.hid + ' 실제 행 수'); }
  });
}
check('G2', '건강검진: 병원은 이름순(가격순 아님), 병원마다 자기 검진만 빠짐없이', () => {
  const {blocks, expected} = checkupRender('전체');
  const names = blocks.map(b => b.name);
  eq(names, [...names].sort((a, b) => a.localeCompare(b, 'ko')), '병원 이름순');
  for (const b of blocks) eq(b.count, expected.filter(x => x.hid === b.hid).length, b.hid + ' 검진 수');
});
check('G3', '건강검진: 가격·포함 검사·원문 링크 표시, 진료비 데이터 보존', () => {
  const {blocks, expected} = checkupRender('전체');
  for (const b of blocks) ok(/\d[\d,]*원/.test(b.body) || /미공개/.test(b.body), b.hid + ' 가격 없음');
  const withIncludes = expected.filter(x => x.pkg && x.includes);
  ok(withIncludes.length > 0, '포함 검사 있는 검진 없음');
  for (const x of withIncludes) ok(blocks.find(b => b.hid === x.hid).body.includes('포함 검사 · '), x.hid + ' 포함 검사 표시 없음');
  for (const b of blocks) { const src = cat.hospitals.get(b.hid); if (src?.url) ok(b.body.includes('가격표 원문'), b.hid + ' 원문 링크 없음'); }
  eq(cat.stats.feeRowsCovered, cat.stats.feeRows, '진료비 행 보존');
});
check('G4', '진료비 비교(calc) 화면은 기존 항목별 표시 유지', () => {
  const f = T.zpFees(); f.loaded = true; f.mode = 'calc'; f.species = '전체'; f.cat = '전체'; f.q = '';
  ok(!T.ZP_VIEWS.fees.render().includes('zp-checkup-group'), '계산기 화면에 병원별 묶음이 섞임');
});

console.log('\n[보고] 수정 전: 진료비 원본 행 ' + cat.stats.feeRows + ' · 고유 항목명 ' + before.size + ' · 비교 가능 ' + beforeShown + ' (기본 노출 ' + Math.min(8, beforeShown) + ') · 비교 병원 ' + F.length + '곳 · 누락 항목명 ' + (before.size - beforeShown) + ' + 건강검진 프로그램 ' + cat.stats.screenRows + '행 미사용');
console.log('[보고] 수정 후: 비교 항목 ' + cat.items.length + ' · 노출 ' + cat.items.length + ' · 공개 병원 ' + cat.hospitals.size + '곳 · 1개 병원 공개 항목 ' + cat.items.filter(i => i.hospitals.size === 1).length + ' · 누락 ' + (cat.stats.feeRows - cat.stats.feeRowsCovered + cat.stats.missing) + ' · 검진 프로그램 사용 ' + cat.stats.screenRowsUsed + ' / 진료비표 중복 제외 ' + cat.stats.screenRowsDuplicate);
console.log('[보고] 분류별: ' + T.ZP_FEE_CATS.map(c => c + ' ' + cat.items.filter(i => i.cat === c).length).join(' · '));
const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
