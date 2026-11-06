const CACHE='zeno-pwa-ui-v15';
const FALLBACKS=['/owner','/hospital'];
self.addEventListener('install',event=>{event.waitUntil(self.skipWaiting())});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k.startsWith('zeno-pwa-ui-')&&k!==CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();
 })());
});
self.addEventListener('fetch',event=>{
 const req=event.request;
 const url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
 if(req.mode==='navigate'||FALLBACKS.includes(url.pathname)){
  event.respondWith((async()=>{
   const cache=await caches.open(CACHE);
   const key=FALLBACKS.includes(url.pathname)?url.pathname:'/owner';
   try{
    const response=await fetch(req,{cache:'no-store'});
    if(response.ok&&FALLBACKS.includes(url.pathname)){
     await cache.put(key,response.clone());
    }
    return response;
   }catch(err){
    const fallback=await cache.match(key);
    if(fallback)return fallback;
    return new Response('현재 네트워크에 연결할 수 없습니다. 인터넷 연결 후 다시 열어 주세요.',{status:503,headers:{'content-type':'text/plain; charset=utf-8'}});
   }
  })());
 }
});
