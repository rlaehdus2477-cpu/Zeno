// 홈 화면 렌더링 검증 (전체 owner.html, 실제 브라우저)
// 실행: node tests/owner-home.mjs   환경변수는 tests/owner-search-card.mjs와 같음
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

let chromium;
try{({chromium}=await import('playwright'));}
catch{({chromium}=createRequire(process.env.PLAYWRIGHT_REQUIRE_FROM||import.meta.url)('playwright'));}
const root=fileURLToPath(new URL('..',import.meta.url));
const htmlPath=process.env.ZENO_OWNER_HTML||path.join(root,'owner.html');
const html=fs.readFileSync(htmlPath,'utf8');
const shots=process.env.SCREENSHOT_DIR||'screenshots';
fs.mkdirSync(shots,{recursive:true});
const localFont=process.env.ZENO_LOCAL_PRETENDARD||'';

const browser=await chromium.launch({headless:true});
async function openHome({width,scheme,height=800}){
 const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2,isMobile:true,hasTouch:true,locale:'ko-KR',timezoneId:'Asia/Seoul',colorScheme:scheme});
 const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // 진료 중 병원이 나오도록 평일 오후로 고정
 await page.clock.install({time:new Date('2026-11-25T16:20:00+09:00')});
 await context.route(/^https:\/\//,route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='cdn.jsdelivr.net'){
   if(!localFont)return route.continue();
   const f=path.join(localFont,u.pathname.split('/dist/web/variable/')[1]||'');
   return fs.existsSync(f)?route.fulfill({status:200,body:fs.readFileSync(f),contentType:f.endsWith('.css')?'text/css':'font/woff2',headers:{'access-control-allow-origin':'*'}}):route.fulfill({status:404,body:''});
  }
  // 저장소에 있는 병원 사진은 저장소 파일로 응답, 그 밖의 외부 사진은 실패시켜 대체 아이콘을 검사한다
  if(u.hostname==='raw.githubusercontent.com'){const m=u.pathname.match(/\/photos\/(.*)$/);const f=m&&path.join(root,'photos',m[1]);if(f&&fs.existsSync(f))return route.fulfill({status:200,body:fs.readFileSync(f),contentType:'image/webp'});}
  return route.fulfill({status:404,body:''});
 });
 await context.route('http://zeno.test/**',route=>{
  const pn=new URL(route.request().url()).pathname;
  if(pn==='/owner')return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html});
  // 로고는 worker.js 안에 base64로 들어 있다 (운영과 같은 파일)
  if(pn==='/brand-wordmark-v4.webp'){const m=fs.readFileSync(path.join(root,'worker.js'),'utf8').match(/BRAND_WORDMARK_ALPHA\s*=\s*["'`]([A-Za-z0-9+/=]+)/);if(m)return route.fulfill({status:200,body:Buffer.from(m[1],'base64'),contentType:'image/webp'});}
  const f=path.join(root,pn);
  if(pn!=='/'&&fs.existsSync(f)&&fs.statSync(f).isFile())return route.fulfill({status:200,body:fs.readFileSync(f)});
  return route.fulfill({status:503,contentType:'application/json',body:'{}'});
 });
 await page.goto('http://zeno.test/owner',{waitUntil:'domcontentloaded'});
 await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.classList.toggle('dark',theme==='dark');state.page='home';render();},scheme);
 await page.locator('.zeno-home-v10').waitFor();
 await page.evaluate(async()=>{await document.fonts.load('600 14px "Pretendard Variable"','지금 진료 중인 병원');await document.fonts.ready;});
 // 가로 스크롤 안의 지연 로딩 사진까지 불러오도록 끝까지 넘겼다가 되돌린다
 await page.evaluate(async()=>{const r=document.querySelector('.zeno-v10-open-rail');for(let x=0;x<=r.scrollWidth;x+=150){r.scrollLeft=x;await new Promise(f=>setTimeout(f,30))}r.scrollLeft=0;});
 await page.waitForFunction(()=>[...document.querySelectorAll('.zeno-home-v10 img')].every(i=>i.complete),null,{timeout:10000}).catch(()=>{});
 await page.waitForTimeout(200);
 return {context,page,errors};
}

const report=[];
for(const width of [320,360,390,412]){
 for(const scheme of ['light','dark']){
  const tag=width+'px '+scheme;
  const {context,page,errors}=await openHome({width,scheme});
  const m=await page.evaluate(()=>{
   const q=s=>document.querySelector(s),qa=s=>[...document.querySelectorAll(s)];
   const box=el=>{const r=el.getBoundingClientRect();return {top:r.top+scrollY,bottom:r.bottom+scrollY,left:r.left,right:r.right,h:r.height,w:r.width}};
   const lines=el=>{const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);const t=new Set();let n;while((n=w.nextNode())){if(!n.textContent.trim())continue;const r=document.createRange();r.selectNodeContents(n);for(const x of r.getClientRects())if(x.width>0)t.add(Math.round(x.top));}return t.size};
   const home=q('.zeno-home-v10');
   const fees=new Set([...ZENO_PUBLIC_FEES.map(v=>v.id),...ZENO_HEALTH_SCREENINGS.map(v=>v.id)]).size;
   const first=ZENO_PUBLIC_FEES.flatMap(v=>v.prices.filter(p=>p[0]==='초진 진찰료').map(p=>({id:v.id,min:+p[1],max:+p[2]})));
   return {
    overflow:document.documentElement.scrollWidth-innerWidth,
    homeH:Math.round(home.getBoundingClientRect().height),
    homeLeft:box(home).left,homeRight:box(home).right,
    sections:qa('.zeno-home-v10 > section, .zeno-home-v10 > .zeno-home-hospital-summary').map(s=>({cls:String(s.className).split(' ')[0],...box(s)})),
    search:box(q('.zeno-v10-search')),
    summary:{...box(q('.zeno-home-hospital-summary')),text:q('.zeno-home-hospital-summary').textContent.replace(/\s+/g,' ').trim(),links:qa('.zeno-home-summary-link').map(b=>b.dataset.action)},
    cards:qa('.zeno-v10-open-card').map(c=>({...box(c),nameLines:lines(c.querySelector('strong')),nameFits:c.querySelector('strong').scrollHeight<=c.querySelector('strong').clientHeight+1,
      badgeFits:(()=>{const b=c.querySelector('.zeno-v10-badge');return b.scrollWidth<=b.clientWidth+1})(),
      img:(()=>{const i=c.querySelector('.zeno-v10-mini-photo img');return i?{ok:i.complete&&i.naturalWidth>0}:{fallback:Boolean(c.querySelector('.zeno-v10-mini-photo svg'))}})()})),
    railScroll:(()=>{const r=q('.zeno-v10-open-rail');return {scroll:r.scrollWidth>r.clientWidth,ox:getComputedStyle(r).overflowX}})(),
    icons:qa('.care-shortcuts button span').map(box),
    symptom:box(q('.care-symptoms')),
    hero:q('.zeno-home-fee-hero')?{...box(q('.zeno-home-fee-hero')),amount:q('.zeno-home-fee-hero strong').textContent,label:q('.zeno-home-fee-hero small').textContent,amountSize:parseFloat(getComputedStyle(q('.zeno-home-fee-hero strong')).fontSize)}:null,
    expected:{clinics:fees,amount:first.length?zenoFeeAmount(Math.min(...first.map(r=>r.min)),Math.max(...first.map(r=>r.max))):'',count:new Set(first.map(r=>r.id)).size},
    feesHead:q('.zeno-home-fees>header button')?.textContent||'',
    chips:qa('.zeno-home-fee-chip').map(c=>({...box(c),text:c.textContent.replace(/\s+/g,' ').trim(),val:c.dataset.value,lines:lines(c)})),
    chipsBox:box(q('.zeno-home-fee-chips')),chipsOx:getComputedStyle(q('.zeno-home-fee-chips')).overflowX,
    utilRows:qa('.zeno-home-utility-row').map(r=>({...box(r),text:r.querySelector('strong').textContent})),
    brokenImgs:qa('.zeno-home-v10 img').filter(i=>i.complete&&i.naturalWidth===0).map(i=>i.src),
    logo:(()=>{const l=q('.zeno-v10-header .zeno-global-brand');return l?{tag:l.tagName,ok:l.tagName!=='IMG'||l.naturalWidth>0}:null})(),
    fonts:getComputedStyle(q('.zeno-home-fee-hero strong')||home).fontFamily,
    lowContrast:(()=>{const rgb=c=>(c.match(/[\d.]+/g)||[]).map(Number);const lum=c=>{const v=rgb(c).slice(0,3).map(x=>{x/=255;return x<=.03928?x/12.92:((x+.055)/1.055)**2.4});return .2126*v[0]+.7152*v[1]+.0722*v[2]};const clear=c=>{const v=rgb(c);return v.length===4&&v[3]===0};const bg=el=>{for(let n=el;n;n=n.parentElement){const c=getComputedStyle(n).backgroundColor;if(!clear(c))return c}return 'rgb(255, 255, 255)'};
     return qa('.zeno-home-v10 :is(h2,strong,small,button,p,span)').filter(el=>!el.closest('[aria-hidden="true"]')&&[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&el.getBoundingClientRect().height>0).map(el=>{const a=lum(getComputedStyle(el).color),b=lum(bg(el));return {t:el.textContent.trim().slice(0,20),r:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}}).filter(x=>x.r<4.5).map(x=>x.t+' '+x.r.toFixed(2))})(),
    clipped:qa('.zeno-home-v10 :is(h2,strong,small,button,p)').filter(el=>{const cs=getComputedStyle(el);if(el.closest('.zeno-v10-open-card')||cs.overflow==='visible'&&cs.textOverflow!=='ellipsis')return false;return el.scrollWidth>el.clientWidth+1&&cs.whiteSpace==='nowrap'&&!el.closest('.zeno-v10-open-rail,.zeno-home-fee-chips')}).map(el=>el.textContent.trim().slice(0,30))
   };
  });
  assert.equal(errors.length,0,tag+' 스크립트 오류 '+errors.join(' | '));
  assert.ok(m.overflow<=0,tag+' 가로 넘침 '+m.overflow+'px');
  assert.deepEqual(m.brokenImgs,[],tag+' 깨진 이미지');
  assert.ok(m.logo&&m.logo.ok,tag+' 로고 표시 실패');
  assert.ok(m.fonts.includes('Pretendard'),tag+' 글꼴');
  assert.equal(Math.round(m.search.h),48,tag+' 검색창 높이');
  assert.ok(m.summary.top-m.search.bottom<=12,tag+' 검색창-요약 간격 '+(m.summary.top-m.search.bottom));
  assert.deepEqual(m.summary.links,['night-shortcut','around-clock-shortcut'],tag+' 요약 연결');
  assert.ok(m.cards.length>=3,tag+' 진료 중 카드 수');
  const ch=m.cards.map(c=>Math.round(c.h));
  assert.ok(Math.max(...ch)-Math.min(...ch)<=1,tag+' 카드 높이 불일치 '+ch.join(','));
  assert.ok(Math.max(...ch)<=82,tag+' 카드 높이 '+Math.max(...ch));
  for(const c of m.cards){
   assert.ok(c.nameLines<=2,tag+' 병원 이름 3줄 이상');
   assert.ok(c.img.ok||c.img.fallback,tag+' 카드 사진/대체 아이콘 없음');
  }
  assert.ok(m.railScroll.scroll&&/auto|scroll/.test(m.railScroll.ox),tag+' 진료 중 카드 가로 스크롤');
  for(const i of m.icons)assert.ok(Math.round(i.w)===40&&Math.round(i.h)===40,tag+' 진료과목 아이콘 크기 '+i.w);
  assert.equal(Math.round(m.symptom.h),34,tag+' 증상 버튼 높이');
  assert.ok(m.hero,tag+' 진료비 가격 카드 없음');
  assert.ok(m.hero.h<=70,tag+' 가격 카드 높이 '+m.hero.h);
  assert.equal(m.hero.amount,m.expected.amount,tag+' 초진 진찰료 범위가 데이터와 다름');
  assert.ok(m.hero.label.includes('공개 '+m.expected.count+'곳'),tag+' 초진 공개 병원 수');
  assert.equal(m.feesHead,'공개 가격 '+m.expected.clinics+'곳 ›',tag+' 진료비 병원 수');
  assert.ok(m.hero.amountSize>=Math.max(...await page.evaluate(()=>[...document.querySelectorAll('.zeno-home-fees :is(small,button,p,strong)')].filter(x=>!x.closest('.zeno-home-fee-hero strong')).map(x=>parseFloat(getComputedStyle(x).fontSize)))),tag+' 초진 가격이 가장 크지 않음');
  assert.deepEqual(m.chips.map(c=>c.val),['고양이 종합백신','개 종합백신','건강검진','중성화 수술'],tag+' 진료비 칩');
  assert.ok(m.chips.every(c=>Math.abs(c.top-m.chips[0].top)<1&&c.lines===1),tag+' 진료비 칩 한 줄');
  assert.ok(/auto|scroll/.test(m.chipsOx),tag+' 진료비 칩 가로 스크롤');
  assert.ok(m.chips.every(c=>/\d+곳$/.test(c.text)),tag+' 칩 병원 수');
  assert.deepEqual(m.utilRows.map(r=>r.text),['예약·접수 안내','야간 진료','24시간 운영 병원'],tag+' 조건별 병원 찾기 항목(진료비 중복 금지)');
  for(const r of m.utilRows)assert.ok(r.h<=56,tag+' 조건별 행 높이 '+r.h);
  // 좌우 여백 통일: 섹션 왼쪽·오른쪽 끝이 같음
  const lefts=new Set(m.sections.map(s=>Math.round(s.left))),rights=new Set(m.sections.map(s=>Math.round(s.right)));
  assert.ok(lefts.size===1&&rights.size===1,tag+' 섹션 좌우 정렬 '+JSON.stringify(m.sections.map(s=>[s.cls,Math.round(s.left),Math.round(s.right)])));
  assert.deepEqual(m.clipped,[],tag+' 잘린 글자');
  assert.deepEqual(m.lowContrast,[],tag+' 글자 대비 4.5:1 미만');
  if(width===360&&scheme==='light')report.push('360px 홈 세로 길이 '+m.homeH+'px · 카드 '+ch[0]+'px · 가격 카드 '+Math.round(m.hero.h)+'px');
  await page.setViewportSize({width,height:m.homeH+140});
  await page.screenshot({path:path.join(shots,'home-'+width+'-'+scheme+'.png'),fullPage:true});
  report.push(tag+': 통과 (카드 '+m.cards.length+'개, 대체 아이콘 '+m.cards.filter(c=>c.img.fallback).length+'개)');
  await context.close();
 }
}

// 가격·병원 수가 데이터에서 계산되는지(하드코딩 아님): 데이터 일부를 바꾸면 홈 숫자도 바뀐다
{
 const {context,page}=await openHome({width:360,scheme:'light'});
 const r=await page.evaluate(()=>{
  ZENO_PUBLIC_FEES.push({id:'test-clinic',url:'',checked:'2026-11-25',prices:[['초진 진찰료',1234,98765,'테스트'],['고양이 종합백신',1,1,'테스트']]});
  render();
  const out={amount:document.querySelector('.zeno-home-fee-hero strong').textContent,head:document.querySelector('.zeno-home-fees>header button').textContent,cat:document.querySelector('.zeno-home-fee-chip[data-value="고양이 종합백신"]').textContent};
  ZENO_PUBLIC_FEES.pop();render();return out;
 });
 assert.equal(r.amount,'1,234 ~ 98,765원','가격 범위가 데이터 변경을 따르지 않음');
 assert.match(r.head,/공개 가격 \d+곳/);
 report.push('데이터 변경 시 홈 가격·병원 수 갱신 확인 ('+r.amount+')');
 // 연결 동작: 요약·칩·가격 카드·조건별 행
 const nav=[];
 for(const [sel,expect] of [['.zeno-home-summary-link[data-action="night-shortcut"]','search'],['.zeno-home-summary-link[data-action="around-clock-shortcut"]','search'],['.zeno-home-fee-hero','prices'],['.zeno-home-fee-chip[data-value="건강검진"]','prices'],['.zeno-home-fees>header button','prices'],['.zeno-home-utility-row[data-nav="reservation-directory"]','reservation-directory'],['.care-symptoms','symptoms']]){
  await page.evaluate(()=>{state.page='home';render();window.scrollTo(0,0)});
  const el=page.locator(sel).first();await el.evaluate(x=>x.scrollIntoView({block:'center',behavior:'instant'}));await el.click();
  const st=await page.evaluate(()=>state.page);
  assert.equal(st,expect,sel+' 이동');nav.push(sel.split('[')[0].replace(/^\./,'')+'→'+st);
 }
 report.push('연결: '+nav.join(', '));
 await context.close();
}
await browser.close();
console.log('PASS owner home\n- '+report.join('\n- '));
