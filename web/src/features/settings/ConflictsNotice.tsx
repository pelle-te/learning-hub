/* ============================================================
   ConflictsNotice — 설정 › 동기화 충돌 알림(Phase 4).

   `useConflicts` 가 담은 그림자(다른 기기 편집에 LWW 로 덮인 내 편집)를 사람이 읽을 수 있게
   편다. 충돌이 없으면 아무것도 렌더하지 않는다(설정 화면을 어지럽히지 않는다).

   ## 되살리기 — 관측을 행동으로

   각 행에 '되살리기'가 있다: 덮인 옛 로컬 값을 fresh 스탬프로 다시 써 LWW 로 되찾고 다른
   기기에도 전파한다(`store/syncController.restoreConflict`). 손으로 테이블별 경로를 짜지 않고
   **검증된 병합 기계(`applyPull`)를 합성 배치로 재사용**해 테이블 무관하게 안전하다. 지금 값을
   덮는 실제 변경이므로 confirm 으로 가드한다. '확인'은 되살리지 않고 그 기록만 지운다(옛 값이
   필요 없을 때).
============================================================ */
import { useConflicts, shadowId } from '@/store/useConflicts';
import { restoreConflict } from '@/store/syncController';
import { ui } from '@/shell';
import { Button } from '@/components/ui';
import type { ConflictShadow } from '@/lib/cloud/conflicts';

/** 테이블 → 사람이 읽는 이름(모르는 테이블은 원래 이름 그대로). */
const TBL_LABEL: Record<string, string> = {
  docs: '문서(독후감·노트)',
  completions: '완료 기록',
  settings: '설정',
  ds_map: '일자별 기록',
  records: '학습 기록',
  summaries: '요약',
  week_alloc: '주간 배분',
};

/** 행 값 배열 → 짧은 미리보기 문자열(원시값만이라 안전하게 문자열화). */
function preview(data: unknown[]): string {
  const s = data
    .map((v) => (v == null ? '' : String(v)))
    .join(' · ')
    .trim();
  if (!s) return '(빈 값)';
  return s.length > 90 ? s.slice(0, 90) + '…' : s;
}

/** 감지 시각 → 짧은 한국어 표기(실패 시 빈 문자열). */
function whenLabel(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function ConflictRow({ c }: { c: ConflictShadow }) {
  const dismiss = useConflicts((s) => s.dismiss);
  // 되살리기는 지금 값(다른 기기 편집)을 옛 로컬 값으로 덮는 실제 데이터 변경 → confirm 으로 가드.
  const restore = async (): Promise<void> => {
    const ok = await ui.confirm(
      '이 기기의 옛 값으로 되살릴까요? 지금 값(다른 기기 편집)을 덮어쓰고 다른 기기에도 반영돼요.',
      {
        title: '되살리기',
        okLabel: '되살리기',
      },
    );
    if (ok) await restoreConflict(c);
  };
  return (
    <li className="flex flex-col gap-1 border-l-2 border-l-warn bg-panel2 py-2 pr-2 pl-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-txt">{TBL_LABEL[c.tbl] ?? c.tbl}</span>
        <span className="text-2xs text-mut tabular-nums">{whenLabel(c.detectedAt)}</span>
        <Button sm variant="ghost" className="ml-auto" onClick={() => void restore()}>
          되살리기
        </Button>
        <Button sm variant="ghost" onClick={() => dismiss(shadowId(c))}>
          확인
        </Button>
      </div>
      <div className="text-2xs text-mut">
        내 값 <code className="font-mono text-2xs text-txt">{preview(c.localData)}</code>
      </div>
      <div className="text-2xs text-mut">
        덮은 값 <code className="font-mono text-2xs">{preview(c.remoteData)}</code>
      </div>
    </li>
  );
}

export default function ConflictsNotice() {
  const shadows = useConflicts((s) => s.shadows);
  const dismissAll = useConflicts((s) => s.dismissAll);
  if (!shadows.length) return null;

  return (
    <div className="ds-well">
      <h2>
        동기화 충돌 <span className="ds-muted ds-tiny">— 다른 기기 편집에 덮인 내 편집 {shadows.length}건</span>
      </h2>
      <p className="ds-muted ds-tiny">
        같은 항목을 두 기기에서 고쳐, 늦게 저장된 쪽이 이겼어요. 아래는 <b>덮이기 전 이 기기의 값</b>입니다.
        <b>되살리기</b>를 누르면 이 값으로 되돌리고(다른 기기에도 반영), <b>확인</b>은 기록만 지워요.
      </p>
      <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
        {shadows.map((c) => (
          <ConflictRow key={shadowId(c)} c={c} />
        ))}
      </ul>
      <div className="ds-foot">
        <Button sm onClick={dismissAll}>
          전부 확인
        </Button>
      </div>
    </div>
  );
}
