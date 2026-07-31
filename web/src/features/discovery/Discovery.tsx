/* ============================================================
   Discovery(발견) — 탭: ✦ 발견 큐(P9 Phase 6 Wave④ · 축 C · D5 사람=승격).
   승격.py 발견큐(state/_발견큐.json)를 소비 — surface(미개척)·다리개념·수집맥락·가능신호 후보를
   사람이 승격/기각한다. "기계가 firehose(다량 수집·발견), 사람이 승격(희소·고가치)"의 사람 절반.
   승인/기각 = `run_tool` 로 승격.py --promote/--dismiss 호출 → 큐 재페치.
   콜드(수집·발견 미가동 · goals: 링크 0)면 파일 부재→404→빈 inbox 정직 안내.
   레이어: store(queries·usePageChrome)·lib(discovery·api)만 소비. app/다른 feature import 금지(boundaries).
============================================================ */
import { useMemo, useState } from 'react';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { useDiscovery, DISCOVERY_KEY } from '@/store/queries';
import { useQueryClient } from '@tanstack/react-query';
import {
  discoveryStatusCounts,
  pendingEntries,
  entryTitle,
  entryGoals,
  DISCOVERY_KIND_META,
  DISCOVERY_DECISION_TOOL,
  type DiscoveryEntry,
  type DiscoveryDecision,
} from '@/lib/discovery';
import { runTool } from '@/lib/api';
import { needsWorkspace, toolFailureCopy } from '@/lib/artifactState';
import { ui } from '@/shell';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui';
import State from '@/components/State';

/* ── C-7 Tailwind 이식(첫 feature) ───────────────────────────────────────
   `Discovery.module.css` 를 없앴다. 규약은 `styles/tokenBridge.css` + `phone/phone.css`
   머리주석이 소유한다(색은 tokens.css 파생 · 임의값 금지 · 사다리로 반올림).

   ⚠ **픽셀이 조금 움직인다 — 의도된 것이다.** 사다리 밖 값(48/22/18/14/9/6/5/2px 간격,
   14/12px 반경 등)을 가장 가까운 사다리 칸으로 반올림했다. 사용자 결정(2026-07-20):
   사다리를 수백 칸으로 불리는 대신 흘러내린 임의 값을 정리하는 쪽. 스냅샷은 이 이식과
   함께 **의도적으로** 재생성했고 diff 를 눈으로 확인했다.

   ⚠ kind 배지 색은 **정적 맵**이다. 옛 코드는 `s['kind_' + entry.kind]` 로 클래스명을
   런타임에 조립했는데, Tailwind 는 소스를 문자열로 훑으므로 **그렇게 만든 클래스는
   생성되지 않는다**(조용히 스타일 없음). 린터도 못 본다. 조립 금지가 규약이다. */
const KIND_CLASS: Record<string, string> = {
  uncovered: 'bg-acc-soft text-acc-on-soft',
  bridge: 'bg-tint-acc2-strong text-acc2',
  survey_context: 'bg-tint-good text-good',
  capability: 'bg-tint-learning text-learning',
};
const ROOT = 'px-5 pt-4 pb-6';

export default function Discovery() {
  const navigate = useNavigate();
  const disc = useDiscovery();
  const qc = useQueryClient();
  const data = disc.data;
  const [busy, setBusy] = useState<string | null>(null); // 결정 진행 중인 후보 id(행 잠금).

  const counts = useMemo(() => discoveryStatusCounts(data), [data]);
  const pending = useMemo(() => pendingEntries(data), [data]);

  usePageChromeEffect(
    () => ({
      /* W22/H3 — `primary` 는 **필수 키**다(`store/usePageChrome.ts` 머리주석). 이 화면은 렌즈라
         44px 앵커를 세우지 않는다 — 잊은 것이 아니라 없다고 정한 것이다. */
      primary: null,
      readouts: [
        { label: '미결', value: counts.pending },
        { label: '승격', value: counts.promoted },
        { label: '기각', value: counts.dismissed },
      ],
    }),
    [counts.pending, counts.promoted, counts.dismissed],
  );

  // 사람 결정 — 백엔드가 살아 있으면 승격.py 를 호출하고 큐를 재페치(낙관 갱신 대신 SSOT 재조회 = 멱등 규율 존중).
  const decide = async (id: string, decision: DiscoveryDecision) => {
    if (busy) return;
    setBusy(id);
    try {
      const r = await runTool(DISCOVERY_DECISION_TOOL[decision], { subject: id });
      if (r.ok && r.code === 0) {
        ui.toast(decision === 'promote' ? '후보를 승격했어요(→ 개론 분해 핸드오프).' : '후보를 기각했어요.', 'ok');
        await qc.invalidateQueries({ queryKey: DISCOVERY_KEY });
      } else {
        ui.toast((r.out || '').slice(0, 140) || `${needsWorkspace('결정을 반영하지 못했어요')}.`, 'bad');
      }
    } catch (e) {
      // H23 — 사유를 버리지 않는다(같은 오진이 두 곳에 있었다).
      ui.toast(`${toolFailureCopy(e, '결정을 반영하지 못했어요')}.`, 'bad');
    } finally {
      setBusy(null);
    }
  };

  if (disc.isLoading) {
    return (
      /* ⚠⚠ **여기 `SkeletonText lines={4}` 가 있었다 — 거짓말하는 뼈대였다**(W15 · 2026-07-31).
         N-4 는 "생 문장 대신 형상"을 근거로 골격을 넣었는데, 발견 큐는 **길이가 데이터에 따라
         변한다**: 골격이 4행을 약속하고 12행이 오면 그건 로딩이 아니라 오답이고, 없애려던
         레이아웃 점프를 골격이 스스로 만든다. 끝을 모르는 대기의 정직한 표현은 `indeterminate` 다.
         SR 공지는 `State` 가 `role=status` 로 소유한다(옛 sr-only 사본 제거). */
      <section className={ROOT}>
        <State kind="loading" shape="indeterminate" title="발견 큐를 불러오는 중" />
      </section>
    );
  }

  // 콜드 정직성 — 파일 부재(404)나 pending 0. 발견 루프가 아직 안 돌았을 뿐(약점 없음 아님과 동형).
  if (disc.isError || !data || pending.length === 0) {
    return (
      <section className={ROOT}>
        <State
          glyph="✦"
          title={counts.promoted + counts.dismissed > 0 ? '미결 후보가 없어요' : '발견 큐가 아직 비어 있어요'}
          /* ⚠ 두 상태는 **처방이 다르다**. "다 처리했다"는 정상 종착이라 억지 CTA 를 두면
             성공한 사람에게 할 일을 만들어 주는 꼴이고, "큐가 비었다"는 파이프라인이 안 돈
             것이라 갈 곳이 있다. `next` 가 필수라 이 구분을 안 하고는 렌더가 안 된다. */
          next={
            counts.promoted + counts.dismissed > 0 ? (
              { terminal: '수집·발견이 더 돌면 새 후보가 차오릅니다.' }
            ) : (
              <Button sm onClick={() => navigate('/control')}>
                탐구 수집 열기 →
              </Button>
            )
          }
          desc={
            counts.promoted + counts.dismissed > 0 ? (
              <>
                모두 처리했어요 — 승격 {counts.promoted} · 기각 {counts.dismissed}. 수집·발견이 더 돌면 새 후보가
                차오릅니다.
              </>
            ) : (
              <>
                발견 루프(수집→surface·다리개념)가 아직 안 돌았어요. 핵심 노트에 <code>goals:</code> 링크를 달고 수집
                소스가 켜지면 “내 목표 근접하나 아직 노트 없는 개념”이 여기 후보로 표면화됩니다(승격.py).
              </>
            )
          }
        />
      </section>
    );
  }

  return (
    <section className={ROOT}>
      <header className="mb-4 rounded-lg border border-line-acc bg-linear-to-b from-acc-soft to-transparent p-5">
        <div className="font-mono text-xs font-semibold tracking-wide text-acc uppercase">발견 · 축 C</div>
        <h1 className="mt-1! mb-2! text-xl! tracking-tight!">✦ 발견 큐</h1>
        <p className="m-0 max-w-prose text-sm leading-normal text-mut">
          기계가 표면화한 후보를 <b>사람이 승격/기각</b>합니다 — 승격은 개론 섹션을 atomic 노트로 분해하는 핸드오프(핵심
          지시문 파이프라인), 기각은 큐에서 내림. 결정은 재실행에도 보존됩니다(멱등).
        </p>
      </header>

      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {pending.map((e) => (
          <Candidate key={e.id} entry={e} busy={busy === e.id} disabled={busy != null} onDecide={decide} />
        ))}
      </ul>
    </section>
  );
}

/** 후보 1건 — kind 배지 · 제목 · (다리개념이면) 잇는 목표 · source · score + 승격/기각. */
function Candidate({
  entry,
  busy,
  disabled,
  onDecide,
}: {
  entry: DiscoveryEntry;
  busy: boolean;
  disabled: boolean;
  onDecide: (id: string, decision: DiscoveryDecision) => void;
}) {
  const meta = DISCOVERY_KIND_META[entry.kind];
  const goals = entryGoals(entry);
  return (
    <li
      className={`flex items-center gap-3 rounded-md border border-line bg-panel px-3 py-3 transition-colors hover:border-line-acc-strong ${busy ? 'pointer-events-none opacity-50' : ''}`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-baseline gap-2">
          {/* 툴팁 설명은 aria-label로도 실어야 스크린리더에 닿는다(TooltipHost가 네이티브 title 대체). */}
          <span
            className={`flex-none rounded-full px-2 py-1 text-xs font-semibold whitespace-nowrap ${KIND_CLASS[entry.kind] ?? ''}`}
            data-tip={meta?.hint}
            role="img"
            aria-label={`${meta?.label ?? entry.kind}${meta?.hint ? ` — ${meta.hint}` : ''}`}
          >
            {meta?.label ?? entry.kind}
          </span>
          <h2 className="m-0! truncate text-md! tracking-tight!">{entryTitle(entry)}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mut">
          {goals.length > 0 && (
            <span
              className="text-acc-on-txt"
              data-tip="이 개념이 잇는 활성 하위목표"
              role="img"
              aria-label={`이 개념이 잇는 활성 하위목표: ${goals.join(', ')}`}
            >
              🎯 {goals.join(' · ')}
            </span>
          )}
          <span
            className="font-mono"
            data-tip="후보를 낸 표면(발견.py 함수)"
            role="img"
            aria-label={`후보를 낸 표면: ${entry.source}`}
          >
            {entry.source}
          </span>
          <span
            className="ml-auto font-semibold text-txt tabular-nums"
            data-tip="랭킹 점수(목표 근접·중심성 등)"
            role="img"
            aria-label={`랭킹 점수 ${entry.score.toFixed(2)} — 목표 근접·중심성 등`}
          >
            {entry.score.toFixed(2)}
          </span>
        </div>
      </div>
      <div className="flex flex-none gap-1">
        <Button sm variant="primary" disabled={disabled} onClick={() => onDecide(entry.id, 'promote')}>
          {busy ? '…' : '승격'}
        </Button>
        <Button sm variant="ghost" danger disabled={disabled} onClick={() => onDecide(entry.id, 'dismiss')}>
          기각
        </Button>
      </div>
    </li>
  );
}
