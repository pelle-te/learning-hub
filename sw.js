/* 서비스워커 — 앱 셸 캐시(오프라인 지원). http/https로 서빙될 때만 등록됨. */
const CACHE='learning-hub-v1';
const SHELL=[
  './','./index.html','./css/style.css','./manifest.webmanifest','./icon.svg',
  './js/utils.js','./js/state.js','./js/scheduler.js',
  './js/ui-schedule.js','./js/ui-items.js','./js/ui-routine.js','./js/ui-stats.js',
  './js/ui-vault.js','./js/ui-anki.js','./js/ui-degree.js','./js/app.js'
];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.origin!==location.origin)return;            // 외부(예: AnkiConnect)는 건드리지 않음
  e.respondWith(
    caches.match(e.request).then(hit=>hit||fetch(e.request).then(res=>{
      const copy=res.clone();
      caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});
      return res;
    }).catch(()=>hit))
  );
});
