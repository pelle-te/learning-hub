/* ============================================================
   Integrations — 탭: 🔗 연동 현황 (Phase 5 · 서버/외부)
   외부 자료를 읽는 두 읽기전용 패널(볼트·Anki)을 한 탭에 합친다(레거시 ui-integrations 동형).
   각 패널이 자기 FS Access/AnkiConnect 호출과 Query 캐시를 소유.
============================================================ */
import { useMemo } from 'react';
import { useQuery, skipToken } from '@tanstack/react-query';
import { usePing } from '@/store/queries';
import { useApp } from '@/store/useApp';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { totalDue, type AnkiLive } from '@/lib/anki';
import { subjectJoin } from '@/lib/subjectMatch';
import type { VaultScan } from '@/lib/vault';
import TelemetryConsole from './TelemetryConsole';
import { VaultPanel } from './VaultPanel';
import { AnkiPanel } from './AnkiPanel';

export default function Integrations() {
  // 상단 바 리드아웃 — TelemetryConsole과 같은 캐시(skipToken=fetch 없이 구독) + usePing로 연결 요약만.
  const ping = usePing();
  const vault = useQuery<VaultScan>({ queryKey: ['vault'], queryFn: skipToken }).data;
  const live = useQuery<AnkiLive>({ queryKey: ['ankiLive'], queryFn: skipToken }).data;
  const online = ping.isSuccess && !!ping.data?.ok;
  const subjects = vault?.subjects.length ?? 0;
  const due = live ? totalDue(live.decks) : 0;

  /* E3 조인 계기 — 앱의 과목 이름이 지식엔진 산출의 과목 이름에 **몇 개나 붙는가**.
     그 매칭은 `masteryNeed` 를 통해 배분을 실제로 구동하는데 실패가 조용해서(안 붙으면 null)
     성공률이 어느 화면에도 없었다. 이 미지수 하나가 보류 셋을 막고 있다(`p_eff` tie-break ·
     유지 큐 Anki 중복 제외 · 폰 볼트 노트 미러) — 재려면 여기 한 줄이면 된다. */
  const items = useApp((s) => s.state.items);
  const know = useApp((s) => s.state._knowState);
  const knowSubjects = useMemo(() => (know?.subjects ?? []).map((s) => s.subject), [know]);
  const join = useMemo(
    () =>
      subjectJoin(
        items.map((i) => i.name),
        knowSubjects,
      ),
    [items, knowSubjects],
  );
  /* ⚠ 후보가 0인 것과 이름이 안 맞는 것은 **처방이 다르다**(파이프라인 미가동 vs 표기 불일치).
     같은 `0/12` 로 뭉뚱그리면 사용자가 과목 이름을 고치러 가는 헛수고를 한다. */
  const noEngine = knowSubjects.length === 0;

  usePageChromeEffect(
    () => ({
      readouts: [
        { label: '볼트', value: vault ? `${subjects}과목` : '—', accent: true },
        { label: 'Anki due', value: live ? due : '—' },
        {
          label: '지식 조인',
          value: noEngine ? '—' : `${join.matched}/${join.total}`,
          accent: join.unmatched.length > 0,
        },
        { label: '워크스페이스', value: online ? '● 연결됨' : ping.isLoading ? '…' : '미설정' },
      ],
    }),
    [vault, subjects, live, due, online, ping.isLoading, noEngine, join.matched, join.total, join.unmatched.length],
  );

  return (
    <section className="h-full min-w-0" aria-label="연동 현황">
      <div className="grid h-full min-h-0 grid-cols-integrations max-wide:grid-cols-1 max-wide:overflow-y-auto">
        {/* 좌 — 가져오기 액션 패널(볼트·Anki) */}
        <div className="min-w-0 [scrollbar-width:thin] overflow-y-auto px-5.5 pt-5 pb-7">
          {/* E3 — 조인 성공률을 **이름까지** 말한다. 숫자만 주면 "9/12"를 보고도 어느 셋을 고쳐야
              하는지 모르고, 그러면 계측이 행동으로 안 이어진다. */}
          {join.total > 0 && (
            <p className="mb-3 text-xs text-mut">
              {!online ? (
                /* ⚠ **실렌더가 잡은 것**: 워크스페이스가 없으면 지식엔진 산출도 당연히 없다.
                   그 상태에서 "볼트를 재빌드하세요"라고 하면 **한 단계 아래 처방**을 주는 것이라
                   사용자가 할 수 없는 일을 시킨다. 원인이 위에 있으면 위를 말해야 한다. */
                <>워크스페이스를 아직 지정하지 않았어요 — 설정 탭에서 지정하면 볼트·숙달도가 연결됩니다.</>
              ) : noEngine ? (
                <>지식엔진 산출이 아직 없어요 — 볼트를 재빌드하면 과목 숙달도가 배분에 연결됩니다.</>
              ) : (
                <>
                  지식엔진 조인 <strong className="text-txt">{join.matched}</strong>/{join.total}
                  {join.unmatched.length > 0 && <> · 미연결: {join.unmatched.join(', ')}(이름 표기가 다릅니다)</>}
                </>
              )}
            </p>
          )}
          <VaultPanel />
          <div style={{ marginTop: 6 }}>
            <AnkiPanel />
          </div>
        </div>
        {/* 우 — 텔레메트리 조종석(백엔드·볼트·Anki 라이브 채널) */}
        <aside className="flex min-w-0 flex-col border-l border-line2 px-4.5 py-5 max-wide:min-h-70 max-wide:border-t max-wide:border-l-0 max-wide:border-line2">
          <TelemetryConsole vertical />
        </aside>
      </div>
    </section>
  );
}
