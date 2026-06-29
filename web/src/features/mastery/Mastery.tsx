/* ============================================================
   Mastery — 탭: 🧠 숙달도 지도 (Phase 5 · 서버/외부 = TanStack Query)
   지식엔진.py 산출(_지식상태.json)을 소비 — 히트맵(A)·프런티어/갭(B)·캘리브레이션(E).
   데이터 원본 둘: serve.js /api/artifact/knowledge(자동) · 볼트 폴더 FS Access(수동 폴백).
   둘 다 같은 ['knowledge'] Query 캐시로 모여 본문이 렌더(설계도 §1-B). 레거시 _knowState 수동배선 제거.
============================================================ */
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useKnowledge, KNOWLEDGE_KEY } from '@/store/queries';
import { useApp } from '@/store/useApp';
import { ui } from '@/shell';
import { loadKnowledgeStateFromVault, type Knowledge } from '@/lib/knowledge';
import { masteryColor } from '@/lib/utils';
import { Button } from '@/components/ui';
import ds from '@/styles/ds.module.css';
import m from './Mastery.module.css';

const pct = (x?: number) => `${Math.round((x || 0) * 100)}%`;

function Overview({ k }: { k: Knowledge }) {
  const s = k.states || {};
  const tot = k.n_notes || 1;
  const seg = (n: number | undefined, c: string, lab: string) => {
    const w = Math.round(((n || 0) / tot) * 100);
    const t = `${lab} ${n || 0} (${w}%)`;
    return w ? <div data-tip={t} role="img" aria-label={t} style={{ width: `${w}%`, background: c }} /> : null;
  };
  return (
    <div className={ds.card}>
      <h3>지식 상태 분포</h3>
      <div className={m.msbar}>
        {seg(s.mastered, 'var(--good,#4caf50)', '숙달')}
        {seg(s.learning, '#d6a72b', '학습중')}
        {seg(s.weak, 'var(--bad,#e3564a)', '약점')}
        {seg(s.unknown, 'var(--line,#444)', '미관측')}
      </div>
      <div className={`${ds.row} ${ds.foot}`} style={{ gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
        <span>
          <i className={m.dot} style={{ background: 'var(--good,#4caf50)' }} />
          숙달 {s.mastered || 0}
        </span>
        <span>
          <i className={m.dot} style={{ background: '#d6a72b' }} />
          학습중 {s.learning || 0}
        </span>
        <span>
          <i className={m.dot} style={{ background: 'var(--bad,#e3564a)' }} />
          약점 {s.weak || 0}
        </span>
        <span>
          <i className={m.dot} style={{ background: 'var(--line,#444)' }} />
          미관측 {s.unknown || 0}
        </span>
      </div>
      {(s.unknown || 0) > tot * 0.5 && (
        <div className={`${ds.foot} ${ds.muted}`} style={{ marginTop: 6 }}>
          ⚠ 미관측이 과반입니다 — 인출 데이터(Anki due·CBMS·백지)가 쌓이면 회색이 색을 찾습니다. 그래프 기반{' '}
          <b>프런티어</b>는 관측 없이도 작동하니 아래에서 다음 배울 개념을 보세요.
        </div>
      )}
    </div>
  );
}

function Subjects({ k }: { k: Knowledge }) {
  const subs = (k.subjects || []).slice().sort((a, b) => a.mastery - b.mastery);
  return (
    <div className={ds.card}>
      <h3>
        과목별 숙달 히트맵{' '}
        <span className={`${ds.muted} ${ds.tiny}`}>
          — 셀 하나가 개념. 빨강=약점·초록=숙달·회색=미관측 (마우스 올리면 제목)
        </span>
      </h3>
      {subs.length ? (
        subs.map((s) => (
          <div key={s.subject} className={m.mssub}>
            <div className={ds.row} style={{ alignItems: 'center', gap: 8 }}>
              <b style={{ flex: 1 }}>{s.subject}</b>
              <span className={`${ds.tiny} ${ds.muted}`}>
                {s.n}개 · 숙달 {pct(s.mastery)}
                {s.weak ? ` · 약점 ${s.weak}` : ''}
                {s.unknown ? ` · 미관측 ${s.unknown}` : ''}
              </span>
            </div>
            <div className={m.msheat}>
              {(s.concepts || []).map((c, i) => {
                const t = `${c.title || c.basename}  ·  유효숙달 ${pct(c.p_eff)} (${c.state})${
                  c.weak && c.root_cause && c.root_cause !== 'self' ? ' ← 선수약점: ' + c.root_cause : ''
                }`;
                const col = masteryColor(c.p_eff, c.state);
                // 발광 지식맵 — 유효숙달 p가 높을수록 글로우 강하게(0.55↑부터 번짐). 미관측/약점은 차분.
                //  프런티어는 accent 링과 글로우를 함께(인라인이 .fr 클래스 box-shadow를 덮으므로 합성).
                const ring = c.frontier ? '0 0 0 1.5px var(--acc)' : '';
                const glow = c.p_eff >= 0.55 ? `0 0 ${Math.round((c.p_eff - 0.4) * 14)}px ${col}` : '';
                const boxShadow = [ring, glow].filter(Boolean).join(', ') || undefined;
                return (
                  <i
                    key={i}
                    className={`${m.mscell}${c.frontier ? ' ' + m.fr : ''}`}
                    style={{ background: col, boxShadow }}
                    data-tip={t}
                    role="img"
                    aria-label={t}
                  />
                );
              })}
            </div>
          </div>
        ))
      ) : (
        <div className={`${ds.muted} ${ds.tiny}`}>과목 없음</div>
      )}
      <div className={`${ds.foot} ${ds.muted} ${ds.tiny}`} style={{ marginTop: 6 }}>
        테두리 친 셀 ⬡ = 프런티어(지금 배울 준비됨).
      </div>
    </div>
  );
}

interface ConceptRow {
  title?: string;
  basename?: string;
  subject?: string;
}
/** 프런티어/약점 등 '개념 리스트' 공통 카드 — 점·이름·과목은 동일, 우측 메타만 renderMeta로 주입. */
function ConceptList<T extends ConceptRow>({
  heading,
  subtitle,
  empty,
  items,
  dot,
  dotColor,
  renderMeta,
}: {
  heading: string;
  subtitle: string;
  empty: ReactNode;
  items: T[];
  dot: string;
  dotColor: string;
  renderMeta: (it: T) => ReactNode;
}) {
  if (!items.length)
    return (
      <div className={ds.card}>
        <h3>{heading}</h3>
        {empty}
      </div>
    );
  return (
    <div className={ds.card}>
      <h3>
        {heading} <span className={`${ds.muted} ${ds.tiny}`}>{subtitle}</span>
      </h3>
      <div className={m.mslist}>
        {items.map((it, i) => (
          <div key={it.basename ?? i} className={m.msrow}>
            <span className={m.msdot} style={{ background: dotColor }}>
              {dot}
            </span>
            <span className={m.nm} style={{ flex: 1 }}>
              {it.title || it.basename}
            </span>
            <span className={`${ds.tiny} ${ds.muted}`}>{it.subject || ''}</span>
            {renderMeta(it)}
          </div>
        ))}
      </div>
    </div>
  );
}

function Frontier({ k }: { k: Knowledge }) {
  return (
    <ConceptList
      heading="🎯 다음 배울 개념"
      subtitle="(ZPD · 선수 충족·고레버리지순 — 이걸 배우면 가장 많은 게 풀린다)"
      empty={<div className={`${ds.muted} ${ds.tiny}`}>프런티어 없음(선수 미충족 또는 충분 숙달).</div>}
      items={(k.frontier || []).slice(0, 18)}
      dot="⬡"
      dotColor="hsl(200 60% 50%)"
      renderMeta={(f) => (
        <span
          className={ds.chip}
          data-tip="이 개념을 선수로 삼는 개념 수"
          role="img"
          aria-label={`의존 ${f.prereq_in} — 이 개념을 선수로 삼는 개념 수`}
        >
          의존 {f.prereq_in}
        </span>
      )}
    />
  );
}

function Gaps({ k }: { k: Knowledge }) {
  return (
    <ConceptList
      heading="🩹 약점 진단"
      subtitle="(약한 순 · 근본원인을 먼저 메우면 상류가 같이 풀린다)"
      empty={<div className={`${ds.foot} ${ds.muted}`}>증거상 약점 없음 — 인출 관측이 쌓이면 약점이 드러납니다.</div>}
      items={(k.gaps || []).slice(0, 18)}
      dot="✗"
      dotColor="var(--bad,#e3564a)"
      renderMeta={(x) => (
        <>
          <span className={ds.chip}>{pct(x.p_eff)}</span>{' '}
          {x.root_cause === 'self' ? (
            <span className={ds.tiny} style={{ color: 'var(--bad)' }}>
              본인 개념
            </span>
          ) : x.root_cause ? (
            <span className={ds.tiny} style={{ color: 'var(--bad)' }}>
              ← 선수약점: {x.root_cause}
            </span>
          ) : null}
        </>
      )}
    />
  );
}

function Calibration({ k }: { k: Knowledge }) {
  const c = k.calibration || {};
  if (!c.n_errors && !c.blank_total)
    return (
      <div className={ds.card}>
        <h3>🎚 메타인지 캘리브레이션</h3>
        <div className={`${ds.foot} ${ds.muted}`}>
          CBMS 오답·백지 기록이 없습니다 — 러닝허브에서 기록 후 <b>볼트 백업</b>→<code>지식엔진.py build --export</code>
          로 인제스트하면 '확신했는데 틀린' 과신율이 잡힙니다(투입 아닌 출력 지표 · 설계 E).
        </div>
      </div>
    );
  const over = c.overconfidence_rate || 0;
  const overCol = over > 0.5 ? 'var(--bad)' : over > 0.3 ? '#d6a72b' : 'var(--good)';
  return (
    <div className={ds.card}>
      <h3>
        🎚 메타인지 캘리브레이션{' '}
        <span className={`${ds.muted} ${ds.tiny}`}>(확신도 vs 정확도 — 낮을수록 자기 앎을 정확히 안다)</span>
      </h3>
      <div className={ds.row} style={{ gap: 24, flexWrap: 'wrap' }}>
        <div>
          <div className={ds.kpi} style={{ color: overCol }}>
            {pct(over)}
          </div>
          <div className={ds.foot}>
            과신율 — 확신했는데 틀림 {c.confident_wrong || 0} / 전체 오답 {c.n_errors || 0}
          </div>
        </div>
        {c.blank_total ? (
          <div>
            <div className={ds.kpi}>{pct(c.blank_pass_rate)}</div>
            <div className={ds.foot}>
              백지복습 통과율 {c.blank_pass || 0}/{c.blank_total || 0}
            </div>
          </div>
        ) : null}
      </div>
      <div className={m.msbar} style={{ marginTop: 10 }}>
        <div
          data-tip="확신했는데 틀림(과신)"
          role="img"
          aria-label="확신했는데 틀림(과신)"
          style={{ width: `${Math.round(over * 100)}%`, background: 'var(--bad,#e3564a)' }}
        />
        <div
          data-tip="확신없음+틀림(적정)"
          role="img"
          aria-label="확신없음+틀림(적정)"
          style={{ width: `${Math.round((1 - over) * 100)}%`, background: '#d6a72b' }}
        />
      </div>
      <div className={`${ds.foot} ${ds.muted} ${ds.tiny}`} style={{ marginTop: 6 }}>
        과신 오답 = 다음 복습에서 우선 표적. 백지 통과율 = '꺼낼 수 있는가'의 직접 증거.
      </div>
    </div>
  );
}

function Setup() {
  return (
    <div className={ds.card}>
      <h3>아직 지식상태가 없어요</h3>
      <ol className={ds.foot} style={{ lineHeight: 1.9 }}>
        <li>
          볼트 인덱스 최신화: <code>python 시스템/_도구/벌트DB.py build</code>
        </li>
        <li>
          (선택) 러닝허브 데이터 먹이기: 설정 탭에서 <b>볼트 백업</b>(<code>러닝허브_백업.json</code>) → 엔진이
          CBMS·백지를 인제스트
        </li>
        <li>
          지식상태 빌드: <code>python 시스템/_도구/지식엔진.py build --export 러닝허브_백업.json</code>
        </li>
        <li>
          위 <b>📁 볼트에서 불러오기</b> 클릭 → 전공 폴더 선택
        </li>
      </ol>
      <div className={`${ds.foot} ${ds.muted}`}>
        엔진은 선수개념 그래프로 "지금 배울 준비된 것(ZPD)"과 "약점의 근본원인"을 진단합니다. 인출 관측(Anki/CBMS)이
        쌓일수록 추정이 날카로워집니다.
      </div>
    </div>
  );
}

export default function Mastery() {
  const { data: k, isLoading, isFetching } = useKnowledge();
  const qc = useQueryClient();
  const setRuntimeCache = useApp((s) => s.setRuntimeCache);

  // 볼트 폴더에서 수동 로드(serve.js 없을 때) → 같은 ['knowledge'] 캐시에 주입 + write-through.
  const loadFromVault = async () => {
    const picker = (window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> })
      .showDirectoryPicker;
    if (!picker) {
      ui.toast('이 브라우저는 폴더 연결 미지원(Chrome/Edge). 또는 node serve.js로 띄우면 자동 로드됩니다.', 'warn');
      return;
    }
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await picker();
    } catch {
      return; // 취소
    }
    const loaded = await loadKnowledgeStateFromVault(handle);
    if (!loaded) {
      ui.toast('_지식상태.json을 못 찾았어요. 전공 폴더를 골랐는지, 지식엔진.py build를 돌렸는지 확인하세요.', 'bad');
      return;
    }
    qc.setQueryData(KNOWLEDGE_KEY, loaded);
    setRuntimeCache('_knowState', loaded);
  };

  return (
    <>
      <div className={ds.card}>
        <div className={ds.row} style={{ alignItems: 'center' }}>
          <h2 style={{ flex: 1, margin: 0 }}>🧠 숙달도 지도</h2>
          <Button sm variant="primary" onClick={loadFromVault}>
            📁 볼트에서 {k ? '새로고침' : '지식상태 불러오기'}
          </Button>
        </div>
        <div className={ds.foot}>
          개념별 <b>유효숙달</b>(선수 약하면 하락)·<b>프런티어</b>(지금 배울 준비된 것)·<b>약점 근본원인</b>·
          <b>과신율</b>. 데이터는 <code>python 시스템/_도구/지식엔진.py build</code>가 만드는{' '}
          <code>_지식상태.json</code>에서 옵니다.
        </div>
        {k && (
          <div className={`${ds.muted} ${ds.tiny}`} style={{ marginTop: 6 }}>
            생성 {k.generated || ''} · 노트 {k.n_notes}개 · 전체 유효숙달 <b>{pct(k.overall)}</b>
          </div>
        )}
        {(isLoading || isFetching) && !k && (
          <div style={{ marginTop: 8 }}>
            <span className={ds.spin} /> 지식상태 로드 중...
          </div>
        )}
      </div>
      {k ? (
        <>
          <Overview k={k} />
          <Subjects k={k} />
          <Frontier k={k} />
          <Gaps k={k} />
          <Calibration k={k} />
        </>
      ) : (
        !isLoading && !isFetching && <Setup />
      )}
    </>
  );
}
