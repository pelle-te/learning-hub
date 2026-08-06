// @vitest-environment jsdom
/* ============================================================
   importRoundtripLarge.test.ts — 이관 왕복을 **대용량 표본**으로 재검증(1단계 이월 ②).

   왜 필요한가: 1단계에서 Chrome → Tauri 셸 수동 이관을 1회 왕복 검증했지만 원본이
   과목 1개·완료 0건이라 "스키마 경로는 전부 탔으나 대용량으로는 검증되지 않았다"가
   플랫폼 개편 2단계의 명시된 한계로 남았다. 2단계 끝에서 브라우저
   실행 경로를 은퇴시키면 그 왕복을 **더 이상 리허설할 수 없으므로** 지금 잠근다.

   검증 대상은 "내가 값을 복사했다"가 아니라 **앱의 진짜 경로**다:
     backupPayload()(내보내기 SSOT) → JSON 파일 → importJSON()(FileReader 포함 실경로)
   localStorage를 직접 쓰지 않는다 — 그러면 migrate·sanitizeImported·사이드카 복원·
   useUI.reloadUI()가 전부 우회돼 왕복이 아니라 대입이 된다(1단계에서 얻은 교훈).

   2단계(SQLite)에서 이 파일은 **I1(export/import JSON 계약)의 대용량 회귀**가 된다:
   저장소가 바뀌어도 이 왕복은 바이트 동일해야 한다.
============================================================ */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shell/toast', () => ({ toast: vi.fn(), toastUndo: vi.fn(), toastUndoable: vi.fn(), ToastHost: () => null }));
vi.mock('@/lib/idb', () => ({
  idbMirror: vi.fn(),
  idbLoad: vi.fn(async () => null),
  idbGet: vi.fn(async () => null),
  idbPut: vi.fn(async () => {}),
  idbDel: vi.fn(async () => {}),
  idbPreserveBackup: vi.fn(async () => {}),
  IDB_BACKUP_KEY: 'state_backup',
  IDB_BACKUP2_KEY: 'state_backup2',
}));

import { defaults, exportSnapshot } from '@/lib/persistence';
import { loadReads, saveReads, type ReadsLocal } from '@/lib/reads';
import { ATLAS_NOTES_KEY, ATLAS_STARS_KEY, RESEARCH_HISTORY_KEY } from '@/lib/sidecars';
import { UI_KEY, defaultUI, persistUI } from '@/lib/uiState';
import { storage } from '@/lib/kv';
import { useApp } from '@/store/useApp';
import { useUI } from '@/store/useUI';
import { backupPayload, importJSON } from '@/shell/actions';
import type { AppState } from '@/lib/types';

/* ── 결정적 난수 — 표본이 매 실행 달라지면 실패가 재현되지 않는다. ── */
let _seed = 0x2b3c4d5e;
const rnd = (): number => {
  _seed = (_seed * 1664525 + 1013904223) >>> 0;
  return _seed / 0x100000000;
};
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));

/** 2026-01-01 기준 n일 뒤 ds. */
const ds = (n: number): string => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);
/** 그 주의 ISO 월요일 ds. */
const monday = (n: number): string => ds(Math.floor(n / 7) * 7 + 3); // 2026-01-01=목 → +3=월

const SUBJECTS = 8;
const CHAPTERS = 25;
const DAYS = 500;

/** 수백 완료·dayPlans 규모의 현실적 상태. 전 슬라이스가 sanitizeImported의 검사를
 **통과하는 정상 레코드**여야 한다 — 한 건이라도 떨어지면 그게 이 테스트의 신호다. */
function bigState(): AppState {
  const s = defaults() as AppState & Record<string, unknown>;
  s.startDate = ds(0);

  s.items = Array.from({ length: SUBJECTS }, (_, i) => ({
    id: `sub-${i}`,
    name: `과목 ${i} — 전자기학·신호·회로 심화`,
    mode: i % 2 ? 'weekly' : 'daily',
    weeklyHours: 6,
    dailyMin: 90,
    chapters: Array.from({ length: CHAPTERS }, (_, c) => ({
      id: `sub-${i}-ch-${c}`,
      name: `${c + 1}장 — 개념 정리와 연습문제`,
      hours: 3,
      done: c < 10,
    })),
  })) as AppState['items'];

  const sid = (): string => `sub-${int(0, SUBJECTS - 1)}`;
  const types = ['new', 'rev', 'blank', 'anki', 'mock'] as const;

  // 완료 기록 — 500일 × 2~4건 ≈ 1,500건
  const comp: Record<string, Record<string, { done: boolean; min: number; doneDs?: string }>> = {};
  for (let d = 0; d < DAYS; d++) {
    const day: Record<string, { done: boolean; min: number; doneDs?: string }> = {};
    for (let k = 0; k < int(2, 4); k++)
      day[`${sid()}|${pick(types)}`] = { done: true, min: int(20, 180), doneDs: ds(d) };
    comp[ds(d)] = day;
  }
  s.completions = comp;

  // 일일 배치 — 400일
  const plans: Record<string, unknown> = {};
  for (let d = 0; d < 400; d++) {
    plans[ds(d)] = {
      mode: d % 3 ? 'auto' : 'manual',
      blocks: Array.from({ length: int(2, 5) }, (_, b) => ({
        id: `blk-${d}-${b}`,
        type: pick(types),
        sid: sid(),
        name: `블록 ${b}`,
        start: int(8, 20) * 60,
        min: int(30, 150),
        chapters: [`sub-0-ch-${int(0, CHAPTERS - 1)}`],
        pinned: b === 0,
        done: rnd() > 0.5,
      })),
    };
  }
  s.dayPlans = plans;

  s.dayOverrides = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [ds(i * 4), int(1, 8)]));

  s.events = Array.from({ length: 400 }, (_, i) => ({
    id: `ev-${i}`,
    ds: ds(int(0, DAYS - 1)),
    start: int(0, 1380),
    min: int(30, 180),
    title: `일정 ${i} — 시험·약속·행사`,
    note: '메모'.repeat(int(1, 20)),
    at: 1767225600000 + i,
  })) as AppState['events'];

  s.tasks = Array.from({ length: 300 }, (_, i) => ({
    id: `tk-${i}`,
    title: `할 일 ${i} — 과제 제출`,
    sid: sid(),
    ds: ds(int(0, DAYS - 1)),
    start: int(0, 1380),
    min: int(15, 120),
    done: rnd() > 0.6,
    at: 1767225600000 + i,
  })) as AppState['tasks'];

  s.cbms = Array.from({ length: 800 }, (_, i) => ({
    id: `cb-${i}`,
    ds: ds(int(0, DAYS - 1)),
    sid: sid(),
    name: `문항 ${i}`,
    chapter: `${int(1, CHAPTERS)}장`,
    code: pick(['C', 'B', 'M', 'S', 'T'] as const),
    note: '오답 메모 — 왜 틀렸는지 서술. '.repeat(int(1, 6)),
    at: 1767225600000 + i,
  })) as AppState['cbms'];

  s.backlog = Array.from({ length: 300 }, (_, i) => ({
    id: `bl-${i}`,
    ds: ds(int(0, DAYS - 1)),
    sid: sid(),
    name: `보충 ${i}`,
    topic: `주제 ${i}`,
    note: '보충이 필요한 이유. '.repeat(int(1, 8)),
    done: rnd() > 0.5,
    doneDs: '',
    at: 1767225600000 + i,
  })) as AppState['backlog'];

  s.blankResults = Array.from({ length: 200 }, (_, i) => ({
    id: `bk-${i}`,
    ds: ds(int(0, DAYS - 1)),
    sid: sid(),
    name: `백지 ${i}`,
    passed: rnd() > 0.4,
    note: '백지 인출 결과. '.repeat(int(1, 5)),
  })) as AppState['blankResults'];

  s.retentionLog = Array.from({ length: 400 }, (_, i) => ({
    wk: monday(i),
    at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    due: int(0, 300),
    cards: int(0, 900),
  })) as AppState['retentionLog'];

  s.summaries = Object.fromEntries(
    Array.from({ length: SUBJECTS }, (_, i) => [
      `sub-${i}`,
      Array.from({ length: 40 }, (_, j) => ({
        id: `sm-${i}-${j}`,
        sid: `sub-${i}`,
        name: `${j + 1}장`,
        s1: '첫 문장 요약. '.repeat(4),
        s2: '둘째 문장 요약. '.repeat(4),
        s3: '셋째 문장 요약. '.repeat(4),
        at: 1767225600000 + j,
      })),
    ]),
  ) as AppState['summaries'];

  s.weekly = Object.fromEntries(
    Array.from({ length: 70 }, (_, i) => [monday(i * 7), { checks: { a: true, b: false }, note: `주간 회고 ${i}` }]),
  ) as AppState['weekly'];
  s.rituals = Object.fromEntries(
    Array.from({ length: 200 }, (_, i) => [ds(i * 2), { plan: true, shutdown: rnd() > 0.5, note: '' }]),
  ) as AppState['rituals'];

  s.weekAlloc = Object.fromEntries(
    Array.from({ length: 60 }, (_, w) => [
      monday(w * 7),
      Object.fromEntries(Array.from({ length: SUBJECTS }, (_, i) => [`sub-${i}`, [0, 60, 60, 90, 60, 60, 0]])),
    ]),
  ) as AppState['weekAlloc'];

  // 영속 마커(런타임 캐시가 **아니다** — 내보내기에 남아야 한다)
  s._lastBackupAt = '2026-07-01T00:00:00.000Z';
  s._lastStreakCele = 12;
  // 런타임 캐시 — 내보내기에서 빠져야 한다
  s._vaultScan = { at: 'x', notes: 999 };
  s._knowState = { subjects: [{ subject: 'sub-0', mastery: 0.7 }] };

  return s as AppState;
}

function bigReads(): ReadsLocal {
  return {
    work: Object.fromEntries(
      Array.from({ length: 120 }, (_, i) => [
        `art-${i}`,
        { summary: `내가 쓴 요약 ${i}. `.repeat(30), done: i % 3 === 0, updatedAt: `2026-03-${(i % 28) + 1}` },
      ]),
    ),
    books: Array.from({ length: 40 }, (_, i) => ({
      id: `bk-${i}`,
      title: `책 ${i}`,
      author: `저자 ${i}`,
      status: i % 2 ? 'done' : 'reading',
      review: `독후감 ${i}. `.repeat(60),
      rating: int(0, 5),
      startedAt: '2026-02-01T00:00:00.000Z',
      finishedAt: null,
    })),
  } as ReadsLocal;
}

/** 실제 importJSON을 구동 — FileReader까지 앱과 같은 경로를 탄다. */
function driveImport(json: string): Promise<void> {
  const input = document.createElement('input');
  const file = new File([json], '러닝허브_백업.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file] as unknown as FileList, configurable: true });
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('importJSON 타임아웃')), 20_000);
    // loadState가 스토어에 반영되는 순간이 완료 신호(FileReader.onload가 async라 반환값으로는 못 기다린다).
    const un = useApp.subscribe(() => {
      clearTimeout(t);
      un();
      // 같은 tick의 사이드카 복원·reloadUI까지 끝나게 한 박자 넘긴다.
      setTimeout(resolve, 0);
    });
    importJSON(input);
  });
}

let ORIGINAL: AppState;
let PAYLOAD: string;

beforeEach(() => {
  localStorage.clear();
  _seed = 0x2b3c4d5e;
});

describe('대용량 이관 왕복 (1단계 이월 ②)', () => {
  it('내보내기 페이로드를 조립한다 — 규모와 바이트 크기를 기록', async () => {
    ORIGINAL = bigState();
    useApp.getState().loadState(ORIGINAL);
    saveReads(bigReads());
    localStorage.setItem(ATLAS_NOTES_KEY, JSON.stringify({ rf: '증폭기 진로 메모. '.repeat(40) }));
    localStorage.setItem(ATLAS_STARS_KEY, JSON.stringify(['rf', 'sat', 'dsp']));
    localStorage.setItem(
      RESEARCH_HISTORY_KEY,
      JSON.stringify(Array.from({ length: 60 }, (_, i) => ({ topic: `LNA ${i}`, ok: true }))),
    );
    // 앱이 실제로 쓰는 형태로 시드한다 — 손으로 만든 객체는 UIStateSchema를 통과하지 못해
    // bootUI가 조용히 기본값으로 떨어지고, 그러면 이 테스트가 복원을 검증하지 못한다.
    persistUI(storage, { ...defaultUI(), accent: 'cyan', navCollapsed: true });

    PAYLOAD = JSON.stringify(await backupPayload(useApp.getState().state), null, 2);

    // 규모 확인 — "수백 완료·dayPlans"라는 이월 조건을 실제로 만족하는지.
    expect(Object.keys(ORIGINAL.completions).length).toBe(DAYS);
    expect(Object.keys(ORIGINAL.dayPlans!).length).toBe(400);
    expect(ORIGINAL.cbms.length).toBe(800);

    // 크기는 assert하지 않고 **기록**한다 — 2단계(SQLite)의 동기가 이 숫자다(localStorage 5MB 절벽).
    // ⚠ 한도의 단위가 바이트가 아니다: 브라우저는 UTF-16 코드유닛으로 센다(한글 1자 = UTF-8 3B이지만
    //    UTF-16 2B). 한국어 데이터는 바이트로 재면 실제보다 커 보이므로 둘 다 남긴다.
    const mb = (n: number): string => (n / 1024 / 1024).toFixed(2);
    const stateJson = JSON.stringify(exportSnapshot(ORIGINAL));
    const u8 = (s: string): number => new TextEncoder().encode(s).length;
    // localStorage에 동시에 앉는 것: 앱 상태(KEY) + 되돌리기 백업(BACKUP_KEY, 파괴적 동작 전마다
    // backupNow가 통째로 복사) + 읽을거리(lh:reads). 즉 절벽까지의 여유는 상태 1벌 기준이 아니다.
    const readsJson = JSON.stringify(loadReads());
    // ×2 = UTF-16 바이트 환산. 상태가 2벌인 이유는 KEY와 BACKUP_KEY가 동시에 앉기 때문.
    const resident = (stateJson.length * 2 + readsJson.length) * 2;
    console.info(
      `[대용량 표본] 백업 파일 ${mb(u8(PAYLOAD))}MB(UTF-8) · ` +
        `앱 상태 ${mb(u8(stateJson))}MB(UTF-8) / ${mb(stateJson.length * 2)}MB(UTF-16) · ` +
        `localStorage 상주 ≈${mb(resident)}MB(UTF-16, KEY+BACKUP_KEY+reads) / 한도 ≈5MB`,
    );
    expect(u8(PAYLOAD)).toBeGreaterThan(1_000_000); // 표본이 실제로 크다는 것 자체를 잠근다
  });

  it('왕복 후 앱 상태가 바이트 동일하다 (sanitizeImported가 정상 레코드를 떨구지 않는다)', async () => {
    localStorage.clear(); // 새 오리진(Tauri WebView2) 시뮬레이션
    useApp.getState().loadState(defaults());

    await driveImport(PAYLOAD);

    const after = useApp.getState().state;
    expect(exportSnapshot(after)).toEqual(exportSnapshot(ORIGINAL));

    // 슬라이스별 건수 — 위 비교가 통째로 통과/실패하면 어디가 깨졌는지 안 보이므로 따로 잠근다.
    expect(Object.keys(after.completions).length).toBe(DAYS);
    expect(Object.keys(after.dayPlans!).length).toBe(400);
    expect(after.cbms.length).toBe(800);
    expect(after.events!.length).toBe(400);
    expect(after.tasks!.length).toBe(300);
    expect(after.backlog.length).toBe(300);
    expect(after.blankResults.length).toBe(200);
    expect(after.retentionLog.length).toBe(400);
    expect(after.items.length).toBe(SUBJECTS);
    expect(after.items[0]!.chapters.length).toBe(CHAPTERS);
  });

  it('런타임 캐시는 넘어오지 않고 영속 마커는 넘어온다 (2계층 스코프 계약)', async () => {
    localStorage.clear();
    useApp.getState().loadState(defaults());
    await driveImport(PAYLOAD);

    const after = useApp.getState().state as AppState & Record<string, unknown>;
    expect(after._vaultScan).toBeUndefined();
    expect(after._knowState).toBeUndefined();
    expect(after._lastBackupAt).toBe('2026-07-01T00:00:00.000Z');
    expect(after._lastStreakCele).toBe(12);
  });

  it('사이드카(_reads·_local)가 대용량에서도 바이트 동일하게 복원된다', async () => {
    localStorage.clear();
    useApp.getState().loadState(defaults());
    await driveImport(PAYLOAD);

    const reads = loadReads();
    expect(Object.keys(reads.work).length).toBe(120);
    expect(reads.books.length).toBe(40);
    expect(reads).toEqual(JSON.parse(PAYLOAD)._reads);

    const local = JSON.parse(PAYLOAD)._local;
    expect(JSON.parse(localStorage.getItem(ATLAS_NOTES_KEY)!)).toEqual(local[ATLAS_NOTES_KEY]);
    expect(JSON.parse(localStorage.getItem(RESEARCH_HISTORY_KEY)!)).toEqual(local[RESEARCH_HISTORY_KEY]);
    expect(JSON.parse(localStorage.getItem(UI_KEY)!)).toEqual(local[UI_KEY]);

    // 0단계-E의 핵심 교훈: KV만 복원하면 낡은 메모리가 다음 편집에서 복원본을 덮는다.
    // importJSON이 reloadUI()를 부르므로 메모리도 복원값이어야 한다.
    expect(useUI.getState().ui.accent).toBe('cyan');
    expect(useUI.getState().ui.navCollapsed).toBe(true);
  });
});
