// 병원 찾기 카드 렌더링·예약 라벨 검증 (전체 owner.html을 실제 브라우저로 렌더링)
// 실행: node tests/owner-search-card.mjs  (playwright 필요)
// 환경변수
//   ZENO_OWNER_HTML        검사할 owner.html 경로 (기본: 저장소 owner.html)
//   SCREENSHOT_DIR         캡처 저장 폴더 (기본: screenshots)
//   ZENO_LOCAL_PRETENDARD  jsDelivr에 접근할 수 없는 로컬 환경에서만, pretendard 패키지의 dist/web/variable 폴더
//   PLAYWRIGHT_REQUIRE_FROM playwright 위치 (전역 설치 등)
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

let chromium;
try{({chromium}=await import('playwright'));}
catch{({chromium}=createRequire(process.env.PLAYWRIGHT_REQUIRE_FROM||import.meta.url)('playwright'));}

const htmlPath=process.env.ZENO_OWNER_HTML||fileURLToPath(new URL('../owner.html',import.meta.url));
const html=fs.readFileSync(htmlPath,'utf8');
const shots=process.env.SCREENSHOT_DIR||'screenshots';
fs.mkdirSync(shots,{recursive:true});
const localFont=process.env.ZENO_LOCAL_PRETENDARD||'';

// ---- 원본 데이터: 앱이 실행되기 전의 HOSPITALS 원문을 직접 읽어 기대값을 만든다 ----
const dataLine=html.split('\n').find(line=>line.startsWith('const HOSPITALS='));
assert.ok(dataLine,'owner.html에서 HOSPITALS 원본을 찾지 못함');
// 운영 배포 점검과 같은 금지어: 보호자용 화면 원문에 '제보'가 있으면 안 된다
assert.ok(!html.includes('제보'),"owner.html에 '제보' 문구가 있음 (운영 배포 점검에서 자동 복구됨)");
const SOURCE=JSON.parse(dataLine.slice('const HOSPITALS='.length).replace(/;\s*$/,''));
const byId=new Map(SOURCE.map(h=>[h.id,h]));
const httpsUrl=v=>{try{const u=new URL(String(v||''));return u.protocol==='https:'?u.href:''}catch{return ''}};
const validPhone=p=>/^0[0-9 -]{8,15}$/.test(String(p||'').trim());
function expectedButtons(h){
 const out=['전화'];
 if(h.address)out.push('길찾기');
 if(h.linked)out.push('예약');
 return out;
}
// 네이버 예약 주소로 인정하는 형식(앱 규칙과 별도로 테스트에 고정)
function naverUsable(h){
 const url=httpsUrl(h.reservationUrl);if(!url)return '';
 const u=new URL(url);
 if(['m.place.naver.com','place.naver.com'].includes(u.hostname)&&/^\/(?:pet|hospital|place)\/\d+\/booking\/?$/.test(u.pathname))return url;
 if(u.hostname==='booking.naver.com'&&/^\/booking\/\d+\/bizes\/\d+/.test(u.pathname))return url;
 if(h.reservationInfo?.naverLinkStatus==='official-booking-tab'&&u.hostname==='map.naver.com'&&/^\/p\/entry\/place\/\d+$/.test(u.pathname)&&/^\/booking(?:\?|$)/.test(u.searchParams.get('placePath')||''))return url;
 return '';
}
function websiteUsable(h){
 const url=httpsUrl(h.reservationUrl);if(!url)return '';
 const u=new URL(url);
 return !u.username&&!u.password&&!/(^|\.)naver\.com$/i.test(u.hostname)?url:'';
}
function naverVerified(h){
 const i=h.reservationInfo||{};
 if(i.naverLinkVerified===false)return false;
 return i.naverLinkVerified===true||['direct','official-booking-tab'].includes(i.naverLinkStatus);
}
// 병원 상태별 확인 문구 (정확히 0개 또는 1개)
function expectedPending(h){
 if(h.linked)return null;
 const i=h.reservationInfo||{},m=Array.isArray(i.methods)?i.methods:[];
 if(i.evidenceStatus==='reported')return '이용자 제공 · 확인 중';
 if(m.includes('naver')&&(!naverUsable(h)||!naverVerified(h)))return '링크 확인 중';
 if(m.includes('official')&&(!websiteUsable(h)||i.officialLinkVerified!==true))return '링크 확인 중';
 return null;
}
function expectedLinks(h){
 if(h.linked)return [];
 const i=h.reservationInfo||{},m=Array.isArray(i.methods)?i.methods:[];
 const out=[];
 if(m.includes('naver')&&naverUsable(h))out.push({label:'네이버 예약',href:naverUsable(h)});
 if(m.includes('official')&&websiteUsable(h))out.push({label:'홈페이지 예약',href:websiteUsable(h)});
 const tel=validPhone(h.phone)?'tel:'+String(h.phone).replace(/[^0-9]/g,''):'';
 if(m.includes('phone')&&tel)out.push({label:'전화 예약',href:tel});
 const hasAny=m.includes('naver')||m.includes('official')||m.includes('phone')||m.includes('app')||m.includes('walkin')||['optional','walkin'].includes(i.policy);
 const policy=['required','recommended','partial'].includes(i.policy);
 if(!hasAny&&!policy&&tel)out.push({label:'예약 여부 전화 문의',href:tel});
 return out;
}

const browser=await chromium.launch({headless:true});
async function openPage({width,scheme}){
 const context=await browser.newContext({viewport:{width,height:800},deviceScaleFactor:2,isMobile:true,hasTouch:true,locale:'ko-KR',colorScheme:scheme});
 const page=await context.newPage();
 const external=[];
 // 외부 예약처에는 접속하지 않고 요청 주소만 기록한다 (route는 나중에 등록한 것이 먼저 처리됨)
 await context.route(/^https:\/\//,route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='cdn.jsdelivr.net')return route.fallback();
  if(route.request().resourceType()==='document')external.push(u.href);
  return route.fulfill({status:200,contentType:'text/html',body:'<title>external test page</title>'});
 });
 if(localFont){
  await context.route('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/**',route=>{
   const file=path.join(localFont,new URL(route.request().url()).pathname.split('/dist/web/variable/')[1]||'');
   return fs.existsSync(file)?route.fulfill({status:200,body:fs.readFileSync(file),contentType:file.endsWith('.css')?'text/css':'font/woff2',headers:{'access-control-allow-origin':'*'}}):route.fulfill({status:404,body:''});
  });
 }
 await context.route('http://zeno.test/**',route=>new URL(route.request().url()).pathname==='/owner'
  ?route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html})
  :route.fulfill({status:503,contentType:'application/json',body:'{}'}));
 await page.goto('http://zeno.test/owner',{waitUntil:'domcontentloaded'});
 await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.classList.toggle('dark',theme==='dark');state.page='search';state.query='';render();},scheme);
 await page.locator('.zeno-search-card').first().waitFor();
 const font=await page.evaluate(async()=>{const loaded=await document.fonts.load('600 14px "Pretendard Variable"','네이버 예약 전화 길찾기 예약 없이 방문 링크 확인 중');await document.fonts.ready;return loaded.length;});
 assert.ok(font>0,'Pretendard 웹 글꼴을 불러오지 못함 ('+width+'px '+scheme+')');
 return {context,page,external};
}
async function glyphFonts(page,selector){
 const session=await page.context().newCDPSession(page);
 await session.send('DOM.enable');await session.send('CSS.enable');
 const doc=await session.send('DOM.getDocument');
 const {nodeId}=await session.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector});
 assert.ok(nodeId,selector+' 없음');
 return (await session.send('CSS.getPlatformFontsForNode',{nodeId})).fonts;
}

const report=[];
const measured={};
for(const width of [320,360,390,412]){
 for(const scheme of ['light','dark']){
  const {context,page}=await openPage({width,scheme});
  const result=await page.evaluate(()=>{
   const lines=el=>{const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);const tops=new Set();let n;while((n=walker.nextNode())){if(!n.textContent.trim())continue;const r=document.createRange();r.selectNodeContents(n);for(const x of r.getClientRects())if(x.width>0)tops.add(Math.round(x.top));}return tops.size;};
   const rgb=c=>(c.match(/[\d.]+/g)||[]).map(Number);
   const lum=c=>{const v=rgb(c).slice(0,3).map(x=>{x/=255;return x<=.03928?x/12.92:((x+.055)/1.055)**2.4});return .2126*v[0]+.7152*v[1]+.0722*v[2]};
   const clear=c=>{const v=rgb(c);return v.length===4&&v[3]===0};
   const bgOf=el=>{for(let n=el;n;n=n.parentElement){const c=getComputedStyle(n).backgroundColor;if(!clear(c))return c}return 'rgb(255, 255, 255)'};
   const ratio=el=>{const a=lum(getComputedStyle(el).color),b=lum(bgOf(el));return Math.round((Math.max(a,b)+.05)/(Math.min(a,b)+.05)*100)/100};
   const measure=el=>{const r=el.getBoundingClientRect(),cs=getComputedStyle(el);return {label:el.textContent.trim(),left:r.left,right:r.right,y:r.top,width:r.width,height:Math.round(r.height),lines:lines(el),fits:el.scrollWidth<=el.clientWidth+1,whiteSpace:cs.whiteSpace,font:cs.fontFamily,href:el.getAttribute('href')||'',tag:el.tagName,contrast:ratio(el)};};
   const cards=[...document.querySelectorAll('.zeno-search-card')].map(card=>{
    const cr=card.getBoundingClientRect();
    return {id:card.querySelector('.directory-main')?.dataset.id,name:card.querySelector('strong').textContent,left:cr.left,right:cr.right,closed:card.classList.contains('list-closed'),
     nameContrast:ratio(card.querySelector('strong')),
     buttons:[...card.querySelectorAll('.zeno-card-actions .zeno-card-action')].map(measure),
     chips:[...card.querySelectorAll('.zeno-list-resv-chip')].map(measure),
     resvLabel:card.querySelector('.zeno-list-resv-label')?measure(card.querySelector('.zeno-list-resv-label')):null,
     pending:card.querySelector('.zeno-list-resv')?.dataset.pending?[card.querySelector('.zeno-list-resv').dataset.pending]:[],
     visiblePending:[...card.querySelectorAll('.zeno-list-resv-pending')].length,
     gap:(()=>{const resv=card.querySelector('.zeno-list-resv');if(!resv)return 0;const last=[...card.querySelectorAll('.directory-text>*')].filter(x=>x.getBoundingClientRect().height>0).pop();return resv.getBoundingClientRect().top-(last?last.getBoundingClientRect().bottom:0)})(),
     thumbBottom:card.querySelector('.zeno-thumb')?.getBoundingClientRect().bottom??0,
     actionsTop:card.querySelector('.zeno-card-actions')?.getBoundingClientRect().top??0,
     policy:[...card.querySelectorAll('.zeno-list-resv-policy')].map(measure),
     book:[...card.querySelectorAll('[data-action="book"]')].map(b=>b.dataset.id),
     text:card.textContent};
   });
   return {overflowX:document.documentElement.scrollWidth-innerWidth,cards};
  });
  const tag=width+'px '+scheme;
  assert.ok(result.overflowX<=0,tag+' 가로 넘침 '+result.overflowX+'px');
  // 전체 병원 ID가 원본 데이터와 정확히 일치
  assert.deepEqual(result.cards.map(c=>c.id).sort(),SOURCE.map(h=>h.id).sort(),tag+' 카드 ID가 원본 병원 목록과 다름');
  let maxDiff=0;
  for(const c of result.cards){
   const h=byId.get(c.id);const who=tag+' '+c.name;
   // 병원별 버튼 구성 (전화·길찾기·제휴만 예약)
   assert.deepEqual(c.buttons.map(b=>b.label),expectedButtons(h),who+' 버튼 구성');
   assert.deepEqual(c.book,h.linked?[h.id]:[],who+' ZENO 예약 버튼');
   const widths=c.buttons.map(b=>b.width);
   const diff=Math.max(...widths)-Math.min(...widths);maxDiff=Math.max(maxDiff,diff);
   assert.ok(diff<=1,who+' 버튼 너비 차이 '+widths.map(w=>w.toFixed(2)).join('/'));
   for(const b of c.buttons){
    assert.equal(b.height,40,who+' '+b.label+' 높이');
    assert.equal(b.lines,1,who+' '+b.label+' 줄바꿈');
    assert.ok(b.fits,who+' '+b.label+' 잘림');
    assert.equal(b.whiteSpace,'nowrap');
    assert.ok(b.font.includes('Pretendard Variable'),who+' 버튼 글꼴');
    assert.ok(b.left>=c.left-1&&b.right<=c.right+1,who+' '+b.label+' 카드 밖으로 나감');
    assert.ok(Math.abs(b.y-c.buttons[0].y)<1,who+' 버튼 줄 어긋남');
   }
   if(!c.closed)assert.ok(c.nameContrast>=4.5,who+' 병원명 대비 '+c.nameContrast);
   // 예약 줄: 링크 라벨 주소가 원본 주소·전화번호와 일치
   const links=c.chips.filter(x=>x.tag==='A').map(x=>({label:x.label,href:x.href}));
   assert.deepEqual(links,expectedLinks(h),who+' 예약 라벨 링크');
   for(const ch of c.chips){
    if(ch.tag!=='A')assert.equal(ch.href,'',who+' 링크 없는 라벨에 href');
    assert.equal(ch.lines,1,who+' 라벨 '+ch.label+' 줄바꿈');
    assert.ok(ch.fits,who+' 라벨 '+ch.label+' 잘림');
    assert.equal(ch.whiteSpace,'nowrap');
    assert.ok(ch.font.includes('Pretendard Variable'),who+' 라벨 글꼴');
    assert.ok(ch.right<=c.right+1,who+' 라벨 '+ch.label+' 카드 밖으로 나감');
    assert.ok(ch.contrast>=4.5,who+' 라벨 '+ch.label+' 대비 '+ch.contrast);
   }
   if(!h.linked){
    assert.ok(c.resvLabel,who+' 예약 줄 없음');
    assert.ok(c.resvLabel.contrast>=4.5,who+" '예약' 글자 대비 "+c.resvLabel.contrast);
   }
   assert.equal(c.visiblePending,0,who+' 목록에 확인 문구 노출');
   assert.ok(c.gap<8,who+' 예약 줄 위 빈칸 '+c.gap.toFixed(1)+'px');
   assert.ok(c.thumbBottom<=c.actionsTop+0.5,who+' 사진과 버튼 줄 겹침');
   for(const x of c.policy){
    assert.ok(x.contrast>=4.5,who+" '"+x.label+"' 대비 "+x.contrast);
    assert.ok(x.right<=c.right+1,who+" '"+x.label+"' 카드 밖으로 나감");
   }
   // 확인 문구: 상태별 정확한 문구와 개수
   const want=expectedPending(h);
   assert.deepEqual(c.pending,want?[want]:[],who+' 확인 상태');
   assert.ok(!c.text.includes('예약 방법 확인 필요'),who+" '예약 방법 확인 필요' 노출");
   measured[tag]=measured[tag]||{};
   if(c.buttons.length===3&&!measured[tag].partner)measured[tag].partner=widths.map(w=>w.toFixed(2)).join(' / ');
   if(c.resvLabel)measured[tag]['예약']=Math.min(measured[tag]['예약']??99,c.resvLabel.contrast);
   for(const ch of c.chips){const key=ch.tag==='A'?'링크':'글자';measured[tag][key]=Math.min(measured[tag][key]??99,ch.contrast);}
  }
  // 실제 그려진 글자의 글꼴
  for(const sel of ['.zeno-search-card .zeno-list-resv-chip.zeno-resv-naver','.zeno-search-card .zeno-list-resv-label','.zeno-search-card .zeno-card-actions .zeno-card-call','.zeno-search-card .zeno-card-book']){
   const fonts=await glyphFonts(page,sel);
   assert.ok(fonts.some(f=>f.isCustomFont&&/Pretendard/i.test(f.familyName)),tag+' '+sel+' Pretendard 아님: '+JSON.stringify(fonts));
  }
  const three=result.cards.filter(c=>c.buttons.length===3).length,two=result.cards.filter(c=>c.buttons.length===2).length;
  const m=measured[tag];
  report.push(tag+': 카드 '+result.cards.length+'곳 원본 일치 (버튼3 '+three+' · 버튼2 '+two+') · 버튼 너비 차 최대 '+maxDiff.toFixed(2)+'px · 제휴 버튼 '+m.partner+' · 대비 예약 '+m['예약']+' / 링크 '+m['링크']+' / 글자 '+m['글자']);
  // 캡처: 320px 확인 문구가 줄바꿈된 카드 / 360px 제휴 카드
  if(width===320){
   const idx=await page.evaluate(()=>[...document.querySelectorAll('.zeno-search-card')].findIndex(c=>c.querySelectorAll('.zeno-list-resv-chips>*').length>=3));
   if(idx>=0)await page.locator('.zeno-search-card').nth(idx).screenshot({path:path.join(shots,'card-320-'+scheme+'-resv-long.png')});
  }
  if(width===360)await page.locator('.zeno-search-card:has([data-action="book"])').first().screenshot({path:path.join(shots,'card-360-'+scheme+'-partner.png')});
  await page.locator('.zeno-search-card').nth(4).scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(shots,'search-card-'+width+'-'+scheme+'.png')});
  await context.close();
 }
}

// ---- URL이 없거나 쓸 수 없는 네이버·홈페이지, 제보 정보: 테스트 입력으로 직접 확인 ----
{
 const {context,page}=await openPage({width:360,scheme:'light'});
 const cases=[
  {name:'네이버 주소 없음',h:{reservationInfo:{methods:['naver','phone']}},link:['tel:0430000000'],pending:'링크 확인 중',plain:['네이버 예약']},
  {name:'네이버 형식 아님',h:{reservationUrl:'https://example.com/x',reservationInfo:{methods:['naver']}},link:[],pending:'링크 확인 중',plain:['네이버 예약']},
  {name:'홈페이지 주소 없음',h:{reservationInfo:{methods:['official']}},link:[],pending:'링크 확인 중',plain:['홈페이지 예약']},
  {name:'홈페이지 http',h:{reservationUrl:'http://example.com/book',reservationInfo:{methods:['official']}},link:[],pending:'링크 확인 중',plain:['홈페이지 예약']},
  {name:'이용자 제공 + 네이버 주소 없음',h:{reservationInfo:{methods:['naver','walkin'],evidenceStatus:'reported'}},link:[],pending:'이용자 제공 · 확인 중',plain:['네이버 예약','예약 없이 방문']},
  {name:'확인된 네이버',h:{reservationUrl:'https://m.place.naver.com/pet/123/booking',reservationInfo:{methods:['naver'],naverLinkVerified:true}},link:['https://m.place.naver.com/pet/123/booking'],pending:null,plain:[]},
  {name:'확인 전 네이버',h:{reservationUrl:'https://m.place.naver.com/pet/123/booking',reservationInfo:{methods:['naver'],naverLinkVerified:false}},link:['https://m.place.naver.com/pet/123/booking'],pending:'링크 확인 중',plain:[]},
  {name:'확인 끝난 전화 예약',h:{reservationInfo:{methods:['phone'],evidenceStatus:'verified'}},link:['tel:0430000000'],pending:null,plain:[]},
  {name:'javascript 주소',h:{reservationUrl:'javascript:alert(1)',reservationInfo:{methods:['naver','official']}},link:[],pending:'링크 확인 중',plain:['네이버 예약','홈페이지 예약']},
  {name:'data 주소',h:{reservationUrl:'data:text/html,x',reservationInfo:{methods:['official']}},link:[],pending:'링크 확인 중',plain:['홈페이지 예약']},
 ];
 for(const t of cases){
  const got=await page.evaluate(h=>{
   const box=document.createElement('div');box.innerHTML=zenoListReservation({id:'t',name:'테스트',phone:'043-000-0000',linked:false,...h},false);
   return {links:[...box.querySelectorAll('a')].map(a=>a.getAttribute('href')),plain:[...box.querySelectorAll('span.zeno-list-resv-chip')].map(x=>x.textContent),pending:box.querySelector('.zeno-list-resv')?.dataset.pending?[box.querySelector('.zeno-list-resv').dataset.pending]:[],visible:box.querySelectorAll('.zeno-list-resv-pending').length,text:box.textContent};
  },t.h);
  assert.deepEqual(got.links,t.link,t.name+' 링크');
  assert.deepEqual(got.plain,t.plain,t.name+' 누를 수 없는 라벨');
  assert.deepEqual(got.pending,t.pending?[t.pending]:[],t.name+' 확인 상태');
  assert.equal(got.visible,0,t.name+' 목록에 확인 문구 노출');
  assert.ok(!/확인 중/.test(got.text),t.name+' 목록 글자에 확인 중 노출');
  assert.ok(!got.text.includes('예약 방법 확인 필요'),t.name+" '예약 방법 확인 필요' 노출");
 }
 report.push('확인 문구 입력 사례 '+cases.length+'개 (네이버·홈페이지 주소 없음, 이용자 제공, 확인 완료, 비허용 주소) 통과');
 await context.close();
}

// ---- 라벨 클릭·키보드: 모든 외부 라벨이 그 병원 저장 주소로 열리고, 검색 화면은 그대로 ----
{
 const {context,page,external}=await openPage({width:360,scheme:'light'});
 const targets=await page.evaluate(()=>[...document.querySelectorAll('.zeno-search-card a.zeno-list-resv-chip[href^="https:"]')].map(a=>({id:a.closest('.zeno-search-card').querySelector('.directory-main').dataset.id,label:a.textContent.trim()})));
 assert.ok(targets.length>0,'외부 예약 라벨 없음');
 let opened=0;
 for(const t of targets){
  const h=byId.get(t.id);
  const expected=t.label==='네이버 예약'?naverUsable(h):websiteUsable(h);
  assert.ok(expected,h.name+' '+t.label+' 저장된 주소가 없는데 링크가 생김');
  const link=page.locator('.zeno-search-card:has(.directory-main[data-id="'+t.id+'"]) a.zeno-list-resv-chip',{hasText:t.label});
  // 하단 메뉴에 가리지 않도록 화면 가운데로 옮긴 뒤 클릭
  await link.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
  const before=await page.evaluate(()=>scrollY);
  const [popup]=await Promise.all([context.waitForEvent('page'),link.click()]);
  await popup.waitForLoadState('domcontentloaded');
  assert.equal(popup.url(),expected,h.name+' '+t.label+' 최종 주소가 저장된 주소와 다름');
  await popup.close();
  const st=await page.evaluate(()=>({page:state.page,modal:state.modal,pending:state.pendingAction||null,y:scrollY,cards:document.querySelectorAll('.zeno-search-card').length}));
  assert.deepEqual({page:st.page,modal:st.modal,pending:st.pending},{page:'search',modal:null,pending:null},h.name+' 라벨 클릭 후 앱 상태 변경');
  assert.equal(st.cards,SOURCE.length,h.name+' 라벨 클릭 후 검색 목록 변경');
  assert.ok(Math.abs(st.y-before)<2,h.name+' 라벨 클릭 후 스크롤 이동 '+before+'→'+st.y);
  opened++;
 }
 assert.equal(external.length,opened,'열린 외부 주소 수');
 // 전화 라벨: 그 병원 번호
 const tels=await page.evaluate(()=>[...document.querySelectorAll('.zeno-search-card a.zeno-list-resv-chip[href^="tel:"]')].map(a=>({id:a.closest('.zeno-search-card').querySelector('.directory-main').dataset.id,href:a.getAttribute('href')})));
 assert.ok(tels.length>0,'전화 예약 라벨 없음');
 for(const t of tels)assert.equal(t.href,'tel:'+String(byId.get(t.id).phone).replace(/[^0-9]/g,''),byId.get(t.id).name+' 전화 라벨 번호');
 // 실제 Tab 이동 → 포커스 테두리 → Enter
 const first=targets[0];
 const card=page.locator('.zeno-search-card:has(.directory-main[data-id="'+first.id+'"])');
 await card.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
 await card.locator('.directory-main').focus();
 const order=[];
 for(let i=0;i<4;i++){
  await page.keyboard.press('Tab');
  const f=await page.evaluate(()=>{const a=document.activeElement;const cs=getComputedStyle(a);return {cls:String(a.className),text:a.textContent.trim(),outline:cs.outlineStyle,width:cs.outlineWidth,visible:a.matches(':focus-visible')}});
  order.push(f);
  if(/zeno-list-resv-chip/.test(f.cls)&&f.text===first.label)break;
 }
 const focused=order[order.length-1];
 assert.ok(/zeno-list-resv-chip/.test(focused.cls)&&focused.text===first.label,'Tab으로 예약 라벨에 도달하지 못함: '+JSON.stringify(order));
 assert.ok(focused.visible&&focused.outline==='solid'&&parseFloat(focused.width)>=2,'포커스 테두리 없음: '+JSON.stringify(focused));
 const expectedFirst=first.label==='네이버 예약'?naverUsable(byId.get(first.id)):websiteUsable(byId.get(first.id));
 const [kbPopup]=await Promise.all([context.waitForEvent('page'),page.keyboard.press('Enter')]);
 await kbPopup.waitForLoadState('domcontentloaded');
 assert.equal(kbPopup.url(),expectedFirst,'Enter로 연 주소');
 await kbPopup.close();
 assert.deepEqual(await page.evaluate(()=>({page:state.page,modal:state.modal})),{page:'search',modal:null},'Enter 후 검색 화면 유지');
 report.push('외부 라벨 '+opened+'개: 새 창 주소가 병원 저장 주소와 일치 · 검색 화면/스크롤 유지 · 전화 라벨 '+tels.length+'개 번호 일치 · Tab→포커스 테두리→Enter 확인');
 await context.close();
}

// ---- 제휴 3곳: 예약 → 진료 선택 → 예약 정보 → 문진 시작하기 → 항목 선택 (제출하지 않음) ----
{
 const {context,page}=await openPage({width:360,scheme:'light'});
 const partners=SOURCE.filter(h=>h.linked).map(h=>({id:h.id,name:h.name}));
 assert.deepEqual(partners.map(p=>p.name).sort(),['24시청주나음동물메디컬','수동물병원','티플러스동물메디컬센터'].sort(),'제휴 병원 목록');
 let posted=0;
 page.on('request',r=>{if(r.method()==='POST'&&/booking|reserv/i.test(r.url()))posted++;});
 const shown=async loc=>loc.evaluate(el=>{const r=el.getBoundingClientRect();if(r.width<1||r.height<1)return false;for(let n=el;n;n=n.parentElement){const cs=getComputedStyle(n);if(cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity)===0)return false}return true});
 for(const p of partners){
  await page.evaluate(()=>{state.ownerToken='test-token';state.modal=null;state.page='search';state.query='';render();});
  const btn=page.locator('.zeno-search-card [data-action="book"][data-id="'+p.id+'"]');
  await btn.scrollIntoViewIfNeeded();await btn.click();
  assert.deepEqual(await page.evaluate(()=>({type:state.modal?.type,id:state.modal?.id})),{type:'book',id:p.id},p.name+' ZENO 예약 창');
  const service=page.locator('[data-action="zeno-book-service"]').first();
  if(await service.count())await service.click();
  const next=page.locator('[data-action="zeno-book-next"]').first();
  assert.ok(await next.isEnabled(),p.name+' 다음 버튼 비활성');
  await next.click();
  await page.locator('#booking-form').waitFor({timeout:5000});
  const intake=page.locator('.zi-intake').first();
  assert.ok(await shown(intake),p.name+' 진료 전 문진이 화면에 보이지 않음');
  const summary=intake.locator('summary',{hasText:'문진 시작하기'});
  await summary.scrollIntoViewIfNeeded();
  assert.ok(await shown(summary),p.name+" '문진 시작하기'가 보이지 않음");
  await summary.click();
  const chip=intake.locator('.zi-chip').first();
  assert.ok(await shown(chip),p.name+' 문진 증상 항목이 펼쳐지지 않음');
  await chip.click();
  assert.equal(await chip.getAttribute('aria-pressed'),'true',p.name+' 문진 증상 선택 실패');
  const select=intake.locator('#zi-onset');
  await select.scrollIntoViewIfNeeded();
  assert.ok(await shown(select),p.name+' 문진 항목이 펼쳐지지 않음');
  const value=await select.evaluate(s=>[...s.options].find(o=>o.value)?.value||'');
  assert.ok(value,p.name+' 문진 선택지 없음');
  await select.selectOption(value);
  assert.equal(await select.inputValue(),value,p.name+' 문진 항목 선택 실패');
  await intake.screenshot({path:path.join(shots,'intake-'+p.id+'-360.png')});
  await page.evaluate(()=>{try{zenoCloseModal()}catch{state.modal=null;render()}});
 }
 assert.equal(posted,0,'테스트 중 예약 요청이 전송됨');
 report.push('제휴 3곳 '+partners.map(p=>p.name).join('·')+': 예약 → 진료 선택 → 예약 정보 → 문진 시작하기 → 항목 선택 (제출 없음)');
 await context.close();
}
// 진료비 비교: 기본 목록에 실제 공개 금액, 작은 화면 가로 넘침 방지, 이음 상세 이동
for(const width of [320,360,390,412]){
 for(const scheme of ['light','dark']){
  const {context,page}=await openPage({width,scheme});
  await page.evaluate(()=>{state.page='prices';state.priceCategory='전체 병원';state.modal=null;render();});
  const rows=page.locator('.zeno-fee-directory-row');
  assert.ok(await rows.count()>=10,'공개 진료비 병원 누락');
  const eum=page.locator('.zeno-fee-directory-row[data-id="pub007"]');
  assert.equal(await eum.count(),1,'이음 가격 목록 누락');
  assert.ok((await eum.innerText()).includes('980,000원'),'고양이 기본 검진 가격 누락');
  assert.ok((await eum.innerText()).includes('960,000'),'강아지 기본 검진 가격 누락');
  assert.equal(await page.locator('.zeno-fee-compact>.zeno-fee-choices .filter').count(),6,'기본 항목 개수');
  assert.equal(await page.locator('.zeno-fee-more').getAttribute('open'),null,'추가 항목은 기본 접힘');
  const layout=await page.evaluate(()=>[...document.querySelectorAll('.zeno-fee-directory-row')].map(el=>({width:el.clientWidth,scroll:el.scrollWidth,rect:el.getBoundingClientRect().height})));
  assert.ok(layout.every(x=>x.scroll<=x.width+1&&x.rect<=125),'가격 목록 넘침 또는 높이 과다: '+JSON.stringify(layout));
  await page.screenshot({path:path.join(shots,'fees-'+width+'-'+scheme+'.png')});
  await eum.click();
  assert.equal(await page.evaluate(()=>state.detailTab),'fees','이음 가격 탭 이동 실패');
  assert.ok(await page.locator('#zeno-detail-fees').isVisible(),'공개 가격 탭 미표시');
  assert.ok((await page.locator('#zeno-detail-fees').innerText()).includes('2,250,000원'),'이음 상세 금액 누락');
  await page.evaluate(()=>{state.modal=null;state.page='prices';state.priceCategory='전체 병원';render();});
  await page.locator('.zeno-fee-compact>.zeno-fee-choices [data-value="건강검진"]').click();
  assert.ok((await page.locator('.zeno-health-clinic').first().innerText()).includes('이음'),'건강검진 비교에서 이음 누락');
  await page.locator('[data-action="health-check-species"][data-value="고양이"]').click();
  assert.ok((await page.locator('.zeno-health-clinic').first().innerText()).includes('2,250,000원'),'고양이 건강검진 비교 금액 누락');
  await context.close();
 }
}
report.push('진료비 비교 320/360/390/412px 라이트·다크: 전체 목록 가격 노출, 필터 접힘, 상세 탭 이동, 강아지/고양이 검진 비교 확인');
await browser.close();
console.log('PASS owner search card\n- '+report.join('\n- '));
