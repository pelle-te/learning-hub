/* ============================================================
   ExportBackup — **폰이 자기 원장을 밖으로 내보내는 유일한 문**(I033 · 2026-08-22 발상 축).

   ## 왜 생겼나

   폰은 자기 SQLite(OPFS)에 `route_visits` 를 쌓는다 — `via:'phone'` 한 칸은 H23 이 *"2주 뒤의
   0 은 「폰 안 씀」이 아니라 「안 쟀음」이었다"* 를 고치며 만든 것이다. 그런데 그 표는
   **동기화 대상이 아니고**(설계다 — 기기별 관측을 합치면 판정이 성립하지 않는다) 폰에는
   내보내기가 **없었다.** 결과: 폰 원장은 쌓이기만 하고 **판정자에게 도달하지 않는다.**

   H23 이 고친 것과 정확히 같은 형태가 한 층 위에서 재발해 있었던 셈이다 — 계측은 붙었는데
   그 값이 결정에 닿는 경로가 없다. 그리고 그 도달 불가에 매달린 항목이 둘이다(I012 시험 직후
   회수 시트 · 「폰 은퇴」 계열 · 리포트 §5-C 가 이 실측을 **둘의 공통 선행**으로 판정).

   ## ⚠ 앱 데이터를 덮으라는 뜻이 아니다

   내보내는 것은 `backupPayload`(= SSOT) 전체지만, 데스크톱에서 이 파일로 하려는 일은
   **관측만 합치는 것**이다(설정의 「다른 기기 관측 합치기»). 통째 가져오기는 앱 상태를
   교체하는 경로라 폰↔PC 사이에 쓰면 안 된다 — 그쪽 정본은 클라우드 동기화다.

   ⚠ 페이로드를 여기서 조립하지 않는다. `lib/backup` 이 SSOT 이고, 폰이 자기 것을 따로
   조립하면 사이드카가 늘 때 한쪽에만 들어간다(그 함수가 애초에 생긴 이유).
============================================================ */
import { useState } from 'react';
import { useApp } from '@/store/useApp';
import { backupPayload } from '@/lib/backup';

export default function ExportBackup(): React.JSX.Element {
  const state = useApp((s) => s.state);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const run = (): void => {
    setBusy(true);
    void backupPayload(state)
      .then((p) => {
        const blob = new Blob([JSON.stringify(p)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `러닝허브_폰_${state.startDate}.json`;
        a.click();
        /* ⚠ 즉시 revoke 하면 일부 모바일 브라우저가 다운로드를 시작하기 전에 URL 이 죽는다.
           한 틱 뒤에 놓아 준다 — 안 놓으면 이 탭이 사는 동안 블롭이 메모리에 남는다. */
        setTimeout(() => URL.revokeObjectURL(url), 0);
        setDone('내보냈어요 — PC 설정 › 방문 원장에서 「다른 기기 관측 합치기」로 읽어 주세요.');
      })
      .catch(() => setDone('내보내기 실패 — 저장소를 읽지 못했어요.'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="px-3 pb-3 text-sm text-mut">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="min-h-11 rounded-md border border-line px-3 enabled:hover:border-acc"
      >
        {busy ? '만드는 중…' : '이 폰의 기록 내보내기'}
      </button>
      {done && <div className="mt-1">{done}</div>}
    </div>
  );
}
