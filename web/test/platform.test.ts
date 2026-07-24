/* ============================================================
   platform.test.ts — 수정자 키 표기의 플랫폼 파생(lib/platform).
   왜 테스트하는가: 이 값은 **화면 네 곳의 문자열**(상단바 칩·팔레트 푸터·치트시트·아틀라스 안내)을
   한꺼번에 정하고, 틀려도 아무것도 깨지지 않은 채 '존재하지 않는 키'를 가르친다 —
   조용한 종류의 오류라 회귀를 사람 눈에 맡길 수 없다.
============================================================ */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMac } from '@/lib/platform';

/** navigator 를 통째로 갈아끼운다(jsdom 의 navigator 는 읽기 전용 접근자라 stubGlobal 이 필요). */
function withNavigator(nav: unknown): void {
  vi.stubGlobal('navigator', nav);
}

afterEach(() => vi.unstubAllGlobals());

describe('isMac — 수정자 글리프 판정', () => {
  it('userAgentData.platform 을 우선한다(신규 API)', () => {
    withNavigator({ userAgentData: { platform: 'macOS' }, platform: 'Win32' });
    expect(isMac()).toBe(true);
  });

  it('userAgentData 가 없으면 navigator.platform 으로 폴백', () => {
    withNavigator({ platform: 'MacIntel' });
    expect(isMac()).toBe(true);
  });

  it('Windows 는 false — 이 앱의 실제 배포 대상', () => {
    withNavigator({ userAgentData: { platform: 'Windows' }, platform: 'Win32' });
    expect(isMac()).toBe(false);
  });

  it('빈 문자열·미지의 값은 false(Mac 을 추정하지 않는다)', () => {
    withNavigator({ userAgentData: { platform: '' }, platform: '' });
    expect(isMac()).toBe(false);
    withNavigator({ platform: 'Linux x86_64' });
    expect(isMac()).toBe(false);
  });

  it('navigator 자체가 없어도(노드·테스트) 던지지 않는다', () => {
    withNavigator(undefined);
    expect(() => isMac()).not.toThrow();
    expect(isMac()).toBe(false);
  });
});
