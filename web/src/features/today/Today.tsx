/* ============================================================
   Today — 탭: 🎯 오늘 학습 (데모 v6 단일 화면 대시보드)
   기본 화면 = TodaySignature(프레임 가득 채우는 4컬럼 대시보드, 무스크롤).
   세부(블록 액션·일일 의식·흐름 가이드)는 "＋"/"지금 시작" → 오버레이 패널로(필요할 때만).
============================================================ */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/store/useApp';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { ui } from '@/shell';
import { setRitual } from '@/lib/methodology';
import { dayShape } from '@/lib/insights';
import { todayISO } from '@/lib/utils';
import type { Ritual } from '@/lib/types';
import { TodaySignature } from './TodaySignature';
import { SetupGuide, setupComplete } from './SetupGuide';
import { TodayBlocks } from './TodayBlocks';
import { BLOCK_STAGES, PRINCIPLES } from './consts';

/** 일일 의식(아침 계획·저녁 셧다운) — 핵심 통계는 TodaySignature가 보여주고, 여기선 의식 체크만. */
function RitualCard() {
  const state = useApp((s) => s.state);
  const mutate = useApp((s) => s.mutate);

  const ds2 = todayISO(state); // '오늘' 단일 출처(_today 시드 존중).
  const r: Ritual = state.rituals?.[ds2] || { plan: false, shutdown: false, note: '' };
  // ID-5 오늘의 모양 — 셧다운 순간의 회고 한 줄(완료·요약 있을 때만).
  const shape = dayShape(state, ds2);
  const [note, setNote] = useState(r.note || '');
  const [justSaved, setJustSaved] = useState(false); // blur 저장이 조용해서 반영 여부를 인라인으로 표시.
  const toggle = (key: 'plan' | 'shutdown', on: boolean) => {
    mutate((st) => setRitual(st, ds2, key, on));
    ui.toast(on ? '기록됨 👍' : '해제됨', 'info');
  };
  // '내일 한 줄'은 blur 시 저장(키 입력마다 mutate 방지).
  const saveNote = () => {
    if (note === (r.note || '')) return;
    mutate((st) => setRitual(st, ds2, 'note', note.trim()));
    setJustSaved(true);
    ui.toast('내일 한 줄 저장됨 🌙', 'info');
  };

  return (
    <div className="ds-card">
      <h2>
        일일 의식 <span className="ds-muted ds-tiny">— 아침 계획 → 저녁 셧다운(작은 의식이 일관성을 만든다)</span>
      </h2>
      <div className="flex flex-wrap gap-2.5">
        <label className="flex! min-w-55 flex-1 cursor-pointer items-center gap-1.75 rounded-md border border-line bg-panel2 px-2.75 py-2.25 text-md! hover:border-[color:var(--line-acc-hover)]">
          <input type="checkbox" checked={r.plan} onChange={(e) => toggle('plan', e.target.checked)} /> 🌅{' '}
          <b>아침 계획</b> <span className="ds-muted ds-tiny">블록 훑고 오늘 가장 중요한 1개 정하기</span>
        </label>
        <label className="flex! min-w-55 flex-1 cursor-pointer items-center gap-1.75 rounded-md border border-line bg-panel2 px-2.75 py-2.25 text-md! hover:border-[color:var(--line-acc-hover)]">
          <input type="checkbox" checked={r.shutdown} onChange={(e) => toggle('shutdown', e.target.checked)} /> 🌙{' '}
          <b>저녁 셧다운</b> <span className="ds-muted ds-tiny">완료 체크 · 내일 한 줄 · 끝내기</span>
        </label>
      </div>
      {/* ID-5 오늘의 모양 — 하루 회고 한 줄(완료 세션·요약 있을 때만). 셧다운 전 '오늘이 어땠나'. */}
      {(shape.sessions > 0 || shape.learned) && (
        <div className="ds-foot" style={{ marginTop: 8 }}>
          🌙 <b>오늘의 모양</b> — {shape.subjects}과목 · {shape.sessions}세션 · {shape.focusMin}분 집중
          {shape.learned && (
            <>
              {' '}
              · 배운 것: <i className="text-txt">{shape.learned}</i>
            </>
          )}
        </div>
      )}
      <div className="ds-fld" style={{ marginTop: 8 }}>
        <label htmlFor="ritual-note">
          내일 한 줄 <span className="ds-muted ds-tiny">— 셧다운의 마지막 조각, 내일의 나에게 남기는 메모</span>
          {justSaved && note.trim() === (r.note || '').trim() && (
            <span className="ds-pill ds-good ds-tiny" style={{ marginLeft: 8 }}>
              ✓ 저장됨
            </span>
          )}
        </label>
        <input
          id="ritual-note"
          type="text"
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setJustSaved(false);
          }}
          onBlur={saveNote}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          placeholder="예) 내일은 3장 변위전류부터 — 백지 복습 먼저"
        />
      </div>
    </div>
  );
}

/** 블록 흐름 가이드(접이식 참고) — 5원리 + 단계 표 + 체크리스트. */
function FlowGuide() {
  return (
    <div className="ds-card">
      <details>
        <summary>학습 원칙 · 블록 흐름 (펼쳐 보기)</summary>
        <div className="mt-3 mb-1 flex flex-wrap gap-1.75">
          {PRINCIPLES.map(([a, b]) => (
            <span
              key={a}
              className="rounded-full border border-line bg-panel2 px-2.75 py-1.25 text-sm leading-[1.6] text-mut"
            >
              <b className="font-semibold text-txt">{a}</b> {b}
            </span>
          ))}
        </div>
        <div className="ds-foot" style={{ margin: '2px 0 12px' }}>
          "이해했다"는 착각을 "꺼낼 수 있다"는 증거로. 바쁜 날엔 <b>풀이 1~2문제 + 3문장 요약 + Anki 점검</b>만 —{' '}
          <i>작은 일관성 &gt; 완벽한 중단</i>(부록 C).
        </div>
        <table>
          <thead>
            <tr>
              <th>단계</th>
              <th>비중</th>
              <th>핵심 행동</th>
            </tr>
          </thead>
          <tbody>
            {BLOCK_STAGES.map((st) => (
              <tr key={st.name}>
                <td>
                  <b>{st.name}</b>
                </td>
                <td className="ds-muted ds-tiny">
                  {st.start}–{st.end}%
                </td>
                <td>{st.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ds-foot" style={{ marginTop: 10 }}>
          <b>주의력:</b> 45~50분마다 5분 휴식(화면·문제에서 눈 떼기). 2h ≈ [50분+5분]×2.
        </div>
        <div className="ds-foot">
          <b>블록 종료 체크:</b> ☐ 3문장 요약(보지 않고) ☐ 까다로운 개념만 시각/언어 스케치 ☐ 막힌 곳 CBMS 분류 ☐ Anki
          ≤5장 점검 ☐ '보충 필요' 회수 시점 정함
        </div>
      </details>
    </div>
  );
}

export default function Today() {
  const items = useApp((s) => s.state.items);
  const [moreOpen, setMoreOpen] = useState(false);
  const morePanelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(moreOpen, morePanelRef); // '오늘 상세' 오버레이 포커스 트랩 + 복원.
  const openMore = useCallback(() => setMoreOpen(true), []);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  return (
    <div className="relative h-full min-h-0">
      <TodaySignature onOpenMore={openMore} />
      {/* 콜드 스타트 — 과목·목표가 없으면 빈 대시보드 위에 3스텝 온보딩을 띄운다(셋업되면 자동 소멸). */}
      {!setupComplete(items) && (
        <div className="absolute inset-0 z-5 grid place-items-center overflow-y-auto bg-[var(--setup-host-bg)] p-6 [backdrop-filter:var(--backdrop-setup)]">
          <SetupGuide />
        </div>
      )}
      {moreOpen && (
        /* 오버레이 클릭-닫기 = 마우스 편의(target===currentTarget 가드). 키보드는 ESC ·
           useFocusTrap(진입·순환·복원) · 패널의 진짜 닫기 버튼이 담당한다. */
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
        <div
          className="fixed inset-0 z-[var(--z-modal)] flex animate-[today-ov-fade_0.16s_var(--ease)] justify-end bg-[var(--overlay-bg)] [backdrop-filter:var(--backdrop-overlay)] motion-reduce:animate-none"
          role="dialog"
          aria-modal="true"
          aria-label="오늘 상세"
          onClick={(e) => {
            if (e.target === e.currentTarget) setMoreOpen(false);
          }}
        >
          <div
            className="flex h-full w-full max-w-runner-narrow animate-[today-ov-slide_0.22s_var(--ease)] flex-col border-l border-line bg-bg shadow-detail motion-reduce:animate-none max-mobile:max-w-none max-mobile:border-l-0"
            ref={morePanelRef}
            tabIndex={-1}
          >
            <div className="flex flex-none items-center justify-between border-b border-line px-5 py-4 text-md tracking-label">
              <b>오늘 상세 — 블록 · 의식 · 흐름</b>
              <button
                type="button"
                className="size-8 rounded-chip! border border-line bg-transparent!"
                onClick={() => setMoreOpen(false)}
                aria-label="닫기"
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 [scrollbar-width:thin] overflow-y-auto px-5 pt-4.5 pb-7">
              <TodayBlocks />
              <RitualCard />
              <FlowGuide />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
