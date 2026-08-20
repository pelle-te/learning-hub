/* ============================================================
   IcsFeedPanel — **N-7 살아 있는 ics 구독 피드**(W8 · 2026-08-07).

   ## 왜 1회 내보내기가 있는데 또 만드나

   `.ics` 내보내기는 이미 있고 **아무도 두 번 안 한다** — 계획은 매일 바뀌고 파일은 안 바뀐다.
   그래서 캘린더에 들어간 순간부터 그것은 *과거의 계획*이다(앱은 그 사실을 `planSignature` 로
   이미 알면서 재내보내기를 사람에게 시켰다). 구독은 캘린더 앱이 **주기적으로 다시 가져간다**.

   ## ⚠ 여기가 그 집인 이유

   이 패널은 **밖으로 나가는 읽기 통로**를 연다(URL 을 아는 사람은 인증 없이 읽는다). 그 성질은
   볼트·Anki 연결과 같은 축이라 연동 현황이 집이고, 무엇보다 **폐기 버튼이 그 옆에 있어야** 한다.

   ⚠ 값과 판정은 `lib/icsFeed` 가 소유한다 — 여기서 하는 일은 발행·폐기·복사뿐이다.
   ⚠ 클라우드 연결이 없으면 URL 을 만들 수 없다(피드를 나르는 것이 그 서버다) → 그 사실을 말한다.
============================================================ */
import { useEffect, useState } from 'react';
import { useApp } from '@/store/useApp';
import { toast } from '@/shell';
import { Button, Pill } from '@/components/ui';
import { readCloudConfig } from '@/lib/cloud/client';
import { icsFeedStale, icsFeedUrl, loadIcsFeed, publishIcsFeed, revokeIcsFeed, type IcsFeed } from '@/lib/icsFeed';

export default function IcsFeedPanel() {
  const state = useApp((s) => s.state);
  const [feed, setFeed] = useState<IcsFeed | null>(() => loadIcsFeed());
  const [origin, setOrigin] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void readCloudConfig().then((cfg) => {
      if (alive) setOrigin(cfg?.baseUrl ?? null);
    });
    return () => {
      alive = false;
    };
  }, []);

  const stale = icsFeedStale(feed, state);
  const url = feed?.token && origin ? icsFeedUrl(origin, feed.token) : '';

  const publish = (rotate = false): void => {
    const next = publishIcsFeed(state, { rotate });
    setFeed(next);
    toast(rotate ? '새 주소를 발행했어요 — 옛 주소는 이제 안 열립니다.' : '지금 계획을 발행했어요.', 'ok');
  };
  const revoke = (): void => {
    revokeIcsFeed();
    setFeed(loadIcsFeed());
    toast('구독을 폐기했어요 — 그 주소는 더 이상 열리지 않습니다.', 'info');
  };
  const copy = (): void => {
    void navigator.clipboard.writeText(url).then(
      () => toast('구독 주소를 복사했어요 — 캘린더 앱의 "URL로 구독"에 붙여 넣으세요.', 'ok'),
      () => toast('복사하지 못했어요 — 주소를 직접 선택해 복사하세요.', 'warn'),
    );
  };

  return (
    <div className="ds-rule">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="mb-0!">캘린더 구독</h3>
        <span className="ds-tiny text-mut">계획이 바뀌면 다시 발행 — 캘린더가 알아서 가져갑니다</span>
        {feed?.token && (
          <Pill tiny tone={stale ? 'warn' : 'good'}>
            {stale ? '계획이 바뀌었어요' : '최신'}
          </Pill>
        )}
      </div>

      {!origin && (
        /* ⚠ 못 하는 이유를 **한 단계 위**에서 말한다 — 피드를 나르는 것이 클라우드 백엔드다. */
        <p className="ds-tiny text-mut">
          클라우드에 연결하면 구독 주소가 생겨요(설정 → 클라우드 동기화). 피드를 나르는 것이 그 서버입니다.
        </p>
      )}

      {origin && !feed?.token && (
        <Button sm variant="primary" onClick={() => publish()}>
          구독 주소 발행
        </Button>
      )}

      {origin && feed?.token && (
        <>
          {/* ⚠ 주소가 곧 열쇠다 — 그 사실을 숨기지 않는다(공유하면 그 사람도 계획을 본다). */}
          <input
            readOnly
            value={url}
            aria-label="구독 주소"
            className="w-full font-mono text-xs"
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button sm onClick={copy}>
              주소 복사
            </Button>
            <Button sm variant={stale ? 'primary' : 'ghost'} onClick={() => publish()}>
              지금 계획으로 갱신
            </Button>
            <Button sm variant="ghost" onClick={() => publish(true)} title="옛 주소를 무효화하고 새 주소를 만든다">
              주소 재발급
            </Button>
            <Button sm variant="ghost" danger onClick={revoke}>
              폐기
            </Button>
          </div>
          <p className="ds-tiny mt-1.5 mb-0 text-mut">
            이 주소를 아는 사람은 인증 없이 학습 일정을 봅니다(성적·오답·메모는 담기지 않습니다).
          </p>
        </>
      )}
    </div>
  );
}
