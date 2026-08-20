/* ============================================================
   StorageGuard.tsx — 저장소 내구성 부팅 훅(0단계-E ①② · UI 없음).
   ① persist() 승격 요청 — best-effort 등급이면 브라우저가 디스크 압박 시 앱 데이터와
      IDB 미러를 *함께* 축출할 수 있다(같은 오리진 → 복구층이 동시 증발).
   ② estimate() 80% 초과 시 1회 경고 — 5MB 절벽에 부딪히기 *전에* 내보내기를 유도한다.
   BootRecovery와 분리한 이유: 저기는 "부팅이 기본값으로 떨어졌을 때만" 도는 계약이라
   정상 부팅에서 즉시 return한다. 내구성은 매 정상 부팅에 확인해야 한다.
============================================================ */
import { useEffect } from 'react';
import { ensureDurableStorage, isQuotaTight, fmtBytes } from '@/lib/durability';
import { installCloseGuard, isTauri, onShellQuit, shellQuit } from '@/lib/tauri';
import { useUI } from '@/store/useUI';
import { whenSettled, waitForMergeWindow } from '@/lib/db/write';
import { installSyncTriggers } from '@/store/syncController';
import { useApp } from '@/store/useApp';
import { exportJSON, toast } from '@/shell';

export default function StorageGuard() {
  /* 창 닫기 가드(2단계-C) — 셸에서만. 디바운스 대기 중 창을 닫으면 동기 localStorage 는
     `pagehide` 로 지켜지지만 **비동기 SQL 쓰기는 잘린다**(트랙 B 실측). 닫기를 잠깐 보류하고
     지금 저장 → SQL 왕복 완료까지 기다린 뒤 창을 파괴한다.
     여기 두는 이유: StorageGuard 가 이미 "매 정상 부팅 1회 도는 내구성 관심사"라 결이 같다. */
  useEffect(() => {
    let un: (() => void) | undefined;
    let dead = false;
    void installCloseGuard(
      async () => {
        useApp.getState().flushNow(); // 디바운스 건너뛰고 동기 정본부터 확정
        /* ⚠⚠ **병합창에 닫으면 그 flush 는 아무것도 안 쓴다(H9 · 2026-07-31 `/감사 근본`).**
         `writeAndVerify` 가 `deferred:true` 로 즉시 반환하고 400ms 타이머를 재예약하는데,
         `whenSettled()` 는 그 링크가 이미 resolve 됐으므로 **곧바로 통과**하고 창이 파괴된다 —
         타이머는 영원히 안 뛴다. 즉 이 가드의 존재 이유(비동기 SQL 쓰기가 잘리는 것을 막는다)가
         정확히 이 경우에만 무력화돼 있었다. 창이 닫히길 짧게 기다렸다 **한 번 더** 확정한다.
         ⚠ 상한이 계약이다(1.2초 < 바깥 가드 3초) — 무한 대기는 "앱이 안 닫힌다"의 로컬판이다. */
        if (await waitForMergeWindow()) useApp.getState().flushNow();
        await whenSettled(); // 그 flush 가 띄운 SQL 쓰기까지 대기
        /* T-3 — 상주 모드면 파괴 대신 숨긴다. **flush 는 위에서 똑같이 끝냈다**: 숨긴 뒤
         강제 종료·크래시가 나면 그 쓰기는 영영 없다(달라지는 것은 마지막 한 줄뿐). */
      },
      3000,
      () => useUI.getState().ui.trayResident,
    ).then((u) => {
      // 언마운트가 구독 완료보다 빠를 수 있다 — 그때 바로 떼지 않으면 리스너가 샌다(L12-4).
      if (dead) u();
      else un = u;
    });
    return () => {
      dead = true;
      un?.();
    };
  }, []);

  /* T-3 — 트레이 `종료`. 상주 모드에서는 창이 숨어 있어 `onCloseRequested` 가 영영 안 오므로
     **이 경로가 유일한 정상 종료**다. 위 가드와 같은 순서로 확정한 뒤 스스로 끈다.
     ⚠ Rust 는 3초 뒤 폴백으로 끄고 그건 저장을 기다려 주지 않는다(`tray.rs`) — 그 값보다
       늦으면 여기서 하는 일이 무의미해지므로, 위 가드와 **같은 상한**을 쓴다. */
  useEffect(() => {
    let un: (() => void) | undefined;
    let dead = false;
    void onShellQuit(() => {
      void (async () => {
        useApp.getState().flushNow();
        if (await waitForMergeWindow()) useApp.getState().flushNow();
        await whenSettled();
        await shellQuit();
      })();
    }).then((u) => {
      if (dead) u();
      else un = u;
    });
    return () => {
      dead = true;
      un?.();
    };
  }, []);

  /* 클라우드 동기화(C-5) — 구동은 **공용 컨트롤러**가 소유한다(`store/syncController`).
     데스크톱은 폰과 같은 이벤트 트리거(복귀·편집후)를 쓴다. 클라우드에 연결돼 있지
     않으면 `syncOnce` 가 즉시 `disconnected` 로 빠지므로 **연결 전에는 비용이 0**이다.

     ⚠ 트리거를 여기서 조립하는 이유: 이 컴포넌트가 이미 "저장 수명주기"를 소유하고, 병합
     결과를 메모리에 싣는 `loadState` 는 store 층 몫이기 때문이다(`lib/` 은 zustand 를 모른다).
     그 적용은 이제 컨트롤러의 `runSync` 안에 있다.

     ⚠ `pagehide` push 는 켜지 않는다 — 데스크톱 창 닫기는 아래 `installCloseGuard` 가 로컬을
     확정하고 다음 부팅이 재개하므로, 닫히는 중에 네트워크 동기화를 띄우면 창 파괴에 잘려 낭비다. */
  useEffect(() => {
    return installSyncTriggers({
      /* ⚠⚠ **5분 폴백 폴링을 은퇴시켰다(W24 · 2026-07-31).** 값이 나오는 유일한 구간은 "PC 를
         열어 둔 채 폰에서 편집하고 다시 PC 화면을 보는 순간"인데, 실측은 **켜 놓고 살지 않는다**
         였다(항상-켜짐 전제 자체가 틀렸다). 그리고 그 구간은 `visibilitychange` 로 원리적으로
         안 잡힌다 — 보이는 채로 포커스만 잃는 것은 `document.hidden` 을 안 바꾼다.
         → 컨트롤러가 **`window.focus`(= 이 앱으로 돌아왔다)** 를 최소 간격과 함께 듣는다.
         구간을 이벤트로 정확히 덮으므로 5분마다 깨어나는 타이머가 필요 없다. */
      onEdit: true,
      onPagehide: false,
      /* ⚠⚠ **데스크톱 실시간(Q-28 · 2026-08-02).** 종전엔 여기가 꺼져 있었고 그 근거는 CSP 였다 —
         웹뷰의 `WebSocket` 은 `connect-src 'self' ipc:` 를 못 넘는다. 그래서 PC 는 폰에서 한 편집을
         **창으로 돌아올 때까지** 못 봤다(`focus` 최소 간격 5분). 소켓이 Rust 로 내려가 그 제약이
         사라졌으므로 켠다 — 전송만 갈리고 백오프·안정 판정은 폰과 **같은 한 벌**이다
         (`lib/cloud/live.ts` 머리주석 §전송이 둘, 정책은 하나).
         ⚠ 셸에서만 켠다. 브라우저 dev·트랙 A 는 클라우드에 연결돼 있지 않은 것이 기본이고,
           거기서 실시간을 켜면 시각 베이스라인이 네트워크 상태에 의존하게 된다. */
      live: isTauri(),
      /* ⚠ **산출물 미러(설계 §13-8)가 P10 W4 에서 빠졌다**(2026-08-07). 미러 대상은 `reads`·
         `markets` 둘뿐이었고(그 표의 판정은 "폰에 화면이 있는가"), 둘 다 `survey/` 로 갔다 —
         즉 폰이 볼 산출물이 0이 됐다. `beforeSync` 훅 자체는 컨트롤러에 남아 있으므로 폰 화면이
         생기면 다시 붙이면 된다. */
      /* 실패는 컨트롤러가 조용히 넘긴다. 단 `blocked`(기기 폐기·한도 소진)는 사용자가 조치해야
         풀리므로 알린다. */
      onResult: (r) => {
        // ⚠ 축이 둘이다 — push 축(`push.status`)과 pull 축(바깥 `status`). H5 주석 참조.
        const why =
          r.push?.status === 'blocked' ? (r.push.error ?? '') : r.status === 'blocked' ? (r.error ?? '') : null;
        if (why !== null) {
          toast(`클라우드 동기화가 중단됐어요 — ${why}`, 'warn', 12000);
        }
      },
    });
  }, []);

  useEffect(() => {
    let alive = true;
    void ensureDurableStorage().then((r) => {
      if (!alive) return;
      // 승격 실패는 조용히 넘어간다 — 사용자가 할 수 있는 일이 없고(브라우저 참여도 휴리스틱),
      // 매 부팅 경고하면 무시하는 법만 학습시킨다. 실제 행동이 필요한 건 쿼터 압박뿐.
      if (!isQuotaTight(r)) return;
      const pct = Math.round((r.ratio ?? 0) * 100);
      const detail = r.usage != null && r.quota != null ? ` (${fmtBytes(r.usage)}/${fmtBytes(r.quota)})` : '';
      toast(`저장공간이 ${pct}% 찼어요${detail} — 지금 내보내기로 백업해 두세요.`, 'warn', 12000, {
        label: '내보내기',
        onAction: () => exportJSON(),
      });
    });
    return () => {
      alive = false;
    };
  }, []);
  return null;
}
