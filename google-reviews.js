// Google Places review integration; Google content is returned live, never persisted.
const norm=v=>String(v||'').toLowerCase().replace(/[^가-힣a-z0-9]/g,'');
const phone=v=>String(v||'').replace(/\D/g,'').replace(/^82(?=\d{8,10}$)/,'0');
const road=v=>String(v||'').match(/([가-힣0-9]+(?:로|길|번길))\s*(\d+(?:-\d+)?)/)?.slice(1).join(' ')||'';
export function matchingPlace(h,places){
 const name=norm(h.name), p=phone(h.phone), a=road(h.address);
 const candidates=places.filter(x=>{
  const n=norm(x.displayName?.text), q=phone(x.nationalPhoneNumber), addr=String(x.formattedAddress||'');
  if(!x.id||!name||!n||!addr.includes('청주'))return false;
  const sameName=n===name||n.replace(/^24시/,'')===name.replace(/^24시/,'');
  if(!sameName)return false;
  if(p&&q&&p!==q)return false;
  return Boolean((p&&q&&p===q)||(a&&road(addr)===a));
 });
 return candidates.length===1?candidates[0]:null;
}
async function requestGoogle(path,key,mask,fetcher,body){
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),6000);
 try{
  const res=await fetcher('https://places.googleapis.com/v1/'+path,{method:body?'POST':'GET',headers:{'X-Goog-Api-Key':key,'X-Goog-FieldMask':mask,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:ctrl.signal});
  if(!res.ok)throw Error('Google Places request failed');
  return await res.json();
 }finally{clearTimeout(timer)}
}
export async function readGoogleReviews(h,key,fetcher=fetch){
 const search=await requestGoogle('places:searchText',key,'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber',fetcher,{textQuery:h.name+' '+h.address,languageCode:'ko',regionCode:'KR',pageSize:5});
 const match=matchingPlace(h,Array.isArray(search.places)?search.places:[]);
 if(!match)return {status:'unmatched'};
 const data=await requestGoogle('places/'+encodeURIComponent(match.id)+'?languageCode=ko&regionCode=KR',key,'rating,userRatingCount,reviews,attributions',fetcher);
 const reviews=(Array.isArray(data.reviews)?data.reviews:[]).slice(0,5).map(x=>({rating:x.rating,text:x.text?.text||x.originalText?.text||'',date:x.relativePublishTimeDescription||'',author:x.authorAttribution||{},uri:x.googleMapsUri||'',flagUri:x.flagContentUri||''})).filter(x=>x.author.displayName&&x.uri);
 return {status:'ok',rating:typeof data.rating==='number'?data.rating:null,count:Number(data.userRatingCount||0),reviews,attributions:Array.isArray(data.attributions)?data.attributions:[]};
}
// Atomic, global daily budget. Only counters are stored, never Google content.
export async function reserveGoogleReviewRequest(db,limit=25){
 const day=new Date().toISOString().slice(0,10);
 await db.prepare('CREATE TABLE IF NOT EXISTS google_review_daily_budget (day TEXT PRIMARY KEY, requests INTEGER NOT NULL)').run();
 const result=await db.prepare('INSERT INTO google_review_daily_budget(day,requests) VALUES (?,1) ON CONFLICT(day) DO UPDATE SET requests=requests+1 WHERE requests < ?').bind(day,limit).run();
 return Number(result.meta?.changes||0)===1;
}
