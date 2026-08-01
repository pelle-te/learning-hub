/* ============================================================
   mistakes.test.ts — 오답 아카이브 **순수 로직**(lib/mistakes).
   컴포넌트 회귀는 `mistakes.test.tsx` 가 따로 본다(같은 이름, 다른 층).
============================================================ */
import { describe, expect, it } from 'vitest';
import { todayMistakes, TODAY_PICK_N, type MistakeRow } from '@/lib/mistakes';

/* ── P-14 오늘 볼 것(2026-08-01) ────────────────────────────────────────────
   잠그는 것 둘: ① 결정론(같은 날 같은 창 · 벽시계 안 봄) ② **정렬을 다시 정하지 않는다**
   — 창이 도는 대상은 `mistakeArchive` 가 이미 정한 순서다. 여기서 순위를 새로 매기면
   두 화면이 다른 이야기를 한다. */
describe('mistakes — 오늘 볼 것(P-14)', () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ key: 'k' + i }) as unknown as MistakeRow);

  it('행이 n 이하면 전부 그대로(회전할 것이 없다)', () => {
    const few = rows.slice(0, 2);
    expect(todayMistakes(few, '2026-08-01').map((r) => r.key)).toEqual(['k0', 'k1']);
    expect(todayMistakes(rows.slice(0, 3), '2026-08-01')).toHaveLength(3);
  });

  it('같은 날이면 같은 창이다(결정론 — 여러 번 열어도 안 흔들린다)', () => {
    const a = todayMistakes(rows, '2026-08-01').map((r) => r.key);
    const b = todayMistakes(rows, '2026-08-01').map((r) => r.key);
    expect(a).toEqual(b);
    expect(a).toHaveLength(TODAY_PICK_N);
  });

  it('창은 연속이고 끝에서 감긴다(정렬을 다시 정하지 않는다)', () => {
    const picked = todayMistakes(rows, '2026-08-01').map((r) => rows.findIndex((x) => x.key === r.key));
    expect(picked[1]).toBe((picked[0]! + 1) % rows.length);
    expect(picked[2]).toBe((picked[0]! + 2) % rows.length);
  });

  it('날이 바뀌면 창이 돈다 — 며칠이면 아카이브 전체를 훑는다', () => {
    const days = ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05'];
    const seen = new Set(days.flatMap((d) => todayMistakes(rows, d).map((r) => r.key)));
    expect(seen.size).toBeGreaterThan(TODAY_PICK_N);
  });

  it('빈 목록에도 안 죽는다', () => {
    expect(todayMistakes([], '2026-08-01')).toEqual([]);
  });
});
