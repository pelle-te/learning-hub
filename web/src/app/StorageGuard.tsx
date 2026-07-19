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
import { installCloseGuard } from '@/lib/tauri';
import { whenSettled } from '@/lib/db/write';
import { syncOnce } from '@/lib/cloud/run';
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

  /* 클라우드 동기화(C-5) — 부팅 1회 + 주기적으로. 클라우드에 연결돼 있지 않으면
     `syncOnce` 가 즉시 `disconnected` 로 빠지므로 **연결 전에는 비용이 0**이다.

     ⚠ 여기 두는 이유: 이 컴포넌트가 이미 "저장 수명주기"를 소유하고, `loadState` 를 부를
     위치가 필요하기 때문이다 — `lib/` 은 zustand 를 모른다(I2). 병합 결과를 메모리에
     싣는 것이 **이 층의 책임**이고, 안 하면 낡은 메모리가 다음 flush 에서 병합을 덮는다
     (0단계-E 에서 물린 *낡은 메모리가 복원본을 덮는다* 그 자체).

     ⚠ 주기는 보수적으로 잡는다(5분). Workers 무료 플랜은 **일일 요청 한도**가 있고
     (VM 엔 없던 축), 공격적으로 잡으면 한도가 먼저 터진다 — 설계서 §9-3b 의 새 위험. */
  useEffect(() => {
    let alive = true;
    const tick = (): void => {
      void syncOnce().then((r) => {
        if (!alive) return;
        // 병합된 것이 있으면 메모리에 싣는다. 없으면 건드리지 않는다(불필요한 재렌더 방지).
        if (r.state) useApp.getState().loadState(r.state);
        /* 실패는 조용히 넘긴다 — 로컬은 멀쩡히 동작하고 다음 시도가 재개한다.
           ⚠ 단 `blocked`(기기 폐기·한도 소진)는 사용자가 조치해야 풀리므로 알린다. */
        if (r.push?.status === 'blocked') {
          ui.toast(`클라우드 동기화가 중단됐어요 — ${r.push.error ?? ''}`, 'warn', 12000);
        }
      });
    };
    tick();
    const id = setInterval(tick, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
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
