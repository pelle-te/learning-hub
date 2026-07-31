import { Card } from './Card';

/* Skeleton — 콘텐츠 로딩 자리표시. 탭 청크가 로드되는 짧은 순간 "불러오는 중…" 텍스트 대신
   레이아웃 형태를 미리 보여줘 체감 지연을 줄이고 레이아웃 시프트를 막는다.

   ── C-7 마지막 티어 이식(Tailwind) ─────────────────────────────────────────
   색 두 단계와 그라데이션은 `tokens.css` 로 올렸다(옛 `.line` 지역 변수 → 절대규칙 #3).
   ⚠ `200% 100%`(background-size)와 그라데이션은 임의값으로 못 적는다(내부 `%` 가 룰에 걸린다)
   → 토큰 이름으로 참조한다(`--grain`·`--acc-fill` 과 같은 관용구).
   키프레임은 전역(`tw.css`) — CSS Modules 가 이름을 스코프해 유틸에서 못 부르던 제약의 잔재다. */
const LINE =
  'h-3.25 rounded-sm bg-sk-base bg-[image:var(--bg-skeleton)] bg-[length:var(--bg-size-skeleton)] animate-[live-flow_var(--tempo-fast)_var(--ease)_infinite] motion-reduce:animate-none';
const STACK = 'space-y-2.75';

/** 단일 스켈레톤 줄. width로 폭을, height로 높이를 조절. */
export function Skeleton({ width, height }: { width?: string | number; height?: string | number }) {
  return <div className={LINE} style={{ width, height }} aria-hidden="true" />;
}

/** 여러 줄 스켈레톤(제목 + 본문 라인들). lines로 본문 줄 수 조절. */
/* ⚠⚠ **features 에서는 쓰지 않는다(W15 · 2026-07-31 · 불변식이 잠근다).**
   줄 수를 지어내는 프리미티브라, 길이가 데이터에 따라 변하는 목록에 쓰면 **골격이 3행을 약속하고
   12행이 오는** 상태가 된다 — 없애려던 레이아웃 점프를 골격이 스스로 만든다. 끝을 모르는 대기는
   `<State kind='loading' shape='indeterminate'>` 다. 여기 남은 이유는 `SkeletonCard` 가 쓰기 때문
   (그건 **카드 한 장**이라 줄 수가 형상으로 확정된다 — 지어내는 것이 아니다). */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className={STACK}>
      <Skeleton width="42%" height={16} />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '70%' : '100%'} />
      ))}
    </div>
  );
}

/** 탭 청크 로딩용 카드형 스켈레톤(Suspense 폴백 표준).
 *  스켈레톤 줄은 aria-hidden(장식)이라 스크린리더엔 침묵 → role="status" SR 안내로 로딩을 알린다. */
export function SkeletonCard({ lines = 4 }: { lines?: number }) {
  return (
    <Card>
      <span role="status" className="sr-only">
        불러오는 중…
      </span>
      <SkeletonText lines={lines} />
    </Card>
  );
}

/* ── 전면(fill) 탭의 로딩 골격(N-4) ────────────────────────────────────────
   착지 화면 **16개가 전면 fill 대시보드**인데 탭 진입 폴백은 `SkeletonCard` 한 장이었다.
   즉 프레임 상단에 작은 카드 하나가 떴다가 화면 전체가 갈아 끼워지는 **레이아웃 점프**가
   매 진입마다 났다 — 스켈레톤이 막으려던 바로 그 현상을 스켈레톤이 만들고 있었다.

   ⚠ **탭마다 골격을 따로 정의하지 않는다.** 그러면 그리드가 두 벌이 되어 서로 표류하고,
   점프는 조용히 되돌아온다(그때는 "스켈레톤이 있는데도" 나서 원인을 더 못 찾는다).
   대신 이 저장소의 fill 탭이 **공유하는 구조**만 그린다: 상단 리드아웃 · 본문 · 하단 스트립
   (재설계 사상의 3단). 정확히 맞지는 않아도 **틀린 크기가 아니다**가 목표다.

   ⚠ 애니메이션은 `LINE` 이 소유하고 `motion-reduce` 로 꺼진다(위). 여기선 기하만 정한다. */
const FILL_WRAP = 'flex h-full w-full flex-col gap-4 p-5';
const FILL_ROW = 'flex gap-3';

/** 전면 대시보드 탭(`TabMeta.fill`)의 Suspense 폴백 — 프레임을 실제로 채운다.
 *  ⚠ `label` — SR 공지 문구. `components/State` 의 `shape='frame'` 이 **자기 제목**을 넘긴다
 *  (W15). 넘기지 않으면 일반 문구인데, 그러면 화면마다 "불러오는 중…"만 들려 무엇을 기다리는지
 *  알 수 없다. 리전을 둘 두지 않는 것도 이유다 — 여기 하나가 공지의 유일한 자리다. */
export function SkeletonFill({ label = '불러오는 중…' }: { label?: string } = {}) {
  return (
    <div className={FILL_WRAP}>
      <span role="status" className="sr-only">
        {label}
      </span>
      {/* 상단 리드아웃 — 세 값이 가로로 서는 형태(usePageChrome 이 세우는 그것). */}
      <div className={FILL_ROW}>
        <Skeleton width="18%" height={13} />
        <Skeleton width="12%" height={13} />
        <Skeleton width="12%" height={13} />
      </div>
      {/* 본문 — 남는 높이를 전부 먹는다. 이 한 칸이 '점프 없음'의 대부분을 만든다. */}
      <Skeleton width="100%" height="100%" />
      {/* 하단 스트립 — 신호 그룹 3~5개가 가로로 서는 형태. */}
      <div className={FILL_ROW}>
        <Skeleton width="22%" height={44} />
        <Skeleton width="22%" height={44} />
        <Skeleton width="22%" height={44} />
        <Skeleton width="22%" height={44} />
      </div>
    </div>
  );
}
