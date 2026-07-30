/* ============================================================
   LiveRegion — **미리 서 있는** 스크린리더 공지 자리(H22 · 2026-07-30 `/감사 근본`).

   ## 왜 이게 컴포넌트여야 했나

   `shell/toast` 는 이 관용구를 이미 정확히 구현하고 그 근거까지 적어 뒀다:

   > 라이브 리전은 **텍스트가 바뀌기 전에 DOM 에 있어야** 한다. 토스트 노드에 롤을 달면
   > 리전과 텍스트가 동시에 삽입돼 AT 에 따라 공지가 통째로 씹힌다.

   그런데 그 통찰이 **토스트 밖에서 전량 재발**해 있었다. `SyncLedger`(`if (!line) return null`) ·
   `OnlineStatus`(`if (online) return null`) · `Review` 의 AI 결과/오류(`{ai && …}`)가 전부
   **롤을 내용과 함께 삽입**한다 — 즉 이 앱에서 가장 중요한 상태 변화들이 스크린리더에
   **영원히 무음**이었다. `OnlineStatus` 는 더 나쁘다: 복귀는 노드가 사라질 뿐이라 "돌아왔다"는
   사실을 알릴 자리가 **아예 없었다**.

   ## 규약 — 보이는 것과 알리는 것을 가른다

   화면에 그리는 노드는 그대로 조건부로 두고(레이아웃이 흔들리면 안 된다), **공지는 항상
   마운트된 sr-only 리전**이 맡는다. 그래서 이 컴포넌트는 `message` 가 빈 문자열이어도 렌더된다 —
   그게 존재 이유다. 조건부로 감싸면 고치기 전으로 되돌아간다.

   ⚠ `assertive` 는 **사용자가 하던 일을 끊어도 되는 것**에만(오류·차단). 상태 갱신은 polite 다 —
   토스트가 두 리전을 노드 단위로 가른 것과 같은 판단이고, 섞으면 politeness 가 서로를 삼킨다.
============================================================ */

export default function LiveRegion({
  message,
  assertive = false,
}: {
  /** 공지할 문장. 빈 문자열이면 아무것도 안 읽는다(리전 자체는 남는다 — 위 규약). */
  message: string;
  /** 하던 일을 끊어도 되는 소식인가(오류·차단). 기본은 polite. */
  assertive?: boolean;
}): React.JSX.Element {
  return (
    <div className="sr-only" role={assertive ? 'alert' : 'status'} aria-live={assertive ? 'assertive' : 'polite'}>
      {message}
    </div>
  );
}
