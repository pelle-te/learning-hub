/* ============================================================
   vaultAnchors.test.ts — 볼트 `reviewed:` 앵커 주입(W2)의 **방향 제약**을 잠근다.

   이 테스트의 요지 한 줄: 볼트 값은 위험을 **올리기만** 해야 한다. 반대로 새면 잊은 챕터가
   큐에서 사라지고 사용자는 "복습 없음"을 정상으로 읽는다 — 조용한 오류의 교과서적 형태라
   사람 눈으로는 절대 안 잡힌다.
============================================================ */
import { afterEach, describe, expect, it } from 'vitest';
import { clearVaultAnchors, setVaultAnchors, vaultAnchorsFrom, vaultAnchorsVersion } from '@/lib/vaultAnchors';
import { chapterReviews } from '@/lib/spacedReview';
import { subjectsFromIndex, type VaultScan } from '@/lib/vault';
import type { Day, ScheduleItem } from '@/lib/types';
import type { AppState } from '@/lib/schema';

const TODAY = '2026-07-31';
const state = (chapters: { name: string; done?: boolean }[]): AppState =>
  ({
    items: [{ id: 'p', name: '회로이론', chapters: chapters.map((c, i) => ({ id: 'c' + i, hours: 2, ...c })) }],
    completions: {},
  }) as unknown as AppState;
const day = (ds: string, items: ScheduleItem[]): Day =>
  ({ ds, date: new Date(ds + 'T00:00:00'), wd: 0, studyMin: 0, used: 0, modLeft: 0, revLeft: 0, items }) as Day;

afterEach(() => clearVaultAnchors());

describe('subjectsFromIndex — 17키 중 버리던 것을 챕터 집계로 올린다', () => {
  it('reviewed 는 챕터 안에서 최댓값(가장 최근), anki_state=stale 은 센다', () => {
    const s = subjectsFromIndex({
      notes: [
        { subject: '회로이론', folder: '회로이론/01 변수', reviewed: '2026-07-01', anki_state: 'ok', prereq_in: 3 },
        { subject: '회로이론', folder: '회로이론/01 변수', reviewed: '2026-07-09', anki_state: 'stale', prereq_in: 8 },
        { subject: '회로이론', folder: '회로이론/02 소자', anki_state: 'none' },
      ],
    });
    const chs = s[0]!.chapters;
    expect(chs[0]!.reviewedRecent).toBe('2026-07-09');
    expect(chs[0]!.ankiStale).toBe(1);
    expect(chs[0]!.prereqIn).toBe(8);
    // 아무 노트도 reviewed 를 안 가지면 ''(= 앵커 없음)이지 오늘이 아니다.
    expect(chs[1]!.reviewedRecent).toBe('');
    expect(s[0]!.reviewedRecent).toBe('2026-07-09');
  });
});

describe('vaultAnchorsFrom — 과목은 매칭 규칙, 챕터는 정확 일치', () => {
  it('앱 챕터명과 볼트 챕터명이 같을 때만 앵커가 생긴다', () => {
    const scan = {
      at: '',
      src: '',
      subjects: subjectsFromIndex({
        notes: [
          { subject: '회로 이론', folder: '회로 이론/01 변수', reviewed: '2026-07-01' },
          { subject: '회로 이론', folder: '회로 이론/99 없는 챕터', reviewed: '2026-07-02' },
        ],
      }),
    } as VaultScan;
    const anchors = vaultAnchorsFrom(scan, state([{ name: '01 변수' }, { name: '02 소자' }]).items);
    expect(anchors.get('p|01 변수')).toBe('2026-07-01'); // 과목은 공백 차이를 흡수(subjectMatch)
    expect(anchors.has('p|02 소자')).toBe(false); // 볼트에 없는 챕터는 앵커도 없다
    expect(anchors.size).toBe(1);
  });
});

describe('chapterReviews — 볼트 앵커는 위험을 올리기만 한다', () => {
  it('앱 앵커가 없는 챕터는 볼트 날짜로 사다리에 올라오고 fromVault 로 표시된다', () => {
    setVaultAnchors(new Map([['p|01 변수', '2026-07-01']])); // 30일 전 → overdue
    const out = chapterReviews(state([{ name: '01 변수' }]), [], TODAY);
    expect(out).toHaveLength(1);
    expect(out[0]!.risk).toBe('overdue');
    expect(out[0]!.fromVault).toBe(true);
  });

  it('⚠ 앱 앵커가 있으면 볼트 값은 **절대 이기지 않는다**(더 최신이어도)', () => {
    setVaultAnchors(new Map([['p|01 변수', TODAY]])); // 볼트가 "오늘 검증됨"이라 말해도
    const days = [day('2026-07-01', [{ type: 'new', sid: 'p', name: '회로이론', min: 120, chapters: ['01 변수'] }])];
    const st = state([{ name: '01 변수' }]);
    (st as unknown as { completions: Record<string, unknown> }).completions = {
      '2026-07-01': { 'p|new': { done: true, min: 120 } },
    };
    const out = chapterReviews(st, days, TODAY);
    expect(out[0]!.lastDs).toBe('2026-07-01'); // 앱 앵커 그대로 = overdue 유지
    expect(out[0]!.risk).toBe('overdue');
    expect(out[0]!.fromVault).toBeUndefined();
  });

  it('끝낸 챕터는 유지 큐 소유라 본 사다리에 주입하지 않는다', () => {
    setVaultAnchors(new Map([['p|01 변수', '2026-07-01']]));
    expect(chapterReviews(state([{ name: '01 변수', done: true }]), [], TODAY)).toHaveLength(0);
  });

  it('미래 날짜는 무시한다(시드·시계 어긋남 방어 — 스캔 경로와 같은 규칙)', () => {
    setVaultAnchors(new Map([['p|01 변수', '2027-01-01']]));
    expect(chapterReviews(state([{ name: '01 변수' }]), [], TODAY)).toHaveLength(0);
  });
});

describe('레지스트리 버전 — 참조-캐시가 갱신을 관측하는 유일한 통로', () => {
  it('내용이 같으면 버전이 안 오르고, 갈리면 오른다', () => {
    const v0 = vaultAnchorsVersion();
    setVaultAnchors(new Map([['p|a', '2026-07-01']]));
    const v1 = vaultAnchorsVersion();
    expect(v1).toBeGreaterThan(v0);
    setVaultAnchors(new Map([['p|a', '2026-07-01']]));
    expect(vaultAnchorsVersion()).toBe(v1); // 같은 내용 → 헛도는 무효화 없음
    setVaultAnchors(new Map([['p|a', '2026-07-02']]));
    expect(vaultAnchorsVersion()).toBeGreaterThan(v1);
  });
});
