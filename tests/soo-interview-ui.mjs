// 수동물병원 현장 인터뷰 반영 화면 테스트 (2026-11-27 수의사 직접 인터뷰)
// 실행: node tests/soo-interview-ui.mjs  (playwright 필요)
// - 제휴 표시 유지 · ZENO 예약 버튼 미노출(검색·저장·예약 방법별·상세·수의사 Q&A·특수동물·증상 검색 경로)
// - 초진 현장 접수 · 재진 전화 예약 안내, 전화 연결
// - 특수동물 진료 동물종 / 수술 가능 동물종 / 공식 인증을 구분 표시
// - 특수동물 입원실 정보, 야간 수의사 상주·24시간 입원 관리 필터에 잘못 포함되지 않음
// - 다른 제휴 병원 예약 버튼 유지, 320·360·390·412px 가로 넘침 없음
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

let chromium;
try{({chromium}=await import('playwright'));}
catch{({chromium}=createRequire(process.env.PLAYWRIGHT_REQUIRE_FROM||import.meta.url)('playwright'));}

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const html=fs.readFileSync(process.env.ZENO_OWNER_HTML||path.join(ROOT,'owner.html'),'utf8');
const hospitalHtml=fs.readFileSync(path.join(ROOT,'hospital.html'),'utf8');
const shots=process.env.SCREENSHOT_DIR||'screenshots';
fs.mkdirSync(shots,{recursive:true});
const localFont=process.env.ZENO_LOCAL_PRETENDARD||'';

const results=[];
async function check(no,title,fn){
 let ok=true,note='';
 try{await fn()}catch(err){ok=false;note=err.message}
 results.push({no,title,ok});
 console.log((ok?'PASS':'FAIL')+'  '+no+'. '+title+(ok?'':'\n      → '+note));
}
const readHospitals=src=>{const line=src.split('\n').find(l=>l.startsWith('const HOSPITALS='));return JSON.parse(line.slice('const HOSPITALS='.length).replace(/;\s*$/,''));};
const OWNER=readHospitals(html),HOSPITAL=readHospitals(hospitalHtml);
const soo=OWNER.find(h=>h.id==='soo');

await check(1,'데이터: 제휴 유지 · 온라인 예약 분리 · 출처와 확인일 구분 · 무관한 정보 유지',async()=>{
 for(const [view,list] of [['owner',OWNER],['hospital',HOSPITAL]]){
  const h=list.find(x=>x.id==='soo');
  assert.equal(h.linked,true,view+' 제휴 유지');
  assert.equal(h.onlineBookingEnabled,false,view+' 온라인 예약 비활성');
  assert.deepEqual({firstVisit:h.bookingPolicy.firstVisit,followUp:h.bookingPolicy.followUp,sameDayBooking:h.bookingPolicy.sameDayBooking,bookedPatientsPriority:h.bookingPolicy.bookedPatientsPriority,preferredContact:h.bookingPolicy.preferredContact,kakaoResponseMayBeDelayed:h.bookingPolicy.kakaoResponseMayBeDelayed,verifiedAt:h.bookingPolicy.verifiedAt,source:h.bookingPolicy.source},
   {firstVisit:'walk-in',followUp:'phone-only',sameDayBooking:false,bookedPatientsPriority:true,preferredContact:'phone',kakaoResponseMayBeDelayed:true,verifiedAt:'2026-11-27',source:'수의사 직접 인터뷰'},view+' 예약 정책');
  const c=h.exoticInpatientCare;
  assert.deepEqual([c.separateSpace,c.temperatureManagement,c.humidityManagement,c.continuous24HourCare,c.overnightVetOnSite,c.referralForContinuousCare,c.verifiedAt,c.source],[true,true,true,false,null,true,'2026-11-27','수의사 직접 인터뷰'],view+' 특수동물 입원실');
  // 기존 진료 동물종(네이버)은 그대로, 인터뷰 확인 종은 따로
  assert.deepEqual(h.publishedExoticSpecies,['토끼','고슴도치','페럿','기니피그','햄스터','설치류','파충류'],view+' 네이버 진료 동물종 유지');
  for(const s of ['토끼','햄스터','기니피그','고슴도치','페럿','설치류','파충류','도마뱀류'])assert.ok(h.exoticCare.treatableSpecies.includes(s),view+' 진료 동물종 '+s);
  assert.equal(h.exoticCare.surgerySpecies,null,view+' 수술 가능 동물종은 미확인');
  assert.equal(h.exoticCare.officialCertification,null,view+' 공식 인증은 미확인');
  assert.deepEqual(h.officialSpecialties,[],view+' 인터뷰만으로 공식 특화 부여 금지');
  assert.equal(h.specialtyVerificationStatus,'needs-naver-check',view+' 기존 특화 검증 상태 유지');
  assert.equal(h.specialtyEvidenceStatus,'owner-classification-pending-naver',view+' 기존 특화 출처 상태 유지');
  assert.equal(h.is24,false,view+' 24시간 병원으로 바뀌지 않음');
  // 이번 수정과 무관한 정보
  assert.equal(h.phone,'043-275-8275');assert.equal(h.address,'충북 청주시 서원구 모충로3번길 81 (한진아파트 상가 110호)');
  assert.equal(h.hours,'월·화·목·금 10:00~18:00 · 수·일 휴무 · 토 10:00~15:00 · 평일 휴게 12:30~14:00 · 접수마감 평일 17:30/토 14:30');
  assert.equal(h.hoursCheckedAt,'2026-11-19');assert.equal(h.careEvidenceCheckedAt,'2026-11-19');assert.equal(h.photos.length,1);
 }
 assert.equal(soo.reservationInfo.source,'수의사 직접 인터뷰');
 assert.equal(soo.reservationInfo.previousSource,'ZENO 직접 확인 · 전화·네이버');
 assert.equal(soo.reservationInfo.previousCheckedAt,'2026-11-24');
 for(const id of ['naeum','pub045'])assert.ok(OWNER.find(h=>h.id===id).linked&&OWNER.find(h=>h.id===id).onlineBookingEnabled!==false,id+' 온라인 예약 유지');
});

const browser=await chromium.launch({headless:true});
async function openPage(width,scheme='light'){
 const context=await browser.newContext({viewport:{width,height:820},deviceScaleFactor:2,isMobile:true,hasTouch:true,locale:'ko-KR',colorScheme:scheme});
 await context.route(/^https:\/\//,route=>{
  const u=new URL(route.request().url());
  if(localFont&&u.hostname==='cdn.jsdelivr.net'){
   const file=path.join(localFont,u.pathname.split('/dist/web/variable/')[1]||'');
   return fs.existsSync(file)?route.fulfill({status:200,body:fs.readFileSync(file),contentType:file.endsWith('.css')?'text/css':'font/woff2',headers:{'access-control-allow-origin':'*'}}):route.fulfill({status:404,body:''});
  }
  if(u.hostname==='cdn.jsdelivr.net')return route.fallback();
  return route.fulfill({status:200,contentType:'text/html',body:''});
 });
 await context.route('http://zeno.test/**',route=>new URL(route.request().url()).pathname==='/owner'
  ?route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html})
  :route.fulfill({status:503,contentType:'application/json',body:'{}'}));
 const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://zeno.test/owner',{waitUntil:'domcontentloaded'});
 await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.classList.toggle('dark',theme==='dark');state.ownerToken='test-token';state.page='search';state.query='';render();},scheme);
 await page.locator('.zeno-search-card').first().waitFor();
 return {context,page,errors};
}
const sooBookButtons=page=>page.locator('[data-action="book"][data-id="soo"]').count();

await check(2,'검색 카드: 제휴 표시 · 초진 현장 접수/재진 전화 예약 · ZENO 예약 없음 · 전화/길찾기 유지 (320·360·390·412px)',async()=>{
 for(const width of [320,360,390,412])for(const scheme of ['light','dark']){
  const {context,page,errors}=await openPage(width,scheme);
  const card=page.locator('.zeno-search-card:has(.directory-main[data-id="soo"])');
  const got=await card.evaluate(c=>({
   partner:c.querySelector('.zeno-list-partner')?.textContent,
   resv:[...c.querySelectorAll('.zeno-list-resv-chip')].map(x=>x.textContent),
   tel:c.querySelector('a.zeno-list-resv-chip[href^="tel:"]')?.getAttribute('href'),
   actions:[...c.querySelectorAll('.zeno-card-actions .zeno-card-action')].map(x=>x.textContent.trim()),
   call:c.querySelector('.zeno-card-call[href^="tel:"]')?.getAttribute('href'),
   route:c.querySelector('.zeno-card-route')?.getAttribute('href')||'',
   right:c.getBoundingClientRect().right,maxRight:Math.max(...[...c.querySelectorAll('*')].map(x=>x.getBoundingClientRect().right))
  }));
  const tag=width+'px '+scheme;
  assert.equal(got.partner,'제휴',tag+' 제휴 표시');
  assert.deepEqual(got.resv,['초진 현장 접수','재진 전화 예약'],tag+' 예약 안내');
  assert.equal(got.tel,'tel:0432758275',tag+' 재진 전화 예약 번호');
  assert.deepEqual(got.actions,['전화','길찾기'],tag+' 버튼');
  assert.equal(got.call,'tel:0432758275',tag+' 전화 연결');
  assert.ok(got.route.includes('map.naver.com'),tag+' 길찾기');
  assert.equal(await sooBookButtons(page),0,tag+' ZENO 예약 버튼');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),tag+' 가로 넘침');
  assert.ok(got.maxRight<=got.right+1,tag+' 카드 밖으로 넘침');
  // 다른 제휴 병원은 예약 버튼 유지
  for(const id of ['naeum','pub045'])assert.equal(await page.locator('.zeno-search-card [data-action="book"][data-id="'+id+'"]').count(),1,tag+' '+id+' 예약 버튼');
  if(scheme==='light')await card.screenshot({path:path.join(shots,'soo-card-'+width+'.png')});
  assert.deepEqual(errors,[],tag+' 스크립트 오류');
  await context.close();
 }
});

await check(3,'상세 화면: 당일 예약 불가 · 예약 환자 우선 · 현장 대기 · 출처 구분 · 예약 요청 버튼 없음',async()=>{
 for(const width of [320,360,390,412]){
  const {context,page,errors}=await openPage(width);
  await page.evaluate(()=>openModal('details','soo'));
  const quick=await page.locator('.modal .zeno-detail-quick[aria-label="예약 안내"]').innerText();
  for(const text of ['초진 현장 접수 · 재진 전화 예약','당일 예약 불가','당일 예약은 받지 않아요','예약 환자를 먼저 진료해요','현장 방문 시 대기가 생길 수 있어요','카카오톡 상담은 수의사 1인 운영으로 답변이 늦어질 수 있어요','043-275-8275','현장 확인 정보: 2026.11.27 수의사 직접 인터뷰','이전 확인: ZENO 직접 확인 · 전화·네이버 · 2026-11-24'])
   assert.ok(quick.includes(text),width+'px 상세 안내 누락: '+text);
  assert.ok(!quick.includes('ZENO 예약은 병원 확인 후 확정'),width+'px ZENO 예약 확정 안내 노출');
  // 예약 정책 표: 초진 예약 불가 · 재진 예약 가능 · 당일 예약 불가 · 예약 없이 방문 가능 · 예약 환자 우선 가능
  const rows=await page.locator('.modal .zeno-detail-quick details.clinic-compact').first().evaluate(d=>{d.open=true;return [...d.querySelectorAll('.zeno-care-row')].map(r=>r.querySelector('dt').textContent+'='+r.querySelector('dd').textContent)});
  assert.deepEqual(rows,['초진 예약=불가','재진 예약=가능','당일 예약=불가','예약 없이 방문=가능','예약 환자 우선=가능'],width+'px 예약 정책 표');
  assert.equal(await page.locator('.modal [data-action="book"]').count(),0,width+'px 상세 예약 요청 버튼');
  assert.ok(await page.locator('.modal .zeno-detail-actions a[href="tel:043-275-8275"]').count()===1,width+'px 상세 전화하기');
  assert.ok(await page.evaluate(()=>document.querySelector('.modal').scrollWidth<=document.querySelector('.modal').clientWidth+1),width+'px 상세 가로 넘침');
  await page.locator('.modal .zeno-detail-quick[aria-label="예약 안내"]').screenshot({path:path.join(shots,'soo-detail-booking-'+width+'.png')});
  assert.deepEqual(errors,[],width+'px 스크립트 오류');
  await context.close();
 }
});

await check(4,'특수동물 진료 정보: 진료 가능 동물종 · 수술 가능 동물종(미확인) · 공식 인증(미확인) 구분',async()=>{
 const {context,page}=await openPage(360);
 await page.evaluate(()=>{state.detailTab='services';openModal('details','soo')});
 const section=page.locator('.modal .zeno-exotic-care');
 const text=await section.innerText();
 for(const s of ['토끼','햄스터','기니피그','고슴도치','페럿','설치류','파충류','도마뱀류'])assert.ok(text.includes(s),'진료 동물종 '+s);
 assert.ok(text.includes('네이버 공개 정보 · 2026.11.19'),'네이버 출처·확인일');
 assert.ok(text.includes('도마뱀류 — 수의사 직접 인터뷰 · 2026.11.27'),'인터뷰 출처');
 assert.ok(text.includes('최근 도마뱀 등 파충류 진료 수요가 증가하고 있음'),'파충류 수요 증가');
 const rows=await section.locator('.zeno-care-row').evaluateAll(r=>r.map(x=>x.querySelector('dt').textContent+'='+x.querySelector('dd').textContent));
 assert.deepEqual(rows,['수술 가능 동물종=미확인','공식 전문·특화 인증=미확인 (확인된 공식 인증 없음)']);
 // 기존 대표 특화(특수동물 수술)는 확인 대기 표시 유지
 const focus=await page.locator('.modal .zeno-detail-focus').innerText();
 assert.ok(focus.includes('확인 대기')&&focus.includes('특수동물 수술'),'기존 특화 확인 대기 표시');
 // 종별 표에서 수술 가능으로 표시되지 않음
 assert.equal(await page.evaluate(()=>clinicSpeciesStatus(hospitalById('soo'),'도마뱀','surgery')),'unknown');
 assert.equal(await page.evaluate(()=>clinicSpeciesStatus(hospitalById('soo'),'도마뱀','general')),'available');
 await section.screenshot({path:path.join(shots,'soo-exotic-care-360.png')});
 await context.close();
});

await check(5,'특수동물 입원실: 독립 공간·온습도 관리 표시, 24시간 관리 불가·전원 안내, 야간 수의사 미확인',async()=>{
 const {context,page}=await openPage(360);
 await page.evaluate(()=>{state.detailTab='services';openModal('details','soo')});
 const ward=await page.locator('.modal .zeno-exotic-ward .zeno-care-row').evaluateAll(r=>r.map(x=>x.querySelector('dt').textContent+'='+x.querySelector('dd').textContent));
 assert.deepEqual(ward,['독립 입원 공간=운영','온도 관리=동물종에 맞춰 관리','습도 관리=동물종에 맞춰 관리','24시간 입원환자 관리=불가','야간 수의사 상주=미확인','지속 관리가 필요할 때=24시간 동물병원으로 전원 안내']);
 const care=await page.locator('.modal .zeno-care-section').innerText();
 assert.ok(care.includes('현장 확인 정보: 2026.11.27 수의사 직접 인터뷰'),'입원실 출처');
 const main=await page.locator('.modal .zeno-care-section > .zeno-care-list').first().evaluate(dl=>Object.fromEntries([...dl.querySelectorAll(':scope > .zeno-care-row')].map(r=>[r.querySelector('dt').textContent,r.querySelector('dd').textContent])));
 assert.equal(main['24시간 입원 관리'],'불가');
 assert.equal(main['야간 수의사'],'확인 필요');
 assert.equal(main['특수동물 독립 입원실'],'가능');
 assert.equal(main['전원 연계'],'가능');
 await page.locator('.modal .zeno-care-section').screenshot({path:path.join(shots,'soo-inpatient-360.png')});
 await context.close();
});

await check(6,'필터: 야간 수의사 상주·24시간 입원 관리에 포함되지 않음, 특수동물(도마뱀) 검색에는 포함되나 예약 버튼 없음',async()=>{
 const {context,page}=await openPage(360);
 const ids=async filters=>page.evaluate(f=>{state.specialty='';state.exoticSpecies='';state.activeFilters=f;return filteredHospitals().map(h=>h.id)},filters);
 assert.ok(!(await ids(['야간 수의사 상주'])).includes('soo'),'야간 수의사 상주 필터에 포함');
 assert.ok(!(await ids(['24시간 입원 관리'])).includes('soo'),'24시간 입원 관리 필터에 포함');
 assert.ok((await ids(['입원 가능'])).includes('soo'),'입원 가능 필터 누락');
 for(const species of ['도마뱀','토끼','고슴도치']){
  await page.evaluate(sp=>{state.activeFilters=[];state.specialty='특수동물';state.exoticSpecies=sp;state.page='search';render()},species);
  assert.ok(await page.locator('.zeno-search-card .directory-main[data-id="soo"]').count()>0,species+' 특수동물 검색 누락');
  assert.equal(await sooBookButtons(page),0,species+' 특수동물 검색 예약 버튼');
  assert.equal(await page.evaluate(()=>zenoBookEligible(hospitalById('soo'))),false);
 }
 await context.close();
});

await check(7,'예약 진입점: 저장 병원·예약 방법별·수의사 Q&A·증상 검색·로그인 후 이어하기·예약 양식 제출 모두 차단',async()=>{
 const {context,page}=await openPage(360);
 let posted=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/bookings'))posted++;});
 // 저장 병원
 const savedHtml=await page.evaluate(()=>zenoSavedHospitalCard(hospitalById('soo')));
 assert.ok(!savedHtml.includes('data-action="book"'),'저장 병원 카드 예약 버튼');
 assert.ok(savedHtml.includes('초진 현장 접수')&&savedHtml.includes('재진 전화 예약'),'저장 병원 예약 안내');
 assert.ok((await page.evaluate(()=>zenoSavedHospitalCard(hospitalById('naeum')))).includes('data-action="book"'),'나음 저장 카드 예약 버튼');
 // 예약 방법별 병원
 assert.ok(!(await page.evaluate(()=>zenoReservationDirectoryKinds(hospitalById('soo')))).includes('zeno'),'예약 방법별 ZENO 예약 분류');
 assert.deepEqual(await page.evaluate(()=>zenoReservationDirectoryKinds(hospitalById('soo'))),['phone','walkin']);
 await page.evaluate(()=>{state.page='search';render()});
 await page.locator('.zeno-resdir-entry').click();
 assert.equal(await sooBookButtons(page),0,'예약 방법별 화면 예약 버튼');
 // 일반 병원 카드(홈 등)와 공통 안내
 assert.ok(!(await page.evaluate(()=>hospitalCard(hospitalById('soo')))).includes('data-action="book"'),'일반 병원 카드 예약 버튼');
 // 로그인 후 이어하기 / 증상 검색 / 직접 호출: 예약 창 대신 상세
 await page.evaluate(()=>{state.modal=null;openModal('book','soo')});
 assert.deepEqual(await page.evaluate(()=>state.modal&&{type:state.modal.type,id:state.modal.id}),{type:'details',id:'soo'});
 // 예약 양식이 어떤 식으로든 만들어져도 제출 전 차단 (서버에도 보내지 않음)
 await page.evaluate(()=>{
  state.modal=null;render();
  const f=document.createElement('form');f.id='booking-form';
  f.innerHTML='<input name="hospitalId" value="soo"><input name="petName" value="테스트"><input name="species" value="고양이"><input name="date" value="2099-01-01"><input name="time" value="10:00"><input name="service" value="일반 진료"><input name="ownerPhone" value="01012345678">';
  document.body.appendChild(f);f.requestSubmit();
 });
 await page.waitForTimeout(300);
 assert.equal(posted,0,'수동물병원 예약 요청이 서버로 전송됨');
 assert.ok((await page.locator('.toast').innerText()).includes('ZENO 온라인 예약을 받지 않습니다'),'차단 안내');
 await context.close();
});

await check(8,'병원용 앱(hospital.html): 수동물병원 데모 예약 버튼·로컬 데모 예약 차단, 다른 제휴 병원 유지',async()=>{
 const context=await browser.newContext({viewport:{width:390,height:820}});
 await context.route(/^https?:\/\//,route=>new URL(route.request().url()).pathname==='/hospital'&&route.request().url().startsWith('http://zeno.test')
  ?route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:hospitalHtml})
  :route.fulfill({status:503,contentType:'application/json',body:'{}'}));
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://zeno.test/hospital',{waitUntil:'domcontentloaded'});
 await page.waitForTimeout(500);
 const r=await page.evaluate(()=>({
  card:hospitalCard(hospitalById('soo')).includes('data-action="book"'),
  naeum:hospitalCard(hospitalById('naeum')).includes('data-action="book"'),
  local:(()=>{try{localApi('POST','/api/bookings',{hospitalId:'soo',petName:'x'});return 'saved'}catch(e){return e.message}})(),
  localNaeum:(()=>{try{return localApi('POST','/api/bookings',{hospitalId:'naeum',petName:'x'})?.hospitalId||'ok'}catch(e){return e.message}})()
 }));
 assert.equal(r.card,false,'수동물병원 예약 요청 버튼');
 assert.equal(r.naeum,true,'나음 예약 요청 버튼');
 assert.equal(r.local,'수동물병원은 초진 현장 접수, 재진 전화 예약만 가능합니다.','로컬 데모 예약 차단');
 assert.notEqual(r.localNaeum,'수동물병원은 초진 현장 접수, 재진 전화 예약만 가능합니다.','나음 로컬 데모 예약');
 assert.deepEqual(errors,[],'스크립트 오류');
 await context.close();
});

await browser.close();
const failed=results.filter(r=>!r.ok);
console.log(`\n수동물병원 인터뷰 반영 화면 테스트: ${results.length-failed.length}/${results.length} 통과`);
if(failed.length||results.length!==8)process.exit(1);
