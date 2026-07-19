/* ============================================================
   itemColor.test.ts — 과목 색 파생(0단계-G · 파생 키를 배열 인덱스 → item.id 해시로).
   잠그는 계약:
     ① 색은 **저장값이 아니라 PALETTE의 파생물**(절대규칙 #3) — PALETTE 한 줄로 전 탭 반영.
     ② 파생 키는 위치가 아니라 **정체성** → 삭제·재정렬에 불변(이게 0-G의 전부).
     ③ 파생 지점은 1곳(colorForId) — 옛 4곳 중복(refineItemColors·makeItem·recolorAll·moveItem) 해소.
============================================================ */
import { describe, expect, it } from 'vitest';
import { PALETTE, colorForId, makeItem, refineItemColors } from '@/lib/utils';
import type { AppState } from '@/lib/types';

const itemsOf = (...ids: string[]) => ids.map((id) => ({ id, name: id, color: '' }));
const stateOf = (...ids: string[]) => refineItemColors({ items: itemsOf(...ids) } as unknown as AppState);
const colorMap = (s: AppState) => Object.fromEntries(s.items.map((i) => [i.id, i.color]));

describe('colorForId — 파생 규칙', () => {
  it('항상 PALETTE 안의 색을 준다', () => {
    for (let i = 0; i < 200; i++) expect(PALETTE).toContain(colorForId('id-' + i));
  });

  it('같은 id는 항상 같은 색(결정적)', () => {
    expect(colorForId('abc123')).toBe(colorForId('abc123'));
  });

  it('빈 id·비정상 입력에도 유효한 색(부팅이 깨지지 않는다)', () => {
    for (const bad of ['', null, undefined]) {
      expect(PALETTE).toContain(colorForId(bad as unknown as string));
    }
  });

  it('PALETTE 8색에 고르게 흩어진다(한 색으로 쏠리지 않음)', () => {
    const hist = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      const c = colorForId('r' + i.toString(36) + '-' + i);
      hist.set(c, (hist.get(c) || 0) + 1);
    }
    expect(hist.size).toBe(PALETTE.length); // 8색 전부 등장
    // 균등이면 500. 쏠림 감지용 느슨한 경계(해시 품질 회귀 방어).
    for (const n of hist.values()) expect(n).toBeGreaterThan(250);
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

  it('저장된 낡은 색을 현재 PALETTE로 덮어쓴다(색은 저장값이 아니다)', () => {
    const s = { items: [{ id: 'a', name: 'a', color: '#ff0000' }] } as unknown as AppState;
    refineItemColors(s);
    expect(s.items[0]!.color).toBe(colorForId('a'));
    expect(PALETTE).toContain(s.items[0]!.color);
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

describe('알려진 트레이드오프 — 색 중복', () => {
  it('과목 수가 팔레트 크기를 넘으면 색이 반복된다(문서화된 한계)', () => {
    // 인덱스 방식은 8개까지 중복이 없었지만, 해시는 그 보장을 못 한다.
    // 8칸에서 '완전 불변 + 무충돌'은 원리적으로 불가능(충돌 회피가 다른 과목의 존재에 의존).
    // 중복이 거슬리면 정공법은 PALETTE를 늘리는 것 — 이 테스트는 그 사실을 문서로 남긴다.
    const s = stateOf(...Array.from({ length: 20 }, (_, i) => 'id' + i));
    const distinct = new Set(s.items.map((i) => i.color));
    expect(distinct.size).toBeLessThanOrEqual(PALETTE.length);
  });
});
