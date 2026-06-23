/* 서비스워커 — 앱 셸 캐시(오프라인 지원). http/https로 서빙될 때만 등록됨.
   ⚠️ 배포 규약(감사 2026-06-23 P1): SHELL의 JS/CSS를 고치면 반드시 아래 CACHE 버전을 올려라.
   activate가 CACHE 키와 다른 옛 캐시를 지우므로, 버전을 올려야 사용자가 새 파일을 받는다.
   (버전 미증가 → cache-first라 옛 JS가 계속 서빙됨. 빌드 자동 주입은 향후 과제.) */
const CACHE='learning-hub-v2-20260623';
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
