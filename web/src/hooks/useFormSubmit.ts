/* ============================================================
   useFormSubmit — 폼 키 계약의 단일 원천(N-17).

   ## 왜 필요했나

   앱 전체에서 `⌘/Ctrl+Enter` 를 처리하는 곳이 `shell/modal.tsx` **한 곳**뿐이었고, 기록
   카드 셋의 계약이 서로 달랐다: `CbmsCard`·`BacklogCard` 는 맨 Enter 로 제출, **`SummaryCard`
   의 textarea 셋은 아무 키 계약이 없었다.** 즉 이 앱에서 가장 잦은 일일 기록인 3문장 요약만
   유일하게 마우스로 버튼을 눌러야 저장됐다. 편집 취소 `Esc` 는 세 카드 모두 없었다.

   ## 계약 (한 문장씩)

   · `⌘/Ctrl+Enter` — **어디서나** 제출. 한 줄 입력이든 여러 줄이든 같다(외울 것이 하나).
   · 맨 `Enter` — **한 줄 입력에서만** 제출. textarea 에선 줄바꿈이다(당연하지만, 그 당연함이
     계약으로 적혀 있지 않아 카드마다 갈렸다).
   · `Esc` — 취소(넘겼을 때만). ⚠ 취소 **버튼은 남긴다** — Esc 만 두면 발견성 없는 파괴 동작이
     된다(로드맵 N-17 의 명시 제약).

   ## ⚠⚠ IME 조합 중의 Enter 는 제출이 아니다 — 이건 선재 결함이었다

   한글 입력에서 마지막 음절이 **조합 중**일 때 누르는 Enter 는 "조합 확정"이지 "제출"이
   아니다. 그런데 옛 핸들러들(`e.key === 'Enter' && submit()`)은 그 구분이 없어서, 크롬이
   `isComposing: true` 로 함께 보내는 그 keydown 에 **덜 친 내용을 제출**했다. 한국어로만
   쓰는 앱에서 한글 입력 칸 7곳이 전부 이랬다 — 증상이 "가끔 반쯤 친 게 저장됨"이라
   재현 조건을 모르면 사용자 실수로 읽힌다. 계약을 한 곳에 모으니 방어도 한 곳이 된다.

   ## 왜 `field`/`area` 로 안 나눴나

   두 벌을 내놓으면 textarea 에 `field` 를 붙이는 실수가 가능하고, 그 결과는 "요약 칸에서
   줄바꿈이 안 됨"이라는 조용한 오작동이다. 대신 `e.currentTarget` 의 태그를 보고 **런타임에
   판정**한다 — 붙이는 쪽이 틀릴 수 있는 선택지를 없앤다.
============================================================ */
import { useMemo } from 'react';
import type { KeyboardEvent } from 'react';

export interface FormKeyProps {
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}

export interface FormSubmitOptions {
  /**
   * **Q-20** — 여러 줄 칸에서 맨 Enter 를 "다음 칸"으로 쓸 때의 이동 함수.
   *
   * @returns 실제로 옮겼는가. **`false` 면 Enter 는 줄바꿈 그대로** — 마지막 칸에서 커서가
   *   갈 곳이 없는데 `preventDefault` 를 하면 그 칸에서만 Enter 가 죽는다(조용한 고장).
   */
  advance?: (from: HTMLElement) => boolean;
}

/**
 * 폼 키 계약을 입력 요소에 붙일 props 로 돌려준다 — `<input {...keys} />` · `<textarea {...keys} />`.
 *
 * @param submit 제출. 유효성 검사·토스트는 호출부가 소유한다(여기는 키만 안다).
 * @param cancel 취소(편집 폼). 없으면 Esc 는 아무 일도 안 한다 — 새 항목 폼에서 Esc 가
 *   입력을 날리면 그게 더 놀랍다.
 */
export function useFormSubmit(submit: () => void, cancel?: () => void, opts?: FormSubmitOptions): FormKeyProps {
  const advance = opts?.advance;
  return useMemo(
    () => ({
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        // ⚠ 조합 중 Enter 는 확정이지 제출이 아니다(머리주석). Esc 도 조합 취소가 먼저다.
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Escape') {
          if (!cancel) return;
          e.preventDefault();
          e.stopPropagation(); // 오버레이 안의 폼이면 Esc 가 오버레이까지 닫는 것을 막는다
          cancel();
          return;
        }
        if (e.key !== 'Enter') return;
        const multiline = (e.currentTarget as HTMLElement).tagName === 'TEXTAREA';
        if (e.altKey || e.shiftKey) return; // Shift+Enter 는 줄바꿈 관용구라 뺏지 않는다
        /* ── Q-20 다음 칸으로 ────────────────────────────────────────────────────────────
           `advance` 를 넘긴 폼에서는 여러 줄 칸의 맨 Enter 가 **다음 칸**이다(⌘Enter 는 여전히
           제출 · ⇧Enter 는 줄바꿈).
           ⚠ 왜 안전한가: 이 옵션은 `rows={2}` 짜리 **"한 문장 그릇"** 에만 붙인다 — 화면이 이미
           크기로 "여기는 한 문장"이라 말하고 있어서, 맨 Enter 의 자연스러운 뜻이 줄바꿈이 아니라
           "다 썼다"다. 긴 글을 받는 textarea 에는 **붙이지 않는다**(그때는 줄바꿈이 맞다).
           ⚠ 옵션으로 둔 이유: 기본값으로 만들면 앱의 모든 textarea 에서 Enter 가 줄바꿈을
           잃는다. 붙이는 쪽이 틀릴 수 있는 선택지를 없앤다는 이 훅의 규율과 어긋나지 않는다 —
           여기서 고르는 것은 *칸의 종류*가 아니라 *폼의 성격*이라 호출부만 알 수 있다. */
        if (multiline && advance && !(e.metaKey || e.ctrlKey)) {
          if (!advance(e.currentTarget as HTMLElement)) return; // 마지막 칸이면 줄바꿈 그대로
          e.preventDefault();
          return;
        }
        if (multiline && !(e.metaKey || e.ctrlKey)) return; // 여러 줄 칸의 맨 Enter = 줄바꿈
        e.preventDefault();
        submit();
      },
    }),
    [submit, cancel, advance],
  );
}
