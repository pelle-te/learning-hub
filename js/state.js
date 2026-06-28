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
let state=boot();

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
  if(!raw){alert('복구할 손상 백업이 없습니다.');return;}
  let s=null; try{s=migrate(JSON.parse(raw));}catch(e){s=null;}
  if(!s){alert('손상 백업도 살릴 수 없습니다(여전히 형식 오류). "'+CORRUPT_KEY+'"를 직접 내보내 점검하세요.');return;}
  backupNow(); state=s; try{localStorage.removeItem(CORRUPT_KEY);}catch(e){}
  persist(); applyTheme(); render(); alert('손상 직전 상태로 복구했습니다.');
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
  catch(e){alert('저장 실패: 브라우저 저장공간이 가득 찼을 수 있어요. 내보내기로 백업 후 정리하세요.\n'+(e.message||e));}
}
function backupNow(){try{localStorage.setItem(BACKUP_KEY,JSON.stringify(state));return true;}catch(e){return false;}}
/* 파괴적 동작 전 백업 — 실패하면(저장공간 등) 되돌리기 불가를 알리고 사용자에 진행 여부를 묻는다(감사 #5 · P1-7) */
function backupOrConfirm(){
  if(backupNow())return true;
  return confirm('백업 저장 실패(저장공간이 가득 찼을 수 있음) — 지금 진행하면 "되돌리기"가 불가능합니다.\n그래도 계속할까요? (먼저 내보내기로 백업 권장)');
}
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
    if(!backupOrConfirm())return;   // 백업 실패 시 사용자 확인(되돌리기 불가 경고 · #5)
    state=s; persist(); applyTheme(); render();
  };
  r.readAsText(f);input.value='';
}
function resetAll(){
  if(confirm('모든 데이터를 지울까요? (직후 "되돌리기"로 복구 가능)')){
    if(!backupOrConfirm())return;   // 백업 실패 시 사용자 확인(되돌리기 불가 경고 · #5)
    state=defaults(); persist(); applyTheme(); render();
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

/* ============================================================
   학습방법론 실행 레이어 — 3문장 요약 · CBMS 오답 · 보충필요 백로그 · 주간리뷰
   (모두 state에 저장 → 내보내기/가져오기 JSON 백업에 포함)
============================================================ */

/* ── 3문장 요약(3절) ── */
function summariesFor(ds){state.summaries=state.summaries||{};return state.summaries[ds]||[];}
function addSummary(ds,sid,name,s1,s2,s3){
  state.summaries=state.summaries||{};
  const arr=state.summaries[ds]=state.summaries[ds]||[];
  arr.push({id:rid(),sid:sid||'',name:name||'',s1:s1||'',s2:s2||'',s3:s3||''});
  persist();
}
function delSummary(ds,id){
  const arr=state.summaries&&state.summaries[ds]; if(!arr)return;
  state.summaries[ds]=arr.filter(x=>x.id!==id);
  if(!state.summaries[ds].length)delete state.summaries[ds];
  persist();
}
/* 전체 요약 개수(통계용) */
function summaryCount(){let n=0;const m=state.summaries||{};for(const ds in m)n+=m[ds].length;return n;}

/* ── CBMS 오답 분류(6·12절) — code ∈ C/B/M/S/T ── */
const CBMS_INFO={
  C:{label:'개념',  tip:'교재 해당 단원 다시 정독(2절 ①로 복귀)',  color:'#ff8fa3'},
  B:{label:'경계',  tip:'그 문제 유형의 체크리스트 만들기',          color:'#ffb454'},
  M:{label:'수학',  tip:'도출 단계 백지 연습(손으로 끝까지)',        color:'#6ea8fe'},
  S:{label:'실수',  tip:'검산 습관 + 단위 체크 자동화',              color:'#7ee0c0'},
  T:{label:'시간',  tip:'자주 막히는 계산 손에 익히기 + 시간 분배 훈련',color:'#b794f6'},
};
function addCbms(ds,sid,name,chapter,code,note){
  state.cbms=state.cbms||[];
  state.cbms.push({id:rid(),ds:ds||iso(new Date()),sid:sid||'',name:name||'',chapter:chapter||'',code:code||'C',note:note||''});
  persist();
}
function delCbms(id){state.cbms=(state.cbms||[]).filter(x=>x.id!==id);persist();}
/* [fromDs,toDs] 구간(포함) 코드별 카운트. 인자 없으면 전체. */
function cbmsCounts(fromDs,toDs){
  const out={C:0,B:0,M:0,S:0,T:0};
  (state.cbms||[]).forEach(e=>{
    if(fromDs&&e.ds<fromDs)return; if(toDs&&e.ds>toDs)return;
    if(out[e.code]!=null)out[e.code]++;
  });
  return out;
}
function cbmsBetween(fromDs,toDs){
  return (state.cbms||[]).filter(e=>(!fromDs||e.ds>=fromDs)&&(!toDs||e.ds<=toDs));
}

/* ── '보충 필요' 백로그(5절) ── */
function addBacklog(sid,name,topic,note){
  state.backlog=state.backlog||[];
  state.backlog.push({id:rid(),ds:iso(new Date()),sid:sid||'',name:name||'',topic:topic||'',note:note||'',done:false,doneDs:''});
  persist();
}
function toggleBacklog(id){
  const b=(state.backlog||[]).find(x=>x.id===id); if(!b)return;
  b.done=!b.done; b.doneDs=b.done?iso(new Date()):'';
  persist();
}
function delBacklog(id){state.backlog=(state.backlog||[]).filter(x=>x.id!==id);persist();}
function openBacklog(){return (state.backlog||[]).filter(b=>!b.done);}
/* [fromDs,toDs] 구간에 회수(닫힘)된 백로그 수 */
function backlogClosedBetween(fromDs,toDs){
  return (state.backlog||[]).filter(b=>b.done&&b.doneDs&&(!fromDs||b.doneDs>=fromDs)&&(!toDs||b.doneDs<=toDs)).length;
}

/* ── 주간 리뷰(10절) — 키: 그 주 월요일 ISO ── */
function weeklyKey(d){return iso(mondayOf(d||new Date()));}
function getWeekly(wk){state.weekly=state.weekly||{};return state.weekly[wk]||{checks:{},note:''};}
function setWeeklyCheck(wk,k,on){
  state.weekly=state.weekly||{};
  const w=state.weekly[wk]=state.weekly[wk]||{checks:{},note:''};
  w.checks=w.checks||{}; w.checks[k]=!!on; persist();
}
function setWeeklyNote(wk,note){
  state.weekly=state.weekly||{};
  const w=state.weekly[wk]=state.weekly[wk]||{checks:{},note:''};
  w.note=note||''; persist();
}

/* ============================================================
   Anki 카드 초안 생성(방법론 7절) — 3문장 요약·반복 오답을 Anki import용
   TSV(.txt)로 떨군다. *자동 생성*은 마찰을, *사람 큐레이션*(가져온 뒤 ≤5장 추리고
   왜/응용형으로 손질)은 학습 이득을 담당한다. 시점(due)은 여전히 FSRS가 소유.
============================================================ */
function _cf(s){return (s||'').toString().replace(/\t/g,' ').replace(/\r?\n/g,'<br>');}
function buildAnkiCards(fromDs,toDs){
  const lines=[];
  const sm=state.summaries||{};
  Object.keys(sm).sort().forEach(ds=>{
    if(fromDs&&ds<fromDs)return; if(toDs&&ds>toDs)return;
    (sm[ds]||[]).forEach(x=>{
      const front=_cf((x.name?'['+x.name+'] ':'')+(x.s1||'핵심 현상·문제는?'));
      const back=_cf(['How(도구): '+(x.s2||''),'Result(결과·의미): '+(x.s3||'')].join('\n'));
      const tag='요약'+(x.name?'::'+x.name.replace(/\s+/g,'_'):'');
      lines.push([front,back,tag].join('\t'));
    });
  });
  (state.cbms||[]).forEach(e=>{
    if(fromDs&&e.ds<fromDs)return; if(toDs&&e.ds>toDs)return;
    const inf=CBMS_INFO[e.code]||{label:'',tip:''};
    const front=_cf((e.name?'['+e.name+'] ':'')+(e.chapter||'')+' — 어디서 왜 막혔나?');
    const back=_cf((e.note||'(메모 없음)')+'\n처방('+e.code+' '+inf.label+'): '+inf.tip);
    lines.push([front,back,'오답::'+e.code].join('\t'));
  });
  return lines;
}
function exportAnkiCards(scope){
  let fromDs='',toDs='';
  if(scope==='today'){fromDs=toDs=todayISO();}
  const lines=buildAnkiCards(fromDs,toDs);
  if(!lines.length){alert(scope==='today'?'오늘 작성한 요약·오답이 없어요. 블록 끝마다 3문장 요약을 남기면 카드가 됩니다.':'요약·오답 기록이 아직 없어요.');return;}
  /* Anki 2.1.55+ import 디렉티브(구버전은 첫 줄들을 노트로 보지 않게 #로 시작) */
  const head=['#separator:Tab','#html:true','#tags column:3'];
  const blob=new Blob([head.concat(lines).join('\n')],{type:'text/plain;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='러닝허브_카드_'+(scope==='today'?todayISO():'전체')+'.txt';a.click();
  alert(lines.length+'장의 카드 초안(.txt)을 내려받았어요.\nAnki에서 "가져오기"로 불러온 뒤 ≤5장으로 추리고 한두 장은 "왜?/응용"형으로 손질하세요(큐레이션이 학습 이득).');
}

/* ============================================================
   볼트 폴더로 자동 백업 — localStorage 전소(브라우저 캐시 삭제 등)에 대비.
   File System Access의 *쓰기*로 볼트 폴더에 러닝허브_백업.json을 떨군다.
============================================================ */
async function backupToVault(){
  if(!window.showDirectoryPicker){alert('이 브라우저는 폴더 쓰기를 지원하지 않아요(Chrome/Edge 권장). 대신 [내보내기]로 파일 백업하세요.');return;}
  try{
    let h=(typeof vaultHandle!=='undefined'&&vaultHandle)?vaultHandle:null;
    if(!h){h=await window.showDirectoryPicker(); try{vaultHandle=h;}catch(e){}}
    if(h.requestPermission){const perm=await h.requestPermission({mode:'readwrite'}); if(perm!=='granted'){alert('쓰기 권한이 거부됐어요.');return;}}
    const fh=await h.getFileHandle('러닝허브_백업.json',{create:true});
    const w=await fh.createWritable(); await w.write(JSON.stringify(state,null,2)); await w.close();
    state._lastBackupAt=new Date().toISOString(); persist();
    if(typeof render==='function')render();
    alert('볼트 폴더에 러닝허브_백업.json 저장 완료.');
  }catch(e){if(e.name!=='AbortError')alert('볼트 백업 실패: '+(e.message||e));}
}
function lastBackupDays(){
  if(!state._lastBackupAt)return null;
  const t=new Date(state._lastBackupAt); if(isNaN(t))return null;
  return Math.floor((Date.now()-t.getTime())/86400000);
}

/* ============================================================
   오래된 기록 보관(아카이빙) — '졸업까지 N년' 쌓이는 completions/summaries/cbms가
   localStorage 쿼터·재렌더 성능을 갉아먹기 전에, 보관 파일로 내려받고 앱에서 비운다.
============================================================ */
function dataSizeKB(){try{return Math.round(JSON.stringify(state).length/1024);}catch(e){return 0;}}
function recordCount(){
  let n=0; const c=state.completions||{},s=state.summaries||{};
  for(const k in c)n+=Object.keys(c[k]).length;
  for(const k in s)n+=s[k].length;
  return n+(state.cbms||[]).length+(state.backlog||[]).length;
}
function archiveOldData(monthsKeep){
  monthsKeep=monthsKeep||6;
  const cutoff=iso(addDays(new Date(),-Math.round(monthsKeep*30)));
  const arch={schemaVersion:SCHEMA_VERSION,archivedAt:new Date().toISOString(),cutoff,
    completions:{},summaries:{},cbms:[],backlog:[]};
  let n=0;
  const c=state.completions||{}; Object.keys(c).forEach(ds=>{if(ds<cutoff){arch.completions[ds]=c[ds];delete c[ds];n+=Object.keys(arch.completions[ds]).length;}});
  const sm=state.summaries||{}; Object.keys(sm).forEach(ds=>{if(ds<cutoff){arch.summaries[ds]=sm[ds];delete sm[ds];n+=arch.summaries[ds].length;}});
  arch.cbms=(state.cbms||[]).filter(e=>e.ds&&e.ds<cutoff); state.cbms=(state.cbms||[]).filter(e=>!(e.ds&&e.ds<cutoff)); n+=arch.cbms.length;
  arch.backlog=(state.backlog||[]).filter(b=>b.done&&b.doneDs&&b.doneDs<cutoff); state.backlog=(state.backlog||[]).filter(b=>!(b.done&&b.doneDs&&b.doneDs<cutoff)); n+=arch.backlog.length;
  if(n===0){alert(cutoff+' 이전 기록이 없어요. 정리할 것이 없습니다.');return;}
  const blob=new Blob([JSON.stringify(arch,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='러닝허브_보관_'+cutoff+'.json';a.click();
  persist(); if(typeof render==='function')render();
  alert(cutoff+' 이전 기록 '+n+'건을 보관 파일로 내려받고 앱에서 비웠어요. (보관 파일은 따로 두면 나중에 열람 가능)');
}

/* ── 인출 증거(방법론 14절: 투입 아닌 '나아진 증거') — CBMS 주간 추세 ── */
function cbmsTrend(){
  const mon=mondayOf(new Date());
  const thisW=cbmsBetween(iso(mon),iso(addDays(mon,6))).length;
  const lastMon=addDays(mon,-7);
  const lastW=cbmsBetween(iso(lastMon),iso(addDays(lastMon,6))).length;
  return {thisW,lastW};
}
