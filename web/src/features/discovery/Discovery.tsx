/* ============================================================
   Discovery(발견) — 탭: ✦ 발견 큐(P9 Phase 6 Wave④ · 축 C · D5 사람=승격).
   승격.py 발견큐(state/_발견큐.json)를 소비 — surface(미개척)·다리개념·수집맥락·가능신호 후보를
   사람이 승격/기각한다. "기계가 firehose(다량 수집·발견), 사람이 승격(희소·고가치)"의 사람 절반.
   승인/기각 = serve.js /api/run 으로 승격.py --promote/--dismiss 호출 → 큐 재페치.
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
import { ui } from '@/shell';
import { Button } from '@/components/ui';
import EmptyState from '@/components/EmptyState';
import s from './Discovery.module.css';

export default function Discovery() {
  const disc = useDiscovery();
  const qc = useQueryClient();
  const data = disc.data;
  const [busy, setBusy] = useState<string | null>(null); // 결정 진행 중인 후보 id(행 잠금).

  const counts = useMemo(() => discoveryStatusCounts(data), [data]);
  const pending = useMemo(() => pendingEntries(data), [data]);

  usePageChromeEffect(
    () => ({
      readouts: [
        { label: '미결', value: counts.pending },
        { label: '승격', value: counts.promoted },
        { label: '기각', value: counts.dismissed },
      ],
    }),
    [counts.pending, counts.promoted, counts.dismissed],
  );

  // 사람 결정 — serve.js 온라인이면 승격.py 를 호출하고 큐를 재페치(낙관 갱신 대신 SSOT 재조회 = 멱등 규율 존중).
  const decide = async (id: string, decision: DiscoveryDecision) => {
    if (busy) return;
    setBusy(id);
    try {
      const r = await runTool(DISCOVERY_DECISION_TOOL[decision], { subject: id });
      if (r.ok && r.code === 0) {
        ui.toast(decision === 'promote' ? '후보를 승격했어요(→ 개론 분해 핸드오프).' : '후보를 기각했어요.', 'ok');
        await qc.invalidateQueries({ queryKey: DISCOVERY_KEY });
      } else {
        ui.toast((r.out || '').slice(0, 140) || '결정을 반영하지 못했어요(serve.js 필요).', 'bad');
      }
    } catch {
      ui.toast('결정을 반영하지 못했어요(serve.js 필요).', 'bad');
    } finally {
      setBusy(null);
    }
  };

  if (disc.isLoading) {
    return (
      <section className={s.root}>
        <p className={s.muted}>발견 큐를 불러오는 중…</p>
      </section>
    );
  }

  // 콜드 정직성 — 파일 부재(404)나 pending 0. 발견 루프가 아직 안 돌았을 뿐(약점 없음 아님과 동형).
  if (disc.isError || !data || pending.length === 0) {
    return (
      <section className={s.root}>
        <EmptyState
          glyph="✦"
          title={counts.promoted + counts.dismissed > 0 ? '미결 후보가 없어요' : '발견 큐가 아직 비어 있어요'}
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
    <section className={s.root}>
      <header className={s.hero}>
        <div className={s.kicker}>발견 · 축 C</div>
        <h1 className={s.title}>✦ 발견 큐</h1>
        <p className={s.desc}>
          기계가 표면화한 후보를 <b>사람이 승격/기각</b>합니다 — 승격은 개론 섹션을 atomic 노트로 분해하는 핸드오프(핵심
          지시문 파이프라인), 기각은 큐에서 내림. 결정은 재실행에도 보존됩니다(멱등).
        </p>
      </header>

      <ul className={s.list}>
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
    <li className={`${s.card} ${busy ? s.cardBusy : ''}`}>
      <div className={s.cardMain}>
        <div className={s.cardHead}>
          <span className={`${s.kind} ${s['kind_' + entry.kind]}`} data-tip={meta?.hint}>
            {meta?.label ?? entry.kind}
          </span>
          <h2 className={s.cardTitle}>{entryTitle(entry)}</h2>
        </div>
        <div className={s.meta}>
          {goals.length > 0 && (
            <span className={s.goals} data-tip="이 개념이 잇는 활성 하위목표">
              🎯 {goals.join(' · ')}
            </span>
          )}
          <span className={s.src} data-tip="후보를 낸 표면(발견.py 함수)">
            {entry.source}
          </span>
          <span className={s.score} data-tip="랭킹 점수(목표 근접·중심성 등)">
            {entry.score.toFixed(2)}
          </span>
        </div>
      </div>
      <div className={s.actions}>
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
