// Bump VERSION on every release. Network-first (4 s timeout on navigations) with cache fallback, so a slow or dead signal still opens the app.
const VERSION='gp-teamapp-v9';const SHELL=['./','./index.html','./app.css?v=7','./app.js?v=9','./config.js?v=2','./data/index.json','./manifest.json','./img/arch-mark.png','./img/icon-192.png','https://unpkg.com/leaflet@1.9.4/dist/leaflet.css','https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(c=>Promise.all(SHELL.map(u=>c.add(u).catch(()=>{})))));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==VERSION).map(x=>caches.delete(x)))));self.clients.claim()});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET')return;
 const own=u.origin===location.origin,lib=u.host==='unpkg.com';if(!own&&!lib)return;
 const net=fetch(e.request).then(r=>{if(r.ok){const c=r.clone();caches.open(VERSION).then(x=>x.put(e.request,c))}return r});
 const cached=()=>caches.match(e.request,{ignoreSearch:e.request.mode==='navigate'});
 if(e.request.mode==='navigate'){e.respondWith(new Promise(res=>{let done=false;const t=setTimeout(()=>cached().then(c=>{if(c&&!done){done=true;res(c)}}),4000);
   net.then(r=>{clearTimeout(t);if(!done){done=true;res(r)}}).catch(()=>cached().then(c=>{if(!done){done=true;res(c||Response.error())}}))}));return}
 e.respondWith(net.catch(()=>cached().then(c=>c||Response.error())))});
