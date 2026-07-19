/* ============================================================
   restoreDrill.test.ts — **G4 복구 드릴**(설계서 §6 P2-8 · 2026-07-20 신설).

   ## 왜 링크가 아니라 **체인**을 재는가

   이 저장소에는 이미 링크별 검사가 촘촘하다:

   · `importRoundtripLarge.test.ts` — 내보내기 JSON ↔ 앱 상태가 바이트 동일한가
   · `dbRows.test.ts`               — 앱 상태 ↔ SQLite 행이 바이트 동일한가
   · `cloudOutbox.test.ts`          — 워터마크 이후 dirty 행을 모으는가

   **셋이 전부 녹색인데도 복구가 반쯤 실패할 수 있다.** 실제로 그런 일이 있었다 — v3 이
   레거시 행을 `updated_at = 0` 으로 이행했고, 각 링크는 "0 이 된다"를 정확히 관측하며
   통과했는데, **아웃박스가 `updated_at > watermark(=0)` 로 모으므로 그 행들은 영원히
   동기화되지 않았다.** 실기기 연결에서 로컬 17행 중 1행만 도착해서야 드러났고 v6 백필이
   고쳤다(`dbMigrations.test.ts` 가 그 오해를 길게 적어 뒀다).

   교훈은 **"각 단계가 맞다"가 "합성이 맞다"를 함의하지 않는다**는 것이다. 그래서 이 파일은
   링크를 다시 재지 않고 **끝에서 끝까지 한 번** 흘린다:

       내보내기 JSON → 파싱 → migrate → sanitize → SQLite 행 → 아웃박스 수집

   ## P2-8 이 요구하는 것은 "있다"가 아니라 "해 봤다"

   런북이 _"복원해 보라는 뜻"_ 이라 적었는데, 종전 판정은 `exportSnapshot` 이 **존재한다**는
   근거로 ✅ 였다. 존재와 검증은 다른 명제다 — G4(_"클라우드가 사라져도 내보내기 JSON
   하나로 복구된다"_)는 **클라우드 시대에 백업의 마지막 보루**라, 그게 반쯤 동작하면
   호스트 폐업·계정 탈취·랜섬웨어가 전부 같은 곳에서 막힌다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { defaults, exportSnapshot, migrate, sanitizeImported } from '@/lib/persistence';
import { diffRows, rowsToState, stateToRows, TABLES } from '@/lib/db/rows';
import type { AppState } from '@/lib/types';

/** 사용자 데이터가 실제로 들어 있는 상태 — 빈 상태로는 유실을 못 잰다. */
function populated(): AppState {
  const s = defaults();
  const t = s as unknown as Record<string, unknown>;
  t['items'] = [
    { id: 'sub-1', name: '이산수학', kind: 'course', grade: 'A0' },
    { id: 'sub-2', name: '운영체제', kind: 'course' },
  ];
  /* ⚠ 실제 스키마 그대로 쓴다 — 처음엔 `{date,time,title}` 로 지어냈다가 `sanitizeImported`
     가 통째로 걸러냈다(일정은 `ds`+`start`+`min` 이 필수다). 픽스처를 발명하면 이 파일이
     복구가 아니라 **내 상상**을 검증하게 된다. 실패가 그걸 잡아 준 사례라 남겨 둔다. */
  t['events'] = [
    { id: 'ev-1', ds: '2026-07-21', start: 840, min: 60, title: '병원', note: '보험증 챙기기' },
    { id: 'ev-2', ds: '2026-07-23', start: 540, min: 90, title: '중간고사' },
  ];
  t['tasks'] = [{ id: 'tk-1', title: '3장 문제풀이', ds: '2026-07-21', min: 45, done: false }];
  // completions[ds][`${sid}|${type}`] = { done, min } — 값이 수치가 아니면 sanitize 가 떨군다.
  t['completions'] = {
    '2026-07-19': { 'sub-1|study': { done: true, min: 90 } },
    '2026-07-20': { 'sub-2|study': { done: false, min: 45 } },
  };
  t['weekAlloc'] = { '2026-07-20': { 'sub-1': [0, 60, 0, 60, 0, 0, 0] } };
  t['retentionLog'] = [{ ds: '2026-07-18', score: 0.82 }];
  return s as AppState;
}

/** 실제 복구 경로를 그대로 흘린다 — 테스트가 값을 손으로 옮기면 "내가 복사했다"만 증명한다. */
function restoreFromExport(s: AppState): AppState {
  const json = JSON.stringify(exportSnapshot(s));
  const migrated = migrate(JSON.parse(json));
  if (!migrated) throw new Error('migrate 가 내보내기 파일을 거절했다 — G4 가 이미 깨진 것이다');
  return sanitizeImported(migrated);
}

describe('⚠⚠ G4 복구 드릴 — 내보내기 JSON 하나로 되살아난다', () => {
  it('복구된 상태가 사용자 데이터를 그대로 갖는다', () => {
    const before = populated();
    const after = restoreFromExport(before);
    const pick = (s: AppState) => {
      const t = s as unknown as Record<string, unknown>;
      return {
        items: t['items'],
        events: t['events'],
        tasks: t['tasks'],
        completions: t['completions'],
        weekAlloc: t['weekAlloc'],
        retentionLog: t['retentionLog'],
      };
    };
    expect(pick(after), '복구가 사용자 데이터를 떨궜다').toEqual(pick(before));
  });

  it('복구된 상태가 SQLite 행을 거쳐도 동형이다 — 정본이 SQLite 이므로 이 구간이 진짜 복구다', () => {
    const restored = restoreFromExport(populated());
    /* ⚠ 2단계 이후 앱의 정본은 SQLite 다. "JSON 을 읽었다"까지는 복구가 아니고,
       그게 행으로 내려가 다시 상태로 올라와야 사용자가 자기 데이터를 본다. */
    expect(rowsToState(stateToRows(restored))).toEqual(restored);
  });
});

describe('⚠⚠ 복구본이 **동기화 대상이 된다** — v6 사고가 이 명제를 부순 적이 있다', () => {
  /** 아웃박스의 수집 조건을 그대로 옮긴 판정(`cloud/outbox.ts` 의 `updated_at > watermark`). */
  const SYNC_TABLES = new Set(TABLES.filter((t) => t.sync).map((t) => t.name));

  it('복구 직후 전 동기화 행에 0 보다 큰 스탬프가 찍힌다', () => {
    const restored = restoreFromExport(populated());
    const stamp = 1_700_000_000_000;
    const stmts = diffRows(null, stateToRows(restored), stamp);

    /* 동기화 대상 테이블로 들어가는 upsert 문을 골라 마지막 바인딩(updated_at)을 본다.
       `diffRows` 는 sync 테이블에만 스탬프 열을 싣는다(5단계-D). */
    const synced = stmts.filter((st) => SYNC_TABLES.has(tableOf(st.sql)) && /INSERT/i.test(st.sql));
    expect(synced.length, '복구했는데 동기화 대상 행이 하나도 안 생겼다').toBeGreaterThan(0);

    for (const st of synced) {
      const last = st.args[st.args.length - 1];
      /* ⚠ 0 은 "아주 오래된 것"이 아니라 **"영원히 수집되지 않는 것"** 이다 —
         워터마크 초기값이 0 이고 조건이 `> 0` 이라 `0 > 0` 이 거짓이기 때문이다.
         v6 백필 이전의 레거시 행이 정확히 이 상태였고, 복구 경로가 그걸 재현하면
         **사용자는 복구에 성공했다고 믿는 채로 다른 기기와 영영 갈린다.** */
      expect(last, `스탬프 0 인 행이 있다 — 이 행은 영영 동기화되지 않는다: ${st.sql}`).toBeGreaterThan(0);
    }
  });

  it('⚠ 복구본 전량이 워터마크 0 에서 수집 대상이다(부분 동기화가 안 생긴다)', () => {
    const restored = restoreFromExport(populated());
    const stamp = 1_700_000_000_000;
    const stmts = diffRows(null, stateToRows(restored), stamp);
    const synced = stmts.filter((st) => SYNC_TABLES.has(tableOf(st.sql)) && /INSERT/i.test(st.sql));

    const collected = synced.filter((st) => Number(st.args[st.args.length - 1]) > 0);
    expect(collected.length, '일부만 수집 대상이면 기기 간 상태가 조용히 갈린다').toBe(synced.length);
  });
});

/** `INSERT INTO <t> …` 에서 테이블명만. 판정에만 쓰므로 느슨해도 된다. */
function tableOf(sql: string): string {
  return /INTO\s+(\w+)/i.exec(sql)?.[1] ?? '';
}
