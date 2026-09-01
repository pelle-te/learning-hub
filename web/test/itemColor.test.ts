/* ============================================================
   itemColor.test.ts — 과목 색 파생(id 해시 → OKLCH 생성 · 2026-07-24 배열→OKLCH).
   잠그는 계약:
     ① 색은 **저장값이 아니라 파생물**(절대규칙 #3) — colorForId 1곳이 유도, 저장은 캐시일 뿐.
     ② 파생 키는 위치가 아니라 **정체성**(id) → 삭제·재정렬에 불변(이게 0-G의 전부).
     ③ OKLCH 생성은 **8색 한계가 없다** — 과목 수가 늘어도 서로 구분되는 색(옛 8색은 ~80% 충돌).
============================================================ */
import { describe, expect, it } from 'vitest';
import { colorForId, oklchToHex, makeItem, refineItemColors } from '@/lib/utils';
import type { AppState } from '@/lib/schema';

const HEX = /^#[0-9a-f]{6}$/;

const itemsOf = (...ids: string[]) => ids.map((id) => ({ id, name: id, color: '' }));
const stateOf = (...ids: string[]) => refineItemColors({ items: itemsOf(...ids) } as unknown as AppState);
const colorMap = (s: AppState) => Object.fromEntries(s.items.map((i) => [i.id, i.color]));

describe('colorForId — 파생 규칙', () => {
  it('항상 유효한 hex 색을 준다', () => {
    for (let i = 0; i < 200; i++) expect(colorForId('id-' + i)).toMatch(HEX);
  });

  it('같은 id는 항상 같은 색(결정적)', () => {
    expect(colorForId('abc123')).toBe(colorForId('abc123'));
  });

  it('빈 id·비정상 입력에도 유효한 색(부팅이 깨지지 않는다)', () => {
    for (const bad of ['', null, undefined]) {
      expect(colorForId(bad as unknown as string)).toMatch(HEX);
    }
  });

  it('색상환 전체에 넓게 흩어진다(8색 한계 없음 · 한 색 쏠림 없음)', () => {
    const hist = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      const c = colorForId('r' + i.toString(36) + '-' + i);
      hist.set(c, (hist.get(c) || 0) + 1);
    }
    // 색상 각도 0~359 → 수백 가지 색이 나온다(옛 8색과 근본적으로 다르다). 쏠림도 없다.
    expect(hist.size).toBeGreaterThan(300);
    for (const n of hist.values()) expect(n).toBeLessThan(60);
  });
});

describe('oklchToHex — 게멋 안전', () => {
  it('색상환 어느 각도든 유효한 hex(게멋 밖은 채도 축소로 맞춤)', () => {
    for (let h = 0; h < 360; h += 7) expect(oklchToHex(0.72, 0.15, h)).toMatch(HEX);
  });
  it('채도 0이면 무채색(회색 계열 · R=G=B)', () => {
    const gray = oklchToHex(0.72, 0, 0);
    expect(gray).toMatch(HEX);
    expect(gray.slice(1, 3)).toBe(gray.slice(3, 5));
    expect(gray.slice(3, 5)).toBe(gray.slice(5, 7));
  });
});

describe('refineItemColors — 삭제·재정렬 불변 (0-G의 핵심)', () => {
  it('재정렬해도 각 과목의 색이 그대로다', () => {
    // 회귀: 인덱스 파생일 땐 순서만 바꿔도 뒤따르는 과목 색이 전부 한 칸씩 밀렸다.
    const before = colorMap(stateOf('a', 'b', 'c', 'd'));
    const after = colorMap(stateOf('d', 'c', 'b', 'a'));
    expect(after).toEqual(before);
  });

  it('중간 과목을 지워도 나머지 색이 안 밀린다', () => {
    const before = colorMap(stateOf('a', 'b', 'c', 'd'));
    const after = colorMap(stateOf('a', 'c', 'd'));
    for (const id of ['a', 'c', 'd']) expect(after[id], id).toBe(before[id]);
  });

  it('과목을 추가해도 기존 색이 안 바뀐다', () => {
    const before = colorMap(stateOf('a', 'b'));
    const after = colorMap(stateOf('a', 'b', 'new'));
    expect(after.a).toBe(before.a);
    expect(after.b).toBe(before.b);
  });

  it('저장된 낡은 색을 현재 파생 결과로 덮어쓴다(색은 저장값이 아니다)', () => {
    const s = { items: [{ id: 'a', name: 'a', color: '#ff0000' }] } as unknown as AppState;
    refineItemColors(s);
    expect(s.items[0]!.color).toBe(colorForId('a'));
    expect(s.items[0]!.color).toMatch(HEX);
  });

  it('비객체 원소를 걸러내고 나머지를 살린다(손상 백업이 부팅을 죽이지 않게)', () => {
    const s = { items: [null, { id: 'a', name: 'a' }, 'junk', undefined] } as unknown as AppState;
    refineItemColors(s);
    expect(s.items).toHaveLength(1);
    expect(s.items[0]!.color).toBe(colorForId('a'));
  });
});

describe('makeItem — 생성 시 색도 id 파생', () => {
  it('생성한 항목의 색이 부팅 시 재유도 결과와 일치한다', () => {
    const it = makeItem({ name: '전자기학' });
    expect(it.color).toBe(colorForId(it.id));
  });

  it('호출부가 id를 지정해도 그 id로 색을 만든다', () => {
    // 회귀 방지: Items.tsx는 시트를 바로 열려고 id를 미리 만들어 partial로 넘긴다.
    // spread 전 id로 색을 계산하면 저장 색과 부팅 재유도 색이 어긋난다.
    const it = makeItem({ id: 'preset-id', name: '새 과목' });
    expect(it.id).toBe('preset-id');
    expect(it.color).toBe(colorForId('preset-id'));
  });

  it('partial의 color는 무시된다(색은 파생물이지 입력이 아니다)', () => {
    const it = makeItem({ name: 'x', color: '#ff0000' } as Parameters<typeof makeItem>[0]);
    expect(it.color).toBe(colorForId(it.id));
  });
});

describe('OKLCH 생성 — 8색 한계 제거', () => {
  it('과목이 20개여도 색이 8색으로 뭉치지 않는다(옛 배열의 근본 한계 해소)', () => {
    // 옛 8색 배열은 20과목이면 색이 8가지로 반복됐다(생일 문제로 5과목만 돼도 ~80% 충돌).
    // 색상환 생성은 각 id 를 독립 각도로 보내 훨씬 많은 색으로 갈린다.
    const s = stateOf(...Array.from({ length: 20 }, (_, i) => 'id' + i));
    const distinct = new Set(s.items.map((i) => i.color));
    expect(distinct.size).toBeGreaterThan(12); // 8색 한계였다면 ≤8 — 그 천장이 사라졌다
  });
});
