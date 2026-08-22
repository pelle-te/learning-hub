/* ============================================================
   GlanceMode — **T-20 거리 표면**(글랜스 모드 · `⇧G`).

   ## 왜 필요한가

   이 앱의 수는 전부 **가까이서 읽는 크기**다(리드아웃 13~44px). 그래서 책상에서 한 발 물러나
   있거나, 다른 일을 하다 고개만 돌렸을 때는 **가까이 가서 읽어야** 한다 — 그 왕복이 "지금
   어떤가"라는 가장 자주 묻는 질문에 붙는 고정 비용이었다.

   글랜스 모드는 지금 화면의 **리드아웃을 거리에서 읽히는 크기로** 다시 그린다. 새 데이터가
   0 인 것이 요점이다 — `usePageChrome` 이 이미 각 화면의 "단 하나의 수"(`primary`)와 보조
   수들(`readouts`)을 갖고 있고, 여기서는 그것을 **크게** 그릴 뿐이다.

   ## ⚠ 로드맵의 검증 조건 — **실측했다**(I026 · 2026-08-22)

   그 조건은 _"`primary` 가 `null` 아닌 탭이 몇 개인지 센다 — **절반 미만이면 빈 화면**"_ 이었다.
   실측: 크롬을 세우는 화면 **19** 중 `primary: null` 이 **9**(47%)다. 그런데 그 조건을 재는
   동안 이 화면 자체에 결함이 있었다 — **`readouts` 가 `primary` 분기 안에 중첩돼**, 대표 수가
   없는 아홉은 보조 수를 갖고 있어도 사과문만 봤다. 즉 «값을 내는가»를 자기가 가진 수를
   가린 채로 재고 있었다. 지금은 셋을 가른다: 대표 수 · 보조 수 · **둘 다 없을 때만** 사과문.

   ⚠ `primary: null` 은 **위반이 아니다** — «이 화면엔 대표 수가 없다»는 정직한 선언이고
   `Find.tsx` 가 그 자리에 그렇게 적어 뒀다. 그것을 결함으로 읽어야만 «계약을 축소하라»가
   성립하는데, 그 독법은 이 저장소가 `null` 에 부여한 뜻과 반대다(원장 I026 닫기 노트).

   ## ⚠ `⇧G` 인 이유

   소문자 `g` 는 **이동 접두사**다(`g` → `t` = 오늘). 거기에 단독 `g` 를 얹으면 접두사가 매번
   150ms 를 기다리게 되거나 이동이 깨진다 — 둘 다 기존 계약을 해친다.
============================================================ */
import { useEffect, useRef, useState } from 'react';
import { usePageChrome } from '@/store/usePageChrome';
import { isTyping } from '@/hooks/interactions';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useScrollLock } from '@/hooks/useScrollLock';

export default function GlanceMode() {
  const [on, setOn] = useState(false);
  const primary = usePageChrome((s) => s.primary);
  const readouts = usePageChrome((s) => s.readouts);
  const panelRef = useRef<HTMLDivElement>(null);
  /* ⚠⚠ **`role="dialog" aria-modal` 을 선언해 놓고 그 계약을 하나도 안 지키고 있었다**
     (H-11 · 2026-08-06 감사). `aria-modal="true"` 는 보조기술에게 _"이 밖은 없는 셈 쳐라"_ 라고
     말하는 선언인데, 포커스 트랩·복원·스크롤 락이 전부 없어서 Tab 이 뒤 화면으로 새어 나갔다 —
     스크린리더 사용자에게는 **닫히지 않는 오버레이 뒤를 더듬는** 상태가 된다. 선언만 있고
     구현이 없으면 aria 는 도움이 아니라 거짓말이다.
     ⚠ 두 훅은 이미 있었다(`useFocusTrap`·`useScrollLock` · 오버레이 6종이 쓴다) — 이 화면만
     그 목록 밖이었고, a11y 로스터(`_fixtures.ts`)에도 안 들어 있어 axe 가 볼 기회조차 없었다. */
  useFocusTrap(on, panelRef);
  useScrollLock(on);

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
      ref={panelRef}
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
      {/* ⚠⚠ **`readouts` 가 `primary` 분기 **안에** 중첩돼 있었다**(I026 실측 · 2026-08-22).
          대가는 이랬다: `primary: null` 인 화면이 **19 중 9**(47%)인데, 그 아홉은 보조 수를
          갖고 있어도 ⇧G 에서 **사과문 한 장**만 봤다. 즉 이 기능이 «값을 내는지»를 스스로
          검증하겠다던 조건이, 정작 자기가 가진 수를 안 보여 준 채로 측정되고 있었다.
          ⚠ 그래서 이 항목의 처방(«계약을 축소하고 ⇧G 를 제거») 대신 **결함을 고쳤다** —
          `primary: null` 은 위반이 아니라 «이 화면엔 대표 수가 없다」는 **정직한 선언**이고
          (`Find.tsx` 가 그 자리에 그렇게 적어 뒀다), 축소의 근거로 쓰려면 그 선언을 결함으로
          읽어야 한다. 근거는 원장 I026 닫기 노트. */}
      {primary && (
        <div className="text-center">
          <div className="ds-caps text-mut">{primary.label}</div>
          <div className="text-display leading-none font-black text-acc tabular-nums">{primary.value}</div>
        </div>
      )}
      {readouts.length > 0 && (
        <div className="flex flex-wrap items-baseline justify-center gap-x-8 gap-y-3">
          {readouts.map((r) => (
            <div key={r.label} className="text-center">
              <div className="ds-caps text-mut">{r.label}</div>
              <div className={`${primary ? 'text-2xl' : 'text-display'} leading-none font-extrabold tabular-nums`}>
                {r.value}
              </div>
            </div>
          ))}
        </div>
      )}
      {/* 대표 수도 보조 수도 없을 때만 — 빈 검은 화면을 안 띄운다(머리주석). */}
      {!primary && readouts.length === 0 && (
        <p className="max-w-100 text-center text-lg leading-body text-mut">
          이 화면은 <b>거리에서 읽을 수</b>를 정해 두지 않았어요. 목적지 화면(오늘·계획·복습 등)에서 열면 그 화면의 수가
          크게 뜹니다.
        </p>
      )}
      <p className="ds-tiny text-mut">아무 곳이나 누르거나 Esc · ⇧G 로 닫기</p>
    </div>
  );
}
