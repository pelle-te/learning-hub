/* ============================================================
   shell/actions.ts — 데이터·백업·테마 액션(레거시 state.js/data-methodology.js의 DOM·다운로드 경로 이식).
   순수 도메인 로직은 lib에 있고, 여기선 store 오케스트레이션 + 파일 다운로드/업로드 + FS Access +
   toast/modal UI를 엮는다. 헤더 ⋯ 메뉴·설정 탭·스케줄/기록 탭이 호출.
============================================================ */
import { useApp } from '@/store/useApp';
import { useRuntime } from '@/store/useRuntime';
import { usePrefill, type PrefillForm } from '@/store/prefill';
import { BACKUP_KEY, RUNTIME_CACHE_KEYS, migrate, defaults, exportSnapshot } from '@/lib/persistence';
import { idbLoad } from '@/lib/idb';
import { buildICS, planSignature as sigOf } from '@/lib/ics';
import { buildAnkiCards, buildSummaryNotes, archiveOldData } from '@/lib/methodology';
import { todayISO } from '@/lib/utils';
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

/** 데이터 내보내기(.json) — 런타임 캐시는 뺀 스냅샷. */
export function exportJSON(): void {
  const s = st().state;
  download(`러닝허브_${s.startDate}.json`, JSON.stringify(exportSnapshot(s), null, 2), 'application/json');
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
    const s = migrate(parsed);
    if (!s) {
      toast('가져오기 실패: 러닝 허브 백업 파일 형식이 아닙니다(필수 항목 누락).', 'bad', 5000);
      return;
    }
    RUNTIME_CACHE_KEYS.forEach((k) => {
      try {
        delete (s as Record<string, unknown>)[k];
      } catch {
        /* noop */
      }
    });
    if (!(await backupOrConfirm())) return;
    st().loadState(s);
    toastUndo('데이터를 가져왔어요.', undoLast);
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
  let s: AppState | null = null;
  try {
    s = migrate(JSON.parse(b));
  } catch {
    s = null;
  }
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
  if (!json) {
    toast('IndexedDB 백업이 없습니다(이 브라우저에서 저장된 적 없음).', 'warn', 4000);
    return;
  }
  let s: AppState | null = null;
  try {
    s = migrate(JSON.parse(json));
  } catch {
    s = null;
  }
  if (!s) {
    toast('IndexedDB 백업을 살릴 수 없습니다(형식 오류).', 'bad', 4000);
    return;
  }
  if (!(await backupOrConfirm())) return;
  st().loadState(s);
  toast('IndexedDB 백업에서 복구했어요.', 'ok', 4000);
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
    await w.write(JSON.stringify(exportSnapshot(st().state), null, 2));
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

/** 오늘/전체 요약·오답 → Anki import용 .txt 카드 초안. */
export function exportAnkiCards(scope: 'today' | 'all'): void {
  const s = st().state;
  const range = scope === 'today' ? todayISO() : '';
  const lines = buildAnkiCards(s, range, range);
  if (!lines.length) {
    toast(
      scope === 'today'
        ? '오늘 작성한 요약·오답이 없어요. 블록 끝마다 3문장 요약을 남기면 카드가 됩니다.'
        : '요약·오답 기록이 아직 없어요.',
      'warn',
      4000,
    );
    return;
  }
  const head = ['#separator:Tab', '#html:true', '#tags column:3'];
  download(
    `러닝허브_카드_${scope === 'today' ? todayISO() : '전체'}.txt`,
    head.concat(lines).join('\n'),
    'text/plain;charset=utf-8',
  );
  toast(
    `${lines.length}장의 카드 초안(.txt)을 내려받았어요. Anki에서 "가져오기" 후 ≤5장으로 추리고 "왜?/응용"형으로 손질하세요.`,
    'ok',
    4600,
  );
}

/** 오늘/전체 요약 → 옵시디언용 .md 노트. */
export function exportSummaryNotes(scope: 'today' | 'all'): void {
  const s = st().state;
  const range = scope === 'today' ? todayISO() : '';
  const md = buildSummaryNotes(s, range, range);
  if (!md) {
    toast(
      scope === 'today'
        ? '오늘 작성한 요약이 없어요. 블록 끝마다 3문장을 남기면 노트가 됩니다.'
        : '요약 기록이 아직 없어요.',
      'warn',
      4000,
    );
    return;
  }
  download(`러닝허브_요약노트_${scope === 'today' ? todayISO() : '전체'}.md`, md, 'text/markdown;charset=utf-8');
  toast('요약 노트(.md)를 내려받았어요. 옵시디언 볼트에 넣어 개념 노트·카드와 연결하세요.', 'ok', 4600);
}

/* ── 빠른 캡처(⌘K 자연어) ─────────────────────────────────────────
   순수 파서(lib/quickCapture)는 컴포넌트에서 돌리고, store를 만지는 부분만 여기 shell에 둔다
   (components→store 금지 경계 준수). 캡처는 기록 프리필 요청 = 오늘탭 블록 버튼과 같은 동선 재사용. */

/** 빠른 캡처가 파서에 넘길 과목 스냅샷(id·name). */
export function captureSubjects(): { id: string; name: string }[] {
  return st().state.items.map((i) => ({ id: i.id, name: i.name }));
}

/** 자연어 캡처 결과 → 기록 프리필 요청 + 확인 토스트. 팔레트는 이후 /journal로 이동한다.
   세션 유형이 복습/모의/백지면 '보충 필요'(bl), 그 외(새 학습·anki·미지정)는 '요약'(sum) 폼으로. */
export function runQuickCapture(cap: CaptureResult, summary: string): void {
  const form: PrefillForm = cap.sessionType && cap.sessionType !== 'new' && cap.sessionType !== 'anki' ? 'bl' : 'sum';
  const sid = cap.subject ? (st().state.items.find((i) => i.name === cap.subject)?.id ?? '') : '';
  usePrefill.getState().request(form, sid);
  toast('📌 기록 탭에 준비했어요 — ' + summary, 'ok', 4500);
}
