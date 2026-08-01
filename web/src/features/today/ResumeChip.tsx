/* ============================================================
   ResumeChip — 다른 기기에서 하던 것으로 이어가는 칩(N-7).

   ⚠ **다른 기기의 커서가 살아 있을 때만 존재한다.** 조건이 안 맞으면 `null` 이라 화면에 자리도
   안 만든다 — 이 앱의 빈 상태 규율(0·평온은 아무것도 안 그린다)과 같은 규칙이고, 실제로도
   대부분의 시간엔 커서가 없다(기기 하나로 쓰거나 6시간이 지났거나).

   ⚠ `components/` 가 아니라 여기 있는 이유는 **레이어 경계**다: 이 칩은 `store` 를 읽는데
   `components → store` 는 금지 방향이라 린트가 error 로 막는다(절대규칙 #2). 폰은 이 파일을
   공유하지 않고 자기 화면 문법으로 따로 그린다(C-6 의 "lib 만 공유" 규율 그대로).
   ⚠ 시각은 마운트 시 한 번만 읽는다 — 렌더 중 `Date.now()` 는 순수성 린트가 막고, 커서의
   6시간 TTL 은 초 단위 정확도가 필요 없다.
============================================================ */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { latestResume, resumeDevice, resumeLabel, resumeIndex, RESUME_ROUTE, type ResumeNav } from '@/lib/resume';
import { Icon } from '@/components/Icon';

const CHIP =
  'inline-flex items-center gap-2 rounded-chip border! border-line-acc-pill! bg-tint-acc-9! px-3! py-1.5! text-sm! leading-auto font-bold! text-ink! hover:bg-tint-acc-14! focus-visible:outline-2 focus-visible:outline-acc focus-visible:-outline-offset-2';

export default function ResumeChip() {
  const state = useApp((s) => s.state);
  const navigate = useNavigate();
  const [now] = useState(() => Date.now());
  const hit = latestResume(state, resumeDevice(), now);
  if (!hit) return null;
  /* 진행 인덱스를 **내비 state 로 실어 보낸다** — 착지 화면이 커서를 스스로 읽으면 레일·⌘K 로
     그냥 연 사람까지 7번째 카드에서 시작한다. 이어하기는 누른 사람의 의도다.
     ⚠ 이 칩이 `(7/12)` 를 약속하는 동안 러너는 언제나 0 에서 열렸다 — 이 기능이 막으려던
     중복 학습을 기능이 보장하던 자리다. */
  const go = (): void => {
    const at = resumeIndex(hit.cur);
    navigate(RESUME_ROUTE[hit.cur.kind], at === null ? undefined : { state: { resumeAt: at } satisfies ResumeNav });
  };
  return (
    <button type="button" className={CHIP} onClick={go} title="다른 기기에서 하던 것을 이어서">
      <Icon name="arrowForward" />
      {resumeLabel(hit.cur)}
    </button>
  );
}
