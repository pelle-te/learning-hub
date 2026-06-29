/* ============================================================
   Control — 탭: 🛠 시스템 제어판 (Phase 5 · 서버/외부 = serve.js /api)
   화이트리스트 도구(지식상태 재빌드·볼트 건강검진·품질검사·Anki 신호·통계·탐구)를 버튼으로 실행.
   연결 여부는 usePing(Query) — file://·정적호스팅이면 우아한 오프라인 안내.
   '지식상태 재빌드' 성공 → ['knowledge'] 무효화 → 숙달도 지도·스케줄러 graphPriority 자동 갱신
   (레거시 loadKnowledgeFromAPI 수동 배선 제거 · 설계도 §1-B).
============================================================ */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePageChrome } from '@/store/usePageChrome';
import { usePing, KNOWLEDGE_KEY } from '@/store/queries';
import { runTool, type RunResult } from '@/lib/api';
import { ui } from '@/shell';
import { Button } from '@/components/ui';
import ds from '@/styles/ds.module.css';
import cm from './Control.module.css';

interface ToolDef {
  key: string;
  title: string;
  label: string;
  desc: string;
  feedsMastery?: boolean;
}
const TOOLS: ToolDef[] = [
  {
    key: 'knowledge-build',
    title: '🧠 지식상태 재빌드',
    label: '지식상태 재빌드',
    feedsMastery: true,
    desc: '지식엔진 — 선수그래프+관측으로 개념별 숙달도 재계산. 끝나면 숙달도 지도가 갱신됨.',
  },
  {
    key: 'vault-health',
    title: '🩺 볼트 건강검진',
    label: '건강검진',
    desc: '벌트DB — 노트/검증/플래그/고립/데드링크/Anki GUID 한눈에.',
  },
  {
    key: 'eval',
    title: '📐 지시문 품질 회귀검사',
    label: '품질검사',
    desc: '지시문평가 — 검증노트를 루브릭으로 채점, 베이스라인 대비 회귀 게이트.',
  },
  {
    key: 'anki-signal',
    title: '🃏 Anki 학습신호 갱신',
    label: '학습신호',
    desc: '학습신호 — AnkiConnect에서 due/lapse를 읽어 _anki신호.json 갱신(엔진 인출관측 소스).',
  },
  { key: 'vault-stats', title: '📊 볼트 통계', label: '통계', desc: '벌트DB — 과목×status×type 분포 표.' },
];

function StatsLine({ k, stats }: { k: string; stats: Record<string, number | boolean | undefined> }) {
  const s = stats;
  if (k === 'knowledge-build')
    return (
      <div className={cm.ctlstats}>
        노트 {(s.notes as number) ?? '?'} · 전체숙달{' '}
        <b>{s.overall != null ? Math.round((s.overall as number) * 100) + '%' : '?'}</b> · 숙달{' '}
        {(s.mastered as number) ?? 0}·학습중 {(s.learning as number) ?? 0}·약점 {(s.weak as number) ?? 0}·미관측{' '}
        {(s.unknown as number) ?? 0} · 프런티어 {(s.frontier as number) ?? 0}
      </div>
    );
  if (k === 'vault-health')
    return (
      <div className={cm.ctlstats}>
        노트 {(s.notes as number) ?? '?'} · 검증 {(s.verified as number) ?? '?'} · 플래그 {(s.flags as number) ?? '?'} ·
        데드링크 {(s.deadlinks as number) ?? '?'} {s.healthy ? '· ✅양호' : ''}
      </div>
    );
  if (k === 'eval')
    return (
      <div className={cm.ctlstats}>
        노트 {(s.notes as number) ?? '?'} · 코퍼스 평균 <b>{(s.corpus_mean as number) ?? '?'}/5</b>{' '}
        {s.regressed ? <span style={{ color: 'var(--bad)' }}>· ⚠ 회귀</span> : '· ✅ 회귀없음'}
      </div>
    );
  return null;
}

function ResultBlock({ k, r }: { k: string; r: RunResult }) {
  const stats = r.stats as Record<string, number | boolean | undefined> | undefined;
  return (
    <>
      {stats && <StatsLine k={k} stats={stats} />}
      <details className={cm.ctldetails} open={!r.ok}>
        <summary className={`${ds.tiny} ${ds.muted}`}>{r.ok ? '출력 보기' : '⚠ 실패 — 출력'}</summary>
        <pre className={cm.ctlpre}>{r.out || '(출력 없음)'}</pre>
      </details>
    </>
  );
}

export default function Control() {
  const { data: ping, isLoading } = usePing();
  const qc = useQueryClient();
  const [busy, setBusy] = useState('');
  const [log, setLog] = useState<Record<string, RunResult>>({});
  const [topic, setTopic] = useState('');
  const [scope, setScope] = useState('');

  const online = !!ping?.ok;
  const offline = !isLoading && !online;
  const setChrome = usePageChrome((s) => s.setChrome);
  const clearChrome = usePageChrome((s) => s.clear);

  // serve.js 연결 상태·도구 수를 상단 바로(데모 v6 헤더).
  useEffect(() => {
    setChrome([
      { label: 'serve.js', value: online ? '● ONLINE' : offline ? 'OFFLINE' : '…', accent: online },
      { label: '도구', value: online ? (ping?.tools.length ?? 0) : '—' },
    ]);
    return () => clearChrome();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, offline, ping?.tools.length]);

  const run = async (key: string, feedsMastery: boolean, body?: Record<string, unknown>, label?: string) => {
    if (busy) return;
    setBusy(key);
    let res: RunResult;
    try {
      res = await runTool(key, body);
    } catch (e) {
      res = { ok: false, out: '요청 실패: ' + ((e as Error).message || e), code: -1 };
    }
    setLog((l) => ({ ...l, [key]: res }));
    setBusy('');
    if (feedsMastery && res.ok) qc.invalidateQueries({ queryKey: KNOWLEDGE_KEY });
    ui.toast(`${label || key} ${res.ok ? '완료' : '실패 — 출력 확인'}`, res.ok ? 'ok' : 'bad');
  };

  const runResearch = () => {
    if (busy) return;
    if (!topic.trim()) {
      ui.toast('주제를 입력하세요.', 'warn');
      return;
    }
    run('research', false, { topic: topic.trim(), scope: scope.trim() }, '탐구 수집');
  };

  return (
    <section className={cm.wrap} aria-label="시스템 제어판">
      <div className={cm.head}>
        <h2 className={cm.headTitle}>🛠 시스템 제어판</h2>
        <span className={cm.headKicker}>OPS CONSOLE</span>
        {online ? (
          <span className={`${cm.status} ${cm.stOn}`}>
            <span className={cm.dot} />
            serve.js ONLINE
          </span>
        ) : offline ? (
          <span className={`${cm.status} ${cm.stOff}`}>
            <span className={cm.dot} />
            API OFFLINE
          </span>
        ) : (
          <span className={cm.status}>
            <span className={ds.spin} /> 연결 확인 중
          </span>
        )}
        <span className={cm.headHint}>버튼 하나로 시스템 도구를 돌리고 결과를 봅니다 — CMD 불필요.</span>
      </div>

      {offline ? (
        <div className={cm.offWrap}>
          <div className={cm.offBoard}>
            <div className={cm.offTitle}>콘솔 오프라인</div>
            <h3 style={{ margin: '0 0 6px', fontSize: 14, color: 'var(--mut)', fontWeight: 700 }}>
              제어판을 켜려면 serve.js로 띄우세요
            </h3>
            <div className={cm.offBoot}>$ node serve.js</div>
            <ol className={ds.foot} style={{ lineHeight: 1.9, marginTop: 8 }}>
              <li>러닝허브 폴더에서 위 명령으로 백엔드 부팅</li>
              <li>
                브라우저로 <code>http://localhost:8000/</code> 열기(지금은 정적/파일 모드라 API가 없음)
              </li>
            </ol>
            <div className={`${ds.foot} ${ds.muted}`}>
              그러면 아래 도구들을 버튼으로 실행할 수 있습니다: 지식상태 재빌드 · 볼트 건강검진 · 지시문 품질검사 · Anki
              학습신호 · 탐구 수집. 파일 모드에서도 숙달도 지도 탭은 폴더 선택으로 동작합니다.
            </div>
          </div>
        </div>
      ) : online ? (
        <div className={cm.scroll}>
          <div className={cm.toolGrid}>
            {TOOLS.map((t) => {
              const isBusy = busy === t.key;
              const r = log[t.key];
              return (
                <div key={t.key} className={ds.card}>
                  <div className={ds.row} style={{ alignItems: 'center', gap: 10 }}>
                    <b style={{ flex: 1 }}>{t.title}</b>
                    <Button
                      sm
                      variant="primary"
                      disabled={isBusy}
                      onClick={() => run(t.key, !!t.feedsMastery, undefined, t.label)}
                    >
                      {isBusy ? (
                        <>
                          <span className={ds.spin} /> 실행 중
                        </>
                      ) : (
                        '실행'
                      )}
                    </Button>
                  </div>
                  <div className={ds.foot}>{t.desc}</div>
                  {r && <ResultBlock k={t.key} r={r} />}
                </div>
              );
            })}
            <div className={`${ds.card} ${cm.wide}`}>
              <div className={ds.row} style={{ alignItems: 'center', gap: 10 }}>
                <b style={{ flex: 1 }}>🔭 탐구(웹 리서치) 수집</b>
              </div>
              <div className={ds.foot}>
                교재가 아니라 웹에서 새로 알아보는 학습(지시문11). 주제를 넣으면 <code>탐구_수집.py</code>가 수집해{' '}
                <code>전공/_탐구/</code>에 원자 노트 초안을 만듭니다.
              </div>
              <div className={ds.row} style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <input
                  placeholder="주제 (예: 반도체 공급망 동향)"
                  style={{ flex: 2, minWidth: 180 }}
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  disabled={busy === 'research'}
                />
                <input
                  placeholder="범위(선택)"
                  style={{ flex: 1, minWidth: 120 }}
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                  disabled={busy === 'research'}
                />
                <Button sm variant="primary" disabled={busy === 'research'} onClick={runResearch}>
                  {busy === 'research' ? (
                    <>
                      <span className={ds.spin} /> 수집 중(최대 30분)
                    </>
                  ) : (
                    '수집 시작'
                  )}
                </Button>
              </div>
              {busy === 'research' && (
                <div className={`${ds.foot} ${ds.muted}`} style={{ marginTop: 6 }}>
                  웹 수집·정리는 몇 분~수십 분 걸립니다. 탭을 떠나도 서버에서 계속 돌아요.
                </div>
              )}
              {log['research'] && <ResultBlock k="research" r={log['research']} />}
            </div>
          </div>
        </div>
      ) : (
        <div className={cm.scroll}>
          <div className={ds.card}>
            <span className={ds.spin} /> 제어판 백엔드 확인 중...
          </div>
        </div>
      )}
    </section>
  );
}
