/* ============================================================
   UpdateCard — 앱 업데이트(2026-07-25).

   ## 왜 생겼나 — **관측의 짝**

   같은 감사에서 텔레메트리(`lib/telemetry.ts`)를 넣어 "결함을 알게 되는" 경로를 만들었다.
   그런데 종전 배포 경로는 **NSIS 인스톨러 수동 재설치뿐**이었다. 알게 됐는데 전달할 수
   없으면 관측은 절반만 값을 낸다. 이 카드가 나머지 절반이다.

   ## ⚠ 자동으로 받지도 설치하지도 않는다 — 그것이 설계다

   이 앱은 **학습 세션 중에 켜져 있는 물건**이다. 집중 타이머가 돌고, 블록이 진행 중이고,
   3문장 요약을 쓰다 만 상태일 수 있다. 그 상황에서 앱이 스스로 재시작하는 것은 이 앱에서
   가장 나쁜 실패 모드다. 그래서:

   · 확인은 **사용자가 누를 때만** 한다(부팅 시 자동 확인도 안 한다 — 배지로 재촉하지 않는다).
   · 설치는 확인과 **별도의 두 번째 클릭**이고, 그 사이에 릴리스 노트를 보여 준다.
   · 설치 직전에 "지금 재시작된다"를 명시한다.

   ## ⚠ 셸 전용

   브라우저(dev·트랙 A)와 폰에는 업데이터가 없다 — 폰은 서비스워커가, 브라우저는 새로고침이
   그 역할을 한다. `WorkspaceCard`·`CloudCard` 와 같은 판단으로 렌더하지 않는다.
============================================================ */
import { useCallback, useState } from 'react';
import { checkUpdate, installUpdate, isTauri, type UpdateInfo } from '@/lib/tauri';
import { readCloudConfig, updateManifestUrl } from '@/lib/cloud/client';
import { Button } from '@/components/ui';
import { settleBeforeExit } from '@/store/settleBeforeExit';
import { confirmLossy, toast } from '@/shell';

/* ⚠ 엔드포인트를 **매번 설정에서 읽는다**(C3). 빌드 시점 상수가 아닌 이유: 배포처가 사용자
   자신의 Workers 오리진이라 사람마다 다르다. 근거는 `updater.rs` 머리주석이 SSOT. */
const endpoint = async (): Promise<string | undefined> => updateManifestUrl(await readCloudConfig());

export default function UpdateCard() {
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<UpdateInfo | null>(null);

  const onCheck = useCallback(async () => {
    setBusy(true);
    try {
      const r = await checkUpdate(await endpoint());
      setInfo(r);
      if (!r.available) toast(`최신 버전입니다 (${r.current})`);
    } catch (e) {
      /* ⚠ 실패를 삼키지 않는다 — "확인했는데 없음"과 "확인 못 함"은 사용자에게 다른 사실이다.
         엔드포인트 미설정·네트워크 없음이 여기로 온다(`updater.rs` 가 Err 로 올리는 이유).
         ⚠⚠ **톤을 명시한다**(U005 · 2026-08-21 ux 축). `toast` 의 두 번째 인자 기본값은 `'ok'`
         라, 톤을 생략한 이 줄은 세 줄 위 주석이 금지한 바로 그것 — 실패를 **초록 ✓ 아이콘**으로
         띄우고 있었다. 문장만 정직하고 시각 채널은 정반대를 말한 형태다. */
      toast(`업데이트 확인 실패: ${e instanceof Error ? e.message : String(e)}`, 'bad', 8000);
    } finally {
      setBusy(false);
    }
  }, []);

  const onInstall = useCallback(async () => {
    /* ⚠ 확인 대화가 **필수**다. 아래 호출은 정상 경로에서 돌아오지 않는다(프로세스가 갈아탄다) —
       진행 중인 집중 세션·미저장 편집이 있는 사람에게 그건 예고 없는 종료다. */
    /* ⚠⚠ 종전엔 **전역 `window.confirm`** 이었다(Q-13 발견) — 앱 모달이 아니라 OS 대화상자라
       포커스 트랩·`isModalOpen()` 키 게이트 밖이었고, 앱에서 가장 파괴적인 확인 하나만 다른
       시각 언어로 떠 있었다. ②단인 이유: 재시작은 못 되돌리지만 **앱은 다시 뜬다.** */
    if (
      !(await confirmLossy('지금 내려받아 설치하고 앱을 재시작합니다.\n진행 중인 작업이 있으면 먼저 저장하세요.', {
        title: '업데이트 설치',
        okLabel: '설치하고 재시작',
      }))
    )
      return;
    setBusy(true);
    try {
      /* ⚠⚠ **세 번째 종료 경로다**(D004 · 2026-08-21). `installUpdate` 는 `app.restart()` 로
         프로세스를 갈아타는데 그건 `on_close_requested` 를 태우지 않으므로 `StorageGuard` 의
         닫기 가드가 **안 뛴다** — 종전엔 400ms 디바운스에 걸려 있던 편집(쓰기 실패 백오프
         중이면 최대 `PERSIST_RETRY_MAX_MS` 만큼)이 그대로 사라졌다. 위 확인 문구는
         *"진행 중인 작업이 있으면 먼저 저장하세요"* 라고 말하지만 **이 앱에 수동 저장이 없다.**
         가드가 뛰든 안 뛰든 확정을 먼저 하는 것이 옳다. */
      await settleBeforeExit();
      await installUpdate(await endpoint());
    } catch (e) {
      setBusy(false);
      // ⚠ 톤 명시 — 위 `onCheck` 와 같은 이유(U005). 설치 실패는 이 카드에서 가장 무거운 실패다.
      toast(`설치 실패: ${e instanceof Error ? e.message : String(e)}`, 'bad', 10000);
    }
  }, []);

  if (!isTauri()) return null;

  return (
    <section className="ds-rule">
      <h2 className="text-lg! leading-text tracking-price! text-txt">앱 업데이트</h2>
      <p className="ds-tiny m-0 text-mut">
        새 버전이 있는지 확인합니다. <strong>자동으로 설치하지 않습니다</strong> — 학습 중에 앱이 재시작되지 않도록
        확인과 설치를 따로 둡니다.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button sm onClick={() => void onCheck()} disabled={busy}>
          {busy ? '확인 중…' : '업데이트 확인'}
        </Button>
        {info && !info.available && <span className="ds-tiny text-mut">현재 {info.current} · 최신</span>}
      </div>

      {info?.available && (
        <div className="mt-3 rounded-md border border-line-acc bg-acc-soft p-3">
          <p className="m-0 text-sm font-bold text-txt">
            새 버전 {info.version} <span className="font-body text-mut">(현재 {info.current})</span>
          </p>
          {info.notes && (
            /* 릴리스 노트를 보여 주는 것이 "두 번째 클릭"의 값이다 — 무엇이 바뀌는지 모르고
               누르는 설치는 자동 설치와 다르지 않다. `whitespace-pre-wrap` 으로 원문 줄바꿈 유지. */
            <p className="mt-2 mb-0 max-h-40 overflow-y-auto text-sm whitespace-pre-wrap text-mut">{info.notes}</p>
          )}
          <div className="mt-3">
            <Button sm variant="primary" onClick={() => void onInstall()} disabled={busy}>
              {busy ? '설치 중…' : '내려받아 설치하고 재시작'}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
