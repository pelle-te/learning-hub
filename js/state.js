/* ============================================================
   state.js — 전역 상태, 기본값, 영속화, 가져오기/내보내기
   ── 모델 v3 ──────────────────────────────────────────────
   item = {
     id, source, name, color,
     mode: 'weekly' | 'daily',
     weeklyHours: 5,            // mode 'weekly' — 주당 목표 시간
     dailyMin: 30,             // mode 'daily'  — 매일 고정 분(Anki 등)
     deadline: '',             // 선택 (시험일 등)
     chapters: [ {id,name,hours,done:false}, ... ]  // 순서대로 학습. 그날 배운 내용·복습 근거
   }
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
    degree:{ targetTotal:130, reqMajorReq:0, reqMajorSel:0, reqLiberal:0,
      semesters:[ {id:rid(),name:'2026-1학기',courses:[]} ] },
    anki:{ source:'file' }
  };
}

let state=migrate(load())||defaults();

function load(){try{return JSON.parse(localStorage.getItem(KEY))}catch(e){return null}}

/* 불러온 데이터에 새 필드 채우기(구버전 호환) */
function migrate(s){
  if(!s||typeof s!=='object')return null;
  if(!validShape(s))return null;
  const d=defaults();
  s.schemaVersion=SCHEMA_VERSION;
  if(s.theme==null)s.theme=d.theme;
  if(s.completions==null||typeof s.completions!=='object')s.completions={};
  if(s.dayOverrides==null)s.dayOverrides={};
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
  catch(e){alert('저장 실패: 브라우저 저장공간이 가득 찼을 수 있어요. 내보내기로 백업 후 정리하세요.\n'+(e.message||e));}
}
function backupNow(){try{localStorage.setItem(BACKUP_KEY,JSON.stringify(state));}catch(e){}}
function hasBackup(){return !!localStorage.getItem(BACKUP_KEY)}
function undoLast(){
  const b=localStorage.getItem(BACKUP_KEY); if(!b){alert('되돌릴 백업이 없습니다.');return;}
  try{const s=migrate(JSON.parse(b)); if(!s){alert('백업이 손상됨');return;}
    state=s; localStorage.removeItem(BACKUP_KEY); persist(); applyTheme(); render();
  }catch(e){alert('되돌리기 실패')}
}

function exportJSON(){
  persist();
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='러닝허브_'+state.startDate+'.json';a.click();
}
function importJSON(input){
  const f=input.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=()=>{
    let parsed;
    try{parsed=JSON.parse(r.result);}catch(e){alert('읽기 실패: JSON 형식이 아닙니다.');return;}
    const s=migrate(parsed);
    if(!s){alert('가져오기 실패: 러닝 허브 백업 파일 형식이 아닙니다(필수 항목 누락).');return;}
    backupNow();           // 현재 상태를 백업해두고 교체(되돌리기 가능)
    state=s; persist(); applyTheme(); render();
  };
  r.readAsText(f);input.value='';
}
function resetAll(){
  if(confirm('모든 데이터를 지울까요? (직후 "되돌리기"로 복구 가능)')){
    backupNow(); state=defaults(); persist(); applyTheme(); render();
  }
}

/* 테마 적용 (light/dark) — applyTheme는 부팅 시·토글 시 호출 */
function applyTheme(){
  const t=(state&&state.theme)||'dark';
  document.documentElement.setAttribute('data-theme',t);
}
function toggleTheme(){state.theme=(state.theme==='light')?'dark':'light';persist();applyTheme();render();}

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
