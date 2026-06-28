/* ============================================================
   utils.js — 상수 & 공용 유틸 (가장 먼저 로드)
============================================================ */
const DOW=['일','월','화','수','목','금','토'];
const DOW_MON=['월','화','수','목','금','토','일'];          // 주간뷰(월요일 시작)
const REVIEW_OFFSETS=[1,3,7,16];                            // 간격반복 복습(일)
const PALETTE=['#6ea8fe','#7ee0c0','#ffb454','#ff8fa3','#b794f6','#63d2ff','#f6c177','#9ece6a'];
/* 고정 일과 블록 유형(색). '공부' 개념은 폐지 — 가용 공부시간은 '깨어있는 시간 − 이 블록들'로 자동 계산된다. */
const BLOCK_TYPES={'수면':'#3a3f4b','식사':'#c98a5e','취미':'#9a7fd1','수업':'#5e8ac9','기타':'#5a6072'};
const KEY='study_planner_v3';                              // localStorage 키 (모델 변경으로 v3)
const SKIP=new Set(['attachments','images','_assets','.obsidian','.trash','_복습시스템','_인터랙티브']);

function rid(){return Math.random().toString(36).slice(2,9)}

/* 날짜/시간 */
/* iso(): 반드시 '로컬' 날짜로 포맷. toISOString()은 UTC라 KST(UTC+9) 등
   양수 시간대에서 하루가 밀리는 버그가 있어 로컬 연·월·일로 직접 만든다. */
function iso(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
/* todayISO(): '오늘'의 단일 출처. 평소엔 실제 오늘이지만, state._today가 있으면 그 값을 쓴다.
   → 스케줄러의 적응형 용량(과거/미래 구분)을 테스트에서 결정적으로 만들기 위한 시드. */
function todayISO(){try{if(typeof state!=='undefined'&&state&&state._today)return state._today;}catch(e){}return iso(new Date());}
function parseISO(s){const[y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)}
function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x}
function fmt(d){return `${d.getMonth()+1}/${d.getDate()} (${DOW[d.getDay()]})`}
function fmtShort(d){return `${d.getMonth()+1}/${d.getDate()}`}
function dayDiff(a,b){return Math.round((parseISO(b)-parseISO(a))/86400000)}
function toMin(t){const[h,m]=t.split(':').map(Number);return h*60+(m||0)}
function toHM(m){m=Math.round(m);const h=Math.floor(m/60),mm=m%60;return `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
/* esc(): HTML 속성/본문에 안전하도록 작은따옴표까지 이스케이프.
   onclick="fn('${esc(x)}')" 처럼 JS 문자열 리터럴에 들어가도 깨지지 않게 함. */
function esc(s){return(s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
/* JS 문자열 리터럴(인라인 핸들러 인자)용 — 따옴표·백슬래시·개행 차단 */
function jsq(s){return(s||'').toString().replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,' ').replace(/\r/g,'')}

/* 시간(시간 단위) 표시 — 분으로 안 다루도록 */
function hLabel(min){const h=min/60;return (Math.round(h*10)/10)+'h'}

/* 주(週) 헬퍼 — 월요일 시작 */
function mondayOf(d){const x=new Date(d);const k=(x.getDay()+6)%7;x.setDate(x.getDate()-k);x.setHours(0,0,0,0);return x}
function weekLabel(monDate){const end=addDays(monDate,6);return `${fmtShort(monDate)} ~ ${fmtShort(end)}`}

/* 페이지 루트 헬퍼 */
function pageEl(){return document.getElementById('page')}

/* ── 탭 공용 헬퍼(여러 탭이 쓰므로 utils에 둔다 — 한 탭이 다른 탭에 의존하지 않게) ── */
/* 학습 항목 id로 항목 찾기 (오늘·통계·주간리뷰 탭 공용) */
function itemById(sid){return (state.items||[]).find(i=>i.id===sid);}
/* D-day 라벨·강조색 — 마감까지 남은 일수(dday) → {lab,cls}. 스케줄·학습항목 탭 공용. */
function ddayInfo(dday){
  const lab=dday===0?'D-DAY':dday>0?'D-'+dday:'D+'+(-dday);
  const cls=dday<0?'bad':dday<=7?'warn':'';
  return {lab,cls};
}

/* 볼트 정본 인덱스(_meta/감사/_index.json) 로드 — 러닝허브가 .md/.txt 재스캔 대신
   메타 시스템 산출(검사.sh --index)을 *소비*한다. 못 찾으면 null(호출부가 파일스캔 폴백).
   감사 2026-06-24 부록A(A-1·A-2): 소비처가 정본 산출을 안 읽던 정합성 공백 해소. */
async function loadVaultIndex(handle){
  try{
    const meta=await handle.getDirectoryHandle('_meta');
    const aud=await meta.getDirectoryHandle('감사');
    const fh=await aud.getFileHandle('_index.json');
    return JSON.parse(await (await fh.getFile()).text());
  }catch(e){return null;}
}

/* ESM-AUTO-EXPOSE */
/* ESM: 이 모듈의 공개 심볼을 전역에 노출 — 인라인 onclick·타 모듈 호출용
   (모듈 내부 헬퍼는 위에 두면 비공개. 여긴 파일의 공개 표면) */
Object.assign(globalThis, { DOW, DOW_MON, REVIEW_OFFSETS, PALETTE, BLOCK_TYPES, KEY, SKIP, rid, iso, todayISO, parseISO, addDays, fmt, fmtShort, dayDiff, toMin, toHM, clamp, esc, jsq, hLabel, mondayOf, weekLabel, pageEl, itemById, ddayInfo, loadVaultIndex });
