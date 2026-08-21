/* ============================================================
   Journal — 탭: 📒 학습 기록 (Phase 4 · 앱상태/Zustand)
   레거시 ui-journal.js를 React로 — 공부 뒤 남기는 산출물: 3문장 요약·CBMS 오답·보충 백로그.
   '오늘 학습' 블록의 프리필 버튼이 prefill 스토어로 과목을 미리 채운다.
   스타일: 공유 디자인 시스템은 styles/ds.css(`ds-*` 전역), 요소·토큰은 전역 base.
============================================================ */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DAY_PATH } from '@/shell/tabs';
import { useApp } from '@/store/useApp';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { usePrefill } from '@/store/prefill';
import { exportAnkiCards, toast } from '@/shell';
import { summariesFor, cbmsBetween, openBacklog, activityFeed, setRitual } from '@/lib/methodology';
import { weeklyRecap } from '@/lib/insights';
import { shutdownChain } from '@/lib/records';
import { parseCaptureBatch } from '@/lib/quickCapture';
import { addDays, fmt, hLabel, iso, mondayOf, parseISO } from '@/lib/utils';
import { useTodayISO } from '@/hooks/useTodayISO';
import { Button } from '@/components/ui';
import JournalStream from './JournalStream';
import SummaryCard from './SummaryCard';
import CbmsCard from './CbmsCard';
import BacklogCard from './BacklogCard';
import { Icon } from '@/components/Icon';

/** 최근 활동(7일) — 완료·요약·오답·보충·백지를 시간역순 단일 피드로(온디맨드 <details>). */
function ActivityFeed({ ds2 }: { ds2: string }) {
  const state = useApp((s) => s.state);
  const feed = activityFeed(state, iso(addDays(parseISO(ds2), -6)), ds2);
  // 접힌 <details> 안 목록을 항상 렌더하지 않고 열렸을 때만(onToggle로 open 추적) 렌더 — lazy.
  const [open, setOpen] = useState(false);
  return (
    <details
      className="mt-2.5 flex-none border-t border-line2 pt-2"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer text-xs leading-text font-extrabold tracking-widest text-mut select-none hover:text-acc">
        최근 활동 · 7일{feed.length ? ` (${feed.length})` : ''}
      </summary>
      {!open ? null : feed.length ? (
        <ol className="mt-2 max-h-45 [scrollbar-width:thin] list-none overflow-y-auto p-0">
          {feed.map((e, i) => (
            <li
              key={i}
              className="flex items-baseline gap-2 border-b border-dashed border-tint-line2 py-1 text-sm leading-text"
            >
              <span className="w-9.5 flex-none text-xs leading-text font-bold text-mut tabular-nums">
                {e.ds.slice(5).replace('-', '/')}
              </span>
              <span
                className="flex-none text-2xs font-extrabold text-acc data-[kind=blank]:text-warn data-[kind=cbms]:text-warn"
                data-kind={e.kind}
              >
                {e.label}
              </span>
              <span className="min-w-0 flex-1 truncate text-txt">{e.detail}</span>
            </li>
          ))}
        </ol>
      ) : (
        <div className="mt-2 text-xs leading-text text-mut">최근 7일 기록이 없어요 — 오늘 첫 발자취를 남겨보세요.</div>
      )}
    </details>
  );
}

/** I-11 배치 캡처 — 여러 줄을 한 번에 파싱해 요약 폼 다건 프리필(우 컬럼 상단, 접이식). */
function BatchCapture() {
  const state = useApp((s) => s.state);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  // 파싱 미리보기 — 줄 수만큼 CaptureResult(빈 줄·실패 제외). subjects=이름 있는 항목명.
  const subjects = state.items.map((i) => i.name).filter(Boolean) as string[];
  const parsed = text.trim() ? parseCaptureBatch(text, new Date(), subjects) : [];
  const apply = () => {
    if (!parsed.length) return; // 빈 파싱이면 no-op
    const reqs = parsed.map((r) => {
      // 정확 name 일치만 id로 매핑(스케줄러 오염 방지) — 없으면 ''.
      const item = r.subject ? state.items.find((i) => i.name === r.subject) : undefined;
      return { form: 'sum' as const, sid: item?.id || '', ds: r.dateISO || '' };
    });
    usePrefill.getState().requestBatch(reqs);
    setText('');
    setOpen(false);
    toast(`${reqs.length}건 프리필 — 요약 폼이 순차로 채워져요`, 'ok');
  };

  return (
    <details
      className="mb-3.5 rounded-base border border-dashed border-line bg-panel2"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer px-3 py-2 text-xs leading-text font-extrabold tracking-wider text-mut select-none hover:text-acc">
        여러 줄 한 번에 — 배치 캡처
      </summary>
      <div className="px-3 pb-3">
        <textarea
          className="resize-y leading-normal"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'한 줄에 하나씩 — 예)\n미적분 7장 부분적분 요약\n어제 선형대수 고윳값 정리'}
        />
        <div className="mt-2 flex items-center justify-between gap-2.5">
          <span className="ds-tiny text-mut">
            {parsed.length ? `${parsed.length}건 인식 — 요약 폼으로 순차 프리필` : '한 줄씩 적으면 요약 폼을 채워요'}
          </span>
          <Button sm variant="primary" onClick={apply} disabled={!parsed.length}>
            {parsed.length ? `${parsed.length}건 프리필` : '프리필'}
          </Button>
        </div>
      </div>
    </details>
  );
}

/** I-12 주간 리캡 — '이번 주 해낸 것'(격려 톤). review(처방)와 분리. 좌 컬럼. */
function WeeklyRecapCard() {
  const state = useApp((s) => s.state);
  const today = useTodayISO(state);
  const weekMon = iso(mondayOf(parseISO(today)));
  const recap = weeklyRecap(state, weekMon);
  return (
    <div className="mt-3 flex-none rounded-base border border-line-acc bg-tint-acc-faint px-3.5 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-sm leading-text font-extrabold tracking-wider text-txt">이번 주 해낸 것</span>
        {recap.focusMin > 0 && (
          <span className="text-xs leading-text font-bold text-acc tabular-nums">{hLabel(recap.focusMin)} 집중</span>
        )}
      </div>
      {recap.wins.length ? (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {recap.wins.map((w, i) => (
            <li
              key={i}
              className="rounded-full border border-line-acc-soft bg-acc-soft px-2.25 py-1 text-xs leading-text font-semibold text-txt"
            >
              {w}
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-xs leading-normal text-mut">이번 주 기록이 쌓이면 여기 성취가 모여요.</div>
      )}
    </div>
  );
}

/** I-13 셧다운 체인 — 최근 14일 연속성 도트 + 'N일 연속' 배지 + 오늘 토글. "Don't break the chain". */
function ShutdownChain() {
  const state = useApp((s) => s.state);
  const mutate = useApp((s) => s.mutate);
  const chain = shutdownChain(state, 14);
  const today = useTodayISO(state);
  const todayDone = chain.days[chain.days.length - 1]?.done ?? false;
  const doneN = chain.days.filter((d) => d.done).length;
  const toggle = () => mutate((st) => setRitual(st, today, 'shutdown', !todayDone));
  return (
    <div className="mt-3 flex-none border-t border-line2 pt-2.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs leading-text font-extrabold tracking-widest text-mut">셧다운 체인</span>
        {chain.streak > 0 && (
          <span className="text-xs leading-text font-extrabold text-acc tabular-nums">
            <Icon name="flame" /> {chain.streak}일 연속
          </span>
        )}
      </div>
      <div className="mb-2.5 flex flex-wrap gap-1.25" role="img" aria-label={`최근 14일 중 ${doneN}일 셧다운 완료`}>
        {chain.days.map((d) => (
          <span
            key={d.ds}
            className={`size-3 rounded-xs border ${d.done ? 'border-acc bg-acc' : 'border-line2 bg-tint-mut'}`}
            title={`${d.ds}${d.done ? ' · 셧다운 완료' : ''}`}
          />
        ))}
      </div>
      <button
        type="button"
        className="appearance-none rounded-base! border border-line px-2.5! py-1.5! text-xs! leading-text! font-bold! hover:border-acc! hover:text-acc! aria-pressed:border-line-acc-hover! aria-pressed:bg-tint-acc-faint! aria-pressed:text-acc-on-soft!"
        onClick={toggle}
        aria-pressed={todayDone}
      >
        {todayDone ? '오늘 셧다운 완료 ✓ — 취소' : '오늘 하루를 닫기 — 셧다운 완료'}
      </button>
    </div>
  );
}

/* ── N-12 **하루가 주소를 갖는다**(W4 · 2026-08-07) ──────────────────────────────────
   보고 있는 날이 `useState` 였다. 그래서 "7/12 를 다시 열기"가 **경로 재현**이었다 — 탭을 열고
   스테퍼를 N번 누른다. 링크로 못 가리키는 것은 ⌘K 로도 못 찾고, 알림도 못 데려가고, 이 앱이
   자기 자신을 참조하지도 못한다(`journal` 이 로드맵에서 "매일 열 이유가 없는 아카이브"로 읽힌
   것과 무관하지 않다: 아카이브인데 **주소가 없어** 갈 이유가 발생하지 않았다).

   ⚠ **경로가 정본이고 `useState` 는 없다.** 스테퍼는 이제 `navigate` 다 — 뒤로가기가 날짜를
   되돌리고, 오늘로 오면 URL 이 `/day` 로 접힌다(오늘은 파라미터를 안 쓴다: 어제 남긴 `/day`
   링크가 오늘 열면 오늘을 보여 주는 것이 이 주소의 뜻이다).
   ⚠ 미래는 못 간다 — 주소로 들어와도 마찬가지다. `ds` 를 URL 에서 받으므로 **입력을 신뢰하지
   않는다**: 형식이 아니거나 미래면 오늘로 접는다(잘못된 주소가 빈 화면을 그리는 것보다 낫다). */
export default function Day() {
  const state = useApp((s) => s.state);
  const navigate = useNavigate();
  const { ds } = useParams<{ ds: string }>();
  const today = useTodayISO(state); // '오늘' 단일 출처 존중 (+ 자정 자동 롤오버 H20)
  const ds2 = ds && /^\d{4}-\d{2}-\d{2}$/.test(ds) && ds <= today ? ds : today;
  const isToday = ds2 === today;
  const setDs2 = (next: string): void => {
    // 오늘이면 파라미터 없는 주소로 접는다 — 그 주소의 뜻이 "오늘"이다.
    navigate(next === today ? DAY_PATH : `${DAY_PATH}/${next}`, { replace: true });
  };
  // C-10: 빠른 캡처가 파싱한 날짜로 기록 탭을 이동(백필). nonce 변화 시점에만 반응(usePrefillForm과 같은 규율).
  // 로컬 setState는 컴파일러 set-state-in-effect에 걸려(usePrefillForm의 prop setter는 불투명해 통과) setTimeout 비동기 커밋으로 회피.
  const prefillNonce = usePrefill((s) => s.nonce);
  const prefillDs = usePrefill((s) => s.ds);
  useEffect(() => {
    if (!(prefillDs && prefillDs <= today)) return;
    const t = setTimeout(() => setDs2(prefillDs), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillNonce]);
  const stepDay = (d: number) => {
    const next = iso(addDays(parseISO(ds2), d));
    if (next > today) return; // 미래 금지
    setDs2(next);
  };
  /* ⚠ **리드아웃은 화면이 보고 있는 날을 따라간다**(`ds2`), '오늘'이 아니라.
     종전엔 여기만 `today` 였고 스트림·입력 폼은 `ds2` 였다 → '과거 보충' 으로 7/12 요약을
     저장해도 최상단 `요약` 숫자가 그대로였다. 리드아웃은 "0.5초에 상태를 읽는 자리"라는 계약을
     정면으로 깨는 자리다(저장이 됐는지 목록을 다시 훑게 만든다).
     ⚠ `열린 보충` 만 날짜 무관이다 — 그건 "오늘까지 안 닫힌 것" 전량이라 선택 날짜와 무관하다. */
  const sumN = summariesFor(state, ds2).length;
  const cbmsN = cbmsBetween(state, ds2, ds2).length;
  const openN = openBacklog(state).length;
  /* 내보내기는 **오늘 것**을 내보낸다(`'today'`) → 게이트도 오늘 수로 본다. 리드아웃과 다른
     날을 보는 것이 맞다: 라벨이 따라가는 것은 *보고 있는 날*이고, 액션이 따르는 것은 *하는 일*이다. */
  const todaySumN = isToday ? sumN : summariesFor(state, today).length;
  const todayCbmsN = isToday ? cbmsN : cbmsBetween(state, today, today).length;

  usePageChromeEffect(
    () => ({
      /* W22 앵커 예산 — 44px 로 자기 값을 말한다(원칙 ②의 물리적 표현).
         ⚠ 종전 이 줄은 _"**destination 은** 자기 값을 44px 로 말한다"_ 였다(M-15 · 2026-08-06 정정).
         `journal` 은 W9 에서 **lens 로 강등**됐으므로 그 문장은 이제 자기 자신을 설명하지 않는다.
         앵커를 **유지하는 것은 판단이다**: 이 화면의 일은 여전히 "오늘 몇 건을 남겼나"이고,
         역할(나브에 서는가)과 값의 크기(무엇이 제일 중요한가)는 다른 축이다. 실제로 앵커를 세운
         lens 는 여섯이다(`alloc`·`items`·`forecast`·`mistakes`·`questions`·여기) — `find` 의
         _"렌즈다 — 44px 앵커를 세우지 않는다"_ 는 그 화면의 **지역 판단**이지 규약이 아니다.
         0이어도 그린다 — 기록 탭에서 0은 "아직 안 썼다"라는 **행동을 바꾸는 사실**이지 값 부재가 아니다.
         ⚠⚠ 첫 판은 `sumN + cbmsN` **합계**였고 그 아래 리드아웃이 같은 둘을 **분해**로 또 그렸다 —
         W7 이 레일 배지에서 금지한 바로 그 형태를 이 배치가 스스로 새로 만든 것이다(실렌더가
         잡았다). 게다가 `selectors.ts` 는 _"둘은 성격이 다른 일이라 합치면 어느 쪽도 행동으로
         안 이어진다"_ 라 이미 적어 뒀다. → 헤드라인은 **요약**(이 탭의 주된 산출) 하나이고,
         리드아웃에서는 그 칸을 뺀다(한 양 = 한 자리). */
      primary: { value: String(sumN), unit: '건', label: isToday ? '오늘 요약' : `${ds2.slice(5)} 요약` },
      readouts: [
        // 오늘이 아니면 라벨에 날짜를 붙인다 — 안 붙이면 과거 수치가 오늘 수치로 읽힌다.
        { label: isToday ? '오답' : `오답 · ${ds2.slice(5)}`, value: cbmsN },
        { label: '열린 보충', value: openN },
      ],
      // 무데이터면 빈 파일 데드엔드 → 상단바 액션 자체를 미노출(카드 내부 버튼은 canExport로 별도 가드).
      action:
        todaySumN || todayCbmsN ? { label: 'Anki 카드(.txt)', onClick: () => exportAnkiCards('today') } : undefined,
    }),
    [sumN, cbmsN, openN, isToday, ds2, todaySumN, todayCbmsN],
  );

  return (
    <section className="h-full min-w-0" aria-label="학습 기록">
      <div className="grid h-full min-h-0 grid-cols-journal max-wide:grid-cols-1 max-wide:overflow-y-auto">
        {/* 좌 — 로그(시그니처, fill) + 최근 활동(온디맨드). 선택 날짜를 따라간다. */}
        <div className="flex min-h-0 min-w-0 flex-col px-5.5 pt-5.5 pb-4.5 max-wide:min-h-90">
          <JournalStream ds={ds2} isToday={isToday} fill />
          <WeeklyRecapCard />
          <ActivityFeed ds2={ds2} />
          <ShutdownChain />
          <div className="mt-2.5 flex-none text-xs leading-normal text-mut">
            공부 뒤 남기는 산출물({fmt(new Date(ds2 + 'T00:00:00'))}) — 블록을 끝낼 때마다 하나씩. 누적 추세·약점 분포는{' '}
            <button
              type="button"
              className="appearance-none border-none! bg-transparent! p-0! text-xs! leading-normal! font-extrabold! text-acc! underline decoration-acc-glow underline-offset-2 hover:decoration-acc"
              onClick={() => navigate('/stats', { viewTransition: true })}
            >
              통계
            </button>
            ·
            <button
              type="button"
              className="appearance-none border-none! bg-transparent! p-0! text-xs! leading-normal! font-extrabold! text-acc! underline decoration-acc-glow underline-offset-2 hover:decoration-acc"
              onClick={() => navigate('/review', { viewTransition: true })}
            >
              주간 리뷰
            </button>
            에서.
          </div>
        </div>
        {/* 우 — 기록 입력(온화면 패널, 스크롤) */}
        <div className="min-w-0 [scrollbar-width:thin] overflow-y-auto border-l border-line2 px-5 pt-5 pb-7 max-wide:border-t max-wide:border-l-0">
          <div className="ds-caps mb-3">기록 입력 — 요약 · 오답 · 보충</div>
          {/* 날짜 스테퍼 — 과거 보충 진입점. 오늘이면 담백하게, 과거면 강조 배너. */}
          <div
            className={`mb-3.5 flex items-center gap-2 rounded-base border px-2.5 py-1.75 ${isToday ? 'border-line bg-panel2' : 'border-line-warn-strong bg-tint-warn-faint'}`}
          >
            <Button sm variant="ghost" onClick={() => stepDay(-1)} aria-label="이전 날">
              <Icon name="chevronLeft" />
            </Button>
            <span className="text-md font-bold text-txt">
              {fmt(new Date(ds2 + 'T00:00:00'))}
              {isToday ? <span className="ds-tiny text-mut"> · 오늘</span> : <b> · 과거 보충</b>}
            </span>
            <Button sm variant="ghost" onClick={() => stepDay(1)} disabled={isToday} aria-label="다음 날">
              <Icon name="chevronRight" />
            </Button>
            {/* ⚠ **±1 스테퍼만 있으면 7일 전은 7클릭이다**(U037 · 2026-08-21 ux 축). 이 패널의
                존재 이유가 «과거 보충» 인데, 실제로 보충하는 날은 «며칠 전»이지 «어제»가 아니다.
                날짜 입력을 그 옆에 둔다 — 새 어휘가 아니라 **네이티브 컨트롤**이고(`type="date"`
                는 이 저장소가 이미 시험일·마감에서 쓴다), 키보드·스크린리더 경로가 그대로 온다.
                ⚠ `max` 로 미래를 막는다 — `stepDay` 가 코드로 막던 규칙을 컨트롤도 알게 한다. */}
            <input
              type="date"
              className="ds-tiny"
              aria-label="날짜 고르기"
              value={ds2}
              max={today}
              onChange={(e) => {
                const v = e.target.value;
                if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v <= today) setDs2(v);
              }}
            />
            {!isToday && (
              <Button sm variant="ghost" onClick={() => setDs2(today)} style={{ marginLeft: 'auto' }}>
                오늘로
              </Button>
            )}
          </div>
          <BatchCapture />
          <SummaryCard ds={ds2} />
          <CbmsCard ds={ds2} />
          <BacklogCard />
        </div>
      </div>
    </section>
  );
}
