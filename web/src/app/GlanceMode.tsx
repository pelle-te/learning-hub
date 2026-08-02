/* ============================================================
   GlanceMode — **T-20 거리 표면**(글랜스 모드 · `⇧G`).

   ## 왜 필요한가

   이 앱의 수는 전부 **가까이서 읽는 크기**다(리드아웃 13~44px). 그래서 책상에서 한 발 물러나
   있거나, 다른 일을 하다 고개만 돌렸을 때는 **가까이 가서 읽어야** 한다 — 그 왕복이 "지금
   어떤가"라는 가장 자주 묻는 질문에 붙는 고정 비용이었다.

   글랜스 모드는 지금 화면의 **리드아웃을 거리에서 읽히는 크기로** 다시 그린다. 새 데이터가
   0 인 것이 요점이다 — `usePageChrome` 이 이미 각 화면의 "단 하나의 수"(`primary`)와 보조
   수들(`readouts`)을 갖고 있고, 여기서는 그것을 **크게** 그릴 뿐이다.

   ## ⚠ 로드맵의 검증 조건을 화면이 스스로 답한다

   그 조건은 _"`primary` 가 `null` 아닌 탭이 몇 개인지 센다 — **절반 미만이면 빈 화면**"_ 이었다.
   `primary` 가 없는 화면에서 이 오버레이를 열면 **그 사실을 말한다**(빈 검은 화면을 띄우지
   않는다). 즉 이 기능이 값을 내는지 아닌지가 쓰는 순간 드러난다.

   ## ⚠ `⇧G` 인 이유

   소문자 `g` 는 **이동 접두사**다(`g` → `t` = 오늘). 거기에 단독 `g` 를 얹으면 접두사가 매번
   150ms 를 기다리게 되거나 이동이 깨진다 — 둘 다 기존 계약을 해친다.
============================================================ */
import { useEffect, useState } from 'react';
import { usePageChrome } from '@/store/usePageChrome';
import { isTyping } from '@/hooks/interactions';

export default function GlanceMode() {
  const [on, setOn] = useState(false);
  const primary = usePageChrome((s) => s.primary);
  const readouts = usePageChrome((s) => s.readouts);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && on) {
        setOn(false);
        return;
      }
      // ⚠ 입력 중에는 안 연다 — 대문자 G 는 글자다(`isTyping` 이 그 판정의 SSOT · 인자 없음).
      if (isTyping()) return;
      if (e.key === 'G' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setOn((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [on]);

  if (!on) return null;

  return (
    /* ⚠ 배경 클릭으로 닫는 것을 `<div onClick>` 으로 하면 jsx-a11y 가 (옳게) 막는다 —
       키보드 사용자에게 그 경로가 없기 때문. **전면 버튼**으로 두면 Enter/Space 가 공짜로
       따라오고 포커스 순서에도 들어간다(Esc·⇧G 는 위 전역 핸들러가 이미 소유한다). */
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex flex-col items-center justify-center gap-6 bg-bg/95 p-8"
      role="dialog"
      aria-modal="true"
      aria-label="글랜스 모드"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default border-0! bg-transparent! p-0!"
        aria-label="글랜스 모드 닫기"
        onClick={() => setOn(false)}
      />
      {primary ? (
        <>
          <div className="text-center">
            <div className="ds-caps text-mut">{primary.label}</div>
            <div className="text-display leading-none font-black text-acc tabular-nums">{primary.value}</div>
          </div>
          {readouts.length > 0 && (
            <div className="flex flex-wrap items-baseline justify-center gap-x-8 gap-y-3">
              {readouts.map((r) => (
                <div key={r.label} className="text-center">
                  <div className="ds-caps text-mut">{r.label}</div>
                  <div className="text-2xl leading-none font-extrabold tabular-nums">{r.value}</div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        /* ⚠ 빈 검은 화면을 안 띄운다 — 이 기능이 값을 내는지가 여기서 드러난다(머리주석). */
        <p className="max-w-100 text-center text-lg leading-body text-mut">
          이 화면은 <b>거리에서 읽을 하나의 수</b>를 정해 두지 않았어요. 목적지 화면(오늘·계획·복습 등)에서 열면 그
          화면의 수가 크게 뜹니다.
        </p>
      )}
      <p className="ds-tiny text-mut">아무 곳이나 누르거나 Esc · ⇧G 로 닫기</p>
    </div>
  );
}
