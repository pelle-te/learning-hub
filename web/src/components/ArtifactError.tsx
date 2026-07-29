/* ============================================================
   ArtifactError — 백엔드는 살아 있으나 /api/artifact 쿼리가 실패(500·깨진 JSON)한 상태를
   '미수집'과 구분해 노출하는 빈상태. reads·markets가 주석까지 복제하던 동일 블록 수렴(SR-9, N-5 산물).
============================================================ */
import EmptyState from './EmptyState';
import { Button } from './ui';

export default function ArtifactError({
  label,
  detail,
  onRetry,
}: {
  label: string; // 무엇을(예: "지문을" · "증시 데이터를")
  detail?: string; // 오류 메시지(있으면 뒤에 붙임)
  onRetry: () => void;
}) {
  return (
    <EmptyState
      glyph="⚠️"
      title={`${label} 불러오지 못했어요`}
      desc={<>워크스페이스는 연결됐지만 응답에 문제가 있어요{detail ? ` — ${detail}` : '.'}</>}
      next={
        <Button variant="primary" onClick={onRetry}>
          다시 시도
        </Button>
      }
    />
  );
}
