// Exercise the same home, directory and emergency routes a guardian uses.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const {chromium}=createRequire(process.env.PLAYWRIGHT_REQUIRE_FROM||import.meta.url)('playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined});
const html=readFileSync(new URL('../owner.html',import.meta.url),'utf8');
try {
 const page=await browser.newPage({viewport:{width:360,height:800},locale:'ko-KR'});
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).pathname==='/owner'
  ?route.fulfill({contentType:'text/html; charset=utf-8',body:html})
  :route.fulfill({status:503,contentType:'application/json',body:'{}'}));
 await page.goto('http://zeno.test/owner');
 const action=name=>page.locator('[data-action="'+name+'"]');
 const submitHome=async query=>{
  await page.locator('#home-hospital-search').fill(query);
  await page.locator('#home-hospital-search').press('Enter');
 };
 await page.locator('.care-symptoms').click();
 assert.ok(await action('symptom-submit').isDisabled());
 const vomit=page.getByRole('button',{name:'토해요',exact:true});
 await vomit.click();
 await vomit.click();
 assert.ok(await action('symptom-submit').isDisabled());
 await vomit.click();
 await page.getByRole('button',{name:'눈곱·충혈이 있어요'}).click();
 await action('symptom-submit').click();
 const reasons=await page.locator('.zeno-symptom-reason').allTextContents();
 const coverage=reasons.map(reason=>Number(reason.match(/\((\d)\/2개 분야\)/)[1]));
 assert.ok(coverage.includes(2)&&coverage.includes(1));
 assert.deepEqual(coverage,[...coverage].sort((a,b)=>b-a));
 assert.equal(await page.locator('.zeno-search-card').count(),reasons.length);
 assert.match(await page.locator('.zeno-results-bar h2').innerText(),new RegExp(reasons.length+'곳'));
 await page.getByRole('button',{name:'증상 변경'}).click();
 assert.equal(await vomit.getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'숨쉬기 힘들어 보여요'}).click();
 assert.match(await page.locator('.zeno-urgent-symptom').innerText(),/전화/);
 assert.ok(await page.locator('.zeno-emergency-group a[href^="tel:"]').count()>0);
 assert.equal(await page.locator('.zeno-emergency-group [data-action="book"]').count(),0);
 await page.evaluate(()=>navTo('home'));
 await submitHome('강아지가 토하고 설사해요');
 assert.match(await page.locator('.zeno-internal-note').innerText(),/토해요 · 설사를 해요/);
 assert.doesNotMatch(await page.locator('.zeno-symptom-reason').first().innerText(),/2개 분야/);
 await page.locator('#hospital-search').fill('없는동물병원');
 await page.locator('#hospital-search').press('Enter');
 await page.locator('.zeno-results-empty').waitFor();
 await page.getByRole('button',{name:'전체 병원 보기',exact:true}).click();
 assert.equal(await page.locator('.zeno-symptom-reason').count(),0);
 await page.locator('#hospital-search').fill('구토, 호흡곤란');
 await action('search-apply').first().click();
 assert.match(await page.locator('.zeno-urgent-symptom').innerText(),/숨쉬기/);
 await page.evaluate(()=>navTo('home'));
 await submitHome('다옴');
 assert.ok((await page.locator('.zeno-search-card').first().innerText()).includes('다옴'));
 assert.equal(await page.locator('.zeno-symptom-reason').count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS symptom selection, ranked matches, query routing, edit, emergency priority and reset');
} finally {await browser.close()}
