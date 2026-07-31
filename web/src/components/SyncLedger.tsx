/* ============================================================
   components/SyncLedger — 동기화 원장 한 줄(그리기만 · E12 · 2026-07-29).

   ## 무엇이 결함이었나

   `PhoneApp` 헤더는 **실패했을 때만** 말했고(UX-B4 가 그걸 고쳤다), 데스크톱은 그 고침을 못
   받았다 — 설정 탭 카드·`blocked` 토스트·레일 충돌 배지 셋으로 흩어져 평상시엔 전부 침묵한다.
   그래서 PC 네트워크가 끊긴 채 반나절 편집해도 신호가 0이고, 폰을 열면 어제 상태라 **같은 걸 또
   입력**하게 된다. 기기를 잇겠다고 만든 기능이 두 번 일하게 만드는 형태다.

   ## 새 데이터가 0 이다

   `syncController.lastSync()` 가 마지막 성공 시각을, `collectOutbox()` 가 대기 건수를 이미 준다.
   없던 것은 **화면에 말하는 자리**뿐이었다.

   ⚠ 판정(`lib/syncLedger.ledgerLine`)과 읽기(`store/useSyncLedger`)는 여기 없다 — 두 기기가
   서로 다른 조건에서 침묵하지 않게 한 곳에 뒀고, `components` 는 store 를 import 할 수 없다.
   여기서 화면마다 달라지는 것은 `className` 뿐이다.
============================================================ */
import LiveRegion from './LiveRegion';
import { ledgerLine, type Ledger } from '@/lib/syncLedger';

export default function SyncLedger({
  led,
  now,
  className = '',
  hideText = false,
}: {
  led: Ledger;
  now: number;
  className?: string;
  /**
   * 보이는 줄만 숨긴다 — **리전은 남는다**(H12 · 2026-07-31 `/감사 근본`).
   *
   * ⚠ 접힌 레일이 이 컴포넌트를 통째로 언마운트하고 있었다. 근거("42px 폭에 문장이 안 들어간다")는
   * **보이는 `<p>`** 에 대해서만 참인데 컴포넌트째로 걷어내는 바람에, 접힘을 쓰는 사용자는
   * "동기화 중단 · 3시간째 실패"를 **시각으로도 스크린리더로도** 못 받았다. 접힘은 영속 설정이라
   * 항구적 상태이고, 이 컴포넌트의 존재 이유(_"두 기기가 서로 다른 조건에서 침묵할 수 없다"_)를
   * 정확히 그 조건에서 뒤집는다.
   */
  hideText?: boolean;
}): React.JSX.Element {
  const line = ledgerLine(led, now);
  /* ⚠ **공지 리전은 항상 서 있다**(H22). 종전엔 `role="status"` 가 이 `<p>` 에 붙어 있었고
     `if (!line) return null` 이라 **리전과 텍스트가 동시에 삽입**됐다 — `shell/toast` 가 자기
     주석에 "그러면 AT 에 따라 공지가 통째로 씹힌다"고 적어 둔 바로 그 형태다. 보이는 줄은
     그대로 조건부로 두고(레이아웃 불변), 알리는 일만 갈라낸다. */
  return (
    <>
      <LiveRegion message={line?.text ?? ''} />
      {line && !hideText ? (
        <p className={`text-xs ${line.warn ? 'text-warn' : 'text-mut'} ${className}`}>{line.text}</p>
      ) : null}
    </>
  );
}
