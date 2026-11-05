const CACHE='zeno-pwa-ui-v2';const PAGES=['/owner','/hospital','/icon-192.png','/icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(PAGES)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(names=>Promise.all(names.filter(n=>n!==CACHE).map(n=>caches.delete(n)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
 if(['/owner','/hospital','/','/index.html'].includes(url.pathname)){
  event.respondWith(fetch(req).catch(()=>caches.match(url.pathname==='/hospital'?'/hospital':'/owner')));return;
 }
 if(url.pathname.startsWith('/icon-'))event.respondWith(caches.match(req).then(r=>r||fetch(req)));
});