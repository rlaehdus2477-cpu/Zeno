// 병원 찾기 카드 렌더링·예약 라벨 검증 (전체 owner.html을 실제 브라우저로 렌더링)
// 실행: node tests/owner-search-card.mjs  (playwright 필요)
// 화면 캡처: screenshots/search-card-<폭>-<light|dark>.png
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

let chromium;
try{({chromium}=await import('playwright'));}
catch{({chromium}=createRequire(process.env.PLAYWRIGHT_REQUIRE_FROM||import.meta.url)('playwright'));}

const html=fs.readFileSync(new URL('../owner.html',import.meta.url),'utf8');
const shots=process.env.SCREENSHOT_DIR||'screenshots';
fs.mkdirSync(shots,{recursive:true});
// 로컬에서 jsDelivr에 접근할 수 없을 때만: Pretendard 패키지 폴더(dist/web/variable)를 지정하면 같은 파일로 대신 응답한다.
const localFont=process.env.ZENO_LOCAL_PRETENDARD||'';

const browser=await chromium.launch({headless:true});
async function openPage({width,scheme}){
 const context=await browser.newContext({viewport:{width,height:800},deviceScaleFactor:2,isMobile:true,hasTouch:true,locale:'ko-KR',colorScheme:scheme});
 const page=await context.newPage();
 await context.route('http://zeno.test/**',route=>new URL(route.request().url()).pathname==='/owner'
  ?route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html})
  :route.fulfill({status:503,contentType:'application/json',body:'{}'}));
 if(localFont){
  await context.route('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/**',route=>{
   const file=path.join(localFont,new URL(route.request().url()).pathname.split('/dist/web/variable/')[1]||'');
   return fs.existsSync(file)?route.fulfill({status:200,body:fs.readFileSync(file),contentType:file.endsWith('.css')?'text/css':'font/woff2',headers:{'access-control-allow-origin':'*'}}):route.fulfill({status:404,body:''});
  });
 }
 // 외부 예약 페이지는 실제로 접속하지 않는다.
 await context.route(/^https:\/\/(m\.place\.naver\.com|booking\.naver\.com|naver\.me|[^/]+)\/.*/,route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='cdn.jsdelivr.net')return route.fallback();
  return route.fulfill({status:200,contentType:'text/html',body:'<title>external</title>'});
 });
 await page.goto('http://zeno.test/owner',{waitUntil:'domcontentloaded'});
 await page.evaluate(theme=>{try{document.documentElement.dataset.theme=theme;document.documentElement.classList.toggle('dark',theme==='dark')}catch{}state.page='search';state.query='';render();},scheme);
 await page.locator('.zeno-search-card').first().waitFor();
 const font=await page.evaluate(async()=>{const loaded=await document.fonts.load('600 14px "Pretendard Variable"','네이버 예약 전화 길찾기 예약 없이 방문');await document.fonts.ready;return loaded.length;});
 assert.ok(font>0,'Pretendard 웹 글꼴을 불러오지 못함 ('+width+'px '+scheme+')');
 return {context,page};
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
for(const width of [320,360,390,412]){
 for(const scheme of ['light','dark']){
  const {context,page}=await openPage({width,scheme});
  const result=await page.evaluate(()=>{
   const out={overflowX:document.documentElement.scrollWidth-innerWidth,cards:[]};
   const lines=el=>{const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);const tops=new Set();let n;while((n=walker.nextNode())){if(!n.textContent.trim())continue;const r=document.createRange();r.selectNodeContents(n);for(const x of r.getClientRects())if(x.width>0)tops.add(Math.round(x.top));}return tops.size;};
   for(const card of document.querySelectorAll('.zeno-search-card')){
    const cr=card.getBoundingClientRect();
    const id=card.querySelector('.directory-main')?.dataset.id;
    const h=(typeof HOSPITALS!=='undefined'?HOSPITALS:[]).find(x=>x.id===id)||{};
    const measure=el=>{const r=el.getBoundingClientRect(),cs=getComputedStyle(el);return {label:el.textContent.trim(),left:r.left,right:r.right,y:r.top,height:Math.round(r.height),lines:lines(el),fits:el.scrollWidth<=el.clientWidth+1,whiteSpace:cs.whiteSpace,font:cs.fontFamily,href:el.getAttribute('href')||'',tag:el.tagName};};
    out.cards.push({name:card.querySelector('strong').textContent,id,linked:Boolean(h.linked),left:cr.left,right:cr.right,
     buttons:[...card.querySelectorAll('.zeno-card-actions .zeno-card-action')].map(measure),
     chips:[...card.querySelectorAll('.zeno-list-resv-chip')].map(measure),
     resv:card.querySelector('.zeno-list-resv')?(()=>{const r=card.querySelector('.zeno-list-resv').getBoundingClientRect();return {right:r.right,lines:card.querySelector('.zeno-list-resv').textContent}})():null,
     book:card.querySelectorAll('[data-action="book"]').length,
     contrast:(()=>{const rgb=c=>(c.match(/[\d.]+/g)||[]).slice(0,3).map(Number);const lum=c=>{const v=rgb(c).map(x=>{x/=255;return x<=.03928?x/12.92:((x+.055)/1.055)**2.4});return .2126*v[0]+.7152*v[1]+.0722*v[2]};let bgEl=card,bg='rgba(0, 0, 0, 0)';while(bgEl&&/rgba\(0, 0, 0, 0\)|transparent/.test(bg=getComputedStyle(bgEl).backgroundColor))bgEl=bgEl.parentElement;if(/rgba\(0, 0, 0, 0\)|transparent/.test(bg))bg='rgb(255, 255, 255)';const ratio=el=>{const a=lum(getComputedStyle(el).color),b=lum(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)};return {name:ratio(card.querySelector('strong')),chips:[...card.querySelectorAll('.zeno-list-resv-chip')].map(el=>{const own=getComputedStyle(el).backgroundColor;const a=lum(getComputedStyle(el).color),b=lum(/rgba\(0, 0, 0, 0\)/.test(own)?bg:own);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)})}})(),
     closed:card.classList.contains('list-closed'),
     pending:[...card.querySelectorAll('.zeno-list-resv-pending')].map(x=>x.textContent),
     text:card.textContent});
   }
   return out;
  });
  const tag=width+'px '+scheme;
  assert.ok(result.overflowX<=0,tag+' 가로 넘침 '+result.overflowX+'px');
  assert.ok(result.cards.length>=50,tag+' 카드 수 '+result.cards.length);
  let three=0,two=0,chipCount=0;
  for(const c of result.cards){
   // 제휴 병원만 ZENO 예약 버튼, 비제휴 병원에는 없음
   assert.equal(c.book,c.linked?1:0,tag+' '+c.name+' 예약 버튼 수');
   if(c.buttons.length===3)three++;else if(c.buttons.length===2)two++;
   for(const b of c.buttons){
    assert.equal(b.height,40,tag+' '+c.name+' '+b.label+' 높이');
    assert.equal(b.lines,1,tag+' '+c.name+' '+b.label+' 줄바꿈');
    assert.ok(b.fits,tag+' '+c.name+' '+b.label+' 잘림');
    assert.equal(b.whiteSpace,'nowrap');
    assert.ok(b.font.includes('Pretendard Variable'),tag+' 버튼 글꼴');
    assert.ok(b.left>=c.left-1&&b.right<=c.right+1,tag+' '+c.name+' '+b.label+' 카드 밖으로 나감');
    assert.ok(Math.abs(b.y-c.buttons[0].y)<1,tag+' '+c.name+' 버튼 줄 어긋남');
   }
   for(const ch of c.chips){
    chipCount++;
    assert.equal(ch.lines,1,tag+' '+c.name+' 라벨 '+ch.label+' 줄바꿈');
    assert.ok(ch.fits,tag+' '+c.name+' 라벨 '+ch.label+' 잘림');
    assert.equal(ch.whiteSpace,'nowrap');
    assert.ok(ch.font.includes('Pretendard Variable'),tag+' 라벨 글꼴');
    assert.ok(ch.right<=c.right+1,tag+' '+c.name+' 라벨 '+ch.label+' 카드 밖으로 나감');
    if(ch.tag==='A')assert.match(ch.href,/^(https:\/\/[^\s]+|tel:[0-9]{9,12})$/,tag+' '+c.name+' 허용되지 않은 링크 '+ch.href);
    else assert.equal(ch.href,'',tag+' 링크 없는 라벨에 href');
   }
   if(!c.closed)assert.ok(c.contrast.name>=4.5,tag+' '+c.name+' 병원명 대비 부족 '+c.contrast.name.toFixed(2));
   for(const r of c.contrast.chips)assert.ok(r>=4.5,tag+' '+c.name+' 예약 라벨 대비 부족 '+r.toFixed(2));
   if(!c.linked)assert.ok(c.resv,tag+' '+c.name+' 예약 줄 없음');
   assert.ok(c.pending.length<=1,tag+' '+c.name+' 확인 문구 중복');
   assert.ok(!c.text.includes('예약 방법 확인 필요'),tag+' '+c.name+' 예약 방법 확인 필요 문구 노출');
  }
  assert.ok(three>=3&&two>=10&&chipCount>=50,tag+' 버튼 3개 카드 '+three+' · 2개 카드 '+two+' · 라벨 '+chipCount);
  // 실제 그려진 글자의 글꼴 (Pretendard 확인)
  for(const sel of ['.zeno-search-card .zeno-list-resv-chip.zeno-resv-naver','.zeno-search-card .zeno-card-actions .zeno-card-call','.zeno-search-card .zeno-card-book']){
   const fonts=await glyphFonts(page,sel);
   assert.ok(fonts.some(f=>f.isCustomFont&&/Pretendard/i.test(f.familyName)),tag+' '+sel+' Pretendard 아님: '+JSON.stringify(fonts));
  }
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.locator('.zeno-search-card').nth(+(process.env.SHOT_CARD||3)).scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(shots,'search-card-'+width+'-'+scheme+'.png')});
  report.push(tag+': 카드 '+result.cards.length+' (버튼3 '+three+' · 버튼2 '+two+') · 라벨 '+chipCount);
  await context.close();
 }
}

// 라벨 클릭: 외부 링크만 새 창으로 열리고, 병원 상세·ZENO 예약 화면은 열리지 않는다.
{
 const {context,page}=await openPage({width:360,scheme:'light'});
 const naver=page.locator('.zeno-search-card .zeno-resv-naver.is-link').first();
 await naver.scrollIntoViewIfNeeded();
 const [popup]=await Promise.all([context.waitForEvent('page'),naver.click()]);
 assert.match(popup.url(),/^https:\/\//,'라벨 클릭 시 https 외부 링크가 아님');
 await popup.close();
 let st=await page.evaluate(()=>({page:state.page,modal:Boolean(state.modal),pending:state.pendingAction||null}));
 assert.equal(st.page,'search','라벨 클릭 후 화면이 바뀜');
 assert.equal(st.modal,false,'라벨 클릭 후 상세/예약 창이 열림');
 assert.equal(st.pending,null,'라벨 클릭이 ZENO 예약으로 이어짐');
 // 키보드: Tab 포커스 + Enter 로 열림
 const kb=page.locator('.zeno-search-card .zeno-resv-naver.is-link').nth(1);
 await kb.focus();
 assert.equal(await kb.evaluate(el=>document.activeElement===el&&el.tabIndex>=0),true,'라벨에 키보드 포커스 불가');
 const [popup2]=await Promise.all([context.waitForEvent('page'),page.keyboard.press('Enter')]);
 assert.match(popup2.url(),/^https:\/\//);await popup2.close();
 // 전화 예약: tel 링크, 앱 화면 변화 없음
 const tel=page.locator('.zeno-search-card .zeno-resv-phone.is-link').first();
 assert.match(await tel.getAttribute('href'),/^tel:[0-9]{9,12}$/);
 await page.evaluate(()=>document.addEventListener('click',e=>{if(e.target.closest('a[href^="tel:"]'))e.preventDefault()},{capture:true,once:true}));
 await tel.click();
 st=await page.evaluate(()=>({page:state.page,modal:Boolean(state.modal)}));
 assert.deepEqual(st,{page:'search',modal:false},'전화 예약 라벨 클릭 후 앱 화면이 바뀜');
 // https·tel 이외 주소 차단
 const blocked=await page.evaluate(()=>{
  const base={id:'t',name:'테스트',phone:'043-000-0000',linked:false};
  return ['javascript:alert(1)','http://example.com/booking','data:text/html,x','https://evil.example/"onmouseover="x'].map(url=>
   zenoListReservation({...base,reservationUrl:url,reservationInfo:{methods:['naver','official']}},false));
 });
 for(const markup of blocked){
  const hrefs=[...markup.matchAll(/href="([^"]*)"/g)].map(m=>m[1]);
  assert.ok(hrefs.every(h=>/^(https:\/\/|tel:)/.test(h)),'차단되어야 할 주소가 링크로 생성됨: '+hrefs.join(','));
  assert.ok(!/javascript:|http:\/\/|data:|onmouseover="/.test(markup),'위험한 주소가 화면에 남음');
 }
 report.push('라벨 클릭: 외부 링크만 열림 · 상세/예약 창 없음 · 키보드 Enter 작동 · tel 확인 · 비허용 주소 차단');
 await context.close();
}

// 제휴 병원 3곳: 기존 ZENO 예약 → 예약 창 + 진료 전 문진(AI 정리) 유지
{
 const {context,page}=await openPage({width:360,scheme:'light'});
 const partners=await page.evaluate(()=>HOSPITALS.filter(h=>h.linked).map(h=>({id:h.id,name:h.name})));
 assert.equal(partners.length,3,'제휴 병원 수 '+partners.length);
 for(const p of partners){
  await page.evaluate(()=>{state.ownerToken='test-token';state.page='search';state.query='';render();});
  const btn=page.locator('.zeno-search-card [data-action="book"][data-id="'+p.id+'"]');
  await btn.scrollIntoViewIfNeeded();await btn.click();
  assert.deepEqual(await page.evaluate(()=>({type:state.modal?.type,id:state.modal?.id})),{type:'book',id:p.id},p.name+' ZENO 예약 창이 열리지 않음');
  if(!(await page.evaluate(()=>state.modal.service)))await page.locator('[data-action="zeno-book-service"]').first().click();
  await page.locator('[data-action="zeno-book-next"]').first().click();
  await page.locator('.zi-intake').first().waitFor({state:'attached',timeout:5000});
  const ok=await page.evaluate(()=>Boolean(document.querySelector('.zi-intake'))&&document.body.textContent.includes('진료 전 문진'));
  assert.ok(ok,p.name+' 예약 창에 진료 전 문진 없음');
  await page.screenshot({path:path.join(shots,'book-'+p.id+'-360.png')});
  await page.evaluate(()=>{try{zenoCloseModal()}catch{state.modal=null;render()}});
 }
 report.push('제휴 병원 '+partners.map(p=>p.name).join('·')+': 예약 창·진료 전 문진 유지');
 await context.close();
}
await browser.close();
console.log('PASS owner search card\n- '+report.join('\n- '));
