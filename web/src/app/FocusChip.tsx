/* ============================================================
   FocusChip — 전역 집중 세션 표시(TopBar 상주). useFocus 세션의 단일 감시자:
   ① 남은 시간 칩(어느 탭에서든 보임, 클릭 → 오늘 탭) ② 문서 제목 미러(탭 전환해도 보임)
   ③ 종료 감지 — 시스템 알림 + '블록 완료로 표시' 액션 토스트(한 번만).
============================================================ */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useFocus } from '@/store/useFocus';
import { useApp } from '@/store/useApp';
import { touchReview } from '@/lib/persistence';
import { mmss } from '@/lib/utils';
import { isTauri, shellNotify } from '@/lib/tauri';
import { MINI_PATH, enterMini, exitMini } from '@/lib/miniMode';
import { toast, toastChoice } from '@/shell/toast';
import { Icon } from '@/components/Icon';
import { confirmIrreversible } from '@/shell/destructive';
import { routeTitle } from './docTitle';
import { onVisible } from '@/lib/visibility';

/* ── C-7 셸 티어 5/5 이식(Tailwind) ─────────────────────────────────────────────
   TopBar 상주 칩 — 네온 헤어라인 + 라이브 펄스 + 모노 숫자. 색은 전부 --acc/--glow 파생
   토큰(절대규칙 #3). ⚠ 두 버튼은 raw `<button>` 이라 언레이어드 전역 `button{}` 을 상대한다
   (배경·보더·radius·padding·font 계열에 `!`). 자손(`b`·`span`)은 버튼의 UA `line-height:normal`
   을 상속하던 자리라 내장 크기명(text-lg/text-sm)에 `leading-auto` 을 함께 박는다(규약 6-b).
   펄스 키프레임은 tw.css 로 옮겼다(CSS Module 스코프 밖이어야 유틸에서 부를 수 있다).
   `FocusChip.module.css` 삭제. */
const CHIP =
  'inline-flex items-stretch self-center overflow-hidden rounded-chip border border-line-acc-pill bg-tint-acc-9 shadow-focus-chip';
const BODY =
  'inline-flex min-h-8.5 items-center gap-2 border-0! bg-transparent! px-3! py-0! text-ink! hover:bg-tint-acc-14! focus-visible:outline-2 focus-visible:outline-acc focus-visible:-outline-offset-2';
const PULSE =
  'size-1.75 rounded-full bg-acc shadow-focus-dot animate-[live-breathe_var(--tempo)_var(--ease-live)_infinite] motion-reduce:animate-none';
const TIME = 'text-lg leading-auto font-extrabold tracking-topbar-sub text-acc tabular-nums text-shadow-focus-time';
const NAME =
  'max-w-30 overflow-hidden text-ellipsis whitespace-nowrap text-sm leading-auto font-bold text-mut max-mobile:hidden';
const STOP =
  // ⚠ radius·padding 은 **건드리지 않는다** — 원본 `.stopBtn`/`.body` 가 그 속성을 선언하지 않아
  //    언레이어드 전역 `button{}`(radius 7px · padding 8/13px)을 그대로 받고 있었다. 유틸로 0 을
  //    박으면 '이식'이 아니라 변경이다(칩은 overflow-hidden 이라 radius 차이가 눈엔 거의 안 보인다).
  'inline-flex w-7.5 items-center justify-center border-0! border-l! border-l-line-acc! bg-transparent! text-2xs! leading-auto text-mut! hover:bg-tint-acc-8! hover:text-bad! focus-visible:outline-2 focus-visible:outline-acc focus-visible:-outline-offset-2';

const fmt = mmss; // 표기 규약은 lib/utils 가 단일 원천(CT-S3)

export default function FocusChip() {
  const session = useFocus((st) => st.session);
  const stop = useFocus((st) => st.stop);
  const clear = useFocus((st) => st.clear);
  const navigate = useNavigate();
  const location = useLocation();
  const [now, setNow] = useState(() => Date.now());
  /** 접기 — 창 조작이 성공했을 때만 라우팅한다(반쪽 상태 금지 · `miniMode` 머리주석). */
  const foldToMini = async (): Promise<void> => {
    if (await enterMini(location.pathname)) navigate(MINI_PATH);
  };
  const doneKey = useRef<number | null>(null);

  // 1초 틱(세션 중에만). 백그라운드 스로틀은 브라우저에 맡기고, 복귀·시작 시 즉시 캐치업.
  useEffect(() => {
    if (!session) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 세션 시작/복귀 시 스테일 now 즉시 보정.
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    const off = onVisible(() => setNow(Date.now())); // 복귀 시 스테일 now 캐치업
    return () => {
      clearInterval(id);
      off();
    };
  }, [session]);

  const leftSec = session ? Math.max(0, Math.round((session.endsAt - now) / 1000)) : 0;

  // 종료 감지 — 세션당 정확히 한 번. 집중: 알림 + 완료 토글 토스트 + 자동 휴식(5분).
  // 휴식: 가벼운 알림 + '다음 블록 시작' 액션(완료 토글·재휴식 없음).
  useEffect(() => {
    if (!session || leftSec > 0) return;
    if (doneKey.current === session.startedAt) return;
    doneKey.current = session.startedAt;
    const { ds, sid, type, name, blockMin, kind, chapter } = session;
    const isBreak = kind === 'break';
    // 즉석 집중(ID-3)은 대상 블록이 없어 완료 토글을 못(안) 한다 — 축하·자동 휴식은 집중과 같되
    // '블록 완료로 표시' 액션만 뺀다(유령 완료 방지). isBreak 은 여전히 false라 회복 휴식은 붙는다.
    const isFree = kind === 'free';
    /* ⚠⚠ **이 앱이 자동으로 알림을 쏘는 자리는 여기 하나다 — 그리고 하나로 유지한다.**
       조건: **사용자가 스스로 시작한 세션이 끝났을 때.** 마감 임박·복습 밀림·하루 셧다운은
       알리지 않는다. 그 셋은 전부 "앱이 사용자를 부르는" 방향이고, 이 저장소는 넛지 계열
       제안을 반복해서 거절해 왔다(로드맵 드롭 목록의 Web Push·넛지 항목들이 같은 판단이다).
       사용자가 시작을 눌렀다는 것이 곧 "끝나면 알려 달라"는 요청이라, 여기만 예외다.
       → "마감 알림도 넣자"는 재제안은 이 주석 한 줄로 끝난다.
       **P-8 은 이 트리거를 한 글자도 안 건드렸다** — 트리거는 그대로 하나이고, 그 하나의
       *내용*이 두꺼워졌을 뿐이다.

       ⚠⚠ **여기 `new Notification(...)` 이 있었고, 단 한 번도 뜬 적이 없다(실측 2026-08-01).**
       가드가 `Notification.permission === 'granted'` 였는데 `tauri://` WebView2 에서 그 값은
       **항상 `denied`** 이고 `requestPermission()` 도 프롬프트 없이 즉시 거부한다(CDP 프로브).
       즉 옛 주석이 _"실측은 아직 안 했다"_ 고 적어 둔 바로 그 자리에서, 이 앱의 개입 채널은
       1개가 아니라 **0개**였다. 지금은 Tauri 알림 플러그인이 진짜로 쏜다(`shellNotify`).
       ⚠ 실패는 여전히 조용하다 — 알림은 부가 신호이고 같은 사실을 아래 토스트가 화면 안에서
       말한다. 다만 이제 그 침묵이 "권한 없음"이지 "코드가 죽어 있음"이 아니다. */
    /* ── Q-25 재개 단서 ────────────────────────────────────────────────────────────────
       종전 본문은 `"${name} — 수고했어요."` 뿐이라 **다음 행동 정보가 0**이었다. 그런데 이
       세션은 *자리를 뜨라고* 만든 것이고, 알림은 대개 **자리를 비운 사이에** 읽힌다 — 즉
       돌아왔을 때 "어디까지 했더라"를 기억으로 재구성해야 했다.
       중단 복귀에는 **재개 지연**이 있고 **단서가 그것을 유의하게 줄인다**(Nature 2025) —
       우리에겐 이미 그 단서가 있다(`session.chapter`). 안 실어 보낼 이유가 없었다.
       ⚠ 단서는 **방금 한 것**이지 지시가 아니다. "다음엔 X 하세요"는 알림이 계획을 대신
       세우는 것이고, 그건 이 자리(사용자가 시작한 세션의 종료)의 권한 밖이다. */
    const cue = chapter ? ` 마지막: ${chapter}.` : '';
    void shellNotify(
      isBreak ? '휴식 끝' : '집중 세션 완료',
      isBreak
        ? '재충전 완료 — 다음 블록을 시작해볼까요?'
        : isFree
          ? `${name} — 수고했어요.${cue}`
          : `${name} — 수고했어요.${cue} 앱에서 블록을 완료로 표시할 수 있어요.`,
    );
    if (isBreak) {
      toast('휴식 끝 — 다음 블록을 시작해볼까요?', 'info', 10_000, {
        label: '집중 시작',
        onAction: () => useFocus.getState().startOnCurrent(),
      });
    } else if (isFree) {
      // 완료 액션 없음 — 즉석 세션은 기록에 남기지 않는다(수고 인정만).
      toast(`즉석 집중 완료 — ${name}. 수고했어요.`, 'info', 8_000);
    } else {
      /* ── P-8 세 갈래 · 시한 없음(2026-08-01) ────────────────────────────────
         ⚠⚠ 종전엔 이 토스트가 **10초**였고 액션이 **'블록 완료로 표시' 하나**였다. 그런데 이
         세션은 **자리를 뜨라고 만든 것**이라, 돌아왔을 땐 대개 이미 사라져 있었다 — 그러면
         완료 체크는 계획 탭에서 손으로 찾는 길뿐이다(화면 1개·클릭 3+). 즉 **가장 값나가는
         기록(G-1 실측 분)이 10초짜리 창에 걸려 있었다.** 이제 누를 때까지 안 사라진다.
         ⚠ 원래 이 갈래들은 **OS 알림 액션 버튼**에 두려던 것인데 Windows 에서 불가라
         (Actions API 는 모바일 전용 · 실측) 앱 안이 진다. */
      toastChoice(`집중 세션 완료 — ${name}`, 'info', [
        {
          label: '블록 완료로 표시',
          onAction: () => {
            const app = useApp.getState();
            /* G-1 — **실제로 집중한 분**을 함께 남긴다. 지금까지 회고 넷은 계획 분을 "집중한
               시간"으로 읽었고, 그중 `adherenceFactor` 는 그 값으로 미래 용량을 깎았다. 이 경로가
               실측을 아는 유일한 자리다(세션 총 길이 = `total` 초). 세션을 중간에 멈췄다면 그 세션은
               완료 토스트 자체가 안 뜨므로 여기 오는 값은 언제나 '끝까지 한 세션'이다. */
            app.toggleDone(ds, sid, type, blockMin, true, Math.round(session.total / 60));
            // ReviewRun發 세션은 챕터를 아니까 챕터 터치도 기록 — 위험모델 lastDs 갱신(감사 #22).
            if (chapter) app.mutate((st) => touchReview(st, sid, chapter, ds));
          },
        },
        /* ⚠⚠ **자동 휴식 5분이 여기서 은퇴했다(P-8).** 종전엔 세션이 끝나는 즉시
           `startBreak(5)` 가 돌아 **사용자가 요청하지 않은 세션을 앱이 시작하는 유일한 자리**
           였다 — 게다가 완료 토스트를 읽는 동안 이미 다음 타이머가 흐르고 있었다. 같은 5분을
           **선택지로** 옮긴다: 없어진 것은 자동성이지 기능이 아니다.
           ⚠ `startBreak` 의 유일한 호출부가 이 줄이다 — 지우면 휴식이 도달 불가가 된다. */
        { label: '5분 휴식', onAction: () => useFocus.getState().startBreak(5) },
        // '계속' 은 아무것도 안 한다 — 시한 없는 토스트를 닫는 정직한 출구다(닫기는 공통 처리).
        { label: '계속', onAction: () => {} },
      ]);
    }
    clear();
  }, [session, leftSec, clear]);

  /* 미니 모드 자동 복귀(N-8) — 세션이 끝나면 알약을 접고 원래 창·원래 탭으로 돌아온다.
     ⚠ 세션 종료를 이 컴포넌트가 단독 감시하므로(위 이펙트) 복귀도 여기 둔다. 미니 화면이
     자기 종료를 감시하게 만들면 감시자가 둘이 되고, 그러면 알림·완료 토스트가 두 번 뜬다.
     ⚠ `session` 이 null 이 되는 순간에 걸린다 — 자동 휴식이 곧바로 새 세션을 만들지만 그건
     다음 렌더의 새 session 이라 이 이펙트는 이미 복귀를 걸었다(휴식은 알약에 안 가둔다). */
  const inMini = location.pathname === MINI_PATH;
  useEffect(() => {
    if (!inMini || session) return;
    /* ⚠ 창 복원이 실패하면 **라우팅하지 않는다**(H9) — 알약 크기 그대로 다른 화면으로 넘어가면
       나갈 문(알약의 확장 버튼)까지 사라져 재시작 외 탈출이 없다. 알약에 머물면 다시 누를 수 있다. */
    void exitMini().then((back) => {
      if (back) navigate(back, { replace: true });
      else toast('창을 되돌리지 못했어요 — 다시 시도해 주세요.', 'bad');
    });
  }, [inMini, session, navigate]);

  // 문서 제목에 남은 시간 미러 — 다른 앱/탭에 가 있어도 세션이 보인다.
  useEffect(() => {
    if (!session) return;
    document.title = `${fmt(leftSec)} · ${session.name} — 러닝허브`;
    return () => {
      // 모듈로드 스냅샷이 아니라 종료 시점의 *현재* 라우트로 재계산 — App의 제목 이펙트는
      // 라우트 변경에만 발화하므로 여기서 복원하지 않으면 stale 제목이 남는다(X-9).
      document.title = routeTitle();
    };
  }, [session, leftSec]);

  if (!session) return null;
  const isBreak = session.kind === 'break';
  const mmss = fmt(leftSec);
  // 조기중단 confirm — 실수 클릭으로 세션이 날아가는 것 방지(휴식은 부담 없이 즉시 중단).
  const stopAsk = async () => {
    if (isBreak) return stop();
    if (
      await confirmIrreversible('집중 세션을 중단할까요? 진행 시간은 기록되지 않아요.', {
        title: '집중 중단',
        okLabel: '중단',
      })
    )
      stop();
  };
  return (
    <div className={CHIP}>
      <button
        type="button"
        className={BODY}
        onClick={() => navigate('/today', { viewTransition: true })}
        title={isBreak ? '휴식 중 — 오늘 탭으로' : '집중 세션 진행 중 — 오늘 탭으로'}
        aria-label={`${isBreak ? '휴식' : `집중 세션 ${session.name}`} 남은 시간 ${mmss} — 오늘 탭으로 이동`}
      >
        <i className={PULSE} aria-hidden="true" />
        <b className={TIME}>{mmss}</b>
        <span className={NAME}>
          {isBreak ? (
            <>
              <Icon name="coffee" /> 휴식
            </>
          ) : (
            session.name
          )}
        </span>
      </button>
      {/* 접기(N-8) — 셸에서만 뜬다. 브라우저(dev·트랙 A)엔 창 개념이 없어 눌러도 할 일이 없고,
          휴식은 5분짜리라 창을 접었다 펴는 비용이 값보다 크다. */}
      {!isBreak && isTauri() && (
        <button
          type="button"
          className={STOP}
          onClick={() => void foldToMini()}
          title="미니 타이머로 접기 — 항상 위에 뜨는 알약"
          aria-label="미니 타이머로 접기"
        >
          ▭
        </button>
      )}
      <button
        type="button"
        className={STOP}
        onClick={() => void stopAsk()}
        title={isBreak ? '휴식 중단' : '집중 중단'}
        aria-label={isBreak ? '휴식 타이머 정지' : '집중 타이머 정지'}
      >
        ■
      </button>
    </div>
  );
}
