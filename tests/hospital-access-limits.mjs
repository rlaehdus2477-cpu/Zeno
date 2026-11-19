// Run the Worker entry point against a temporary local D1. Credentials and records are test fixtures.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {getPlatformProxy} from 'wrangler';
import worker from '../worker.js';

const platform=await getPlatformProxy({persist:false,remoteBindings:false,envFiles:[]});
try {
 const db=platform.env.DB;
 const schema=await readFile(new URL('../schema.sql',import.meta.url),'utf8');
 // Upgrade a populated installation with the original partner constraint.
 const old=schema.split('-- ZENO authenticated owners')[0].replace('hospital_id TEXT PRIMARY KEY,',
  "hospital_id TEXT PRIMARY KEY CHECK(hospital_id IN ('soo','naeum','tnd')),");
 const base=old+'\n'+schema.slice(schema.indexOf('-- ZENO authenticated owners'),schema.indexOf('CREATE TABLE IF NOT EXISTS hospital_staff'));
 const ddl=base.replace(/^\s*--[^\n]*/gm,'').split(';').map(s=>s.trim()).filter(Boolean);
 await db.batch(ddl.map(sql=>db.prepare(sql)));
 await db.prepare("INSERT INTO hospital_settings(hospital_id,notice) VALUES('soo','기존 안내')").run();
 const env={DB:db,SESSION_SECRET:'local-session-fixture',HOSPITAL_SOO_PIN:'local-pilot-pin',ADMIN_PIN:'local-admin-pin'};
 async function api(method,path,{token,body,bindings=env}={}){
  const request=new Request('https://zeno.test'+path,{method,headers:token?{Authorization:'Bearer '+token}:{},body:body&&JSON.stringify(body)});
  const result=await worker.fetch(request,bindings);
  return {status:result.status,data:await result.json()};
 }
 const get=(path,token)=>api('GET',path,{token});
 const post=(path,body,token)=>api('POST',path,{body,token});
 const patch=(path,body,token)=>api('PATCH',path,{body,token});
 const login=(hospitalId,pin,username)=>post('/api/login',{hospitalId,username,pin});
 const list=async()=> (await get('/api/public/hospital-status')).data.partnerIds;
 const dashboard=(id,token)=>get('/api/dashboard?hospitalId='+id,token);
 const pin=env.HOSPITAL_SOO_PIN, newId='pub015', staffPath='/api/admin/hospital-staff';
 const secret='fixture-staff-password';
 assert.deepEqual((await get('/api/ping')).data,{connected:true});
 const missing=await api('GET','/api/ping',{bindings:{}}), empty=await api('GET','/api/ping',{bindings:{...env,DB:{prepare(){throw Error('fixture')}}}});
 assert.equal(missing.status,503); assert.deepEqual(empty,missing); assert.deepEqual(missing.data,{connected:false});
 assert.deepEqual(await list(),['soo']);
 const legacy=(await login('soo',pin)).data.token;
 assert.equal((await dashboard('soo',legacy)).status,200);
 env.HOSPITAL_SOO_PIN='changed-local-pilot-pin';
 assert.equal((await dashboard('soo',legacy)).status,401);
 const current=(await login('soo',env.HOSPITAL_SOO_PIN)).data.token;
 assert.ok(current);
 const admin=(await post('/api/admin/login',{pin:env.ADMIN_PIN})).data.token;
 const create=(hospitalId,username)=>post(staffPath,{hospitalId,username,password:secret},admin);
 assert.equal((await post(staffPath,{hospitalId:newId,username:'doctor',password:secret},current)).status,401);
 assert.equal((await create('soo','first')).status,201);
 assert.equal((await dashboard('soo',current)).status,401);
 assert.equal((await login('soo',env.HOSPITAL_SOO_PIN)).status,401);
 assert.equal((await create(newId,'doctor')).status,201);
 assert.equal((await create(newId,'desk')).status,201);
 assert.deepEqual((await list()).sort(),[newId,'soo'].sort());
 assert.equal((await get('/api/admin/stats',admin)).data.hospitals,2);
 const details=(await get(staffPath,admin)).data.staff;
 assert.ok(details.every(r=>Object.keys(r).sort().join()==='active,hospitalId,username'));
 const staff=(await login(newId,secret,'doctor')).data.token, desk=(await login(newId,secret,'desk')).data.token;
 assert.ok(staff&&desk);
 assert.equal((await patch('/api/settings',{notice:'새 병원 안내'},staff)).status,200);
 assert.equal((await db.prepare("SELECT notice FROM hospital_settings WHERE hospital_id='soo'").first()).notice,'기존 안내');
 assert.equal((await dashboard(newId,desk)).data.settings.notice,'새 병원 안내');
 const staffData={hospitalId:newId,username:'doctor'};
 assert.equal((await patch(staffPath,{...staffData,action:'reset',password:secret+'2'},admin)).status,200);
 assert.equal((await dashboard(newId,staff)).status,401);
 assert.equal((await patch('/api/settings',{notice:'계정 변경 후'},staff)).status,401);
 const renewed=(await login(newId,secret+'2','doctor')).data.token;
 assert.ok(renewed);
 assert.equal((await patch(staffPath,{...staffData,action:'disable'},admin)).status,200);
 assert.equal((await dashboard(newId,renewed)).status,401);
 assert.equal((await login(newId,secret+'2','doctor')).status,401);
 assert.equal((await dashboard(newId,desk)).status,200);
 console.log('PASS  병원 추가, 기존 설정 이전, 비밀번호 변경, 개별 계정 중지, 공용 로그인 종료, 상태 응답');

 const owner=(await post('/api/auth/register',{username:'quota_test',password:'fixture-owner-password',displayName:'보호자'})).data.token;
 const date=new Date(Date.now()+3*864e5).toISOString().slice(0,10);
 const booking={hospitalId:newId,petName:'나비',species:'고양이',date,time:'10:00',service:'일반 진료',ownerPhone:'01012345678',visitType:'첫 방문'};
 const question={hospitalId:newId,text:'어떤 자료를 지참해야 하나요?'};
 const submit=(path,body)=>post(path,body,owner);
 const receipt=[];
 for(let i=0;i<4;i++){const r=await submit('/api/bookings',booking);assert.equal(r.status,201);receipt.push(r.data.id)}
 const last=await Promise.all([submit('/api/bookings',booking),submit('/api/bookings',{...booking,hospitalId:'soo'})]);
 assert.deepEqual(last.map(r=>r.status).sort(),[201,429]);
 assert.equal((await patch('/api/bookings/'+receipt[0],{status:'cancelled',side:'owner'},owner)).status,200);
 assert.equal((await api('DELETE','/api/bookings/'+receipt[0],{token:desk})).status,200);
 assert.equal((await submit('/api/bookings',booking)).status,429);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM booking_details WHERE booking_id NOT IN (SELECT id FROM bookings)').first()).n,0);
 await db.prepare("UPDATE removed_booking_submissions SET created_at='2020-01-01T00:00:00.000Z' WHERE booking_id=?").bind(receipt[0]).run();
 assert.equal((await submit('/api/bookings',booking)).status,201);
 for(let i=0;i<4;i++)assert.equal((await submit('/api/questions',question)).status,201);
 const qlast=await Promise.all([submit('/api/questions',question),submit('/api/questions',{...question,hospitalId:'soo'})]);
 assert.deepEqual(qlast.map(r=>r.status).sort(),[201,429]);
 const oldest=await db.prepare('SELECT id FROM questions ORDER BY created_at LIMIT 1').first();
 await db.prepare("UPDATE questions SET created_at='2020-01-01T00:00:00.000Z' WHERE id=?").bind(oldest.id).run();
 assert.equal((await submit('/api/questions',question)).status,201);
 assert.equal((await patch(staffPath,{hospitalId:newId,username:'desk',action:'disable'},admin)).status,200);
 assert.equal((await dashboard(newId,desk)).status,401);
 assert.ok(!(await list()).includes(newId));
 assert.equal((await patch(staffPath,{hospitalId:'soo',username:'first',action:'disable'},admin)).status,200);
 assert.equal((await login('soo',env.HOSPITAL_SOO_PIN)).status,401);
 console.log('PASS  예약·질문 각각 최근 24시간 한도, 동시 저장, 삭제 후 한도 유지, 시간 경과 후 재등록');
} finally {
 await platform.dispose();
}
