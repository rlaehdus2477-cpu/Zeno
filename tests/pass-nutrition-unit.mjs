// ZENO PASS 맞춤 영양 관리: 급여량·비용 계산, 일반 사료 필터, 반려동물 전환 테스트 (브라우저 없이 실행)
// owner.html의 PASS 모듈과 worker.js의 사료 목록을 그대로 읽어 계산합니다. 실행: node tests/pass-nutrition-unit.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const owner = fs.readFileSync(path.join(ROOT, 'owner.html'), 'utf8');
const worker = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
const moduleSrc = owner.match(/<script id="zeno-pass-module">([\s\S]*?)<\/script>/)[1];
const catStart = worker.indexOf('const ZP_FEED_SOURCE_CHECKED');
const catEnd = worker.indexOf("const ZP_FEED_BY_ID=new Map(ZP_FEED_CATALOG.map(p=>[p.id,p]));");
if (catStart < 0 || catEnd < 0) throw new Error('worker.js에서 사료 목록을 찾지 못했습니다.');
const catalogSrc = worker.slice(catStart, catEnd);

const listeners = {};
const ctx = {
  state: {ownerToken: 'test', page: 'pass', pets: []},
  APP_MODE: 'owner', ZENO_TAB_ICONS: {}, HOSPITALS: [{id: 'soo', name: '수동물병원'}],
  e: s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])),
  hospitalById: id => ({soo: {id: 'soo', name: '수동물병원', phone: '043-000-0000'}}[id]),
  topbar: t => '<h1>' + t + '</h1>', today: () => '2026-11-27', toast: () => {}, render: () => {}, navTo: () => {},
  api: async () => ({}), confirm: () => true, window: {scrollTo() {}},
  document: {addEventListener: (t, f) => { listeners[t] = f; }},
  console,
};
vm.createContext(ctx);
vm.runInContext(catalogSrc + ';globalThis.CATALOG=ZP_FEED_CATALOG.map(p=>({...p,checked:p.checked||ZP_FEED_SOURCE_CHECKED,source:p.source||"제조사 공식 제품 페이지"}));', ctx);
vm.runInContext(moduleSrc + ';globalThis.T={zpFeedFor,zpNuCost,zpNu,zpState,zpPetStage,zpParseYears,zpParseKg,ZP_VIEWS};', ctx);
const {T, CATALOG} = ctx;
const byId = id => { const p = CATALOG.find(x => x.id === id); if (!p) throw new Error('제품 없음: ' + id); return p; };

const results = [];
function check(no, title, fn) {
  try { fn(); results.push(true); console.log(`PASS  ${no}. ${title}`); }
  catch (err) { results.push(false); console.log(`FAIL  ${no}. ${title}\n      → ${err.message}`); }
}
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); }
const prof = o => ({neutered: 'unknown', bodyCondition: 'unknown', activity: 'unknown', conditions: [], allergies: [], budgetMonthly: null, ...o});

check('U1', '급여량: 같은 체중 행, 가까운 두 행 사이 계산, 범위 밖은 확인 불가', () => {
  eq(T.zpFeedFor(byId('hills-cat-adult-chicken'), 3.6, prof({}), 'adult').g, 65, '힐스 어덜트 3.6kg');
  eq(T.zpFeedFor(byId('hills-cat-adult-chicken'), 3, prof({}), 'adult').g, 52, '힐스 어덜트 3kg 보간');
  eq(T.zpFeedFor(byId('rc-dog-x-small-adult'), 1.2, prof({}), 'adult').g, 31, '엑스스몰 1.2kg 정상활동 보간');
  eq(T.zpFeedFor(byId('hills-dog-adult-large'), 25, prof({}), 'adult').g, null, '행 간격이 넓으면 계산하지 않음');
  eq(T.zpFeedFor(byId('rc-cat-indoor-27'), 4, prof({}), 'adult').text, '제조사 급여표 미확인', '급여표 없는 제품');
  eq(T.zpFeedFor(byId('orijen-dog-puppy'), 5, prof({}), 'young').g, null, '자견 표는 예상 성견 체중 필요');
});
check('U2', '급여량: 활동량·체형·중성화에 맞는 급여표 열 선택', () => {
  eq(T.zpFeedFor(byId('rc-dog-mini-coat-care'), 3, prof({activity: 'high'}), 'adult').g, 73, '코트케어 고활동');
  eq(T.zpFeedFor(byId('rc-dog-mini-coat-care'), 3, prof({activity: 'low'}), 'adult').g, 56, '코트케어 저활동');
  eq(T.zpFeedFor(byId('rc-dog-mini-coat-care'), 3, prof({}), 'adult').g, 65, '코트케어 기본(보통)');
  const cat = T.zpFeedFor(byId('orijen-cat-original'), 4.2, prof({neutered: 'yes'}), 'adult');
  if (!cat.text.includes('4~5kg') || !cat.text.includes('중성화 고양이') || !cat.text.includes('43~52g') || cat.g !== null) throw new Error('오리젠 캣 중성화 범위: ' + cat.text);
  const dog = T.zpFeedFor(byId('orijen-dog-original'), 7, prof({activity: 'low'}), 'adult');
  if (!dog.text.includes('덜 활발한 성견') || !dog.text.includes('60~120g')) throw new Error('오리젠 독 저활동: ' + dog.text);
  const trim = T.zpFeedFor(byId('orijen-cat-fit-trim'), 5.5, prof({bodyCondition: 'over'}), 'adult');
  if (!trim.text.includes('체중 감량') || !trim.text.includes('50~63g')) throw new Error('피트앤트림 과체중: ' + trim.text);
});
check('U3', '비용: 하루·30일·소진 기간, 직접 입력 급여량 우선, 가격 없으면 계산 안 함', () => {
  const n = T.zpNu();
  n.prices = {'hills-cat-adult-chicken': {price: 48000, packageG: 4000}};
  n.daily = {};
  const p = byId('hills-cat-adult-chicken'), feed = T.zpFeedFor(p, 3.6, prof({}), 'adult');
  const c = T.zpNuCost(p, 'cat1', feed);
  eq([Math.round(c.day), Math.round(c.month), Math.floor(c.days)], [780, 23400, 61], '급여표 65g 기준');
  n.daily = {cat1: {'hills-cat-adult-chicken': 55.5}};
  const c2 = T.zpNuCost(p, 'cat1', feed);
  eq([Math.round(c2.day), Math.round(c2.month), Math.floor(c2.days), c2.own], [666, 19980, 72, 55.5], '직접 입력 55.5g 기준');
  eq(T.zpNuCost(byId('rc-cat-indoor-27'), 'cat1', null).ok, false, '가격 없는 제품');
});
function renderFor(pet, profile, opts = {}) {
  const n = T.zpNu();
  Object.assign(n, {loaded: true, error: '', pets: [pet], profiles: {[pet.id]: profile}, prices: {}, daily: {}, catalog: CATALOG, conditions: [], brands: [{brand: '로얄캐닌', status: 'ready'}, {brand: '퓨리나 프로플랜', status: 'unverified'}], stock: [], petId: pet.id, tab: 'general', age: 'auto', form: 'all', feat: [], editing: false, priceFor: null, open: null}, opts);
  T.zpState().view = 'nutrition'; T.zpState().pass = {active: true}; T.zpState().passLoaded = true;
  return T.ZP_VIEWS.nutrition.render();
}
const ids = html => [...html.matchAll(/data-zp="nu-open" data-id="([^"]+)"/g)].map(m => m[1]);
check('U4', '일반 사료 필터: 종·나이·형태·특성, 처방식 제외, 가나다순', () => {
  const cat5 = {id: 'cat1', name: '노아', species: '고양이', age: '5살', weight: '4kg'};
  const list = ids(renderFor(cat5, prof({})));
  const items = list.map(byId);
  if (!items.length || items.some(p => p.species !== '고양이' || p.kind !== '일반식' || !['adult', 'all'].includes(p.lifeStage))) throw new Error('성묘 필터 결과 이상: ' + list);
  const sorted = [...items].sort((a, b) => a.brand.localeCompare(b.brand, 'ko') || a.name.localeCompare(b.name, 'ko')).map(p => p.id);
  eq(list, sorted, '가나다순');
  const senior = ids(renderFor({...cat5, age: '10살'}, prof({}))).map(byId);
  if (!senior.some(p => p.id === 'rc-cat-indoor-7plus') || senior.some(p => p.lifeStage === 'adult')) throw new Error('노령묘 필터 이상');
  const wet = ids(renderFor(cat5, prof({}), {form: '습식'})).map(byId);
  if (!wet.length || wet.some(p => p.form !== '습식')) throw new Error('습식 필터 이상');
  const weight = ids(renderFor(cat5, prof({}), {feat: ['체중 관리']})).map(byId);
  if (!weight.length || weight.some(p => !p.features.includes('체중 관리'))) throw new Error('체중 관리 필터 이상');
  const html = renderFor(cat5, prof({}));
  if (!html.includes('공식 자료 확인 전')) throw new Error('미확인 브랜드 상태 미표시');
  if (/병원|제휴병원|수의사/.test(html.replace(/<p class="zp-disclaimer">[\s\S]*?<\/p>/, '').split('브랜드별 등록 현황')[0].split('일반 사료</h2>')[1] || '')) throw new Error('일반 사료 목록에 병원 관련 안내가 있음');
});
check('U5', '처방식: 권고 없으면 숨김, 진단·권고 있으면 해당 질환 제품만', () => {
  const cat = {id: 'cat1', name: '노아', species: '고양이', age: '5살', weight: '4kg'};
  const none = renderFor(cat, prof({conditions: ['신장 질환'], vetRecommended: false}), {tab: 'rx'});
  if (ids(none).length) throw new Error('권고 없이 처방식이 보임');
  const rx = ids(renderFor(cat, prof({conditions: ['신장 질환'], vetRecommended: true}), {tab: 'rx'})).map(byId);
  if (!rx.length || rx.some(p => p.kind !== '처방식' || !p.conditions.includes('신장 질환'))) throw new Error('처방식 필터 이상');
  const general = ids(renderFor(cat, prof({conditions: ['신장 질환'], vetRecommended: true}))).map(byId);
  if (general.some(p => p.kind === '처방식')) throw new Error('일반 사료 탭에 처방식이 섞임');
});
check('U6', '반려동물 전환: 아이를 바꾸면 종·정보가 바뀌고 열린 입력창이 닫힘', async () => {
  const n = T.zpNu();
  n.pets = [{id: 'cat1', name: '노아', species: '고양이', age: '5살', weight: '4kg'}, {id: 'dog1', name: '콩이', species: '강아지', age: '3살', weight: '3kg'}];
  n.profiles = {}; n.petId = 'cat1'; n.priceFor = 'x'; n.open = 'y';
  T.ZP_VIEWS.nutrition.click('nu-pet', {dataset: {value: 'dog1'}});
  eq([n.petId, n.priceFor, n.open], ['dog1', null, null], '전환 후 상태');
  const html = T.ZP_VIEWS.nutrition.render();
  if (!html.includes('콩이의 정보')) throw new Error('전환한 아이 정보가 안 보임');
  if (ids(html).map(byId).some(p => p.species !== '강아지')) throw new Error('강아지로 바꿨는데 고양이 사료가 보임');
});
const failed = results.filter(x => !x).length;
console.log(`\n결과: ${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
