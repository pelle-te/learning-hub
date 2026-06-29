/* ============================================================
   Today — 탭: 🎯 오늘 학습 (Phase 3 · 앱상태 + 파생 scheduler)
   계획(스케줄 탭)이 '언제/무엇'이라면, 이 탭은 '블록 안에서 어떻게'를 굴린다.
   레거시 ui-today.js를 React로 — 셋업 가이드 / 오늘 한눈에·의식 / 오늘의 블록 / 흐름 가이드.
============================================================ */
import { useApp } from '@/store/useApp';
import { ui } from '@/shell';
import { setRitual } from '@/lib/methodology';
import { iso } from '@/lib/utils';
import ds from '@/styles/ds.module.css';
import t from './Today.module.css';
import type { Ritual } from '@/lib/types';
import { SetupGuide } from './SetupGuide';
import { TodayHero } from './TodayHero';
import { TodayBlocks } from './TodayBlocks';
import { BLOCK_STAGES, PRINCIPLES } from './consts';

/** 일일 의식(아침 계획·저녁 셧다운) — 핵심 통계는 TodayHero가 보여주고, 여기선 의식 체크만. */
function RitualCard() {
  const state = useApp((s) => s.state);
  const mutate = useApp((s) => s.mutate);

  const ds2 = iso(new Date());
  const r: Ritual = state.rituals?.[ds2] || { plan: false, shutdown: false, note: '' };
  const toggle = (key: 'plan' | 'shutdown', on: boolean) => {
    mutate((st) => setRitual(st, ds2, key, on));
    ui.toast(on ? '기록됨 👍' : '해제됨', 'info');
  };

  return (
    <div className={ds.card}>
      <h2>
        일일 의식{' '}
        <span className={`${ds.muted} ${ds.tiny}`}>— 아침 계획 → 저녁 셧다운(작은 의식이 일관성을 만든다)</span>
      </h2>
      <div className={t.ritualRow}>
        <label className={t.ritualCk}>
          <input type="checkbox" checked={r.plan} onChange={(e) => toggle('plan', e.target.checked)} /> 🌅{' '}
          <b>아침 계획</b> <span className={`${ds.muted} ${ds.tiny}`}>블록 훑고 오늘 가장 중요한 1개 정하기</span>
        </label>
        <label className={t.ritualCk}>
          <input type="checkbox" checked={r.shutdown} onChange={(e) => toggle('shutdown', e.target.checked)} /> 🌙{' '}
          <b>저녁 셧다운</b> <span className={`${ds.muted} ${ds.tiny}`}>완료 체크 · 내일 한 줄 · 끝내기</span>
        </label>
      </div>
    </div>
  );
}

/** 블록 흐름 가이드(접이식 참고) — 5원리 + 단계 표 + 체크리스트. */
function FlowGuide() {
  return (
    <div className={ds.card}>
      <details>
        <summary>학습 원칙 · 블록 흐름 (펼쳐 보기)</summary>
        <div className={t.princ} style={{ marginTop: 12 }}>
          {PRINCIPLES.map(([a, b]) => (
            <span key={a} className={t.princChip}>
              <b>{a}</b> {b}
            </span>
          ))}
        </div>
        <div className={ds.foot} style={{ margin: '2px 0 12px' }}>
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
                <td className={`${ds.muted} ${ds.tiny}`}>
                  {st.start}–{st.end}%
                </td>
                <td>{st.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={ds.foot} style={{ marginTop: 10 }}>
          <b>주의력:</b> 45~50분마다 5분 휴식(화면·문제에서 눈 떼기). 2h ≈ [50분+5분]×2.
        </div>
        <div className={ds.foot}>
          <b>블록 종료 체크:</b> ☐ 3문장 요약(보지 않고) ☐ 까다로운 개념만 시각/언어 스케치 ☐ 막힌 곳 CBMS 분류 ☐ Anki
          ≤5장 점검 ☐ '보충 필요' 회수 시점 정함
        </div>
      </details>
    </div>
  );
}

export default function Today() {
  return (
    <>
      <SetupGuide />
      <TodayHero />
      <TodayBlocks />
      <RitualCard />
      <FlowGuide />
    </>
  );
}
