/* ============================================================
   vt.test.ts — 전이 방향 문법(D-8)이 **탭 레지스트리에서 파생되는지**.

   여기서 잠그는 것은 픽셀이 아니라 판정이다. 전이 애니는 정지 프레임 스냅샷에 안 잡히므로
   (시각 회귀가 원리적으로 못 보는 층) 규칙이 틀려도 조용하다 — 그래서 규칙만 따로 잠근다.
   ⚠ 기대값을 탭 이름으로 손코딩하지 않는다: `tabs.ts` 의 order·SUBTAB_GROUPS 가 바뀌면
     이 테스트도 함께 바뀌어야 하는 게 맞다(그게 "레지스트리에서 파생된다"의 뜻이다).
============================================================ */
import { describe, expect, it } from 'vitest';
import { vtMove } from '@/shell/vt';

describe('vtMove — 형제 사이는 lateral, 방향은 order 대소', () => {
  it('오늘 → 통계는 앞으로', () => {
    expect(vtMove('/today', '/stats')).toEqual({ kind: 'lateral', dir: 'fwd' });
  });
  it('통계 → 오늘은 뒤로', () => {
    expect(vtMove('/stats', '/today')).toEqual({ kind: 'lateral', dir: 'back' });
  });
  it('세그먼트끼리도 lateral — 호스트가 같으면 형제다(계획 안의 배분 ↔ 과목)', () => {
    expect(vtMove('/alloc', '/items')).toEqual({ kind: 'lateral', dir: 'fwd' });
    expect(vtMove('/items', '/alloc')).toEqual({ kind: 'lateral', dir: 'back' });
  });
  it('세그먼트에서 남의 호스트로 나가면 **호스트 위치**로 비교한다', () => {
    // items(order 40)에서 today(10)로 — items 의 호스트는 schedule(12)이므로 뒤로.
    expect(vtMove('/items', '/today')).toEqual({ kind: 'lateral', dir: 'back' });
  });
});

/* ⚠⚠ **N-14(W5 · 2026-08-07) — `descend`/`ascend` 의 근거가 사라졌다.**
   그 둘은 *호스트 → 그 안의 조망* 이라는 **두 층 구조**의 문법이었고, 레일 평탄화가 그 구조를
   없앴다(모든 화면이 형제다). 옛 케이스는 `/schedule → /items` 를 `descend` 로 잠갔는데, 지금
   그 둘은 같은 섹션의 이웃이라 위아래가 없다 — **관계가 바뀐 것이지 테스트가 틀린 게 아니다**
   (E13 때 이 파일이 같은 이유로 한 번 갱신됐다).
   ⚠ 어휘를 지우지 않는 것이 중요하다: `ascend` 는 **`immerse` 의 짝**으로 살아 있고(아래 케이스),
   그게 이 문법이 지금도 말하는 유일한 위아래다. 그래서 여기서는 *같은 층의 이동에 위아래가
   붙지 않는다*를 잠근다 — 지어낸 계층이 다시 생기면 사용자가 구조를 잘못 배운다. */
describe('vtMove — 같은 층에는 위아래가 없다(N-14)', () => {
  it('같은 섹션의 이웃은 lateral 이다(계획 → 과목)', () => {
    expect(vtMove('/schedule', '/items')).toEqual({ kind: 'lateral', dir: 'fwd' });
  });
  it('되돌아오면 방향만 뒤집힌다 — 층을 지어내지 않는다', () => {
    expect(vtMove('/items', '/schedule')).toEqual({ kind: 'lateral', dir: 'back' });
  });
});

describe('vtMove — 몰입', () => {
  it('복습 러너로 들어가면 immerse', () => {
    expect(vtMove('/today', '/review-run')).toEqual({ kind: 'immerse' });
  });
  it('러너에서 나오면 ascend — 어디로 나가든 "열림"이다', () => {
    expect(vtMove('/review-run', '/today')).toEqual({ kind: 'ascend' });
    expect(vtMove('/review-run', '/day')).toEqual({ kind: 'ascend' }); // N-12 — `journal` → `day`
  });
});

describe('vtMove — 방향을 지어내지 않는다', () => {
  it('같은 탭 안의 이동(중첩 라우트·쿼리)은 방향 없는 lateral', () => {
    expect(vtMove('/atlas/rf', '/atlas/ai')).toEqual({ kind: 'lateral' });
    expect(vtMove('/items', '/items?focus=x')).toEqual({ kind: 'lateral' });
  });
  it('루트("/")는 today 로 읽는다(셸 기본 경로)', () => {
    expect(vtMove('/', '/today')).toEqual({ kind: 'lateral' });
  });
});
