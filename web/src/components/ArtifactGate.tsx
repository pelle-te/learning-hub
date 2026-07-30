/* ============================================================
   ArtifactGate — 수집형 탭의 오프라인/미수집 빈 상태 공용 분기.
   (워크스페이스 미설정 → 설정 안내 / 미수집 → 수집 시작 버튼) — reads/markets가 공유.
   로딩 표시는 탭마다 형상이 달라(스켈레톤 등) 호출부에 남긴다.

   ⚠ **여기가 `next` 필수화의 구멍이 실제로 샌 곳이었다**(E17 · 2026-07-30). `onRetry` 가 없으면
   `next={undefined}` 를 넘겼고, `ReactNode` 가 `undefined` 를 포함해서 그게 **타입 통과**였다 →
   워크스페이스 미설정 화면이 다음 행동 없이 렌더됐다. W5-1 이 없애려던 막다른 빈 상태가
   W5-1 의 컴포넌트 안에 남아 있었던 셈이다. `State.StateNext` 가 이제 타입으로 막는다.
   ⚠ `onRetry` 가 없는 호출부는 **거짓말을 하지 않는 종착 문구**를 받는다 — "다시 확인" 버튼이
   없다는 것은 이 화면이 스스로 재프로브할 수단이 없다는 뜻이므로, 사용자가 갈 곳(설정 탭)을
   글로 알려 주는 것이 정확하다.
============================================================ */
import type { ReactNode } from 'react';
import State from './State';
import { Button } from './ui';
import { WORKSPACE_UNSET } from '@/lib/artifactState';

export default function ArtifactGate({
  online,
  glyph,
  offlineDesc,
  emptyTitle,
  emptyDesc,
  collecting,
  onCollect,
  collectLabel,
  onRetry,
  collectError,
}: {
  online: boolean;
  glyph: string;
  offlineDesc: ReactNode;
  emptyTitle: string;
  emptyDesc: ReactNode;
  collecting: boolean;
  onCollect: () => void;
  collectLabel: string;
  /* 오프라인 재확인 — 워크스페이스를 설정한 뒤 페이지를 떠나지 않고 즉시 재프로브(ping+아티팩트 refetch). */
  onRetry?: () => void;
  /** 마지막(조용한) 자동 수집 실패 사유 — 있으면 빈 상태에 한 줄 덧붙인다(H23). */
  collectError?: string | null;
}) {
  if (!online)
    return (
      <State
        glyph={glyph}
        title={WORKSPACE_UNSET}
        desc={offlineDesc}
        next={
          onRetry ? (
            <Button variant="primary" onClick={onRetry}>
              다시 확인
            </Button>
          ) : (
            { terminal: '설정 탭에서 워크스페이스 폴더를 지정하면 이 화면이 채워져요.' }
          )
        }
      />
    );
  return (
    <State
      glyph={glyph}
      title={emptyTitle}
      /* ⚠ **"안 받았다"와 "받으려다 실패했다"를 구분해 말한다(H23).** 자동 수집은 조용히
         돌므로(`useAutoCollect` → `collect(true)`) 실패해도 토스트가 없고, 그러면 이 화면이
         *아직 수집 안 됨* 으로 보인다 — 두 상태의 처방이 다른데 화면이 같았다. 토스트를
         되살리는 대신(그건 소음이다) 이미 여기 있는 문장에 한 줄을 얹는다. */
      desc={
        collectError ? (
          <>
            {emptyDesc}
            <br />
            <b className="text-bad">마지막 자동 수집이 실패했어요</b> — {collectError}
          </>
        ) : (
          emptyDesc
        )
      }
      next={
        <Button variant="primary" onClick={onCollect} disabled={collecting}>
          {collecting ? (
            <>
              <span className="ds-spin" /> 수집 중…
            </>
          ) : (
            collectLabel
          )}
        </Button>
      }
    />
  );
}
