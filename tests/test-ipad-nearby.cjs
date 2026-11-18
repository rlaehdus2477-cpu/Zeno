'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html=fs.readFileSync('owner.html','utf8');
const start=html.indexOf('async function zenoToggleNearby(){');
const end=html.indexOf('function zenoListMatchedConditions(',start);
assert.ok(start>0&&end>start,'Nearby browser handler must be found');
const body=html.slice(start,end);
assert.ok(!body.includes('await zenoNearbyGeoRequest(true)'), 'Browser key preflight must not block the iPad location prompt');

function setup(position) {
 const events=[],notifications=[];
 const state={nearbyBusy:false,nearbyError:'',nearbyStage:'',nearbyCoordinates:null,nearbyPosition:null,activeFilters:[],filter:'전체',searchRegion:''};
 const app={
  window:{isSecureContext:true},
  navigator:{geolocation:{},userAgent:'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)',platform:'iPad',maxTouchPoints:5},
  HOSPITALS:[{id:'clinic',address:'충북 청주시'}],
  state,
  render(){},
  toast(message){notifications.push(message)},
  zenoHasFilter(name){return state.activeFilters.includes(name)},
  zenoActiveFilters(){return state.activeFilters},
  async zenoReadNearbyPosition(){events.push('location');return position()},
  async zenoLoadNearbyCoordinates(){events.push('coordinates');state.nearbyCoordinates={clinic:{lat:36.6,lon:127.4}}},
  async zenoNearbyGeoRequest(){events.push('key-preflight');throw new Error('preflight called unexpectedly')},
 };
 vm.createContext(app);
 vm.runInContext(body,app);
 return {app,state,events,notifications};
}
(async()=>{
 const ok=setup(()=>({coords:{latitude:36.6,longitude:127.4,accuracy:70}}));
 await ok.app.zenoToggleNearby();
 assert.deepEqual(ok.events,['location','coordinates'],'iPad permission request must precede geocoding');
 assert.equal(ok.state.activeFilters.includes('내 주변'),true);
 assert.equal(ok.state.nearbyBusy,false);
 assert.equal(ok.state.nearbyPosition.lat,36.6);

 const denied=setup(()=>{const error=new Error('Permission denied');error.code=1;throw error});
 await denied.app.zenoToggleNearby();
 assert.deepEqual(denied.events,['location'],'denied location must never try geocoder');
 assert.equal(denied.state.nearbyPosition,null);
 assert.ok(denied.state.nearbyError.includes('아이패드 위치 권한'));
 assert.equal(denied.state.activeFilters.includes('내 주변'),false);
 console.log('iPad nearby browser tests passed (permission-first, successful search, denial).');
})().catch(e=>{console.error(e);process.exitCode=1});
