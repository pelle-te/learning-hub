/* ============================================================
   ArtifactGate — 수집형 탭의 오프라인/미수집 빈 상태 공용 분기.
   (워크스페이스 미설정 → 설정 안내 / 미수집 → 수집 시작 버튼) — reads/markets가 공유.
   로딩 표시는 탭마다 형상이 달라(스켈레톤 등) 호출부에 남긴다.
============================================================ */
import type { ReactNode } from 'react';
import EmptyState from './EmptyState';
import { Button } from './ui';

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
}) {
  if (!online)
    return (
      <EmptyState
        glyph={glyph}
        title="워크스페이스가 설정되지 않았어요"
        desc={offlineDesc}
        actions={
          onRetry ? (
            <Button variant="primary" onClick={onRetry}>
              다시 확인
            </Button>
          ) : undefined
        }
      />
    );
  return (
    <EmptyState
      glyph={glyph}
      title={emptyTitle}
      desc={emptyDesc}
      actions={
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
