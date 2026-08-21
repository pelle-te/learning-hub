/* ============================================================
   DayBufferOverlay — **오늘 버퍼**(N-15 · W7 · 발산 6회차).

   ## 왜 필요한가

   이 앱은 하루를 **여섯 표면**으로 말한다(히어로 · 흐름 · 막대 · 스트립 · 레일 · 리드아웃).
   각각은 그 자리에서 옳지만 *"오늘 전체를 한 번에 훑는다"* 는 동작이 없어서, 사용자는 그
   훑기를 머릿속에서(또는 볼트에 손으로) 한다. 텍스트 한 장이 그 훑기를 앱 안으로 들인다.

   ## ⚠⚠ 읽기 전용이다 — **파서를 만들지 않는다**

   로드맵이 적은 가장 싼 검증이 그것이다: _"파서 **없이** 읽기 전용 렌더 → 사흘 '고치고 싶었나'
   O/X"_. 편집을 먼저 만들면 텍스트↔상태 왕복 파서가 필요하고, **그 비용을 치른 뒤에야**
   사람들이 실제로 고치려 드는지 알게 된다. 순서를 뒤집는다.
   ⚠ 대신 **복사**는 준다 — 편집이 없어도 *가져나가는* 것은 되어야 하고(볼트가 마크다운이다),
     그게 "고치고 싶었나"를 관측하는 가장 정직한 대리 신호이기도 하다.

   ## ⚠ 라우트가 아니라 오버레이인 이유

   이건 *가는 곳*이 아니라 **지금 화면 위에서 훑는 것**이다(⌘K·`?`·글랜스와 같은 부류).
   라우트로 만들면 명사 축(N-12)에 "하루"가 둘이 된다 — `/day` 와 겹친다.

   ⚠ `GlanceMode` 가 세운 오버레이 계약을 그대로 따른다: 포커스 트랩 · 스크롤 락 · Esc.
     `aria-modal` 을 선언하고 그 셋을 안 지키면 그건 도움이 아니라 거짓말이다(H-11).
============================================================ */
import { useEffect, useMemo, useRef } from 'react';
import { useApp } from '@/store/useApp';
import { useOverlay } from '@/store/useOverlay';
import { useSchedule } from '@/store/selectors';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useScrollLock } from '@/hooks/useScrollLock';
import { dayBuffer, type BufferBlock } from '@/lib/dayBuffer';
import { dayCapacity } from '@/lib/dayCapacity';
import { untimedChoreMin } from '@/lib/tasks';
import { summariesFor, cbmsBetween } from '@/lib/methodology';
import { isDone } from '@/lib/persistence';
import { todayISO } from '@/lib/utils';
import { layoutDay } from '@/lib/scheduler';
import { Button } from '@/components/ui';
import { toast } from '@/shell/toast';

export default function DayBufferOverlay() {
  const on = useOverlay((s) => s.dayBuffer);
  const setOn = useOverlay((s) => s.setDayBuffer);
  const state = useApp((s) => s.state);
  const res = useSchedule();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(on, panelRef);
  useScrollLock(on);

  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOn(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [on, setOn]);

  const text = useMemo(() => {
    if (!on) return '';
    const ds = todayISO(state);
    const day = res.days.find((d) => d.ds === ds);
    const L = day ? layoutDay(state, day) : null;
    /* 학습 블록 + 일과 블록을 **한 목록**으로 — 하루는 그렇게 흘러간다(둘을 가르면 이 화면이
       또 하나의 '학습만 보는 표면'이 되고, 그건 이미 여섯 개 있다). */
    const blocks: BufferBlock[] = [
      ...(day?.items ?? []).map((it) => ({
        /* ⚠ 타임라인은 `sid`+`type` 으로만 자기를 말한다(`key` 필드가 없다) — 완료 키와 같은
           식으로 맞춰 찾는다(두 벌을 만들지 않는다). */
        start: L?.tl.find((n) => n.kind === 'study' && n.sid === it.sid && n.type === it.type)?.start ?? null,
        min: it.min || 0,
        done: isDone(state, ds, it.sid, it.type),
        name: it.name,
        detail: it.chapters?.length ? it.chapters.join(', ') : undefined,
      })),
      ...(L?.tl ?? [])
        .filter((n) => n.kind !== 'study')
        .map((n) => ({
          start: n.start,
          min: Math.max(0, n.end - n.start),
          done: false,
          name: n.name ?? '일과',
          routine: true as const,
        })),
    ];
    const cap = dayCapacity(
      blocks.filter((b) => !b.routine).map((b, i) => ({ key: String(i), start: b.start, min: b.min, done: b.done })),
      L ? L.free.reduce((t, [a, z]) => t + (z - a), 0) : 0,
      /* ⚠ N-1(W8) — **시각 없는 것만** 뺀다. `L.free` 는 이제 시각 박힌 과제를 구간으로 이미
         뺀 값이라(`freeWindowsForDay`), 총량을 다시 빼면 그 과제가 두 번 깎인다. */
      untimedChoreMin(state, ds),
    );
    return dayBuffer({
      ds,
      blocks,
      summaries: summariesFor(state, ds).map((s) => [s.s1, s.s2, s.s3].filter(Boolean).join(' / ')),
      misses: cbmsBetween(state, ds, ds).map((c) => `${c.name || ''} ${c.chapter || ''} — ${c.note || c.code}`.trim()),
      fitLine: cap.fitLine,
      prevNote: null,
    });
  }, [on, state, res.days]);

  if (!on) return null;
  return (
    <div
      ref={panelRef}
      className="fixed inset-0 z-[var(--z-modal)] flex flex-col items-center bg-bg/95 p-8"
      role="dialog"
      aria-modal="true"
      aria-label="오늘 버퍼"
    >
      <div className="flex w-full max-w-160 flex-none items-center gap-2 pb-3">
        <h2 className="ds-caps mb-0! flex-1">오늘 버퍼 — 읽기 전용</h2>
        <Button
          sm
          onClick={() => {
            void navigator.clipboard
              ?.writeText(text)
              .then(() => toast('복사했어요 — 볼트에 붙이면 그대로 마크다운입니다.', 'ok'))
              /* ⚠ 실패를 삼키지 않는다: 복사가 이 화면의 유일한 출구인데 조용히 실패하면
                 사용자는 붙여넣기가 안 되는 이유를 어디서도 못 읽는다. */
              .catch(() => toast('복사하지 못했어요 — 글자를 직접 선택해 주세요.', 'bad'));
          }}
        >
          복사
        </Button>
        <Button sm variant="ghost" onClick={() => setOn(false)}>
          닫기
        </Button>
      </div>
      {/* ⚠ `<pre>` 다 — 이 화면의 값은 *조판*이 아니라 **텍스트 그 자체**이고, 그걸 예쁘게
          렌더하면 "복사하면 이대로 나온다"는 약속이 깨진다. */}
      {/* ⚠ **스크롤 컨테이너는 키보드로도 스크롤돼야 한다**(U038 · 2026-08-21 ux 축 · WCAG 2.1.1).
          `overflow:auto` 만으로는 포커스를 못 받아, 내용이 넘칠 때 마우스 휠·드래그 외에 방법이
          없었다(이 오버레이엔 다른 포커스 가능 요소가 위쪽 버튼 둘뿐이라 화살표 키가 갈 곳이
          없다). `tabIndex=0` 이 그 하나로 해결한다 — 브라우저가 스크롤 컨테이너에 포커스를 주면
          ↑↓·PageUp/Down·Space 가 그대로 동작한다.
          ⚠ 표식은 **`role="group"`** 이다 — 이 저장소가 스크롤 컨테이너에 쓰기로 정한 어휘이고
          (`eslint.config.js` 의 `no-noninteractive-tabindex` 옵션이 그 목록을 진다) 이름을 주지
          않는 것까지가 그 규약이다(이름 없는 group 은 스크린리더가 사실상 무시하므로 잡음
          랜드마크가 안 생긴다 · `components/hud/HudFrame.tsx` 가 같은 판단을 적어 뒀다).
          이 오버레이의 이름은 바깥 `dialog` 가 이미 갖고 있다. */}
      <pre
        tabIndex={0}
        role="group"
        className="ds-well m-0! w-full max-w-160 flex-1 overflow-auto text-sm leading-relaxed whitespace-pre-wrap"
      >
        {text}
      </pre>
      <p className="ds-tiny mt-2 text-anno">Esc 로 닫기 · 편집은 아직 없습니다(고치고 싶었다면 그게 다음 신호입니다)</p>
    </div>
  );
}
