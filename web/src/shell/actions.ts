/* ============================================================
   shell/actions.ts — 데이터·백업·테마 액션(레거시 state.js/data-methodology.js의 DOM·다운로드 경로 이식).
   순수 도메인 로직은 lib에 있고, 여기선 store 오케스트레이션 + 파일 다운로드/업로드 + FS Access +
   toast/modal UI를 엮는다. 헤더 ⋯ 메뉴·설정 탭·스케줄/기록 탭이 호출.
============================================================ */
import { useApp } from '@/store/useApp';
import { useRuntime } from '@/store/useRuntime';
import { useUI } from '@/store/useUI';
import { usePrefill, type PrefillForm } from '@/store/prefill';
import {
  BACKUP_KEY,
  BACKUP_AT_KEY,
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
import { exportLocalExtras, importLocalExtras, LOCAL_EXTRAS_FIELD } from '@/lib/sidecars';
import { semanticSearch, semanticAvailable, type SemHit } from '@/lib/semantic';
import { idbLoad, idbGet, IDB_BACKUP_KEY, IDB_BACKUP2_KEY } from '@/lib/idb';
import { dbFallbackSnapshot } from '@/lib/db/fallback';
import { storage } from '@/lib/kv';
import { buildICS, planSignature as sigOf } from '@/lib/ics';
import {
  buildAnkiCards,
  buildSummaryNotes,
  archiveOldData,
  openBacklog,
  addBacklog,
  toggleBacklog,
} from '@/lib/methodology';
import { weakSpots } from '@/lib/insights';
import { PROMOTE_TOAST } from '@/lib/promote';
import { iso, mondayOf, openVaultSearch, todayISO } from '@/lib/utils';
import { isFsAccessSupported, pickDirectory, requestPermission } from '@/lib/fsAccess';
import type { AppState, Theme } from '@/lib/types';
import type { CaptureResult } from '@/lib/quickCapture';
import { isTauri, shellSaveFile } from '@/lib/tauri';
import { toast, toastUndo } from './toast';
import { confirm } from './modal';

const st = () => useApp.getState();
/* ⚠ 예전엔 여기 `safeLS()` 라는 자체 헬퍼가 localStorage 를 **직접** 잡았다. 그건 앱의 KV 단일
   출처(`lib/kv` 의 `storage`)를 우회하는 마지막 지점이었고, 비브라우저 환경에서 조용히 `null` 을
   돌려줘 되돌리기 백업이 **저장된 적 없이 성공한 척**했다(kv 는 메모리로 폴백한다).
   try/catch 는 그대로 둔다 — 용량 초과·프라이빗 모드는 폴백이 아니라 예외로 온다. */

/** 파일 내보내기 — 셸은 저장 대화상자, 브라우저는 `<a download>`.
 *
 *  ⚠ **셸에서 `<a download>` 는 예외 없이 아무 파일도 만들지 않는다**(4단계-F 트랙 B 프로브로
 *  실측 — 다운로드 폴더·프로필·앱 폴더 어디에도 안 생긴다). 내보내기 6경로가 전부 이 함수에
 *  수렴하고 그중 하나가 **백업**이라, 2단계-E 로 배포 경로를 셸 하나로 좁힌 뒤 줄곧 백업이
 *  안 되는 상태였다. 실패가 조용했던 것이 이 결함의 본질이라, 이제 결과를 토스트로 알린다. */
/* ⚠ **저장 성공 여부를 돌려준다**(H19 · 2026-07-26 감사). 종전엔 `void` 라 호출부가 결과를 알
   방법이 없었고, 그래서 `downloadCorruptSnapshot` 이 "내려받았겠지" 하고 **원본을 지웠다** —
   셸에서 저장 대화를 **취소해도** 유일한 손상 원본이 사라졌다(복구 경로가 복구 대상을 파괴).
   브라우저 `<a download>` 경로는 성공을 관측할 수단이 없으므로 `true` 로 본다 — 거기선 취소가
   파일 저장 대화가 아니라 브라우저 다운로드 관리자의 일이고, 원본 삭제와 엮이지 않는다. */
function download(filename: string, text: string, mime: string): Promise<boolean> {
  if (isTauri()) {
    return shellSaveFile(filename, text)
      .then((saved) => {
        if (saved) toast(`${filename} 을 저장했어요.`, 'ok');
        return saved;
      })
      .catch((e: unknown) => {
        toast(`저장하지 못했어요 — ${e instanceof Error ? e.message : String(e)}`, 'bad');
        return false;
      });
  }
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
  return Promise.resolve(true);
}

/** 되돌리기용 1단계 백업(localStorage). 시각도 함께 남긴다 — 아래 `backupAt` 참조. */
export function backupNow(): boolean {
  try {
    storage.setItem(BACKUP_KEY, JSON.stringify(st().state));
    storage.setItem(BACKUP_AT_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

/**
 * 되돌리기 백업이 **언제** 찍혔나. 없으면 null(= 되돌릴 것이 없다).
 *
 * ⚠ 이게 없던 동안 ⋯ 메뉴의 '되돌리기' 는 **항상 눌리는 버튼**이었고, 누르면 "직전"이 아니라
 * *마지막으로 파괴적 동작을 한 아무 때나*로 갔다 — 며칠 전일 수도 있었고 화면 어디에도 그
 * 사실이 없었다. 되돌리기가 조용히 며칠을 지우는 것은 되돌리기가 아니다.
 * ⚠ 시각을 못 읽어도(옛 백업엔 키가 없다) **백업 자체는 유효**하다 → `at:null` 로 구분한다.
 */
export function backupAt(): { at: number | null } | null {
  try {
    if (storage.getItem(BACKUP_KEY) == null) return null;
    const raw = storage.getItem(BACKUP_AT_KEY);
    const n = raw == null ? NaN : Number(raw);
    return { at: Number.isFinite(n) ? n : null };
  } catch {
    return null;
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
    return storage.getItem(CORRUPT_KEY) != null;
  } catch {
    return false;
  }
}

/** 손상 원본 내려받기(③#9) — boot이 CORRUPT_KEY에 보존한 '살릴 수 없던 raw'를 devtools 없이
 *  파일로 회수. 내려받기 성공 시 키를 정리한다(쓰기만 있고 읽기/삭제 경로가 없어 영구 잔존하던 층). */
export function downloadCorruptSnapshot(): void {
  let raw: string | null = null;
  try {
    raw = storage.getItem(CORRUPT_KEY);
  } catch {
    /* 접근 불가 */
  }
  if (!raw) {
    toast('보존된 손상 원본이 없어요.', 'warn');
    return;
  }
  /* ⚠⚠ **저장이 확인된 뒤에만 정리한다(H19 · 2026-07-26 감사).** 종전엔 `download()` 직후
     무조건 지웠는데, 셸에서 그건 비동기 fire-and-forget 이라 **사용자가 저장 대화를 취소해도**
     유일한 손상 원본이 사라졌다 — 복구 경로가 복구 대상을 파괴하는 형태다. 원본은 재생성이
     불가능하므로, 판단이 애매하면 **남기는 쪽**이 항상 옳다(다음 시도에서 다시 받을 수 있다). */
  void download('러닝허브_손상원본.json', raw, 'application/json').then((saved) => {
    if (!saved) return; // 취소·실패 — 보존본은 그대로 둔다(안내는 download 가 이미 했다)
    try {
      storage.removeItem(CORRUPT_KEY);
    } catch {
      /* 정리 실패는 치명 아님 — 다음 시도에서 재정리 */
    }
    toast('손상 원본을 내려받았어요 — 보존본은 정리했어요.', 'ok');
  });
}

/** 임시 저장본 내려받기(C1 · 2026-07-26 감사) — 정본(SQLite)이 죽은 세션이 localStorage 에
 *  남긴 스냅샷을 파일로 회수한다. **자동 병합은 하지 않는다**(근거는 `lib/db/fallback.ts`
 *  머리주석) — 사람이 파일을 보고 가져오기로 정한다.
 *
 *  ⚠ 마커를 여기서 지우지 않는다(H19 와 같은 규율): 셸의 `download` 는 비동기 fire-and-forget
 *  이라 저장 대화를 취소해도 성공처럼 보인다. 정리는 사용자의 "확인함"이 한다. */
export function downloadFallbackSnapshot(): void {
  const raw = dbFallbackSnapshot();
  if (!raw) {
    toast('임시 저장본이 없어요.', 'warn');
    return;
  }
  download('러닝허브_임시저장본.json', raw, 'application/json');
}

/** 데이터 내보내기(.json) — 런타임 캐시는 뺀 스냅샷 + 읽을거리 저작물(_reads: 내 요약·독후감)
    + 앱 상태 밖 로컬 키(_local: 아틀라스 메모·관심·리서치 이력·UI 설정 · 0단계-E ③).
    사이드카가 없으면 "내보내기로 백업하세요" 안내(저장실패 토스트)와 실제 백업 범위가 어긋난다. */
export function exportJSON(): void {
  const s = st().state;
  download(`러닝허브_${s.startDate}.json`, JSON.stringify(backupPayload(s), null, 2), 'application/json');
}

/** 백업 페이로드 SSOT — 파일 내보내기와 볼트 백업이 **같은 범위**를 쓰게 한다.
    (두 곳이 각자 조립하던 탓에 사이드카 추가가 한쪽에만 반영될 수 있었다.)
    export인 이유: `test/importRoundtripLarge.test.ts`가 **진짜 내보내기 범위**로 왕복을 검증한다.
    테스트가 페이로드를 자기 손으로 조립하면 "내가 값을 복사했다"만 증명하게 된다(1단계 교훈). */
export function backupPayload(s: AppState): Record<string, unknown> {
  return { ...exportSnapshot(s), _reads: loadReads(), [LOCAL_EXTRAS_FIELD]: exportLocalExtras() };
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
    // _reads(내 요약·독후감)·_local(아틀라스 메모·리서치 이력·UI 설정)은 앱 상태가 아니라
    // 별도 블롭 — 분리해 각자 복원한다. 구 백업엔 없으므로 undefined면 조용히 건너뛴다.
    const obj = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
    const reads = obj?._reads;
    const localExtras = obj?.[LOCAL_EXTRAS_FIELD];
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
    delete (s as Record<string, unknown>)[LOCAL_EXTRAS_FIELD];
    if (!(await backupOrConfirm())) return;
    st().loadState(s);
    const restored = reads ? importReads(reads) : null;
    // 사이드카 KV 복원 → announce({kind:'local'})가 아틀라스·리서치·UI의 메모리 상태를 되읽게 한다.
    const localCount = localExtras ? importLocalExtras(localExtras).length : 0;
    // UI 스토어는 sync 구독자가 아니다(부팅 시 1회 read) → 복원 후 명시적으로 되읽어야
    // 다음 설정 변경의 flush가 복원된 lh_ui_v1을 메모리 기본값으로 덮지 않는다.
    if (localCount) useUI.getState().reloadUI();
    const extras = [restored ? '읽을거리 요약·독후감' : '', localCount ? '아틀라스 메모·설정' : '']
      .filter(Boolean)
      .join(' · ');
    toastUndo(extras ? `데이터를 가져왔어요(${extras} 포함).` : '데이터를 가져왔어요.', undoLast);
  };
  r.readAsText(f);
  input.value = '';
}

/** 되돌리기 — BACKUP_KEY 직전 상태로. */
export function undoLast(): void {
  const b = storage.getItem(BACKUP_KEY);
  if (!b) {
    toast('되돌릴 백업이 없어요 — 삭제·가져오기·초기화 직전에 자동으로 만들어져요.', 'bad');
    return;
  }
  const s = parseState(b);
  if (!s) {
    toast('백업이 손상돼 되돌릴 수 없어요. 내보내 둔 파일이 있으면 가져오기로 복구하세요.', 'bad');
    return;
  }
  st().loadState(s);
  try {
    storage.removeItem(BACKUP_KEY);
    storage.removeItem(BACKUP_AT_KEY); // 짝을 남기면 다음 메뉴가 "없는 백업의 시각"을 말한다
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
    if (json) toast('IndexedDB 백업을 살릴 수 없어요(형식 오류).', 'bad', 4000);
    else toast('IndexedDB 백업이 없어요(이 브라우저에서 저장된 적 없어요).', 'warn', 4000);
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

/** 볼트 폴더에 러닝허브_백업.json 쓰기(FS Access). */
export async function backupToVault(): Promise<void> {
  if (!isFsAccessSupported()) {
    toast(
      '이 브라우저는 폴더 쓰기를 지원하지 않아요(Chrome/Edge 권장). 대신 [⋯ 메뉴 → 데이터 내보내기]로 파일 백업하세요.',
      'warn',
      5000,
    );
    return;
  }
  try {
    const h = await pickDirectory();
    if (!h) return; // 사용자 취소
    // 'prompt'는 requestPermission 미구현 브라우저의 값이기도 하다 — 여기서 막으면
    // 그 브라우저는 백업 자체가 불가능해진다. 명시적 거부만 차단하고, 나머지는 쓰기 시도가 판정한다.
    if ((await requestPermission(h, 'readwrite')) === 'denied') {
      toast('쓰기 권한이 거부됐어요.', 'bad');
      return;
    }
    const fh = await h.getFileHandle('러닝허브_백업.json', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(backupPayload(st().state), null, 2));
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
  kind: 'subject' | 'chapter' | 'book' | 'backlog' | 'weak' | 'mistake';
  label: string;
  to: string;
  /* ── 동사가 작용할 대상(N-1) ──────────────────────────────────────────
     ⚠ `id` 문자열(`c-chap:<sid>:<cid>`)을 되파싱하지 않는다. 그 문자열은 cmdk 의 키일 뿐
     계약이 아니고, 접두어 규칙이 한 번 바뀌면 동사가 **조용히 엉뚱한 객체에** 작용한다
     (잘못된 쓰기는 이 저장소가 반복해서 물린 침묵하는 부류다). 필드로 들고 다닌다. */
  /** 소속 과목 id — subject·chapter·weak. weak 는 CBMS 항목의 sid 다. */
  sid?: string;
  /** 과목명(표시·볼트 질의용) — sid 가 지워진 과목을 가리킬 수 있어 이름을 함께 든다. */
  subject?: string;
  /** 챕터명 — chapter·weak. */
  chapter?: string;
  /** 보충 레코드 id — backlog. */
  blId?: string;
};

/* ── N-1 명사→동사 ────────────────────────────────────────────────────────
   ⌘K 는 **찾아주고 데려다만 줬다**. `ContentHit` 은 4필드였고 `onSelect` 는
   `close(); navigate()` 가 전부라, "이 약점을 보충에 담기"는 팔레트에서 찾은 뒤 화면을
   옮겨 다시 그 항목을 찾아 버튼을 누르는 4클릭이었다.

   ## ⚠ 규율: **새 동사를 짓지 않는다**

   여기 있는 동사는 전부 **이미 화면에 있는 버튼**이다 — 요약·오답 프리필(오늘 탭 블록
   버튼과 같은 경로) · 보충에 담기(`Review.tsx` I-1 의 `addBacklog`+토스트 그대로) ·
   볼트 열기(5개 feature 의 `openVaultSearch`) · 보충 완료(`BacklogCard` 의 `toggleBacklog`).
   이 규율을 어기는 순간 팔레트가 **두 번째 IA** 가 되고, 어느 쪽이 진짜인지 모르게 된다.

   ## ⚠ 프리필에 `sid` 를 넘기는 것이 이 항목의 절반이다

   팔레트의 `act:add-sum`·`act:add-cbms` 는 `request(form, '')` 로 **과목을 빈 채** 넘겼다.
   즉 키보드 경로가 마우스보다 못했다(오늘 탭 버튼은 그 블록의 과목을 채워 준다). 객체
   위에서 부르는 동사는 그 객체를 안다 — 같은 폼이 채워진 채로 열린다. */
export interface HitVerb {
  id: string;
  label: string;
  hint: string;
  run: () => void;
  /** 실행 후 이동할 라우트(없으면 제자리 — 볼트 열기·보충 완료가 그렇다). */
  to?: string;
}

/** 보충 담기 — `Review.tsx` 의 I-1 경로(addBacklog + 승격 토스트)를 그대로 승격한 것. */
function seedBacklog(sid: string, name: string, topic: string, note: string): void {
  st().mutate((s) => addBacklog(s, sid, name, topic, note));
  toast(PROMOTE_TOAST, 'ok');
}

/**
 * 히트 위에서 쓸 수 있는 동사들. 빈 배열이면 팔레트가 동사 단계를 열지 않는다
 * (열어 놓고 "없음"을 보여 주는 것은 키를 배운 사람에게 벌을 주는 것이다).
 */
export function verbsFor(hit: ContentHit): HitVerb[] {
  const subject = hit.subject ?? '';
  const chapter = hit.chapter ?? '';
  const sid = hit.sid ?? '';
  /* 볼트 질의 — `Review.tsx:581` 의 `subject + ' ' + chapter` 관용구. 챕터가 없으면
     과목명만(`Mistakes.tsx:88` 이 같은 폴백을 쓴다). */
  const vaultQuery = [subject, chapter].filter(Boolean).join(' ');
  const openVault: HitVerb = {
    id: 'v:vault',
    label: '볼트에서 열기',
    hint: 'Obsidian',
    run: () => openVaultSearch(vaultQuery),
  };

  switch (hit.kind) {
    case 'subject':
    case 'chapter':
      return [
        {
          id: 'v:sum',
          label: '3문장 요약 남기기',
          hint: '기록',
          run: () => usePrefill.getState().request('sum', sid),
          to: '/journal',
        },
        {
          id: 'v:cbms',
          label: '오답(CBMS) 기록',
          hint: '기록',
          // 보충 폼과 달리 요약 폼엔 챕터 칸이 없다 — 챕터는 CBMS 로만 넘긴다(runQuickCapture 와 같은 판단).
          run: () => usePrefill.getState().request('cbms', sid, '', chapter),
          to: '/journal',
        },
        {
          id: 'v:bl',
          label: '보충에 담기',
          hint: '보충',
          run: () => seedBacklog(sid, subject || hit.label, chapter || subject || hit.label, ''),
        },
        openVault,
      ];
    case 'weak':
      /* 약점은 **이미 진단된 것**이라 처방이 먼저다 — 발산이 든 대표 사례
         ("리뷰 약점→보충 = 4클릭+스크롤+화면전환 1"). 순서가 곧 권고다. */
      return [
        {
          id: 'v:bl',
          label: '보충에 담기',
          hint: '처방',
          run: () => seedBacklog(sid, '반복 약점', `${subject} — ${chapter}`, '2회 이상 막힌 지점 — 백지로 인출'),
        },
        {
          id: 'v:cbms',
          label: '오답(CBMS) 기록',
          hint: '기록',
          run: () => usePrefill.getState().request('cbms', sid, '', chapter),
          to: '/journal',
        },
        openVault,
      ];
    case 'backlog':
      return [
        {
          id: 'v:done',
          label: '보충 완료 처리',
          hint: '보충',
          run: () => {
            if (!hit.blId) return;
            st().mutate((s) => toggleBacklog(s, hit.blId!));
            toast('보충을 닫았어요.', 'ok');
          },
        },
      ];
    /* `book` 은 동사가 없다 — 읽을거리에서 할 수 있는 일(정독·연습·요약)이 전부 그 화면의
       상태에 붙어 있어 여기로 들어올리면 화면 하나를 팔레트에 다시 짓게 된다. 기본 동작
       (열기)이 정직한 최선이다. */
    default:
      return [];
  }
}

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
  /* ⚠ 예전엔 과목·챕터 히트가 전부 `/items`(탭 루트)로만 갔다 — "선형대수"를 찾아 Enter 를 눌러도
     과목 20개짜리 목록 한복판에 떨어질 뿐, **내가 고른 것이 어디 있는지 표시가 없었다**. 찾아 주는
     것과 데려다주는 것은 다르다. AN-17 이 `?focus=<itemId>` 앵커(스크롤 + 1.5초 하이라이트)를
     이미 만들어 뒀으므로(Items.tsx:214) 그 위에 얹는다 — 로드맵이 '앵커 선행'이라 적어 둔 대목.
     챕터 히트는 챕터 단위 앵커가 없으니 **소속 과목 카드**까지가 정직한 최선이다. */
  const itemAnchor = (id: string) => '/items?focus=' + encodeURIComponent(id);
  for (const it of s.items) {
    if (it.name.toLowerCase().includes(q))
      hits.push({
        id: 'c-subj:' + it.id,
        kind: 'subject',
        label: it.name,
        to: itemAnchor(it.id),
        sid: it.id,
        subject: it.name,
      });
    for (const c of it.chapters || []) {
      if (hits.length >= cap) break;
      if (c.name.toLowerCase().includes(q))
        hits.push({
          id: 'c-chap:' + it.id + ':' + c.id,
          kind: 'chapter',
          label: `${it.name} · ${c.name}`,
          to: itemAnchor(it.id),
          sid: it.id,
          subject: it.name,
          chapter: c.name,
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
      hits.push({
        id: 'c-bl:' + bl.id,
        kind: 'backlog',
        label: bl.topic || bl.name || '보충',
        to: '/journal',
        blId: bl.id,
      });
  }
  // C-3: 반복 약점(2회+ 막힌 과목·챕터) → 리뷰 탭.
  for (const w of weakSpots(s)) {
    if (hits.length >= cap) break;
    if ((w.subject + ' ' + w.chapter).toLowerCase().includes(q))
      hits.push({
        id: 'c-weak:' + w.key,
        kind: 'weak',
        label: `${w.subject} · ${w.chapter}`,
        to: '/review',
        // weakSpots 의 key 는 `sid|chapter` 다 — 이미 갖고 있는 값을 필드로 꺼낸다(되파싱 금지).
        sid: w.key.split('|')[0] ?? '',
        subject: w.subject,
        chapter: w.chapter,
      });
  }
  /* 오답 메모(CBMS `note`) — **가장 밀도 높은 자기 텍스트인데 유일하게 검색 밖이었다.**
     "내가 왜 틀렸는지 적어 둔 그것"에 도달하는 경로가 오답 탭을 눈으로 스크롤하는 것뿐이었다.
     ⚠ 목적지는 `?sid=` 로 **과목까지 좁혀** 보낸다 — 조인 키가 과목 id 라 실패가 원리적으로
       없다(챕터 이름 매칭이 아니다). 챕터 단위 앵커는 없으므로 과목까지가 정직한 최선이다. */
  for (const e of s.cbms || []) {
    if (hits.length >= cap) break;
    if (`${e.note} ${e.name} ${e.chapter}`.toLowerCase().includes(q))
      hits.push({
        id: 'c-cbms:' + e.id,
        kind: 'mistake',
        label: `${e.name || '?'}${e.chapter ? ' · ' + e.chapter : ''} — ${(e.note || '').slice(0, 40)}`,
        to: '/mistakes?sid=' + encodeURIComponent(e.sid),
        sid: e.sid,
        subject: e.name,
        chapter: e.chapter,
      });
  }
  return hits.slice(0, limit);
}

/** 자연어 캡처 결과 → 기록 프리필 요청 + 확인 토스트. 팔레트는 이후 /journal로 이동한다.
   세션 유형이 복습/모의/백지면 '보충 필요'(bl), 그 외(새 학습·anki·미지정)는 '요약'(sum) 폼으로. */
export function runQuickCapture(cap: CaptureResult, summary: string): void {
  const form: PrefillForm = cap.sessionType && cap.sessionType !== 'new' && cap.sessionType !== 'anki' ? 'bl' : 'sum';
  const sid = cap.subject ? (st().state.items.find((i) => i.name === cap.subject)?.id ?? '') : '';
  // C-10: 파서가 뽑은 날짜(미래는 기록 탭이 무시)도 넘긴다 — "어제 …" 캡처가 오늘로 잘못 기록되던 것 해소.
  // C-10 잔여: 챕터도 넘긴다 — 단 텍스트 칸이 있는 **보충 폼**일 때만(요약엔 담을 칸이 없다).
  usePrefill.getState().request(form, sid, cap.dateISO, form === 'bl' ? cap.chapter : '');
  toast('📌 기록 탭에 준비했어요 — ' + summary, 'ok', 4500);
}

/** 팔레트 결과 0건 폴백 — 친 문자열을 **그대로** 보충('나중에 볼 것')으로 담는다.
 *
 *  왜 보충인가: 파서가 아무 토큰도 못 뽑은 텍스트는 날짜도 과목도 없는 *생각 조각*이다.
 *  기록 프리필로 보내면 폼만 열리고 **친 글자는 어디에도 안 남는다**(프리필은 과목·날짜만
 *  나른다) — 캡처를 자처하면서 캡처를 잃는 셈이라, 텍스트를 그대로 보존하는 backlog 가
 *  유일하게 정직한 목적지다. 과목 미지정(sid='')은 보충 스키마가 이미 허용한다.
 *  예전엔 이 경우 팔레트가 "일치하는 명령이 없어요"로 **막다른 골목**이었다. */
export function captureToBacklog(text: string): void {
  const topic = text.trim();
  if (!topic) return;
  st().mutate((s) => addBacklog(s, '', '', topic, ''));
  toast('📥 보충에 담았어요 — ' + topic, 'ok', 4000);
}
