// Exercise a mobile owner and a hospital desktop against one disposable local D1.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright-core';

const origin = 'http://127.0.0.1:8787';
for (let attempt=0; attempt<60; attempt++) {
  const ping = await fetch(origin+'/api/ping').then(r=>r.json()).catch(()=>null);
  if (ping?.connected) break;
  if (attempt===59) throw Error('Local D1 did not become ready');
  await new Promise(resolve=>setTimeout(resolve,500));
}
const account = {username:'demo_'+randomUUID().slice(0,8), password:randomUUID(), displayName:'시연점검'};
const registered = await fetch(origin+'/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(account)});
assert.equal(registered.status,201,'local owner fixture');
const version = await (await fetch(origin+'/api/ui-version')).json();
const browser = await chromium.launch({channel:'chrome', headless:true});
try {
  // Deployment embeds these HTML files in the Worker. Use their current bodies and
  // the local Worker's revision and response headers. All data requests go to D1.
  async function openApp(app, viewport, mobile=false) {
    const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile,serviceWorkers:'block',locale:'ko-KR',timezoneId:'Asia/Seoul'});
    const html=await readFile(new URL('../'+app+'.html',import.meta.url),'utf8');
    const revision=new RegExp("const ZENO_"+app.toUpperCase()+"_UI_REVISION\\s*=\\s*'[^']+';");
    assert.ok(revision.test(html));
    const body=html.replace(revision,"const ZENO_"+app.toUpperCase()+"_UI_REVISION='"+version[app]+"';");
    await context.route(origin+'/'+app,async route=>{
      const response=await route.fetch();
      assert.equal(response.status(),200);
      await route.fulfill({response,body});
    });
    const page=await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror',err=>{pageErrors.push(err.message);console.error(app,'page error',err.message);});
    page.on('response',r=>{
      const path=new URL(r.url()).pathname;
      if(path.startsWith('/api/') && (r.request().method()!=='GET' || r.status()>=400))
        console.log(app,r.request().method(),path,r.status());
    });
    page.on('dialog',dialog=>dialog.accept());
    await page.goto(origin+'/'+app);
    return page;
  }
  const pageErrors=[];
  const owner=await openApp('owner',{width:384,height:832},true);
  const hospital=await openApp('hospital',{width:1366,height:900});
  const visibleNav=(page,route)=>page.locator('[data-nav="'+route+'"]:visible').first().click();
  const button=(page,name)=>page.getByRole('button',{name,exact:true});
  const pet='시연점검';
  const note='양쪽 앱에 전달되는 시연 점검용 메모';
  const row=hospital.getByRole('group',{name:pet+' 예약',exact:true});
  const card=owner.locator('article').filter({hasText:pet}).first();
  await hospital.locator('#hospital-login select').selectOption('pub045');
  await hospital.locator('#hospital-login input[name=pin]').fill('demo-tplus-local');
  await hospital.locator('#hospital-login button[type=submit]').click();
  await hospital.getByRole('heading',{name:'티플러스동물메디컬센터',exact:true}).waitFor();
  await visibleNav(owner,'search');
  await owner.locator('[data-action=book][data-id=pub045]:visible').first().click();
  await owner.locator('#owner-auth input[name=username]').fill(account.username);
  await owner.locator('#owner-auth input[name=password]').fill(account.password);
  await owner.locator('#owner-auth button[type=submit]').click();
  await owner.locator('[data-action=zeno-book-kind][data-value="고양이"]').click();
  await owner.locator('[data-action=zeno-book-service]:visible').first().click();
  await button(owner,'다음 단계').click();
  await owner.locator('#zeno-book-owner-phone').fill('010-0000-0000');
  await owner.locator('#zeno-book-pet-name').fill(pet);
  const date=new Date(Date.now()+2*86400000+9*3600000).toISOString().slice(0,10);
  await owner.locator('#zeno-book-date').fill(date);
  await owner.locator('#zeno-book-time').fill('11:00');
  await owner.locator('#zeno-book-note').fill(note);
  assert.ok(await owner.locator('#booking-form').evaluate(form=>form.checkValidity()));
  const [submitted]=await Promise.all([
    owner.waitForResponse(r=>r.url().endsWith('/api/bookings') && r.request().method()==='POST'),
    button(owner,'예약 요청하기').click()
  ]);
  assert.equal(submitted.status(),201,'booking creation');
  await card.waitFor().catch(async error=>{
    console.error('Booking screen headings:',await owner.locator('h1:visible,h2:visible').allInnerTexts());
    throw error;
  });
  await button(hospital,'새로고침').click();
  await row.getByText(note,{exact:true}).waitFor();
  console.log('PASS mobile owner request, hospital login, booking and note received');
  await button(row,'요청 시간으로 확정').click();
  await row.getByText('예약 확정',{exact:true}).waitFor();
  await button(owner,'예약 새로고침').click();
  await card.getByText('예약 확정',{exact:true}).first().waitFor();
  console.log('PASS hospital confirmation shown on owner booking');
  await visibleNav(owner,'more');
  await visibleNav(owner,'qa');
  await button(owner,'질문하기').click();
  assert.deepEqual(await owner.locator('#question-form select option').allTextContents(),['티플러스동물메디컬센터']);
  const question='점검용 방문 준비 문의입니다.';
  await owner.locator('#question-form textarea').fill(question);
  await button(owner,'질문 등록').click();
  await owner.getByRole('heading',{name:question}).waitFor();
  await button(hospital,'진료 전 질문').click();
  await button(hospital,'새로고침').click();
  await hospital.getByText(question,{exact:true}).first().waitFor();
  const reply='점검용 답변입니다.';
  await hospital.locator('textarea[id^="answer-"]').fill(reply);
  await button(hospital,'답변 저장').click();
  await hospital.getByText('답변 등록',{exact:true}).waitFor();
  await visibleNav(owner,'more');
  await visibleNav(owner,'qa');
  await owner.getByText('병원 답변 보기',{exact:true}).click();
  await owner.getByText(reply,{exact:true}).waitFor();
  console.log('PASS private question selection, hospital inbox and reply on owner screen');
  await button(hospital,'진료 상태').click();
  await hospital.locator('[data-action=status-edit][data-value=normal]').click();
  const [savedStatus]=await Promise.all([
    hospital.waitForResponse(r=>r.url().endsWith('/api/settings') && r.request().method()==='PATCH'),
    hospital.locator('[data-action=change-status][data-value=busy]').click()
  ]);
  assert.equal(savedStatus.status(),200);
  const publicState=await (await fetch(origin+'/api/public/hospital-status')).json();
  assert.equal(publicState.settings.pub045.status,'busy');
  console.log('PASS hospital intake status reflected in public API');
  await button(hospital,'예약 관리').click();
  await row.locator('summary').click();
  await button(row,'예약 취소').click();
  await row.getByText('취소됨',{exact:true}).waitFor();
  await visibleNav(owner,'more');
  await visibleNav(owner,'bookings');
  await card.getByText('예약 취소',{exact:true}).first().waitFor();
  await visibleNav(owner,'more');
  await visibleNav(owner,'qa');
  await button(owner,'예약할 병원 찾기').waitFor();
  await owner.getByRole('heading',{name:question}).waitFor();
  assert.deepEqual(pageErrors,[]);
  console.log('PASS cancellation on both screens, question history retained, no page exceptions');
} finally {
  await browser.close();
}
