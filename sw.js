/* ZENO PWA v5: clinic pages must never fall back to stale cached UI. */
const CACHE='zeno-pwa-assets-v5';
const ICONS=['/icon-192.png','/icon-512.png'];
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ICONS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(names=>Promise.all(names.filter(name=>name!==CACHE).map(name=>caches.delete(name)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
 const request=event.request, url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
 if(['/owner','/owner/','/owner.html','/hospital','/hospital/','/hospital.html','/','/index.html'].includes(url.pathname)){
  event.respondWith(fetch(request,{cache:'no-store'}));return;
 }
 if(url.pathname.startsWith('/icon-')){
  event.respondWith(caches.match(request).then(response=>response||fetch(request)));
 }
});