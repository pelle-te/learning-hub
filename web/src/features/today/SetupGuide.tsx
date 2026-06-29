/* SetupGuide — 첫 실행 온보딩(콜드 스타트 빈 화면 방지). 3스텝 라이브 체크.
   과목+목표가 갖춰지면 자동으로 숨는다. */
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { Button, Pill } from '@/components/ui';
import ds from '@/styles/ds.module.css';
import t from './Today.module.css';

export function SetupGuide() {
  const navigate = useNavigate();
  const items = useApp((s) => s.state.items);
  const routine = useApp((s) => s.state.routine);

  const hasSubjects = items.some((i) => i.name);
  const hasTargets = items.some(
    (i) =>
      i.name &&
      ((i.mode === 'daily' && (i.dailyMin || 0) > 0) ||
        (i.weeklyHours || 0) > 0 ||
        (i.chapters && i.chapters.length > 0)),
  );
  const hasRoutine = (routine || []).length > 0;
  if (hasSubjects && hasTargets) return null; // 셋업 완료 → 숨김

  const steps: { ok: boolean; title: string; desc: string; actions: React.ReactNode }[] = [
    {
      ok: hasSubjects,
      title: '공부할 과목 추가',
      desc: '볼트(전공 폴더)에서 통째로 불러오거나 직접 입력하세요.',
      actions: (
        <>
          <Button sm variant="primary" onClick={() => navigate('/items')}>
            학습 항목 열기
          </Button>{' '}
          <Button sm onClick={() => navigate('/integrations')}>
            볼트에서 불러오기
          </Button>
        </>
      ),
    },
    {
      ok: hasTargets,
      title: '주당 목표 시간·챕터 설정',
      desc: '과목마다 주당 몇 시간 공부할지와 챕터(순서)를 정하면 블록이 배분됩니다.',
      actions: (
        <Button sm variant={hasSubjects ? 'primary' : 'default'} onClick={() => navigate('/items')}>
          학습 항목에서 설정
        </Button>
      ),
    },
    {
      ok: hasRoutine,
      title: '일과·가용 시간 확인',
      desc: '수면·식사·수업을 빼고 남는 빈 시간이 자동으로 공부시간이 됩니다(기본값 제공 — 필요 시 조정).',
      actions: (
        <Button sm onClick={() => navigate('/routine')}>
          가용시간 열기
        </Button>
      ),
    },
  ];
  const done = steps.filter((s) => s.ok).length;

  return (
    <div className={`${ds.card} ${t.setupCard}`}>
      <h2>
        시작하기 <span className={`${ds.muted} ${ds.tiny}`}>— 3단계만 채우면 오늘의 블록이 자동으로 잡혀요</span>
      </h2>
      <div className={ds.row} style={{ alignItems: 'center', marginBottom: 6 }}>
        <Pill tone={done === 3 ? 'good' : 'warn'}>{done}/3 완료</Pill>
        <span className={t.setupProg}>
          <i style={{ width: `${Math.round((done / 3) * 100)}%` }} />
        </span>
      </div>
      {steps.map((s, i) => (
        <div key={i} className={t.setupStep}>
          <span className={`${t.setupCk}${s.ok ? ' ' + t.on : ''}`} aria-hidden="true">
            {s.ok ? '✓' : ''}
          </span>
          <div className={t.setupBody}>
            <div className={t.setupTitle}>{s.ok ? <s>{s.title}</s> : s.title}</div>
            <div className={`${ds.muted} ${ds.tiny}`}>{s.desc}</div>
            {!s.ok && <div className={t.setupAct}>{s.actions}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
