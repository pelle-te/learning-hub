/* ============================================================
   shell/actions.ts — 데이터·백업·테마 액션(레거시 state.js/data-methodology.js의 DOM·다운로드 경로 이식).
   순수 도메인 로직은 lib에 있고, 여기선 store 오케스트레이션 + 파일 다운로드/업로드 + FS Access +
   toast/modal UI를 엮는다. 헤더 ⋯ 메뉴·설정 탭·스케줄/기록 탭이 호출.
============================================================ */
import { useApp } from '@/store/useApp';
import { useRuntime } from '@/store/useRuntime';
import { useUI } from '@/store/useUI';
import { useOverlay } from '@/store/useOverlay';
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
  degreeSeed,
} from '@/lib/persistence';
import { resolveTheme } from '@/lib/uiState';
import { routeLabelOf } from './tabs';
import { exportLocalExtras, importLocalExtras, LOCAL_EXTRAS_FIELD } from '@/lib/sidecars';
import { exportObservations, importObservations, OBSERVATIONS_FIELD } from '@/lib/observations';
import { DOCS_FIELD, exportAllDocs, importDocs } from '@/lib/db/docs';
import { idbLoad, idbGet, IDB_BACKUP_KEY, IDB_BACKUP2_KEY } from '@/lib/idb';
import { dbFallbackSnapshot } from '@/lib/db/fallback';
import { storage } from '@/lib/kv';
import { buildICS, planSignature as sigOf } from '@/lib/ics';
import { buildAnkiCards, buildSummaryNotes, archiveOldData } from '@/lib/methodology';
import { iso, makeItem, mondayOf, rid, todayISO } from '@/lib/utils';
import { chaptersFromVault, type VaultSubject } from '@/lib/vault';
import { applyCardedDone, cardedChapters, cardedPrompt } from '@/lib/ledgerSeed';
import type { Ledger } from '@/lib/ledger';
import { isFsAccessSupported, pickDirectory, requestPermission } from '@/lib/fsAccess';
import type { AppState, Theme } from '@/lib/types';
import { isTauri, shellSaveFile, shellSaveInWorkspace } from '@/lib/tauri';
import { toast, toastUndo, toastUndoable } from './toast';
import { confirmIrreversible, confirmLossy } from './destructive';

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
  return confirmIrreversible(
    '백업 저장 실패(저장공간이 가득 찼을 수 있음) — 지금 진행하면 "되돌리기"가 불가능합니다. 그래도 계속할까요? (먼저 내보내기로 백업 권장)',
    { title: '백업 실패', okLabel: '계속' },
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

/** 데이터 내보내기(.json) — 런타임 캐시는 뺀 스냅샷 + 앱 상태 밖 로컬 키(_local: UI 설정 등).
    ⚠ **`_reads`(내 요약·독후감)가 P10 W4 에서 빠졌다**(2026-08-07). 그 화면이 `survey/` 로 갔고
    정본이 **볼트 노트 파일**이 됐으므로, 이 앱의 백업이 그것을 담으면 같은 사실이 두 집을 갖는다.
    ⚠ 옛 백업 파일의 `_reads` 는 **조용히 무시된다** — 이관 시점 실측이 요약 1건(빈 문자열)·
      독후감 0건이라 잃을 것이 없었다. 그보다 큰 백업을 들고 있다면 볼트로 손으로 옮겨야 한다.
    사이드카가 없으면 "내보내기로 백업하세요" 안내(저장실패 토스트)와 실제 백업 범위가 어긋난다. */
export function exportJSON(): void {
  const s = st().state;
  void backupPayload(s).then((p) =>
    download(`러닝허브_${s.startDate}.json`, JSON.stringify(p, null, 2), 'application/json'),
  );
}

/** 백업 페이로드 SSOT — 파일 내보내기와 볼트 백업이 **같은 범위**를 쓰게 한다.
    (두 곳이 각자 조립하던 탓에 사이드카 추가가 한쪽에만 반영될 수 있었다.)
    export인 이유: `test/importRoundtripLarge.test.ts`가 **진짜 내보내기 범위**로 왕복을 검증한다.
    테스트가 페이로드를 자기 손으로 조립하면 "내가 값을 복사했다"만 증명하게 된다(1단계 교훈). */
/* ⚠ **비동기다**(H-14 · 2026-08-06 감사). 관측 원장(`route_visits`·`day_signals`)은 KV 가 아니라
   SQL 표라 읽기가 비동기이고, 그 둘이 **어떤 백업에도 없어서** 재설치·오리진 이동 때 0 이
   됐다(그것을 기다리는 로드맵 판정이 일곱이고 게이트가 관측일 10·방문 30이라 대기가 몇 주다).
   근거 전문은 `lib/observations.ts` 머리주석이 소유한다. */
/* ⚠⚠ `docs` 표를 **전량** 싣는다(D005 · 2026-08-21). P10 W4 가 `_reads` 를 걷은 뒤 이 표는
   **어떤 백업에도 없었다** — 그런데 비어 있지 않았다: 실 DB 에 3행 51,793 B 가 도달 불가인
   채(읽을 수도 지울 수도 없는데 D1·폰까지 밀린 채) 있었고 그중 하나는 사용자가 쓴 글이었다.
   살아 있는 세입자(`ics:feed`)도 같은 이유로 재설치에서 사라졌다.
   ⚠ 회수 경로가 삭제 경로보다 **먼저** 서야 한다는 것이 그 항목 처방의 순서다. */
export async function backupPayload(s: AppState): Promise<Record<string, unknown>> {
  return {
    ...exportSnapshot(s),
    [LOCAL_EXTRAS_FIELD]: exportLocalExtras(),
    [OBSERVATIONS_FIELD]: await exportObservations(),
    [DOCS_FIELD]: await exportAllDocs(),
  };
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
    // _local(UI 설정 등)·관측 원장은 앱 상태가 아니라 별도 블롭 — 분리해 각자 복원한다.
    // 구 백업엔 없으므로 undefined면 조용히 건너뛴다.
    const obj = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
    const localExtras = obj?.[LOCAL_EXTRAS_FIELD];
    const observations = obj?.[OBSERVATIONS_FIELD];
    const docsBlob = obj?.[DOCS_FIELD];
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
    delete (s as Record<string, unknown>)[LOCAL_EXTRAS_FIELD];
    delete (s as Record<string, unknown>)[OBSERVATIONS_FIELD];
    delete (s as Record<string, unknown>)[DOCS_FIELD];
    if (!(await backupOrConfirm())) return;
    st().loadState(s);
    // 사이드카 KV 복원 → announce({kind:'local'})가 아틀라스·리서치·UI의 메모리 상태를 되읽게 한다.
    const localCount = localExtras ? importLocalExtras(localExtras).length : 0;
    /* 관측 원장(H-14) — 실패해도 가져오기 전체를 막지 않는다. 이건 앱 데이터가 아니라 *관측*이고,
       없으면 판정이 늦어질 뿐 앱은 정상 동작한다(`observations.ts` 의 방문 수 MAX 규칙 참조). */
    if (observations) await importObservations(observations).catch(() => 0);
    /* D005 — `docs` 는 **아는 키만** 되살린다(`importDocs` 머리주석). 미지 키를 되쓰면 도달
       불가 행을 재생산하는 것이고, 파일에 담은 이유는 회수지 복원이 아니다. */
    if (docsBlob) await importDocs(docsBlob).catch(() => 0);
    // UI 스토어는 sync 구독자가 아니다(부팅 시 1회 read) → 복원 후 명시적으로 되읽어야
    // 다음 설정 변경의 flush가 복원된 lh_ui_v1을 메모리 기본값으로 덮지 않는다.
    if (localCount) useUI.getState().reloadUI();
    const extras = localCount ? '설정' : '';
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
    !(await confirmIrreversible('모든 데이터를 지울까요? (직후 [⋯ 메뉴 → 되돌리기]로 복구 가능)', {
      title: '전체 초기화',
      okLabel: '초기화',
    }))
  )
    return;
  if (!(await backupOrConfirm())) return;
  st().loadState(defaults());
  toastUndo('초기화했어요.', undoLast);
}

/** 졸업 계획 시드 불러오기 — **명시적 행위**(m-14).
 *
 *  이 데이터는 종전에 `defaults()` 에 실려 있어서 "전체 초기화"가 빈 상태가 아니라 옛 성적표
 *  복원이 됐다(근거는 `lib/persistence.degreeSeed` 위 ⚠⚠). 기본값에서 떼면서 **버리지 않고**
 *  여기로 옮긴다 — 새 기기·초기화 뒤에 다시 넣고 싶을 때가 그 값의 유일한 정당한 자리다.
 *
 *  ⚠ 이미 학기가 있으면 **덮어쓴다** → 파괴적이므로 확인 + 백업을 먼저 받는다(`resetAll` 과 같은 형태). */
export async function seedDegreePlan(): Promise<void> {
  const cur = st().state.degree?.semesters?.length ?? 0;
  if (cur > 0) {
    if (
      !(await confirmLossy(`졸업 계획에 이미 학기 ${cur}개가 있어요. 시드로 덮어쓸까요?`, {
        title: '졸업 계획 시드',
        okLabel: '덮어쓰기',
      }))
    )
      return;
    if (!(await backupOrConfirm())) return;
  }
  st().mutate((s) => {
    s.degree = degreeSeed();
  });
  toastUndoable('졸업 계획 시드를 넣었어요.');
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
  /* ⚠ **화면이 보고 있는 값**에서 출발한다(H9). 정본(`state.theme`)만 읽으면 시스템 따라가기가
     켜져 있을 때 "라이트를 보면서 라이트로 전환"이 된다 — 한 번 눌러도 아무 일이 없다. */
  const ui = useUI.getState().ui;
  const cur = resolveTheme(st().state.theme, ui);
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(cur) + 1) % THEME_CYCLE.length] || 'dark';
  setThemeTo(next);
}
/** 특정 테마로 직접 전환(팔레트의 '다크/라이트 모드' 명령). */
export function setThemeTo(t: Theme): void {
  st().setTheme(t);
  /* ⚠ 감지값을 지운다(H9) — 안 지우면 `resolveTheme` 이 계속 OS 값을 우선해 **수동 선택이
     화면에 반영되지 않는다.** "고른 값은 다음 OS 변경까지 유지"라는 기존 계약이 여기서 성립한다. */
  useUI.getState().setAutoTheme(null);
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

/** 볼트 폴더에 러닝허브_백업.json 쓰기 — 셸은 워크스페이스 경로로, 브라우저는 FS Access 로.
 *
 * ⚠⚠ **셸 경로가 없어서 되먹임 루프가 막혀 있었다**(2026-08-06). 지식엔진은 이 파일을 찾아 앱
 * 관측을 인제스트하는데, 이 함수는 FS Access 전용이라 **브라우저에서만** 동작했다 — 그리고
 * 배포 진입점은 2단계-E 이후 셸 하나다. 즉 사용자의 실제 앱에서는 이 파일이 **만들어질 수
 * 없었고**, 로드맵의 "되먹임 루프 재개(선행 ① 출하됨)"가 그 뒤로도 계속 막혔다. 근거·실측은
 * `lib/tauri.ts` 의 `shellSaveInWorkspace` 머리주석이 갖는다.
 * ⚠ 셸에선 **폴더를 묻지 않는다** — 워크스페이스가 이미 그 답이고(설정에서 한 번 고른다),
 * 매번 물으면 "저장 때마다 자동으로"라는 이 기능의 성질과 어긋난다. */
export async function backupToVault(): Promise<void> {
  if (isTauri()) {
    try {
      const path = await shellSaveInWorkspace(
        '러닝허브_백업.json',
        JSON.stringify(await backupPayload(st().state), null, 2),
      );
      if (!path) {
        toast('워크스페이스가 설정되지 않았어요 — 설정 탭에서 폴더를 먼저 지정하세요.', 'warn', 5000);
        return;
      }
      st().mutate((s) => void ((s as AppState)._lastBackupAt = new Date().toISOString()));
      toast('워크스페이스에 러닝허브_백업.json 저장 완료.', 'ok');
    } catch (e) {
      toast('볼트 백업 실패: ' + ((e as Error).message || e), 'bad', 5000);
    }
    return;
  }
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
    await w.write(JSON.stringify(await backupPayload(st().state), null, 2));
    await w.close();
    st().mutate((s) => void ((s as AppState)._lastBackupAt = new Date().toISOString()));
    toast('볼트 폴더에 러닝허브_백업.json 저장 완료.', 'ok');
  } catch (e) {
    if ((e as Error).name !== 'AbortError') toast('볼트 백업 실패: ' + ((e as Error).message || e), 'bad', 5000);
  }
}

/** 오래된 기록(기본 6개월 이전) 보관 파일로 내려받고 앱에서 비움. */
export function archiveOld(monthsKeep = 6): void {
  /* ⚠⚠ **저장이 확인된 뒤에만 비운다(H2 · 2026-07-30 `/감사 근본`).**

     종전 순서는 `mutate(archiveOldData)`(= 상태에서 **삭제**) → `download(...)`(**반환값 무시**)
     → "내려받고 비웠어요" 토스트였다. 셸의 `download` 는 저장 대화를 띄우고 취소 시 `false` 를
     주는데 그 값을 읽지 않았으므로, **사용자가 취소하면 6개월치 기록이 파일 없이 사라졌다.**
     그리고 `runCloseout`("하루 마감")이 이 함수를 무인 호출하므로 버튼 한 번이 발동시킨다.

     이건 같은 파일 `downloadCorruptSnapshot` 이 H19(2026-07-26)에서 이미 고친 형태이고, 그때
     세운 원칙("복구 경로가 복구 대상을 파괴한다")을 이 함수가 위반한 채 남아 있었다.

     → ① **사본**에서 보관 payload 를 만들고(상태 무변경) ② 저장 성공을 확인한 뒤 ③ 실제로 비운다.
     ⚠ ①의 cutoff 를 ③에 물려준다 — 저장 대화가 자정을 넘겨 열려 있으면 두 번째 계산이 하루
       밀려 **보관한 것과 지운 것이 어긋난다**(`archiveOldData` 의 `cutoffOverride` 주석). */
  const preview = archiveOldData(structuredClone(st().state), monthsKeep);
  if (!preview.count) {
    toast('정리할 오래된 기록이 없어요(6개월 이전 기록 없음).', 'info', 3200);
    return;
  }
  void download(`러닝허브_보관_${todayISO()}.json`, JSON.stringify(preview.archive, null, 2), 'application/json').then(
    (saved) => {
      if (!saved) {
        /* 취소·실패 — 앱의 기록은 손대지 않았다. 그 사실을 말해야 사용자가 "지워졌나?" 를
         의심하지 않는다(조용한 무반응이 최악이라는 규율). */
        toast('보관 파일을 저장하지 않았어요 — 앱의 기록은 그대로 뒀어요.', 'warn', 5000);
        return;
      }
      st().mutate((s) => {
        archiveOldData(s, monthsKeep, preview.archive.cutoff);
      });
      toast(`${preview.count}건을 보관 파일로 내려받고 앱에서 비웠어요.`, 'ok', 4200);
    },
  );
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
/* T-26 — 지금 화면 고정/해제. ⚠ 경로·라벨을 **부를 때** 읽는다(모듈 로드 시점이 아니라):
   팔레트 명령 목록은 열 때 한 번 만들어지므로, 여기서 값을 굳히면 "지금" 화면이 아니라
   *팔레트를 처음 연* 화면이 고정된다. 상한 규칙은 `lib/pins` 가 소유한다. */
export function toggleCurrentPin(): void {
  const to = window.location.pathname;
  const key = to.split('/')[1] || 'today';
  useUI.getState().togglePin(to, routeLabelOf(key), Date.now());
}

/* ── N-13 작업대 — **지금 화면을 옆에 붙든다**(W9 · 2026-08-07) ──────────────────────
   ⚠ `toggleCurrentPin` 과 같은 이유로 경로를 **부를 때** 읽는다(팔레트 목록은 열 때 한 번
   만들어지므로 여기서 굳히면 *팔레트를 처음 연* 화면이 붙들린다).
   ⚠ 쿼리까지 싣는다 — `?view=` 로 갈라지는 화면이 여럿이라(`/degree?view=close`) 경로만
   싣으면 붙들어 둔 것이 다른 뷰가 된다.
   ⚠ 같은 화면을 두 번 붙들면 **닫는다**(토글) — 여는 명령과 닫는 명령을 따로 두면 팔레트에
   줄이 둘이 되고, 그중 하나는 항상 아무 일도 안 한다. */
export function toggleBench(): void {
  const cur = window.location.pathname + window.location.search;
  const { bench, setBench } = useOverlay.getState();
  setBench(bench === cur ? null : cur);
}

export async function importVaultSubject(s: VaultSubject, ledger: Ledger | undefined, tail: string): Promise<void> {
  const items = st().state.items;
  if (items.some((x) => x.name === s.name)) {
    toast('이미 추가된 항목입니다.', 'warn');
    return;
  }
  const chapters = chaptersFromVault(s.chapters);
  const id = rid();
  st().mutate((state) => {
    state.items.push(makeItem({ id, source: '볼트', name: s.name, chapters }));
  });
  toast(`"${s.name}" 추가됨 — 챕터 ${chapters.length}개. ${tail}`, 'ok');
  /* W4 — 임포트는 모든 챕터를 `done:false` 로 만들어 **가짜 백로그**를 세운다. 원장은 같은
     챕터에 대해 `carded` 를 이미 아는데, 자동으로 찍으면 안 익힌 챕터가 조용히 유지 큐로
     내려간다 → **한 번 묻고 사람이 판단한다**(근거는 `lib/ledgerSeed.ts` 머리주석). */
  const carded = cardedChapters(ledger, s.name, chapters);
  if (!carded.length) return;
  /* Q-13 ②단 — 원장이 밖에 그대로 있으니 언제든 다시 맞출 수 있다(재구성 가능). */
  const ok = await confirmLossy(cardedPrompt(s.name, carded.length, chapters.length), {
    title: '원장과 맞출까요?',
    okLabel: `${carded.length}개 끝낸 것으로 표시`,
    cancelLabel: '그대로 두기',
  });
  if (!ok) return;
  let marked = 0;
  st().mutate((state) => {
    const it = state.items.find((x) => x.id === id);
    if (it) marked = applyCardedDone(it.chapters || [], carded);
  });
  toast(`챕터 ${marked}개를 끝낸 것으로 표시했어요 — 유지 복습 큐로 넘어갑니다.`, 'ok');
}
