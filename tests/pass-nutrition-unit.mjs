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
vm.runInContext(moduleSrc + ';globalThis.T={zpFeedFor,zpNuCost,zpNu,zpState,zpPetStage,zpParseYears,zpParseKg,ZP_VIEWS,ZP_NU_FEATURES};', ctx);
const rawCtx = {}; vm.createContext(rawCtx);
vm.runInContext(catalogSrc.replace(/ZP_FEED_CATALOG\.push\([\s\S]*$/, '') + ';globalThis.RAW=[...ZP_FEED_GENERAL,...ZP_FEED_GENERAL_2];', rawCtx);
ctx.RAW = rawCtx.RAW;
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
  eq(T.zpFeedFor(byId('hills-dog-adult-large'), 25, prof({}), 'adult').g, 343, '대형견은 체중 20% 이내 행 사이 계산');
  eq(T.zpFeedFor(byId('hills-dog-adult11-small-mini'), 7.9, prof({}), 'senior').g, null, '행 간격이 넓으면 계산하지 않음');
  eq(T.zpFeedFor(byId('rc-dog-mini-adult-pouch'), 4, prof({}), 'adult').g, 340, '파우치 4개 × 85g');
  eq(T.zpFeedFor(byId('rc-cat-indoor-27'), 4, prof({bodyCondition: 'over'}), 'adult').g, 44, '인도어 과체중 열');
  eq(T.zpFeedFor(byId('acana-cat-indoor-entree'), 4, prof({}), 'adult').text, '제조사 페이지의 급여량 계산기에서 확인해 주세요', '고정 급여표 없는 제품');
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
  Object.assign(n, {loaded: true, error: '', pets: [pet], profiles: {[pet.id]: profile}, prices: {}, daily: {}, catalog: CATALOG, conditions: [], brands: [{brand: '로얄캐닌', status: 'ready'}, {brand: '퓨리나 프로플랜', status: 'ready'}, {brand: '뉴트로', status: 'unverified'}], stock: [], petId: pet.id, tab: 'general', age: 'auto', form: 'all', feat: [], editing: false, priceFor: null, open: null}, opts);
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
const GEN = CATALOG.filter(p => p.kind === '일반식');
const STAGES = ['young', 'adult', 'senior', 'all', 'unknown'];
check('U7', '사료 목록 무결성: 중복 없음, 특성·연령 값, 공식 링크, 판매가 없음, 고단백 기준', () => {
  const ids = T => T.map(p => p.id);
  const raw = ctx.RAW;
  const dupId = ids(raw).filter((x, i, a) => a.indexOf(x) !== i);
  if (dupId.length) throw new Error('중복 id: ' + dupId);
  const keys = raw.map(p => [p.brand, p.name, p.species, p.form].join('|'));
  const dupKey = keys.filter((x, i, a) => a.indexOf(x) !== i);
  if (dupKey.length) throw new Error('중복 제품: ' + dupKey);
  const urls = raw.filter(p => !/^https:\/\/(www\.purinapetcare|www\.doowonpet)/.test(p.url)).map(p => p.url);
  const dupUrl = urls.filter((x, i, a) => a.indexOf(x) !== i);
  if (dupUrl.length) throw new Error('같은 공식 페이지가 두 번 등록됨: ' + dupUrl);
  const official = /^https:\/\/(www\.royalcanin\.com\/kr\/|www\.hillspet\.co\.kr\/|apac\.acana\.com\/ko-KR\/|apac\.orijenpetfoods\.com\/ko-KR\/|www\.doowonpet\.co\.kr\/orijen\/|healmedix\.com\/|www\.purinapetcare\.co\.kr\/)/;
  for (const p of CATALOG) {
    if (!official.test(p.url)) throw new Error('공식 링크 아님: ' + p.id);
    if (p.price || p.priceKrw) throw new Error('판매가 포함: ' + p.id);
  }
  for (const p of GEN) {
    if (!STAGES.includes(p.lifeStage)) throw new Error('연령 값 이상: ' + p.id + ' ' + p.lifeStage);
    if (!['건식', '습식'].includes(p.form) || !['강아지', '고양이'].includes(p.species)) throw new Error('형태·종 이상: ' + p.id);
    if ((p.features || []).some(f => !T.ZP_NU_FEATURES.includes(f))) throw new Error('알 수 없는 특성: ' + p.id);
    if (p.species === '강아지' && p.features.includes('헤어볼')) throw new Error('강아지 헤어볼: ' + p.id);
    if (p.conditions.length) throw new Error('일반 사료에 질환 표기: ' + p.id);
    const a = p.analysis;
    if (!a || !['asFed', 'dryMatter'].includes(a.basis)) throw new Error('영양 기준 없음: ' + p.id);
    for (const k of ['protein', 'fat', 'fiber', 'ash', 'moisture']) if (a[k] !== null && !(typeof a[k] === 'number' && a[k] >= 0 && a[k] < 100)) throw new Error('영양값 이상: ' + p.id + ' ' + k);
    if (p.energy !== null && !(p.energy > 500 && p.energy < 6000)) throw new Error('열량 이상: ' + p.id);
    const hp = p.form === '건식' && a.basis === 'asFed' && typeof a.protein === 'number' && a.protein >= (p.species === '강아지' ? 30 : 36);
    if (hp !== p.features.includes('고단백')) throw new Error('고단백 기준 불일치: ' + p.id);
    if (p.brand === '퓨리나 프로플랜' && Object.values(a).some(v => typeof v === 'number')) throw new Error('확인 안 된 퓨리나 성분이 들어감: ' + p.id);
  }
  if (CATALOG.some(p => p.id === 'purina-cat-kitten' && p.lifeStage !== 'young')) throw new Error('키튼 연령 값이 필터와 맞지 않음');
});
const chips = html => [...html.matchAll(/data-zp="nu-feat" data-value="([^"]+)" aria-pressed="(true|false)">([^<]*)<\/button>/g)].map(m => ({f: m[1], on: m[2] === 'true', label: m[3]}));
const shown = html => chips(html).map(c => c.f);
const pressedAge = html => [...html.matchAll(/data-zp="nu-age" data-value="([^"]+)" aria-pressed="true"/g)].map(m => m[1]);
check('U8', '특성 칩: 숫자 없음, 노령 제외, 결과 0개 특성 숨김, 보이는 특성은 결과 있음', () => {
  const pets = [{id: 'cat1', name: '노아', species: '고양이', age: '5살', weight: '4kg'}, {id: 'dog1', name: '콩이', species: '강아지', age: '5살', weight: '4kg'}];
  const FILTER = T.ZP_NU_FEATURES.filter(f => f !== '노령');
  let n = 0;
  for (const pet of pets) for (const age of ['auto', 'young', 'adult', 'senior', 'all']) for (const form of ['all', '건식', '습식']) {
    const base = renderFor(pet, prof({}), {age, form});
    const cs = chips(base);
    if (cs.some(c => c.label !== c.f)) throw new Error('특성 칩에 숫자·추가 문구가 있음: ' + cs.map(c => c.label));
    if (shown(base).includes('노령')) throw new Error('특성 필터에 노령이 있음');
    if (/disabled/.test(base.split('data-zp="nu-feat"').slice(1).join(''))) throw new Error('비활성 특성 칩이 남아 있음');
    for (const f of FILTER) {
      const html = renderFor(pet, prof({}), {age, form, feat: [f]});
      const got = ids(html).length;
      if (shown(base).includes(f) !== got > 0) throw new Error(`${pet.species} ${age} ${form} ${f}: 표시 ${shown(base).includes(f)} / 결과 ${got}`);
      if (!html.includes('<span>' + got + '개 · 브랜드 가나다순')) throw new Error('목록 제목 개수 불일치 ' + f);
      if (!shown(html).includes(f)) throw new Error('선택한 특성이 숨겨짐 ' + f);
      for (const g of FILTER) {
        if (g === f) continue;
        const got2 = ids(renderFor(pet, prof({}), {age, form, feat: [f, g]})).length;
        if (shown(html).includes(g) !== got2 > 0) throw new Error(`${pet.species} ${age} ${form} ${f}+${g}: 표시 ${shown(html).includes(g)} / 결과 ${got2}`);
        n++;
      }
      const list = ids(html).map(byId);
      if (list.some(p => !p.features.includes(f) || p.kind !== '일반식' || p.species !== pet.species)) throw new Error('특성·종·처방식 필터 이상 ' + f);
      if (new Set(list.map(p => p.id)).size !== list.length) throw new Error('같은 제품이 두 번 보임');
    }
  }
  if (n < 1000) throw new Error('조합 수가 너무 적음 ' + n);
});
check('U9', '연령 필터: 4개 버튼, 아이 나이로 기본 선택, 안내 카드·긴 문구 없음', () => {
  const cat5 = {id: 'cat1', name: '노아', species: '고양이', age: '5살', weight: '4kg'};
  const h5 = renderFor(cat5, prof({}));
  const ages = [...h5.matchAll(/data-zp="nu-age" data-value="([^"]+)" aria-pressed="(?:true|false)">([^<]*)</g)].map(m => m[1] + ':' + m[2]);
  eq(ages, ['all:전체', 'young:어린 시기', 'adult:성견·성묘', 'senior:노령'], '연령 버튼');
  eq(pressedAge(h5), ['adult'], '5살 기본 선택');
  eq(pressedAge(renderFor({...cat5, age: '12살'}, prof({}))), ['senior'], '12살 기본 선택');
  eq(pressedAge(renderFor({...cat5, age: '4개월'}, prof({}))), ['young'], '4개월 기본 선택');
  eq(pressedAge(renderFor({...cat5, age: ''}, prof({}))), ['all'], '나이 미입력 기본 선택');
  eq(pressedAge(renderFor(cat5, prof({}), {age: 'senior'})), ['senior'], '직접 선택 유지');
  for (const bad of ['나이 기준', 'zp-nu-hint', '다른 연령에 있어요', '권장 연령이 없는', '나이를 입력하지 않아']) if (h5.includes(bad) || renderFor({...cat5, age: ''}, prof({})).includes(bad)) throw new Error('제거한 문구가 남아 있음: ' + bad);
  const c5 = shown(h5);
  if (!c5.includes('관절') || !c5.includes('고단백') || !c5.includes('체중 관리') || !c5.includes('헤어볼')) throw new Error('성묘 주요 특성 없음 ' + c5);
  const senior = renderFor({...cat5, age: '12살'}, prof({}));
  if (!shown(senior).includes('관절') || ids(senior).length < 10) throw new Error('노령묘 결과 부족');
  if (ids(senior).map(byId).some(p => !['senior', 'all'].includes(p.lifeStage))) throw new Error('노령묘 목록에 다른 연령 섞임');
  const kitten = ids(renderFor({...cat5, age: '4개월'}, prof({}))).map(byId);
  if (!kitten.some(p => p.id === 'purina-cat-kitten') || kitten.some(p => !['young', 'all'].includes(p.lifeStage))) throw new Error('어린 고양이 필터 이상');
  const all = ids(renderFor(cat5, prof({}), {age: 'all'})).map(byId);
  if (all.length !== GEN.filter(p => p.species === '고양이').length) throw new Error('전체 연령에서 고양이 일반 사료가 다 안 보임');
  const dog = {id: 'dog1', name: '콩이', species: '강아지', age: '3살', weight: '8kg'};
  const dc = renderFor(dog, prof({}));
  if (!shown(dc).includes('관절') || !shown(dc).includes('활동량 많음')) throw new Error('성견 관절·활동량 ' + shown(dc));
  const n = T.zpNu(); n.pets = [cat5, {...dog, age: '12살'}]; n.age = 'young';
  T.ZP_VIEWS.nutrition.click('nu-pet', {dataset: {value: 'dog1'}});
  eq(pressedAge(T.ZP_VIEWS.nutrition.render()), ['senior'], '아이 전환 시 그 아이 연령으로 기본 선택');
  if (!h5.includes('중성화 모름') || /종·나이·체중은 내 아이 화면에서/.test(h5)) throw new Error('반려동물 정보 요약 이상');
});
check('U10', '알레르기 부분 원료 안내, 캔당 열량 표기, 처방식 탭 분리 유지', () => {
  const cat = {id: 'cat1', name: '노아', species: '고양이', age: '5살', weight: '4kg'};
  const html = renderFor(cat, prof({allergies: ['양고기']}), {feat: ['관절']});
  if (!html.includes('앞부분 원료에는 양고기')) throw new Error('부분 원료 알레르기 안내 없음');
  const hit = renderFor(cat, prof({allergies: ['연어']}), {age: 'all'});
  if (!html.includes('알레르기 확인') || !hit.includes('표기 원료에 연어 포함')) throw new Error('알레르기 일치 표시 없음');
  const w = renderFor(cat, prof({}), {feat: ['체중 관리'], form: '습식'});
  if (!w.includes('62 kcal / 82g 캔')) throw new Error('캔당 열량 미표시');
  const rx = ids(renderFor(cat, prof({conditions: ['위장관 질환'], vetRecommended: true}), {tab: 'rx'})).map(byId);
  if (!rx.length || rx.some(p => p.kind !== '처방식')) throw new Error('처방식 탭 이상');
  if (!renderFor(cat, prof({conditions: ['위장관 질환'], vetRecommended: true}), {tab: 'rx'}).includes('수의사')) throw new Error('처방식 수의사 안내 없음');
});
const failed = results.filter(x => !x).length;
console.log(`\n결과: ${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
