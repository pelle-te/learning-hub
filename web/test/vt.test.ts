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

describe('vtMove — 안으로/밖으로', () => {
  it('호스트 → 조망은 descend(계획 → 과목)', () => {
    expect(vtMove('/schedule', '/items')).toEqual({ kind: 'descend' });
  });
  it('조망 → 호스트는 ascend(나오는 길이 있다)', () => {
    expect(vtMove('/items', '/schedule')).toEqual({ kind: 'ascend' });
  });
});

describe('vtMove — 몰입', () => {
  it('복습 러너로 들어가면 immerse', () => {
    expect(vtMove('/today', '/review-run')).toEqual({ kind: 'immerse' });
  });
  it('러너에서 나오면 ascend — 어디로 나가든 "열림"이다', () => {
    expect(vtMove('/review-run', '/today')).toEqual({ kind: 'ascend' });
    expect(vtMove('/review-run', '/journal')).toEqual({ kind: 'ascend' });
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
