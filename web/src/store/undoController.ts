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
      ⚠ **자리가 계약의 일부다 — ② 안이어야 한다**(M-2 후속 · 2026-08-06). 게이트 밖에서 부르면
      병합 창에 걸려 `deferred` 로 돌아오고, 그때 ①은 아무것도 확정하지 못한 채 통과한다.
   ② **`exclusiveMerge`** — 되돌리기도 `applyPull` 을 쓰므로 병합 창을 연다. H8 의 중첩 조건에
      그대로 해당한다(`syncController` 의 그 주석이 SSOT).
   ③ **`applyMerged` + `finally endMergeApply`** — `loadState` 가 **아니다**(C1). 진행 중 로컬
      편집을 지우지 않고 스냅샷 위에 재적용하는 진입점이어야 한다.
============================================================ */
import { redoLastWrite, undoLastWrite } from '@/lib/cloud/undo';
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
  return runInverse(undoLastWrite, UNDO_WORDS);
}

/**
 * **Q-8 다시 실행(⇧⌘Z).** 방금 되돌린 것을 되돌린다.
 *
 * ⚠ 순서 계약 셋(머리주석)이 **그대로 필요하다** — 다시실행도 `applyPull` 을 쓰고 디바운스와
 * 경쟁하며 병합 창을 연다. 그래서 몸통을 공유한다(문구만 다르다).
 */
export async function redoLastEdit(): Promise<void> {
  return runInverse(redoLastWrite, REDO_WORDS);
}

/** 방향별 문구. 몸통이 하나라 **말만** 갈린다 — 두 벌로 두면 한쪽 문구가 곧 낡는다. */
interface InverseWords {
  empty: string;
  ok: string;
  fail: string;
}
const UNDO_WORDS: InverseWords = {
  empty: '되돌릴 편집이 없어요.',
  ok: '직전 편집을 되돌렸어요.',
  fail: '되돌리기에 실패했어요',
};
const REDO_WORDS: InverseWords = {
  empty: '다시 실행할 것이 없어요.',
  ok: '되돌린 편집을 다시 실행했어요.',
  fail: '다시 실행에 실패했어요',
};

async function runInverse(run: typeof undoLastWrite, words: InverseWords): Promise<void> {
  /* ⚠⚠ **실패 보고를 이 층이 소유한다**(H2 · 2026-08-01) — 근거는 `syncController.reportFailure`
     주석. ⌘Z 입구는 둘(`App.tsx` 캡처 리스너 · `palette.ts` 명령)이고 **둘 다 `void`** 로 부른다:
     여기서 안 잡으면 실패가 unhandled rejection 으로 사라지고 화면은 아무 말도 안 한다. */
  let r: Awaited<ReturnType<typeof undoLastWrite>>;
  try {
    r = await exclusiveMerge(async () => {
      /* ① 디바운스 대기 중인 편집을 먼저 확정한다 — **게이트 안에서**(M-2 후속 · 2026-08-06).

         ⚠⚠ 종전엔 이 두 줄이 `exclusiveMerge` **밖**에 있었고, 그러면 확정하지 않는다:
         동기화가 진행 중이면 병합 반영 창이 열려 있어 `flushNow()` 의 쓰기가 `deferred`
         (= `ok:true` · 400ms 뒤 재예약)로 돌아온다. `whenSettled()` 는 그 체인 링크가 이미
         resolve 됐으므로 **곧바로 통과**하고(같은 함정을 `waitForMergeWindow` 가 창 닫기
         가드에서 이미 겪었다), 우리는 *아직 쓰이지 않은 편집*을 두고 되돌리기에 들어간다 →
         **그 앞의 편집이 지워지고**, 뒤이어 디바운스가 깨어나 방금 편집을 쓴다. 머리주석 ①이
         막으려던 그 증상 그대로다.

         게이트 안에서는 앞선 병합이 이미 끝나 창이 닫혀 있으므로(닫기는 `finally` 라 게이트가
         풀리기 전에 일어난다) `deferred` 가 성립하지 않는다 — 확정이 실제로 확정이 된다. */
      useApp.getState().flushNow();
      await whenSettled();

      /* ⚠⚠ **`undoLastWrite` 자신이 `try` 안이어야 한다(H1 · 2026-08-01).** 그 안에서 `applyPull` 이
       병합 창을 켜므로, 켠 뒤 던지는 경로가 `try` 밖이면 아래 `finally` 에 도달하지 못한다.
       굳으면 이후 flush 가 전부 `deferred`(= `ok:true`)라 **경고 없이 그 세션이 하나도 저장되지
       않는다.** 근거는 `syncController.restoreConflict` 의 같은 자리 주석. */
      try {
        const out = await run();
        if (out.state) useApp.getState().applyMerged(out.state);
        return out;
      } finally {
        endMergeApply(); // C1 방어망 — `applyPull` 이 연 병합-적용 창을 실패 경로에서도 닫는다
      }
    });
  } catch (e) {
    /* 스택은 `peek → apply → drop` 이라 **항목이 그대로 남아 있다** — 재시도가 성립한다
       (`db/undoStack.peekUndo`). 그래서 "다시 눌러 보세요"가 지킬 수 있는 약속이다. */
    toast(`${words.fail} — ${e instanceof Error ? e.message : String(e)}`, 'bad', 8000);
    return;
  }

  if (r.empty) {
    toast(words.empty, 'info');
    return;
  }
  /* ⚠ 건너뛴 행을 **수로 말한다**(착지 조건 ④). "되돌렸어요"만 말하면 일부만 되돌아간 상태를
     전부라고 보고하는 것이고, 그건 이 저장소가 반복해 잡은 *안 잰 것을 결과로 보고하는* 형태다. */
  if (r.skipped) {
    const total = r.restored + r.skipped;
    toast(`${total}건 중 ${r.skipped}건은 다른 기기가 지워 되돌리지 않았어요.`, 'warn', 6000);
  } else {
    toast(words.ok, 'ok');
  }
  if (r.restored) syncSoon(); // 되돌린 값을 다른 기기로 전파
}
