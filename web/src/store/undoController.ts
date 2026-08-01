/* ============================================================
   store/undoController.ts — 전역 ⌘Z 의 **접합점**(근본① · 2026-08-01).

   `lib/cloud/undo.ts` 가 "무엇을 되돌리나"(pre-image → 합성 배치 → `applyPull`)를 소유하고,
   이 파일은 그 위에서 **언제 부르고 · 결과를 메모리에 어떻게 싣고 · 사용자에게 뭐라 말하나**만
   정한다. `lib/` 은 zustand 를 모르므로(레이어 단방향) 그 접합이 store 층에 있어야 한다 —
   `syncController` 가 병합에 대해 갖는 것과 **같은 이유·같은 모양**이다.

   ## ⚠ 세 줄이 순서 계약의 전부다

   ① **`flushNow()` + `whenSettled()`** — persist 는 400ms 디바운스다. 편집하고 곧바로 ⌘Z 를
      누르면 그 편집은 **아직 쓰이지도 않았고 스택에도 없다.** 확정하지 않고 되돌리면 *그 앞의*
      편집이 사라지고, 뒤이어 디바운스가 깨어나 방금 편집을 쓴다 — 사용자에겐 "엉뚱한 게
      지워졌다"로 보인다. `whenSettled()` 로 기다리는 것까지가 한 짝이다(`flushNow` 는 비동기
      SQL 쓰기를 *시작*만 한다 · `db/write.ts` 주석).
   ② **`exclusiveMerge`** — 되돌리기도 `applyPull` 을 쓰므로 병합 창을 연다. H8 의 중첩 조건에
      그대로 해당한다(`syncController` 의 그 주석이 SSOT).
   ③ **`applyMerged` + `finally endMergeApply`** — `loadState` 가 **아니다**(C1). 진행 중 로컬
      편집을 지우지 않고 스냅샷 위에 재적용하는 진입점이어야 한다.
============================================================ */
import { undoLastWrite } from '@/lib/cloud/undo';
import { endMergeApply, whenSettled } from '@/lib/db/write';
import { toast } from '@/shell/toast';
import { useApp } from './useApp';
import { exclusiveMerge, syncSoon } from './syncController';

/**
 * 가장 최근 편집을 되돌린다(전역 ⌘Z). 되돌릴 것이 없으면 그 사실을 말하고 끝낸다.
 *
 * ⚠ **조용히 실패하지 않는다.** 되돌리기가 아무 말도 없이 끝나면 사용자는 "눌렸는데 안 됐다"와
 * "되돌릴 게 없었다"를 구분할 수 없고, 그 구분이 없으면 다음 ⌘Z 를 더 누른다.
 */
export async function undoLastEdit(): Promise<void> {
  // ① 디바운스 대기 중인 편집을 먼저 확정한다(머리주석).
  useApp.getState().flushNow();
  await whenSettled();

  const r = await exclusiveMerge(async () => {
    const out = await undoLastWrite();
    try {
      if (out.state) useApp.getState().applyMerged(out.state);
    } finally {
      endMergeApply(); // C1 방어망 — `applyPull` 이 연 병합-적용 창을 실패 경로에서도 닫는다
    }
    return out;
  });

  if (r.empty) {
    toast('되돌릴 편집이 없어요.', 'info');
    return;
  }
  /* ⚠ 건너뛴 행을 **수로 말한다**(착지 조건 ④). "되돌렸어요"만 말하면 일부만 되돌아간 상태를
     전부라고 보고하는 것이고, 그건 이 저장소가 반복해 잡은 *안 잰 것을 결과로 보고하는* 형태다. */
  if (r.skipped) {
    const total = r.restored + r.skipped;
    toast(`${total}건 중 ${r.skipped}건은 다른 기기가 지워 되돌리지 않았어요.`, 'warn', 6000);
  } else {
    toast('직전 편집을 되돌렸어요.', 'ok');
  }
  if (r.restored) syncSoon(); // 되돌린 값을 다른 기기로 전파
}
