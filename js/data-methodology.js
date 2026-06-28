/* ============================================================
   data-methodology.js — 학습방법론 데이터 레이어 (state 다음 로드)
   ── 왜 분리했나 ────────────────────────────────────────────
   예전엔 이 도메인(3문장 요약·CBMS 오답·보충필요 백로그·백지 결과·주간 리뷰
   ·Anki 카드 생성·볼트 백업·아카이빙)이 전부 state.js 한 파일(만물상)에 있었다.
   기능이 늘 때마다 state.js가 무한정 커지는 구조라, *핵심 상태/영속*(state.js)과
   *방법론 기능 데이터*(이 파일)를 갈랐다. 모든 데이터는 여전히 전역 state에
   저장돼 내보내기/가져오기 JSON 백업에 그대로 포함된다.
   의존: state.js(persist·exportSnapshot·SCHEMA_VERSION) · utils.js(rid·iso·날짜)
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
/* conf: '찍어서 맞음/확신 없었음' 플래그(방법론 6절·E5) — 맞아도 다시 점검해야 하는 위양성 표시. */
function addCbms(ds,sid,name,chapter,code,note,conf){
  state.cbms=state.cbms||[];
  state.cbms.push({id:rid(),ds:ds||iso(new Date()),sid:sid||'',name:name||'',chapter:chapter||'',code:code||'C',note:note||'',conf:!!conf});
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

/* ── 백지 복습 결과(방법론 9절·E4) — '완료=통과' 근사를 통과/막힘 *실측*으로 바꾼다 ──
   하루·과목당 1개(중복 갱신). 막힘+메모는 CBMS(C 개념)로 자동 연결해 약점 추적과 잇는다. */
function setBlankResult(ds,sid,name,passed,note,chapter){
  state.blankResults=state.blankResults||[];
  const prior=blankResultFor(ds,sid);                                  // 같은 날·과목의 직전 기록
  state.blankResults=state.blankResults.filter(x=>!(x.ds===ds&&x.sid===(sid||'')));
  state.blankResults.push({id:rid(),ds:ds||iso(new Date()),sid:sid||'',name:name||'',passed:!!passed,note:note||''});
  // 막힘이고 메모/챕터가 있으면 CBMS(C 개념)로 연결 — 단, 이미 막힘 기록이 있었다면 중복 생성 금지
  if(!passed && (note||chapter) && !(prior&&!prior.passed))
    addCbms(ds,sid,name,chapter||'','C','[백지복습 막힘] '+(note||''),false);
  persist();
}
function blankResultFor(ds,sid){return (state.blankResults||[]).find(x=>x.ds===ds&&x.sid===(sid||''))||null;}
function clearBlankResult(ds,sid){
  state.blankResults=(state.blankResults||[]).filter(x=>!(x.ds===ds&&x.sid===(sid||'')));
  persist();
}
/* [fromDs,toDs] 백지 통과율(기록된 것 기준). 기록 없으면 null → 통계가 '근사' 대신 '미측정'을 구분. */
function blankPassRate(fromDs,toDs){
  const rs=(state.blankResults||[]).filter(x=>(!fromDs||x.ds>=fromDs)&&(!toDs||x.ds<=toDs));
  if(!rs.length)return null;
  return {total:rs.length,passed:rs.filter(x=>x.passed).length};
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
  if(!lines.length){toast(scope==='today'?'오늘 작성한 요약·오답이 없어요. 블록 끝마다 3문장 요약을 남기면 카드가 됩니다.':'요약·오답 기록이 아직 없어요.','warn',4000);return;}
  /* Anki 2.1.55+ import 디렉티브(구버전은 첫 줄들을 노트로 보지 않게 #로 시작) */
  const head=['#separator:Tab','#html:true','#tags column:3'];
  const blob=new Blob([head.concat(lines).join('\n')],{type:'text/plain;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='러닝허브_카드_'+(scope==='today'?todayISO():'전체')+'.txt';a.click();
  toast(lines.length+'장의 카드 초안(.txt)을 내려받았어요. Anki에서 "가져오기" 후 ≤5장으로 추리고 "왜?/응용"형으로 손질하세요.','ok',4600);
}

/* ============================================================
   볼트 폴더로 자동 백업 — localStorage 전소(브라우저 캐시 삭제 등)에 대비.
   File System Access의 *쓰기*로 볼트 폴더에 러닝허브_백업.json을 떨군다.
============================================================ */
async function backupToVault(){
  if(!window.showDirectoryPicker){toast('이 브라우저는 폴더 쓰기를 지원하지 않아요(Chrome/Edge 권장). 대신 [⋯ 메뉴 → 데이터 내보내기]로 파일 백업하세요.','warn',5000);return;}
  try{
    let h=(typeof vaultHandle!=='undefined'&&vaultHandle)?vaultHandle:null;
    if(!h){h=await window.showDirectoryPicker(); try{vaultHandle=h;}catch(e){}}
    if(h.requestPermission){const perm=await h.requestPermission({mode:'readwrite'}); if(perm!=='granted'){toast('쓰기 권한이 거부됐어요.','bad');return;}}
    const fh=await h.getFileHandle('러닝허브_백업.json',{create:true});
    const w=await fh.createWritable(); await w.write(JSON.stringify(exportSnapshot(),null,2)); await w.close();
    state._lastBackupAt=new Date().toISOString(); persist();
    if(typeof render==='function')render();
    toast('볼트 폴더에 러닝허브_백업.json 저장 완료.','ok');
  }catch(e){if(e.name!=='AbortError')toast('볼트 백업 실패: '+(e.message||e),'bad',5000);}
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
  return n+(state.cbms||[]).length+(state.backlog||[]).length+(state.blankResults||[]).length;
}
function archiveOldData(monthsKeep){
  monthsKeep=monthsKeep||6;
  const cutoff=iso(addDays(new Date(),-Math.round(monthsKeep*30)));
  const arch={schemaVersion:SCHEMA_VERSION,archivedAt:new Date().toISOString(),cutoff,
    completions:{},summaries:{},cbms:[],backlog:[],blankResults:[]};
  let n=0;
  const c=state.completions||{}; Object.keys(c).forEach(ds=>{if(ds<cutoff){arch.completions[ds]=c[ds];delete c[ds];n+=Object.keys(arch.completions[ds]).length;}});
  const sm=state.summaries||{}; Object.keys(sm).forEach(ds=>{if(ds<cutoff){arch.summaries[ds]=sm[ds];delete sm[ds];n+=arch.summaries[ds].length;}});
  arch.cbms=(state.cbms||[]).filter(e=>e.ds&&e.ds<cutoff); state.cbms=(state.cbms||[]).filter(e=>!(e.ds&&e.ds<cutoff)); n+=arch.cbms.length;
  arch.backlog=(state.backlog||[]).filter(b=>b.done&&b.doneDs&&b.doneDs<cutoff); state.backlog=(state.backlog||[]).filter(b=>!(b.done&&b.doneDs&&b.doneDs<cutoff)); n+=arch.backlog.length;
  arch.blankResults=(state.blankResults||[]).filter(x=>x.ds&&x.ds<cutoff); state.blankResults=(state.blankResults||[]).filter(x=>!(x.ds&&x.ds<cutoff)); n+=arch.blankResults.length;
  if(n===0){toast(cutoff+' 이전 기록이 없어요. 정리할 것이 없습니다.','info',3600);return;}
  const blob=new Blob([JSON.stringify(arch,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='러닝허브_보관_'+cutoff+'.json';a.click();
  persist(); if(typeof render==='function')render();
  toast(cutoff+' 이전 기록 '+n+'건을 보관 파일로 내려받고 앱에서 비웠어요.','ok',4200);
}

/* ── 인출 증거(방법론 14절: 투입 아닌 '나아진 증거') — CBMS 주간 추세 ── */
function cbmsTrend(){
  const mon=mondayOf(new Date());
  const thisW=cbmsBetween(iso(mon),iso(addDays(mon,6))).length;
  const lastMon=addDays(mon,-7);
  const lastW=cbmsBetween(iso(lastMon),iso(addDays(lastMon,6))).length;
  return {thisW,lastW};
}

/* ESM-AUTO-EXPOSE */
/* ESM: 이 모듈의 공개 심볼을 전역에 노출 — 인라인 onclick·타 모듈 호출용
   (모듈 내부 헬퍼는 위에 두면 비공개. 여긴 파일의 공개 표면) */
Object.assign(globalThis, { summariesFor, addSummary, delSummary, summaryCount, CBMS_INFO, addCbms, delCbms, cbmsCounts, cbmsBetween, setBlankResult, blankResultFor, clearBlankResult, blankPassRate, addBacklog, toggleBacklog, delBacklog, openBacklog, backlogClosedBetween, weeklyKey, getWeekly, setWeeklyCheck, setWeeklyNote, _cf, buildAnkiCards, exportAnkiCards, backupToVault, lastBackupDays, dataSizeKB, recordCount, archiveOldData, cbmsTrend });
