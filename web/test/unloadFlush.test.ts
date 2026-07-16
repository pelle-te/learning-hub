// @vitest-environment jsdom
/* ============================================================
   unloadFlush.test.ts — 언로드 안전망(pagehide·visibilitychange=hidden 동기 flush) 회귀
   — 감사 2026-07-16 ③#10(미테스트였던 데이터 유실 방지 경로) + ②#27(dirty 조건).
   계약: ① 디바운스(400ms) 대기 중 탭이 닫혀도(pagehide) 마지막 편집이 storage에 남는다
        ② visibilitychange=hidden 도 동일 ③ 반복 발화는 멱등(같은 상태 재기록일 뿐 크래시 없음)
        ④ 무편집(dirty 아님)이면 flush 를 건너뛴다 — 탭 전환마다 전체 직렬화·기록·방송으로
           수신 탭 전체 re-boot 를 유발하던 낭비 차단(②#27 · 안전망 목적은 그대로).
============================================================ */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/idb', () => ({ idbMirror: vi.fn(), idbLoad: vi.fn(async () => null) }));

import { KEY } from '@/lib/persistence';
import { useApp } from '@/store/useApp';

const readSaved = () => JSON.parse(localStorage.getItem(KEY)!) as { moduleLen: number };
const fireHidden = () => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  localStorage.clear();
});

describe('언로드 안전망 — 대기 편집 동기 flush(③#10)', () => {
  it('pagehide: 디바운스 대기 중 편집이 즉시 storage에 영속된다(400ms 안 기다림)', () => {
    useApp.getState().mutate((s) => {
      s.moduleLen = 111; // 타이머 시작 — 아직 미저장
    });
    expect(localStorage.getItem(KEY)).toBeNull(); // 디바운스 창 안 — 유실 위험 구간
    window.dispatchEvent(new Event('pagehide'));
    expect(readSaved().moduleLen).toBe(111); // 안전망이 동기 flush
  });

  it('visibilitychange=hidden: 동일하게 즉시 flush(모바일 스와이프 종료·앱 전환)', () => {
    useApp.getState().mutate((s) => {
      s.moduleLen = 112;
    });
    fireHidden();
    expect(readSaved().moduleLen).toBe(112);
  });

  it('반복 발화 멱등 — 두 번 발화해도 크래시 없이 같은 최신 상태', () => {
    useApp.getState().mutate((s) => {
      s.moduleLen = 113;
    });
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pagehide'));
    fireHidden();
    expect(readSaved().moduleLen).toBe(113);
  });

  it('무편집(dirty 아님)이면 flush 를 건너뛴다(②#27) — 탭 전환마다 전체 기록·방송 안 함', async () => {
    // 대기 편집을 소진해 깨끗한 상태로 만든다.
    useApp.getState().mutate((s) => {
      s.moduleLen = 114;
    });
    await sleep(500); // 디바운스 소진 — 타이머 없음(dirty 아님)
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    fireHidden();
    window.dispatchEvent(new Event('pagehide'));
    expect(spy).not.toHaveBeenCalled(); // 무편집 언로드 신호 — 기록 0(직렬화·방송 낭비 차단)
    spy.mockRestore();
    // dirty 로 돌아오면 다시 flush 된다(안전망 유지 확인).
    useApp.getState().mutate((s) => {
      s.moduleLen = 115;
    });
    fireHidden();
    expect(readSaved().moduleLen).toBe(115);
  });
});
