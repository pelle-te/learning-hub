/* ============================================================
   state.js — 핵심 전역 상태: 기본값·영속화·migrate·가져오기/내보내기·완료추적·테마
   ※ 방법론 데이터(요약·CBMS·백로그·백지·주간리뷰·Anki카드·백업·아카이빙)는
     data-methodology.js로 분리(이 파일이 만물상이 되지 않게). 모델은 아래 그대로.
   ── 모델 v3 ──────────────────────────────────────────────
   item = {
     id, source, name, color,
     mode: 'weekly' | 'daily',
     weeklyHours: 5,            // mode 'weekly' — 주당 목표 시간
     dailyMin: 30,             // mode 'daily'  — 매일 고정 분(Anki 등)
     deadline: '',             // 선택 (시험일 등)
     chapters: [ {id,name,hours,done:false}, ... ]  // 순서대로 학습. 그날 배운 내용·복습 근거
   }
   ── 학습방법론 실행 레이어(v3.1에서 추가) ───────────────────
   summaries : { 'YYYY-MM-DD': [ {id,sid,name,s1,s2,s3} ] }   // 3문장 요약(3절)
   cbms      : [ {id,ds,sid,name,chapter,code,note} ]          // 오답 분류 C/B/M/S/T(6·12절)
   backlog   : [ {id,ds,sid,name,topic,note,done,doneDs} ]     // '보충 필요' 백로그(5절)
   weekly    : { '주_월요일ISO': {checks:{backlog,cbms,plan,anki}, note} } // 주간 리뷰(10절)
   blankReviewWeekly : true   // 백지 복습(9절) 주 1회 자동 배치
   mockEveryWeeks    : 0      // 모의시험(12절) N주마다(0=끔)
============================================================ */
const SCHEMA_VERSION=3;                 // 모델 버전 (import 마이그레이션 판단용)
const BACKUP_KEY=KEY+'_backup';         // 초기화/가져오기 직전 백업(되돌리기용)

function defaults(){
  const t=new Date();
  const blk=(name,type,s,e,days)=>({id:rid(),name,type,start:s,end:e,days});
  return {
    schemaVersion:SCHEMA_VERSION,
    theme:'dark',         // 'dark' | 'light'
    completions:{},       // 실행 추적: { '2026-06-23': { 'sid|type': {done:true, min:90} } }
    startDate:iso(t),
    moduleLen:120,        // 모듈(공부 슬롯) 분 — 기본 2시간
    reviewRatio:20,       // 가용시간 중 복습용 비중(%)
    routine:[
      blk('수면','수면','00:00','07:00',[0,1,2,3,4,5,6]),
      blk('아침','식사','07:30','08:00',[0,1,2,3,4,5,6]),
      blk('점심','식사','12:00','13:00',[0,1,2,3,4,5,6]),
      blk('저녁','식사','18:00','19:00',[0,1,2,3,4,5,6]),
      blk('취미/휴식','취미','21:30','23:00',[0,1,2,3,4,5,6]),
      /* 수업: 요일마다 개별 블록(시작~끝). 아래는 예시 — 일과 탭에서 요일별로 수정/추가/삭제 */
      blk('수업','수업','09:00','12:00',[1]),
      blk('수업','수업','13:00','15:00',[2]),
      blk('수업','수업','09:00','12:00',[3]),
      blk('수업','수업','13:00','15:00',[4]),
      /* 나머지 깨어있는 시간은 자동으로 공부 가능(빈 시간)이 됩니다 */
    ],
    dayOverrides:{},      // {'2026-06-25': 1.5}  특정 날짜 가용시간(시간) 덮어쓰기
    items:[],
    /* ── 학습방법론 실행 레이어 ── */
    summaries:{},         // 3문장 요약(3절)
    cbms:[],              // 오답 분류 C/B/M/S/T(6·12절)
    backlog:[],           // '보충 필요' 백로그(5절)
    blankResults:[],      // 백지 복습 통과/막힘 결과(9절·E4) — 막힘은 CBMS(C 개념)로 자동 연결
    retentionLog:[],      // 유지율(retention) 추세(E6·F-05) — AnkiConnect due를 주별로 스냅샷 [{wk,at,due,cards}]
    weekly:{},            // 주간 리뷰 체크/메모(10절)
    blankReviewWeekly:true,  // 백지 복습(9절) 주 1회 자동 배치
    mockEveryWeeks:0,        // 모의시험(12절) N주마다(0=끔)
    /* ── 적응·배치 설정(2026-06-28 추가) ── */
    adaptiveCapacity:true,   // 최근 완료율로 미래 계획 용량 보정(방법론 1·10절 "계획은 가설")
    peakStart:'', peakEnd:'',// 각성도 최고 시간대(HH:MM) — new/mock을 여기 우선 배치(방법론 1절). 빈값=끔
    reviewViaAnki:false,     // 복습을 Anki/FSRS에 위임(합성 간격복습 슬롯 생성 끔 → 시간 이중계상 방지)
    degree:{ targetTotal:130, reqMajorReq:0, reqMajorSel:0, reqLiberal:0,
      semesters:[ {id:rid(),name:'2026-1학기',courses:[]} ] },
    anki:{ source:'file' }
  };
}

const CORRUPT_KEY=KEY+'_corrupt';       // 손상 원본 보존(데이터 손실 방지 · 감사 2026-06-23 #5 · P1-7)
/* state는 모든 모듈이 읽고(통계·스케줄러) state.js 안에서만 재할당(boot/undo/import/reset)한다.
   ESM에서 외부 모듈·테스트가 바로 읽도록 globalThis 슬롯에 둔다(scheduler 테스트가 mock state 주입). */
globalThis.state=boot();

/* 부팅 — 저장된 상태를 살리되, 손상/형식불일치로 기본값으로 떨어질 땐
   *원본 raw 문자열을 CORRUPT_KEY에 백업한 뒤* 기본값으로 시작한다.
   (과거: load() 실패 → defaults → 첫 persist()가 복구가능한 원본을 덮어써 영구 손실. 감사 P1-7) */
function boot(){
  let raw=null; try{raw=localStorage.getItem(KEY);}catch(e){}
  let s=null; try{s=migrate(JSON.parse(raw));}catch(e){s=null;}
  if(!s && raw){                         // 원본은 있는데 못 살림 = 손상/형식불일치
    try{ if(localStorage.getItem(CORRUPT_KEY)==null) localStorage.setItem(CORRUPT_KEY,raw); }catch(e){}
    try{ console.warn('상태 손상 감지 — 원본을 "'+CORRUPT_KEY+'"에 보존하고 기본값으로 시작. recoverCorrupt()로 복구 시도 가능.'); }catch(e){}
  }
  return s||defaults();
}
/* 손상 백업이 있으면 복구 시도(되돌리기) */
function hasCorrupt(){try{return !!localStorage.getItem(CORRUPT_KEY)}catch(e){return false}}
function recoverCorrupt(){
  let raw=null; try{raw=localStorage.getItem(CORRUPT_KEY);}catch(e){}
  if(!raw){toast('복구할 손상 백업이 없습니다.','bad');return;}
  let s=null; try{s=migrate(JSON.parse(raw));}catch(e){s=null;}
  if(!s){toast('손상 백업도 살릴 수 없습니다(여전히 형식 오류). "'+CORRUPT_KEY+'"를 직접 내보내 점검하세요.','bad',5000);return;}
  backupNow(); state=s; try{localStorage.removeItem(CORRUPT_KEY);}catch(e){}
  persist(); applyTheme(); render(); toast('손상 직전 상태로 복구했습니다.','ok');
}

/* 불러온 데이터에 새 필드 채우기(구버전 호환) */
function migrate(s){
  if(!s||typeof s!=='object')return null;
  if(!validShape(s))return null;
  const d=defaults();
  s.schemaVersion=SCHEMA_VERSION;
  if(s.theme==null)s.theme=d.theme;
  if(s.completions==null||typeof s.completions!=='object')s.completions={};
  if(s.dayOverrides==null)s.dayOverrides={};
  /* 학습방법론 실행 레이어 필드 보강(구버전 호환) */
  if(s.summaries==null||typeof s.summaries!=='object')s.summaries={};
  if(!Array.isArray(s.cbms))s.cbms=[];
  if(!Array.isArray(s.backlog))s.backlog=[];
  if(!Array.isArray(s.blankResults))s.blankResults=[];
  if(!Array.isArray(s.retentionLog))s.retentionLog=[];
  if(s.weekly==null||typeof s.weekly!=='object')s.weekly={};
  if(s.blankReviewWeekly==null)s.blankReviewWeekly=d.blankReviewWeekly;
  if(s.mockEveryWeeks==null)s.mockEveryWeeks=d.mockEveryWeeks;
  /* 적응·배치 설정 보강(구버전 호환) */
  if(s.adaptiveCapacity==null)s.adaptiveCapacity=d.adaptiveCapacity;
  if(s.peakStart==null)s.peakStart=d.peakStart;
  if(s.peakEnd==null)s.peakEnd=d.peakEnd;
  if(s.reviewViaAnki==null)s.reviewViaAnki=d.reviewViaAnki;
  /* _today는 테스트/시뮬레이션 시드 — 평소 데이터엔 없어야 한다(가져온 파일에 묻어오면 제거). */
  if(s._today!=null)delete s._today;
  /* '공부' 블록 개념 폐지: 남아있던 공부 블록은 제거(그 시간은 자동으로 빈 시간=공부 가능이 됨) */
  if(Array.isArray(s.routine))s.routine=s.routine.filter(b=>b&&b.type!=='공부');
  return s;
}
/* 최소 구조 검증 — 엉뚱한 JSON을 그대로 덮어써 앱이 깨지는 것 방지 */
function validShape(s){
  return s && typeof s==='object'
    && Array.isArray(s.items)
    && Array.isArray(s.routine)
    && s.degree && Array.isArray(s.degree.semesters)
    && typeof s.startDate==='string';
}

function persist(){
  try{localStorage.setItem(KEY,JSON.stringify(state));}
  catch(e){toast('저장 실패: 저장공간이 가득 찼을 수 있어요. [⋯ 메뉴 → 데이터 내보내기]로 백업 후 정리하세요.','bad',5000);}
}
function backupNow(){try{localStorage.setItem(BACKUP_KEY,JSON.stringify(state));return true;}catch(e){return false;}}
/* 파괴적 동작 전 백업 — 실패하면(저장공간 등) 되돌리기 불가를 알리고 사용자에 진행 여부를 묻는다(감사 #5 · P1-7) */
async function backupOrConfirm(){
  if(backupNow())return true;
  return confirmModal('백업 저장 실패(저장공간이 가득 찼을 수 있음) — 지금 진행하면 "되돌리기"가 불가능합니다. 그래도 계속할까요? (먼저 내보내기로 백업 권장)',{title:'백업 실패',okLabel:'계속',danger:true});
}
function hasBackup(){return !!localStorage.getItem(BACKUP_KEY)}
function undoLast(){
  const b=localStorage.getItem(BACKUP_KEY); if(!b){toast('되돌릴 백업이 없습니다.','bad');return;}
  try{const s=migrate(JSON.parse(b)); if(!s){toast('백업이 손상됨','bad');return;}
    state=s; localStorage.removeItem(BACKUP_KEY); persist(); applyTheme(); render(); toast('직전 상태로 되돌렸어요.','ok');
  }catch(e){toast('되돌리기 실패','bad')}
}

/* 런타임 스캔 캐시 — 계산 산출물이라 '파일로 나가는' 백업/내보내기에서는 빼낸다(감사 F-01·설계도 §13.2).
   localStorage 영속에는 남겨 로컬 새로고침 시 재스캔을 아끼되, 내보내기 JSON만 가볍게·깨끗하게. */
const RUNTIME_CACHE_KEYS=['_vaultScan','_ankiFile','_ankiLive','_icsExport'];
function exportSnapshot(){
  const s={}; for(const k in state) if(RUNTIME_CACHE_KEYS.indexOf(k)<0) s[k]=state[k];
  return s;
}
function exportJSON(){
  persist();
  const blob=new Blob([JSON.stringify(exportSnapshot(),null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='러닝허브_'+state.startDate+'.json';a.click();
}
function importJSON(input){
  const f=input.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=async()=>{
    let parsed;
    try{parsed=JSON.parse(r.result);}catch(e){toast('읽기 실패: JSON 형식이 아닙니다.','bad');return;}
    const s=migrate(parsed);
    if(!s){toast('가져오기 실패: 러닝 허브 백업 파일 형식이 아닙니다(필수 항목 누락).','bad',5000);return;}
    RUNTIME_CACHE_KEYS.forEach(k=>{try{delete s[k];}catch(e){}});  // 가져온 파일의 옛 스캔 캐시는 버린다(F-01)
    if(!await backupOrConfirm())return;   // 백업 실패 시 사용자 확인(되돌리기 불가 경고 · #5)
    state=s; persist(); applyTheme(); render(); toastUndo('데이터를 가져왔어요.');
  };
  r.readAsText(f);input.value='';
}
async function resetAll(){
  if(!await confirmModal('모든 데이터를 지울까요? (직후 [⋯ 메뉴 → 되돌리기]로 복구 가능)',{title:'전체 초기화',okLabel:'초기화',cancelLabel:'취소',danger:true}))return;
  if(!await backupOrConfirm())return;   // 백업 실패 시 사용자 확인(되돌리기 불가 경고 · #5)
  state=defaults(); persist(); applyTheme(); render();
  toastUndo('초기화했어요.');
}

/* 테마 — 순환(dark→light→sepia). applyTheme는 부팅 시·토글 시 호출.
   토큰 기반(css/style.css :root[data-theme=…])이라 새 테마 추가는 CSS 한 블록 + 이 목록 한 줄. */
const THEME_CYCLE=['dark','light','sepia'];
function applyTheme(){
  const t=(state&&state.theme)||'dark';
  document.documentElement.setAttribute('data-theme',t);
}
function toggleTheme(){
  const i=THEME_CYCLE.indexOf((state&&state.theme)||'dark');
  state.theme=THEME_CYCLE[(i+1)%THEME_CYCLE.length]||'dark';
  persist();applyTheme();render();
  if(typeof toast==='function')toast('테마: '+({dark:'다크',light:'라이트',sepia:'세피아'}[state.theme]||state.theme),'info',1600);
}

/* ── 실행 추적: 그 날 그 과목의 학습/복습/Anki를 '완료'로 기록 ── */
function compMap(ds){state.completions=state.completions||{};return (state.completions[ds]=state.completions[ds]||{});}
function isDone(ds,sid,type){const m=state.completions&&state.completions[ds];const e=m&&m[sid+'|'+type];return !!(e&&e.done);}
function doneMin(ds,sid,type){const m=state.completions&&state.completions[ds];const e=m&&m[sid+'|'+type];return e&&e.done?(+e.min||0):0;}
function setDone(ds,sid,type,plannedMin,on){
  const m=compMap(ds), k=sid+'|'+type;
  if(on)m[k]={done:true,min:Math.round(plannedMin)};
  else delete m[k];
  if(!Object.keys(m).length)delete state.completions[ds];
  persist();
}
/* 총 완료 학습시간(시간) */
function totalDoneHours(){
  let mins=0; const c=state.completions||{};
  for(const ds in c)for(const k in c[ds])mins+=(+c[ds][k].min||0);
  return mins/60;
}
/* 연속 학습일(스트릭): 오늘(또는 어제)부터 거꾸로 완료기록이 있는 날 연속 카운트 */
function studyStreak(){
  const c=state.completions||{};
  const has=ds=>c[ds]&&Object.keys(c[ds]).length;
  let cur=new Date(); cur.setHours(0,0,0,0);
  if(!has(iso(cur))){cur=addDays(cur,-1); if(!has(iso(cur)))return 0;}
  let n=0; while(has(iso(cur))){n++;cur=addDays(cur,-1);} return n;
}

/* ESM-AUTO-EXPOSE */
/* ESM: 이 모듈의 공개 심볼을 전역에 노출 — 인라인 onclick·타 모듈 호출용
   (모듈 내부 헬퍼는 위에 두면 비공개. 여긴 파일의 공개 표면) */
Object.assign(globalThis, { SCHEMA_VERSION, BACKUP_KEY, defaults, CORRUPT_KEY, boot, hasCorrupt, recoverCorrupt, migrate, validShape, persist, backupNow, backupOrConfirm, hasBackup, undoLast, RUNTIME_CACHE_KEYS, exportSnapshot, exportJSON, importJSON, resetAll, applyTheme, toggleTheme, compMap, isDone, doneMin, setDone, totalDoneHours, studyStreak });
