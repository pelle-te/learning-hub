/* ============================================================
   shell/actions.ts — 데이터·백업·테마 액션(레거시 state.js/data-methodology.js의 DOM·다운로드 경로 이식).
   순수 도메인 로직은 lib에 있고, 여기선 store 오케스트레이션 + 파일 다운로드/업로드 + FS Access +
   toast/modal UI를 엮는다. 헤더 ⋯ 메뉴·설정 탭·스케줄/기록 탭이 호출.
============================================================ */
import { useApp } from '@/store/useApp';
import { useRuntime } from '@/store/useRuntime';
import { usePrefill, type PrefillForm } from '@/store/prefill';
import {
  BACKUP_KEY,
  CORRUPT_KEY,
  RUNTIME_CACHE_KEYS,
  migrate,
  sanitizeImported,
  parseState,
  defaults,
  exportSnapshot,
  isPristineState,
} from '@/lib/persistence';
import { loadReads, importReads } from '@/lib/reads';
import { semanticSearch, semanticAvailable, type SemHit } from '@/lib/semantic';
import { idbLoad, idbGet, IDB_BACKUP_KEY, IDB_BACKUP2_KEY } from '@/lib/idb';
import { buildICS, planSignature as sigOf } from '@/lib/ics';
import { buildAnkiCards, buildSummaryNotes, archiveOldData, openBacklog } from '@/lib/methodology';
import { weakSpots } from '@/lib/insights';
import { iso, mondayOf, todayISO } from '@/lib/utils';
import type { AppState, Theme } from '@/lib/types';
import type { CaptureResult } from '@/lib/quickCapture';
import { toast, toastUndo } from './toast';
import { confirm } from './modal';

const st = () => useApp.getState();
const safeLS = (): Storage | null => (typeof localStorage !== 'undefined' ? localStorage : null);

/** 브라우저 다운로드 트리거(Blob → <a download>). */
function download(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}

/** 되돌리기용 1단계 백업(localStorage). */
export function backupNow(): boolean {
  try {
    safeLS()?.setItem(BACKUP_KEY, JSON.stringify(st().state));
    return true;
  } catch {
    return false;
  }
}
/** 파괴적 동작 전 백업 — 실패하면 되돌리기 불가를 경고하고 진행 여부를 묻는다. */
async function backupOrConfirm(): Promise<boolean> {
  if (backupNow()) return true;
  return confirm(
    '백업 저장 실패(저장공간이 가득 찼을 수 있음) — 지금 진행하면 "되돌리기"가 불가능합니다. 그래도 계속할까요? (먼저 내보내기로 백업 권장)',
    { title: '백업 실패', okLabel: '계속', danger: true },
  );
}

/** 손상 원본 보존본 존재 여부(감사 2026-07-16 ③#9) — 설정 탭이 버튼 노출을 게이팅. */
export function hasCorruptSnapshot(): boolean {
  try {
    return safeLS()?.getItem(CORRUPT_KEY) != null;
  } catch {
    return false;
  }
}

/** 손상 원본 내려받기(③#9) — boot이 CORRUPT_KEY에 보존한 '살릴 수 없던 raw'를 devtools 없이
 *  파일로 회수. 내려받기 성공 시 키를 정리한다(쓰기만 있고 읽기/삭제 경로가 없어 영구 잔존하던 층). */
export function downloadCorruptSnapshot(): void {
  const ls = safeLS();
  let raw: string | null = null;
  try {
    raw = ls?.getItem(CORRUPT_KEY) ?? null;
  } catch {
    /* 접근 불가 */
  }
  if (!raw) {
    toast('보존된 손상 원본이 없습니다.', 'warn');
    return;
  }
  download('러닝허브_손상원본.json', raw, 'application/json');
  try {
    ls?.removeItem(CORRUPT_KEY);
  } catch {
    /* 정리 실패는 치명 아님 — 다음 시도에서 재정리 */
  }
  toast('손상 원본을 내려받았어요 — 보존 키는 정리했습니다.', 'ok');
}

/** 데이터 내보내기(.json) — 런타임 캐시는 뺀 스냅샷 + 읽을거리 저작물(_reads: 내 요약·독후감).
    _reads가 없으면 "내보내기로 백업하세요" 안내(저장실패 토스트)와 실제 백업 범위가 어긋난다. */
export function exportJSON(): void {
  const s = st().state;
  const payload = { ...exportSnapshot(s), _reads: loadReads() };
  download(`러닝허브_${s.startDate}.json`, JSON.stringify(payload, null, 2), 'application/json');
}

/** 데이터 가져오기 — 파일 → migrate → (백업 후) 통째 교체. */
export function importJSON(input: HTMLInputElement): void {
  const f = input.files?.[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(r.result));
    } catch {
      toast('읽기 실패: JSON 형식이 아닙니다.', 'bad');
      return;
    }
    // _reads(내 요약·독후감)는 앱 상태가 아니라 별도 블롭 — 분리해 각자 복원한다.
    const reads = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>)._reads : undefined;
    const migrated = migrate(parsed);
    if (!migrated) {
      toast('가져오기 실패: 러닝 허브 백업 파일 형식이 아닙니다(필수 항목 누락).', 'bad', 5000);
      return;
    }
    // 신뢰 불가 파일 방어선 — 크래시 유발 레코드(잘못된 cbms code·비수치 min 등)를 걸러낸다(import 경로 전용).
    const s = sanitizeImported(migrated);
    RUNTIME_CACHE_KEYS.forEach((k) => {
      try {
        delete (s as Record<string, unknown>)[k];
      } catch {
        /* noop */
      }
    });
    delete (s as Record<string, unknown>)._reads;
    if (!(await backupOrConfirm())) return;
    st().loadState(s);
    const restored = reads ? importReads(reads) : null;
    toastUndo(restored ? '데이터를 가져왔어요(읽을거리 요약·독후감 포함).' : '데이터를 가져왔어요.', undoLast);
  };
  r.readAsText(f);
  input.value = '';
}

/** 되돌리기 — BACKUP_KEY 직전 상태로. */
export function undoLast(): void {
  const ls = safeLS();
  const b = ls?.getItem(BACKUP_KEY);
  if (!b) {
    toast('되돌릴 백업이 없습니다.', 'bad');
    return;
  }
  const s = parseState(b);
  if (!s) {
    toast('백업이 손상됨', 'bad');
    return;
  }
  st().loadState(s);
  try {
    ls?.removeItem(BACKUP_KEY);
  } catch {
    /* noop */
  }
  toast('직전 상태로 되돌렸어요.', 'ok');
}

/** 전체 초기화 — 확인 → 백업 → 기본값. */
export async function resetAll(): Promise<void> {
  if (
    !(await confirm('모든 데이터를 지울까요? (직후 [⋯ 메뉴 → 되돌리기]로 복구 가능)', {
      title: '전체 초기화',
      okLabel: '초기화',
      danger: true,
    }))
  )
    return;
  if (!(await backupOrConfirm())) return;
  st().loadState(defaults());
  toastUndo('초기화했어요.', undoLast);
}

/** IndexedDB 미러에서 복구(localStorage 전소 대비).
 *  preloaded: 부팅 복구 안내(BootRecovery)가 미리 읽어둔 스냅샷 — 안내가 떠 있는 사이
 *  flush가 미러를 기본값으로 덮어도 복구가 안전하도록 캡처본을 우선 사용. */
export async function restoreFromIDB(preloaded?: string | null): Promise<void> {
  let json: string | null = preloaded ?? null;
  if (!json) {
    try {
      json = await idbLoad();
    } catch {
      /* noop */
    }
  }
  let s = json ? parseState(json) : null;
  let fromBackup = false;
  // 라이브 미러가 없거나 손상, 또는 defaults-동형(무활동 — fallback 부팅 후 flush가 덮은 잔해)이면
  // 세대 백업(fallback 부팅 시 idbPreserveBackup이 보존)을 우선한다(감사 #21 · 재검증 ⑩#1).
  if (!s || isPristineState(s)) {
    for (const k of [IDB_BACKUP_KEY, IDB_BACKUP2_KEY]) {
      const b = await idbGet<string>(k).catch(() => null);
      const bs = typeof b === 'string' ? parseState(b) : null;
      if (!bs) continue;
      if (!isPristineState(bs)) {
        s = bs; // 활동 데이터가 있는 백업 — 즉시 채택
        fromBackup = true;
        break;
      }
      if (!s) {
        s = bs; // 백업도 무활동 — 미러 부재/손상일 때만 채택하고, 더 나은 세대를 계속 탐색
        fromBackup = true;
      }
    }
  }
  if (!s) {
    if (json) toast('IndexedDB 백업을 살릴 수 없습니다(형식 오류).', 'bad', 4000);
    else toast('IndexedDB 백업이 없습니다(이 브라우저에서 저장된 적 없음).', 'warn', 4000);
    return;
  }
  if (!(await backupOrConfirm())) return;
  st().loadState(s);
  toast(fromBackup ? 'IndexedDB 세대 백업(보존본)에서 복구했어요.' : 'IndexedDB 백업에서 복구했어요.', 'ok', 4000);
}

const THEME_CYCLE: Theme[] = ['dark', 'light'];
const THEME_LABEL: Record<Theme, string> = { dark: '다크', light: '라이트' };
/** 테마 토글(다크 ↔ 라이트). 에디토리얼 다크가 기본, 라이트는 대안 1종(세피아 폐기). */
export function toggleTheme(): void {
  const cur = st().state.theme || 'dark';
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(cur) + 1) % THEME_CYCLE.length] || 'dark';
  setThemeTo(next);
}
/** 특정 테마로 직접 전환(팔레트의 '다크/라이트 모드' 명령). */
export function setThemeTo(t: Theme): void {
  st().setTheme(t);
  toast('테마: ' + (THEME_LABEL[t] || t), 'info', 1600);
}

/** 계획 서명(스케줄 탭 .ics 신선도 판정). */
export function planSignature(): string {
  return sigOf(st().state);
}
/** 캘린더(.ics) 내보내기 + 신선도 스탬프. */
export function exportICS(): void {
  const s = st().state;
  download(`러닝허브_${s.startDate}.ics`, buildICS(s), 'text/calendar;charset=utf-8');
  // plan-무관 캐시 — useRuntime 소유(state 참조 불변 → selectSchedule 재계산 없음, B1/B3).
  useRuntime.getState().set('_icsExport', { at: new Date().toISOString(), sig: sigOf(s) });
}

interface DirPickerWindow {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
}
/** 볼트 폴더에 러닝허브_백업.json 쓰기(FS Access). */
export async function backupToVault(): Promise<void> {
  const picker = (window as unknown as DirPickerWindow).showDirectoryPicker;
  if (!picker) {
    toast(
      '이 브라우저는 폴더 쓰기를 지원하지 않아요(Chrome/Edge 권장). 대신 [⋯ 메뉴 → 데이터 내보내기]로 파일 백업하세요.',
      'warn',
      5000,
    );
    return;
  }
  try {
    const h = await picker();
    const perm = (h as unknown as { requestPermission?: (o: { mode: string }) => Promise<string> }).requestPermission;
    if (perm && (await perm.call(h, { mode: 'readwrite' })) !== 'granted') {
      toast('쓰기 권한이 거부됐어요.', 'bad');
      return;
    }
    const fh = await h.getFileHandle('러닝허브_백업.json', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({ ...exportSnapshot(st().state), _reads: loadReads() }, null, 2));
    await w.close();
    st().mutate((s) => void ((s as AppState)._lastBackupAt = new Date().toISOString()));
    toast('볼트 폴더에 러닝허브_백업.json 저장 완료.', 'ok');
  } catch (e) {
    if ((e as Error).name !== 'AbortError') toast('볼트 백업 실패: ' + ((e as Error).message || e), 'bad', 5000);
  }
}

/** 오래된 기록(기본 6개월 이전) 보관 파일로 내려받고 앱에서 비움. */
export function archiveOld(monthsKeep = 6): void {
  let count = 0;
  let archive: unknown = null;
  st().mutate((s) => {
    const res = archiveOldData(s, monthsKeep);
    count = res.count;
    archive = res.archive;
  });
  if (!count) {
    toast('정리할 오래된 기록이 없어요(6개월 이전 기록 없음).', 'info', 3200);
    return;
  }
  download(`러닝허브_보관_${todayISO()}.json`, JSON.stringify(archive, null, 2), 'application/json');
  toast(`${count}건을 보관 파일로 내려받고 앱에서 비웠어요.`, 'ok', 4200);
}

/** 내보내기 범위 → [from, to] ds. 'week'=이번 주 월요일~오늘(리뷰 주간 케이던스와 정렬),
   'today'=당일, 'all'=무제한(''). buildAnkiCards/buildSummaryNotes가 임의 범위를 이미 수용. */
export type ExportScope = 'today' | 'week' | 'all';
function exportRange(scope: ExportScope): [string, string] {
  if (scope === 'all') return ['', ''];
  if (scope === 'week') return [iso(mondayOf(new Date())), todayISO()];
  const t = todayISO();
  return [t, t];
}
const SCOPE_TAG: Record<ExportScope, string> = { today: '오늘', week: '이번주', all: '전체' };

/** 오늘/이번주/전체 요약·오답 → Anki import용 .txt 카드 초안. */
export function exportAnkiCards(scope: ExportScope): void {
  const s = st().state;
  const [from, to] = exportRange(scope);
  const lines = buildAnkiCards(s, from, to);
  if (!lines.length) {
    toast(
      scope === 'all'
        ? '요약·오답 기록이 아직 없어요.'
        : `${SCOPE_TAG[scope]} 작성한 요약·오답이 없어요. 블록 끝마다 3문장 요약을 남기면 카드가 됩니다.`,
      'warn',
      4000,
    );
    return;
  }
  const head = ['#separator:Tab', '#html:true', '#tags column:3'];
  download(
    `러닝허브_카드_${scope === 'all' ? '전체' : SCOPE_TAG[scope]}.txt`,
    head.concat(lines).join('\n'),
    'text/plain;charset=utf-8',
  );
  toast(
    `${lines.length}장의 카드 초안(.txt)을 내려받았어요. Anki에서 "가져오기" 후 ≤5장으로 추리고 "왜?/응용"형으로 손질하세요.`,
    'ok',
    4600,
  );
}

/** 오늘/이번주/전체 요약 → 옵시디언용 .md 노트. */
export function exportSummaryNotes(scope: ExportScope): void {
  const s = st().state;
  const [from, to] = exportRange(scope);
  const md = buildSummaryNotes(s, from, to);
  if (!md) {
    toast(
      scope === 'all'
        ? '요약 기록이 아직 없어요.'
        : `${SCOPE_TAG[scope]} 작성한 요약이 없어요. 블록 끝마다 3문장을 남기면 노트가 됩니다.`,
      'warn',
      4000,
    );
    return;
  }
  download(`러닝허브_요약노트_${scope === 'all' ? '전체' : SCOPE_TAG[scope]}.md`, md, 'text/markdown;charset=utf-8');
  toast('요약 노트(.md)를 내려받았어요. 옵시디언 볼트에 넣어 개념 노트·카드와 연결하세요.', 'ok', 4600);
}

/** 하루 마감 원커맨드 매크로(I-3) — 백업 → 오늘 요약(.md) → 오늘 카드(.txt) → 오래된 기록 정리를
   한 번에. 기존 액션을 순서대로 조합(각자 대상 없으면 조용히 건너뜀). 흩어진 마감 동작을 한 클릭 리추얼로. */
export function runCloseout(): void {
  backupNow();
  exportSummaryNotes('today');
  exportAnkiCards('today');
  archiveOld();
  toast('오늘 마감 — 백업·요약·카드·정리를 실행했어요. 내려받은 파일을 확인하세요.', 'ok', 4600);
}

/* ── 빠른 캡처(⌘K 자연어) ─────────────────────────────────────────
   순수 파서(lib/quickCapture)는 컴포넌트에서 돌리고, store를 만지는 부분만 여기 shell에 둔다
   (components→store 금지 경계 준수). 캡처는 기록 프리필 요청 = 오늘탭 블록 버튼과 같은 동선 재사용. */

/** 빠른 캡처가 파서에 넘길 과목 스냅샷(id·name). */
export function captureSubjects(): { id: string; name: string }[] {
  return st().state.items.map((i) => ({ id: i.id, name: i.name }));
}

/** ⌘K 의미 검색 — store 스냅샷 + 읽을거리 블롭을 모아 lib/semantic에 위임
   (components→store 금지 경계: 팔레트는 이 shell 표면만 부른다). Ollama 불가면 []. */
export function semanticPalette(query: string): Promise<SemHit[]> {
  if (!semanticAvailable()) return Promise.resolve([]);
  return semanticSearch(query, st().state, loadReads());
}

export type ContentHit = {
  id: string;
  kind: 'subject' | 'chapter' | 'book' | 'backlog' | 'weak';
  label: string;
  to: string;
};

/** E-6/C-3: ⌘K 오프라인 통합 검색 — Ollama 불필요. 메모리에 이미 있는 학습 항목(과목·챕터)·독서(책)·
   열린 보충(backlog)·반복 약점(weak)을 부분문자열로 찾아 해당 탭으로 이동. 의미검색(semanticPalette)의
   오프라인 보완(임베딩 없이 항상 동작). 수집 지문(articles)은 react-query 캐시라 여기서 안 닿음(온라인 담당).
   C-1: reads는 팔레트가 열릴 때 1회 스냅샷해 주입 — 타이핑 매 키마다 localStorage 재파싱을 피한다. */
export function contentSearch(query: string, reads: ReturnType<typeof loadReads>, limit = 8): ContentHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const s = st().state;
  const cap = limit * 3;
  const hits: ContentHit[] = [];
  for (const it of s.items) {
    if (it.name.toLowerCase().includes(q))
      hits.push({ id: 'c-subj:' + it.id, kind: 'subject', label: it.name, to: '/items' });
    for (const c of it.chapters || []) {
      if (hits.length >= cap) break;
      if (c.name.toLowerCase().includes(q))
        hits.push({
          id: 'c-chap:' + it.id + ':' + c.id,
          kind: 'chapter',
          label: `${it.name} · ${c.name}`,
          to: '/items',
        });
    }
  }
  for (const b of reads.books) {
    if (hits.length >= cap) break;
    if (b.title.toLowerCase().includes(q) || (b.author || '').toLowerCase().includes(q))
      hits.push({
        id: 'c-book:' + b.id,
        kind: 'book',
        label: b.author ? `${b.title} — ${b.author}` : b.title,
        to: '/reads',
      });
  }
  // C-3: 열린 보충 — topic/과목/근거 텍스트를 이미 메모리에 들고 있으나 ⌘K서 못 찾던 것.
  for (const bl of openBacklog(s)) {
    if (hits.length >= cap) break;
    if ((bl.topic + ' ' + bl.name + ' ' + bl.note).toLowerCase().includes(q))
      hits.push({ id: 'c-bl:' + bl.id, kind: 'backlog', label: bl.topic || bl.name || '보충', to: '/journal' });
  }
  // C-3: 반복 약점(2회+ 막힌 과목·챕터) → 리뷰 탭.
  for (const w of weakSpots(s)) {
    if (hits.length >= cap) break;
    if ((w.subject + ' ' + w.chapter).toLowerCase().includes(q))
      hits.push({ id: 'c-weak:' + w.key, kind: 'weak', label: `${w.subject} · ${w.chapter}`, to: '/review' });
  }
  return hits.slice(0, limit);
}

/** 자연어 캡처 결과 → 기록 프리필 요청 + 확인 토스트. 팔레트는 이후 /journal로 이동한다.
   세션 유형이 복습/모의/백지면 '보충 필요'(bl), 그 외(새 학습·anki·미지정)는 '요약'(sum) 폼으로. */
export function runQuickCapture(cap: CaptureResult, summary: string): void {
  const form: PrefillForm = cap.sessionType && cap.sessionType !== 'new' && cap.sessionType !== 'anki' ? 'bl' : 'sum';
  const sid = cap.subject ? (st().state.items.find((i) => i.name === cap.subject)?.id ?? '') : '';
  // C-10: 파서가 뽑은 날짜(미래는 기록 탭이 무시)도 넘긴다 — "어제 …" 캡처가 오늘로 잘못 기록되던 것 해소.
  usePrefill.getState().request(form, sid, cap.dateISO);
  toast('📌 기록 탭에 준비했어요 — ' + summary, 'ok', 4500);
}
