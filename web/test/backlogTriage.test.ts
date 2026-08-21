/* ============================================================
   backlogTriage.test.ts — **캡처 트리아지**(I042 · 2026-08-22 발상 축).

   캡처 입구 셋(⌘K · 미니 HUD · 폰 캡처 바)이 전부 판정 없이 백로그로 직행했다. 그러면
   «지하철에서 떠오른 한 줄»과 «정말 막힌 것»이 같은 목록의 같은 무게로 쌓이고, 밖의 표본이
   경고하는 결말이 온다: *"검증 안 된 유입이 쌓여 백로그 전체가 아무도 안 읽는 목록이 된다."*

   ⚠ 여기서 잠그는 것 — 그 문서가 함께 적는 **대가**를 피하는 장치들이다:
   ① 미분류는 **별도 목록이 아니다** — 판정을 건너뛰어도 그 항목은 여전히 열린 보충이다
      (트리아지가 새 백로그가 되지 않는 유일한 방법)
   ② **옛 항목은 미분류가 아니다**(`triaged` 없음 = 판정된 것) — 무마이그레이션
   ③ 미룬 것은 그 날짜까지 숨고 **스스로 돌아온다**
   ④ ⚠⚠ 미루기가 **판정도 끝낸다** — 안 그러면 돌아올 때마다 다시 미분류라 판정 노동이 영구화된다
   ⑤ 손으로 만든 보충은 처음부터 판정된 것이다(캡처만 미분류)
============================================================ */
import { describe, expect, it } from 'vitest';
import { addBacklog, openBacklog, untriagedBacklog, triageBacklog, snoozeBacklog } from '@/lib/methodology';
import { fileCapture } from '@/lib/quickCapture';
import type { AppState } from '@/lib/types';

const TODAY = '2026-08-22';
const st = (): AppState => ({ _today: TODAY, backlog: [], items: [] }) as unknown as AppState;

describe('트리아지 — 미분류는 별도 목록이 아니다', () => {
  it('⭐ 캡처는 미분류로 들어오지만 **열린 보충에는 그대로 있다**', () => {
    const s = st();
    fileCapture(s, '변위전류 유도 막힘', new Date(TODAY + 'T09:00:00'));
    expect(openBacklog(s, TODAY)).toHaveLength(1);
    expect(untriagedBacklog(s, TODAY)).toHaveLength(1);
  });

  it('⚠ 손으로 만든 보충은 처음부터 판정된 것이다', () => {
    const s = st();
    addBacklog(s, '', '', '손으로 적음', '');
    expect(untriagedBacklog(s, TODAY)).toEqual([]);
  });

  it('⚠ 옛 저장본(`triaged` 없음)은 미분류로 되살아나지 않는다', () => {
    const s = st();
    s.backlog = [{ id: 'old', ds: '2026-01-01', sid: '', name: '', topic: '옛것', note: '', done: false, doneDs: '' }];
    expect(untriagedBacklog(s, TODAY)).toEqual([]);
  });

  it('「지금 볼 것」은 판정만 끝낸다 — 목록에서 사라지지 않는다', () => {
    const s = st();
    const id = addBacklog(s, '', '', 'x', '', false);
    triageBacklog(s, id);
    expect(untriagedBacklog(s, TODAY)).toEqual([]);
    expect(openBacklog(s, TODAY)).toHaveLength(1);
  });

  it('「지금 볼 것」에 과목을 함께 줄 수 있다', () => {
    const s = st();
    const id = addBacklog(s, '', '', 'x', '', false);
    triageBacklog(s, id, 's1', '회로이론');
    expect(s.backlog[0]).toMatchObject({ sid: 's1', name: '회로이론', triaged: true });
  });
});

describe('스누즈 — 미루기도 판정이다', () => {
  it('그 날짜까지 숨고, 지나면 스스로 돌아온다', () => {
    const s = st();
    const id = addBacklog(s, '', '', 'x', '', false);
    snoozeBacklog(s, id, '2026-08-29');
    expect(openBacklog(s, TODAY)).toEqual([]);
    expect(openBacklog(s, '2026-08-29')).toHaveLength(1);
  });

  it('⚠⚠ 미루기가 판정도 끝낸다 — 안 그러면 돌아올 때마다 다시 미분류다', () => {
    const s = st();
    const id = addBacklog(s, '', '', 'x', '', false);
    snoozeBacklog(s, id, '2026-08-29');
    expect(untriagedBacklog(s, '2026-08-29')).toEqual([]);
  });

  it('⚠ 날짜를 안 주는 호출부는 종전 그대로다 — 「열린 것의 총량」은 스누즈와 무관하다', () => {
    const s = st();
    const id = addBacklog(s, '', '', 'x', '', false);
    snoozeBacklog(s, id, '2026-12-31');
    expect(openBacklog(s)).toHaveLength(1);
  });
});
