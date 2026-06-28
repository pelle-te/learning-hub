/* 서비스워커 — 앱 셸 캐시(오프라인 지원). http/https로 서빙될 때만 등록됨.
   ▣ 캐시 전략(감사 2026-06-23 #5 · P1-5): fetch가 stale-while-revalidate다 —
     캐시를 즉시 돌려주되 *백그라운드로 새로 받아 캐시를 갱신*한다. 그래서 JS/CSS를 고치면
     수동 버전 bump 없이도 **다음 로드에 자동 반영**된다(옛 'cache-first라 영원히 stale' 함정 해소).
   CACHE 버전은 이제 *선택*(즉시 일괄 무효화하고 싶을 때만 올림). 올리면 activate가 옛 캐시를 지운다. */
const CACHE='learning-hub-v8-swr';
const SHELL=[
  './','./index.html','./css/style.css','./manifest.webmanifest','./icon.svg',
  './js/main.js',
  './js/utils.js','./js/ui-kit.js','./js/tabs.js','./js/state.js','./js/data-methodology.js','./js/scheduler.js',
  './js/ui-today.js','./js/ui-journal.js','./js/ui-schedule.js','./js/ui-items.js','./js/ui-routine.js','./js/ui-stats.js',
  './js/ui-mastery.js','./js/ui-review.js','./js/ui-vault.js','./js/ui-anki.js','./js/ui-integrations.js','./js/ui-control.js','./js/ui-degree.js','./js/ui-degree-req.js','./js/ui-command.js','./js/app.js',
  './js/vendor/lit-html.js'

];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;              // GET만 캐시(POST 등은 통과)
  const u=new URL(e.request.url);
  if(u.origin!==location.origin)return;            // 외부(예: AnkiConnect)는 건드리지 않음
  // stale-while-revalidate: 캐시 즉시 반환 + 백그라운드 갱신 → 고친 JS가 다음 로드에 자동 반영(P1-5).
  e.respondWith(
    caches.open(CACHE).then(c=>
      c.match(e.request).then(hit=>{
        const net=fetch(e.request).then(res=>{
          if(res&&res.status===200)c.put(e.request,res.clone());   // 정상 응답만 갱신
          return res;
        }).catch(()=>hit);                          // 오프라인이면 캐시로 폴백
        return hit||net;                            // 캐시 있으면 즉시, 없으면 네트워크
      })
    )
  );
});
