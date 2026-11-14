import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const owner=fs.readFileSync('owner.html','utf8');
const worker=fs.readFileSync('worker.js','utf8');
assert.ok(worker.includes('const OWNER_HTML = '+JSON.stringify(owner)+';'),
  'Deployed Worker must embed the exact owner HTML');
assert.match(owner,/const ZENO_PUBLIC_PAGES=\[[^\]]*'pets'\]/,
  'My Pets must be a public page');
assert.doesNotMatch(owner,/const ZENO_PUBLIC_PAGES=\[[^\]]*'bookings'\]/,
  'Bookings must still require login');
assert.match(owner,/if\(!state.ownerToken\)\{zenoGuestProfileSave\(\);return;\}/,
  'Guest health profile must save locally');

for(const [i,match] of [...owner.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].entries()){
 if(match[1].trim())new vm.Script(match[1],{filename:'owner.html#script'+i});
}

const start=owner.indexOf('const ZENO_GUEST_PROFILE_KEY=');
const end=owner.indexOf('/* CHANGED: removed unreachable local demo backend',start);
assert.ok(start>0&&end>start,'Missing guest-profile implementation');
const store=new Map();
const localStorage={
 getItem:key=>store.has(key)?store.get(key):null,
 setItem:(key,value)=>{store.set(key,String(value));},
 removeItem:key=>{store.delete(key);}
};
const state={ownerToken:'',owner:null,pets:[],records:[],favorites:[],
 petPhotos:{},petTab:'전체',profileLoaded:false,profileSaving:false,profileSaveError:''};
const context=vm.createContext({APP_MODE:'owner',state,localStorage,toast:()=>{},setTimeout,clearTimeout});
vm.runInContext(owner.slice(start,end),context,{filename:'guest-pets.js'});
assert.equal(state.pets.length,0,'Guest starts empty on a fresh browser');
state.pets=[{id:'guest-pet',name:'별이',species:'고양이'}];
state.records=[{id:'guest-record',petId:'guest-pet',memo:'건강검진'}];
vm.runInContext('savePersonal()',context);
assert.equal(JSON.parse(store.get('zeno-guest-pet-profile-v1')).pets[0].name,'별이');
state.pets=[];state.records=[];
vm.runInContext('zenoApplyGuestProfile()',context);
assert.equal(state.pets[0].name,'별이','Guest pets must survive reload');
assert.equal(state.records[0].memo,'건강검진');
state.ownerToken='signed-in';
state.pets=[{id:'account-pet',name:'로그인 계정의 아이'}];
vm.runInContext('zenoApplyGuestProfile()',context);
assert.equal(state.pets[0].name,'로그인 계정의 아이','Guest data may not replace a signed-in account');
state.ownerToken='';
vm.runInContext('zenoApplyGuestProfile()',context);
assert.equal(state.pets[0].name,'별이','Signed-out view restores isolated guest data');

const memStart=owner.indexOf('function zenoMemorialKey(){');
const memEnd=owner.indexOf('/* ZENO pet portrait upload',memStart);
assert.ok(memStart>0&&memEnd>memStart,'Guest memorial storage code missing');
vm.runInContext(owner.slice(memStart,memEnd),context);
vm.runInContext("zenoMemorialSet({petIds:['guest-pet'],notes:[]})",context);
assert.deepEqual(JSON.parse(store.get('zeno-memorial-guest-v1')).petIds,['guest-pet']);
console.log('PASS guest My Pets local persistence, account isolation, memorial and JS syntax');
