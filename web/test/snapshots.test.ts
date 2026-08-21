/* ============================================================
   snapshots.test.ts — **되돌릴 수 있는 지점의 사다리**(I038 · 2026-08-22 발상 축).

   세대가 1이라 **회수 경로가 자기를 덮고 있었다**: 잘못된 가져오기 → (백업 A) → 다시 가져오기
   → **A 가 이미 엉킨 상태 B 로 덮인다** → 되돌리기는 엉킨 곳으로 간다. 이 저장소가 H19·H2 에서
   두 번 고친 *"복구 경로가 복구 대상을 파괴한다"* 가 세대 축에 남아 있던 형태다.

   ⚠ 여기서 잠그는 것:
   ① **그 시나리오 자체** — 두 번 밀어도 첫 상태가 살아 있다(이 파일에서 가장 중요한 케이스)
   ② 0세대 키가 **옛 `BACKUP_KEY` 그대로**다(마이그레이션 0 · 옛 저장본이 그냥 읽힌다)
   ③ 미는 방향 — 앞에서부터 밀면 세 세대가 **같은 값**이 되어 기능이 조용히 무효화된다
   ④ 되돌린 지점은 지워지고 **당겨 채우지 않는다**
   ⑤ 저장 실패는 던지지 않고 `false` — 호출부가 「되돌리기 불가」를 사용자에게 묻는다
============================================================ */
import { describe, expect, it } from 'vitest';
import { memKV } from '@/lib/kv';
import { BACKUP_AT_KEY, BACKUP_KEY } from '@/lib/persistence';
import { GENERATIONS, dropSnapshot, genKey, pushSnapshot, readSnapshot, snapshots } from '@/lib/snapshots';
import type { KV } from '@/lib/types';

describe('snapshots — 세대 사다리', () => {
  it('⭐ 파괴적 동작을 연달아 해도 첫 상태가 남는다(이 항목의 전부)', () => {
    const kv = memKV();
    pushSnapshot(kv, 'A', 1);
    pushSnapshot(kv, 'B', 2);
    const list = snapshots(kv);
    expect(list.map((s) => readSnapshot(kv, s.key))).toEqual(['B', 'A']);
  });

  it('⚠ 0세대 키가 옛 BACKUP_KEY 그대로다 — 옛 저장본이 마이그레이션 없이 읽힌다', () => {
    const kv = memKV();
    kv.setItem(BACKUP_KEY, 'OLD');
    kv.setItem(BACKUP_AT_KEY, '7');
    expect(snapshots(kv)).toEqual([{ key: BACKUP_KEY, gen: 0, at: 7 }]);
    // 그 위에 새로 찍으면 옛것이 1세대로 내려간다(잃지 않는다)
    pushSnapshot(kv, 'NEW', 8);
    expect(readSnapshot(kv, genKey(1))).toBe('OLD');
  });

  it('⚠⚠ 세대가 서로 다른 값이다 — 앞에서부터 밀면 전부 같은 값이 되어 기능이 조용히 죽는다', () => {
    const kv = memKV();
    for (let i = 0; i < GENERATIONS + 2; i++) pushSnapshot(kv, 'v' + i, i);
    const vals = snapshots(kv).map((s) => readSnapshot(kv, s.key));
    expect(new Set(vals).size).toBe(GENERATIONS);
  });

  it('사다리 길이를 넘지 않는다 — 가장 오래된 것이 떨어진다', () => {
    const kv = memKV();
    for (let i = 0; i < 10; i++) pushSnapshot(kv, 'v' + i, i);
    expect(snapshots(kv)).toHaveLength(GENERATIONS);
    expect(readSnapshot(kv, genKey(0))).toBe('v9');
  });

  it('시각이 값과 함께 내려간다 — 목록이 「언제로 돌아가는가」를 말할 수 있어야 한다', () => {
    const kv = memKV();
    pushSnapshot(kv, 'A', 100);
    pushSnapshot(kv, 'B', 200);
    expect(snapshots(kv).map((s) => s.at)).toEqual([200, 100]);
  });

  it('시각이 없는 옛 세대는 at=null 이지만 복원은 된다', () => {
    const kv = memKV();
    kv.setItem(BACKUP_KEY, 'OLD'); // 짝인 _at 없음
    expect(snapshots(kv)[0]!.at).toBeNull();
    expect(readSnapshot(kv, BACKUP_KEY)).toBe('OLD');
  });

  it('⚠ 되돌린 지점은 지워지고 당겨 채우지 않는다 — 같은 지점으로 두 번 갈 수 없다', () => {
    const kv = memKV();
    pushSnapshot(kv, 'A', 1);
    pushSnapshot(kv, 'B', 2);
    dropSnapshot(kv, genKey(0));
    const list = snapshots(kv);
    expect(list).toHaveLength(1);
    expect(list[0]!.gen).toBe(1); // 1세대가 0으로 올라오지 않는다
    expect(readSnapshot(kv, list[0]!.key)).toBe('A');
  });

  it('⚠ 저장 실패는 던지지 않고 false — 호출부가 「되돌리기 불가」를 묻는다', () => {
    const broken: KV = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
      removeItem: () => undefined,
    };
    expect(() => pushSnapshot(broken, 'A', 1)).not.toThrow();
    expect(pushSnapshot(broken, 'A', 1)).toBe(false);
  });
});
