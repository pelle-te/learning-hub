/* ============================================================
   Settings — 탭: ⚙ 설정 (Phase 4 · 앱상태/Zustand · nav 숨김)
   레거시 ui-routine.js의 renderSettings + maintenanceCard를 React로.
   자주 안 바뀌는 기본값(시작일·모듈길이·피크 등) + 데이터 백업·정리.
   백업/내보내기/복구/아카이빙은 부수효과가 본질이라 shell/io로 위임(설계도 §3).

   월드클래스 라운드(AmbientCanvas 언어) — 폼이 본질인 유틸 탭의 괴리감 해소: 상단 시네마틱
   상태 밴드(백업·저장·기록을 카운트업 리드아웃으로)로 제품의 같은 피부·살아있는 감각을 입힘.
============================================================ */
import { useApp } from '@/store/useApp';
import { useUI } from '@/store/useUI';
import { ui, io } from '@/shell';
import { useHeroPointer } from '@/lib/interactions';
import { dataSizeKB, recordCount } from '@/lib/methodology';
import { ACCENTS, type Accent } from '@/lib/uiState';
import { Button } from '@/components/ui';
import { CountReadout } from '@/components/CountReadout';
import ds from '@/styles/ds.module.css';
import st from './Settings.module.css';
import type { AppState } from '@/lib/types';

/** 액센트 스와치 미리보기색 — tokens.css [data-accent] 프리셋의 --acc를 직접 읽어 파생(하드코딩 SSOT 위반 제거).
    '테마 무관 대표 네온'을 위해 다크 테마 기준으로 계산한다(라이트에서도 스와치는 같은 네온).
    프리셋 규칙이 :root를 겨냥하므로 documentElement 속성을 잠깐 바꿔 읽고 즉시 원복 — 동기 실행이라
    중간 프레임은 페인트되지 않아 깜빡임이 없다. 향후 토큰 재튜닝이 스와치에 자동 반영된다. */
function readAccentPreviews(): Record<Accent, string> {
  const fallback: Record<Accent, string> = { violet: '#9b8cff', lime: '#b6f23a', cyan: '#4dd9e8', amber: '#ffb454' };
  if (typeof document === 'undefined') return fallback;
  const root = document.documentElement;
  const prevTheme = root.getAttribute('data-theme');
  const prevAccent = root.getAttribute('data-accent');
  root.setAttribute('data-theme', 'dark');
  const out = {} as Record<Accent, string>;
  for (const a of ACCENTS) {
    // 기본(violet)은 전용 프리셋이 없어 data-accent를 비운다(베이스 --acc).
    if (a === 'violet') root.removeAttribute('data-accent');
    else root.setAttribute('data-accent', a);
    out[a] = getComputedStyle(root).getPropertyValue('--acc').trim() || fallback[a];
  }
  if (prevTheme == null) root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', prevTheme);
  if (prevAccent == null) root.removeAttribute('data-accent');
  else root.setAttribute('data-accent', prevAccent);
  return out;
}
/** 액센트 스와치 미리보기색 + 라벨. tokens.css [data-accent] 프리셋과 1:1(파생). */
const ACC_PREVIEW: Record<Accent, string> = readAccentPreviews();
const ACC_LABEL: Record<Accent, string> = { violet: '바이올렛', lime: '라임', cyan: '시안', amber: '앰버' };

/** 최근 백업 경과일(state._lastBackupAt) — 렌더 전용(변형 없음). */
function lastBackupDays(at?: string): number | null {
  if (!at) return null;
  const t = new Date(at);
  if (isNaN(t.getTime())) return null;
  return Math.floor((Date.now() - t.getTime()) / 86400000);
}

/** 상태 리드아웃 — 공용 CountReadout에 이 탭의 클래스만 입힘(카운트업 정본 공유). */
function Readout({
  value,
  suffix,
  lab,
  tone,
}: {
  value: number;
  suffix?: React.ReactNode;
  lab: string;
  tone?: 'ok' | 'warn';
}) {
  return (
    <CountReadout
      value={value}
      suffix={suffix}
      lab={lab}
      className={`${st.ro} ${tone === 'ok' ? st.roOk : tone === 'warn' ? st.roWarn : ''}`}
      numClassName={st.roNum}
      labClassName={st.roLab}
    />
  );
}

/** 기본 설정 + 데이터 백업·정리. */
export default function Settings() {
  const state = useApp((s) => s.state);
  const mutate = useApp((s) => s.mutate);
  const accent = useUI((s) => s.ui.accent);
  const setAccent = useUI((s) => s.setAccent);
  const fxLite = useUI((s) => s.ui.fxLite);
  const setFxLite = useUI((s) => s.setFxLite);
  // 포인터 추적 스포트라이트 — 상태 밴드가 커서를 따라 발광(틸트 없는 큰 보드).
  const { ref: heroRef, onMouseMove: heroMove, onMouseLeave: heroLeave } = useHeroPointer(0);

  // 설정값 1개 변경 — 레거시 setSetting(state[k]=v;persist;render)을 mutate로.
  const set = <K extends keyof AppState>(k: K, v: AppState[K]) => mutate((st) => void ((st as AppState)[k] = v));

  // 숫자 설정 — 빈 필드/NaN을 min으로 방어하고 [min,max]로 클램프.
  // (HTML min/max·step은 스피너 힌트일 뿐, 직접 타이핑한 값이나 지운 필드(NaN)를 막지 못한다.)
  const clampNum = (raw: number, min: number, max: number, round = false) => {
    let v = round ? Math.round(raw) : raw;
    if (!Number.isFinite(v)) v = min;
    return Math.min(max, Math.max(min, v));
  };

  // 피크 시간대 역전 감지 — 끝이 시작보다 이르면 스케줄러 피크 우선배치가 조용히 깨진다.
  const peakInverted = !!state.peakStart && !!state.peakEnd && state.peakEnd <= state.peakStart;

  const days = lastBackupDays(state._lastBackupAt as string | undefined);
  const stale = days == null || days >= 7;
  const sizeKB = dataSizeKB(state);
  const recs = recordCount(state);
  const backupLine = days == null ? '볼트 백업 기록 없음' : days === 0 ? '볼트 백업: 오늘' : `볼트 백업: ${days}일 전`;

  const archiveOldConfirm = async () => {
    const ok = await ui.confirm(
      '6개월 이전의 완료기록·요약·오답·회수된 백로그를 보관 파일(.json)로 내려받고 앱에서 비울까요? (통계가 가벼워지고 저장공간을 회수합니다. 보관 파일은 따로 두면 나중에 열람 가능)',
      { title: '오래된 기록 정리', okLabel: '정리' },
    );
    if (ok) io.archiveOld(6);
  };

  return (
    <section className={st.wrap} aria-label="설정">
      {/* ── 시네마틱 상태 밴드 — 무엇을 설정하나 + 핵심 상태(백업·저장·기록) ── */}
      <div
        ref={heroRef}
        onMouseMove={heroMove}
        onMouseLeave={heroLeave}
        className={`${st.hero} ${ds.spotHost} ${ds.glow}`}
      >
        <div className={ds.spotlight} aria-hidden="true" />
        <div className={ds.aura} aria-hidden="true" />
        <div className={st.heroLeft}>
          <span className={st.eyebrow}>환경설정 · SETTINGS</span>
          <h2 className={st.title}>설정</h2>
          <span className={st.meta}>
            학습 계획의 기본값 · 테마 · 데이터 백업. 요일별 가용시간·수업·일과는 <b>가용시간·수업·일과</b> 탭에서.
          </span>
        </div>
        <div className={st.status}>
          <div className={`${st.ro} ${stale ? st.roWarn : st.roOk}`} title={backupLine}>
            <span className={st.roNum} style={{ fontSize: 16 }}>
              {days == null ? '없음' : days === 0 ? '오늘' : `${days}일 전`}
            </span>
            <span className={st.roLab}>볼트 백업</span>
          </div>
          <Readout value={sizeKB} suffix={<small>KB</small>} lab="저장 크기" />
          <Readout value={recs} suffix={<small>건</small>} lab="기록 수" />
        </div>
      </div>

      <div className={`${ds.card} ${ds.glow}`}>
        <h2>
          테마 · 액센트{' '}
          <span className={`${ds.muted} ${ds.tiny}`}>— 네온 색을 고르세요(다크/라이트 전환은 우측 상단 ◐)</span>
        </h2>
        <div className={st.accRow}>
          {ACCENTS.map((a) => (
            <button
              key={a}
              type="button"
              aria-pressed={accent === a}
              aria-label={`액센트 ${ACC_LABEL[a]}`}
              onClick={() => setAccent(a)}
              className={`${st.accBtn} ${accent === a ? st.accOn : ''}`}
            >
              <span
                aria-hidden="true"
                className={st.accSwatch}
                style={{ background: ACC_PREVIEW[a], boxShadow: `0 0 8px ${ACC_PREVIEW[a]}` }}
              />
              {ACC_LABEL[a]}
            </button>
          ))}
        </div>
        <div className={ds.foot}>
          액센트는 이 기기에 저장돼요(데이터와 별개). 발광·강조·진행 바 전체에 즉시 반영됩니다.
        </div>
        <label className={ds.chkRow} style={{ marginTop: 10 }}>
          <input type="checkbox" checked={fxLite} onChange={(e) => setFxLite(e.target.checked)} />
          발광 효과 줄이기 (배경 오로라·발광 펄스 정지 — 저사양/노트북에서 가볍게)
        </label>
      </div>

      <div className={`${ds.card} ${ds.glow}`}>
        <h2>기본 설정</h2>
        <div className={ds.row}>
          <div>
            <label htmlFor="set-start">시작일</label>
            <input
              id="set-start"
              type="date"
              value={state.startDate}
              onChange={(e) => set('startDate', e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="set-modlen">모듈 길이 (시간)</label>
            <input
              id="set-modlen"
              type="number"
              step="0.5"
              min="0.5"
              value={state.moduleLen / 60}
              onChange={(e) => set('moduleLen', Math.round(clampNum(+e.target.value, 0.5, 12) * 60))}
            />
          </div>
          <div>
            <label htmlFor="set-revratio">복습 시간 비중 (%)</label>
            <input
              id="set-revratio"
              type="number"
              step="5"
              min="0"
              max="60"
              value={state.reviewRatio}
              onChange={(e) => set('reviewRatio', clampNum(+e.target.value, 0, 60, true))}
            />
          </div>
        </div>
        <div className={ds.foot}>
          모듈 = 한 번에 집중하는 공부 슬롯(기본 2시간). 하루 공부 가능 시간이 이 단위로 과목에 배분됩니다.
        </div>
        <hr />
        <div className={ds.row}>
          <div className={ds.fld}>
            <label htmlFor="set-blank" style={{ display: 'inline' }}>
              백지 복습 자동 배치 <span className={`${ds.muted} ${ds.tiny}`}>(방법론 9절 — 주 1회 단원 재구성)</span>
            </label>
            <div style={{ marginTop: 6 }}>
              <label className={ds.chkRow} style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  id="set-blank"
                  checked={state.blankReviewWeekly}
                  onChange={(e) => set('blankReviewWeekly', e.target.checked)}
                />{' '}
                <span>그 주 배운 과목마다 주말에 백지 복습 한 칸</span>
              </label>
            </div>
          </div>
          <div>
            <label htmlFor="set-mock">
              모의시험 주기 (주) <span className={`${ds.muted} ${ds.tiny}`}>0=끔 (방법론 12절)</span>
            </label>
            <input
              id="set-mock"
              type="number"
              step="1"
              min="0"
              max="12"
              value={state.mockEveryWeeks || 0}
              onChange={(e) => set('mockEveryWeeks', Math.max(0, Math.round(+e.target.value)))}
            />
          </div>
        </div>
        <div className={ds.foot}>
          백지 복습·모의시험은 여유 있는 날에만 배치되며 가용시간을 넘기지 않아요. <b>오늘 학습</b> 탭에서 절차 가이드를
          봅니다.
        </div>
        <hr />
        <div className={ds.row}>
          <div className={ds.fld}>
            <label style={{ display: 'inline' }}>
              적응형 용량 <span className={`${ds.muted} ${ds.tiny}`}>(방법론 1·10절 — "계획은 가설")</span>
            </label>
            <div style={{ marginTop: 6 }}>
              <label className={ds.chkRow} style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={state.adaptiveCapacity !== false}
                  onChange={(e) => set('adaptiveCapacity', e.target.checked)}
                />{' '}
                <span>최근 14일 완료율로 다음 계획 용량을 자동 보정(꾸준히 70%만 끝내면 계획도 70%로)</span>
              </label>
            </div>
          </div>
          <div className={ds.fld}>
            <label style={{ display: 'inline' }}>
              복습은 Anki에 위임 <span className={`${ds.muted} ${ds.tiny}`}>(시간 이중계상 방지)</span>
            </label>
            <div style={{ marginTop: 6 }}>
              <label className={ds.chkRow} style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={state.reviewViaAnki}
                  onChange={(e) => set('reviewViaAnki', e.target.checked)}
                />{' '}
                <span>매일 Anki 항목이 있으면 합성 간격복습(1·3·7·16) 슬롯을 만들지 않음 — due는 FSRS가 소유</span>
              </label>
            </div>
          </div>
          <div className={ds.fld}>
            <label style={{ display: 'inline' }}>
              그래프 우선순위 <span className={`${ds.muted} ${ds.tiny}`}>(지식엔진 숙달도로 배분 보정 · 설계 B)</span>
            </label>
            <div style={{ marginTop: 6 }}>
              <label className={ds.chkRow} style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={state.graphPriority}
                  onChange={(e) => set('graphPriority', e.target.checked)}
                />{' '}
                <span>
                  같은 마감 긴급도면 <b>숙달 낮은(약한) 과목을 먼저</b> 배치. 숙달도 지도 탭에서 지식상태를 먼저
                  불러와야 작동(없으면 영향 0).
                </span>
              </label>
            </div>
          </div>
        </div>
        <div className={ds.row}>
          <div>
            <label htmlFor="set-peak0">
              각성도 최고 시간대 시작{' '}
              <span className={`${ds.muted} ${ds.tiny}`}>(방법론 1절 — 어려운 새 학습을 맑을 때)</span>
            </label>
            <input
              id="set-peak0"
              type="time"
              value={state.peakStart || ''}
              onChange={(e) => set('peakStart', e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="set-peak1">끝</label>
            <input
              id="set-peak1"
              type="time"
              value={state.peakEnd || ''}
              onChange={(e) => set('peakEnd', e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }} />
        </div>
        {peakInverted && (
          <div className={ds.foot} style={{ color: 'var(--bad)' }}>
            ⚠ 끝 시각이 시작보다 빨라요 — 피크 구간이 비어 우선 배치가 동작하지 않습니다.
          </div>
        )}
        <div className={ds.foot}>
          피크 시간대를 정하면 <b>새 학습(new)·모의시험</b>을 그 구간에 우선 배치하고, 복습·Anki는 나머지 시간에.
          비워두면 끔(이른 시각부터 순서대로).
        </div>
      </div>

      <div className={`${ds.card} ${ds.glow}`}>
        <h2>
          데이터 백업·정리{' '}
          <span className={`${ds.muted} ${ds.tiny}`}>— localStorage 한 곳에만 있으면 캐시 삭제 시 전소</span>
        </h2>
        <div className={ds.row} style={{ marginBottom: 6 }}>
          <span className={`${ds.pill} ${stale ? ds.warn : ds.good}`}>{backupLine}</span>
          <span className={ds.pill}>
            저장 크기 {sizeKB}KB · 기록 {recs}건
          </span>
        </div>
        <div className={ds.row}>
          <Button sm onClick={() => io.backupToVault()}>
            📁 볼트 폴더에 백업
          </Button>
          <Button sm variant="ghost" onClick={() => io.exportJSON()}>
            💾 파일로 내보내기
          </Button>
          <Button
            sm
            variant="ghost"
            onClick={() => io.restoreFromIDB()}
            title="localStorage가 지워졌을 때 IndexedDB 자동 미러에서 복구"
          >
            ♻ IndexedDB에서 복구
          </Button>
          <Button sm variant="ghost" danger onClick={archiveOldConfirm}>
            🗄 오래된 기록 정리(6개월 이전)
          </Button>
        </div>
        {stale && (
          <div className={ds.warnbox} style={{ marginTop: 8 }}>
            백업이 {days == null ? '아직 없어요' : `${days}일 지났어요`}. 브라우저 캐시를 지우면 데이터가 사라질 수
            있으니 백업하세요.
          </div>
        )}
        <div className={ds.foot}>
          볼트 백업은 볼트 폴더에 <code>러닝허브_백업.json</code>을 씁니다(Chrome/Edge). 저장 때마다{' '}
          <b>IndexedDB에 자동 미러</b>되어, 사이트 데이터가 지워져도 <b>♻ 복구</b>로 되살릴 수 있어요(같은 브라우저
          한정). 정리는 6개월 이전 기록을 보관 파일로 내려받고 앱에서 비워 쿼터·성능을 지킵니다.
        </div>
      </div>
    </section>
  );
}
