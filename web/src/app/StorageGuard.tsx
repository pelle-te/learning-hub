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
import { installCloseGuard, isTauri } from '@/lib/tauri';
import { whenSettled } from '@/lib/db/write';
import { installSyncTriggers } from '@/store/syncController';
import { mirrorArtifacts } from '@/lib/artifactMirror';
import { useApp } from '@/store/useApp';
import { ui, io } from '@/shell';

export default function StorageGuard() {
  /* 창 닫기 가드(2단계-C) — 셸에서만. 디바운스 대기 중 창을 닫으면 동기 localStorage 는
     `pagehide` 로 지켜지지만 **비동기 SQL 쓰기는 잘린다**(트랙 B 실측). 닫기를 잠깐 보류하고
     지금 저장 → SQL 왕복 완료까지 기다린 뒤 창을 파괴한다.
     여기 두는 이유: StorageGuard 가 이미 "매 정상 부팅 1회 도는 내구성 관심사"라 결이 같다. */
  useEffect(() => {
    let un: (() => void) | undefined;
    void installCloseGuard(async () => {
      useApp.getState().flushNow(); // 디바운스 건너뛰고 동기 정본부터 확정
      await whenSettled(); // 그 flush 가 띄운 SQL 쓰기까지 대기
    }).then((u) => {
      un = u;
    });
    return () => un?.();
  }, []);

  /* 클라우드 동기화(C-5) — 구동은 **공용 컨트롤러**가 소유한다(`store/syncController`).
     데스크톱은 폰과 같은 이벤트 트리거(복귀·편집후)에 더해 **5분 폴백 폴링**을 켠다(항상-켜짐
     환경이라 화면을 열어 둔 채 다른 기기의 변경을 받는 경우가 있다). 클라우드에 연결돼 있지
     않으면 `syncOnce` 가 즉시 `disconnected` 로 빠지므로 **연결 전에는 비용이 0**이다.

     ⚠ 트리거를 여기서 조립하는 이유: 이 컴포넌트가 이미 "저장 수명주기"를 소유하고, 병합
     결과를 메모리에 싣는 `loadState` 는 store 층 몫이기 때문이다(`lib/` 은 zustand 를 모른다).
     그 적용은 이제 컨트롤러의 `runSync` 안에 있다.

     ⚠ `pagehide` push 는 켜지 않는다 — 데스크톱 창 닫기는 아래 `installCloseGuard` 가 로컬을
     확정하고 다음 부팅이 재개하므로, 닫히는 중에 네트워크 동기화를 띄우면 창 파괴에 잘려 낭비다. */
  useEffect(() => {
    return installSyncTriggers({
      pollMs: 5 * 60 * 1000,
      onEdit: true,
      onPagehide: false,
      /* 산출물 미러(설계 §13-8) — **동기화보다 먼저**. 그래야 이번 사이클에 함께 올라간다.
         셸 전용이다(원본 파일이 PC 에만 있다). 내용이 안 바뀌었으면 스탬프를 안 찍으므로 유선 0. */
      beforeSync: isTauri() ? () => mirrorArtifacts().then(() => undefined) : undefined,
      /* 실패는 컨트롤러가 조용히 넘긴다. 단 `blocked`(기기 폐기·한도 소진)는 사용자가 조치해야
         풀리므로 알린다. */
      onResult: (r) => {
        if (r.push?.status === 'blocked') {
          ui.toast(`클라우드 동기화가 중단됐어요 — ${r.push.error ?? ''}`, 'warn', 12000);
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
      ui.toast(`저장공간이 ${pct}% 찼어요${detail} — 지금 내보내기로 백업해 두세요.`, 'warn', 12000, {
        label: '내보내기',
        onAction: () => io.exportJSON(),
      });
    });
    return () => {
      alive = false;
    };
  }, []);
  return null;
}
