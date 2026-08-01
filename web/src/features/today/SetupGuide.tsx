/* SetupGuide — 첫 실행 온보딩(콜드 스타트 빈 화면 방지). 3스텝 라이브 체크.
   과목+목표가 갖춰지면 자동으로 숨는다(Today가 setupComplete로 대시보드와 스위칭).

   ⚠ W3(2026-07-31) — 종전엔 **3버튼이 전부 `/items` 로** 갔다(화면은 "3단계"라 말하는데 목적지가
   하나). 그리고 볼트를 **묻지도 않아서**, 노트 604개가 옆에 있는 사용자에게도 빈 앱을 보여줬다.
   지금은 `app/VaultSync` 가 부팅에 채운 `['vault']` 를 읽어 **볼트에 무엇이 있는지 먼저 말하고**,
   각 단계가 서로 다른 목적지(임포트 패널 · 과목 시트 · 뼈대)를 갖는다. */
import { useNavigate } from 'react-router-dom';
import { useQuery, skipToken } from '@tanstack/react-query';
import { useApp } from '@/store/useApp';
import { Button, Pill } from '@/components/ui';
import type { VaultScan } from '@/lib/vault';
import type { AppState } from '@/lib/types';
import { Icon } from '@/components/Icon';

/** 셋업 완료 판정 — 과목 1개 이상 + 목표(일일분/주당시간/챕터) 1개 이상. Today와 공유(단일 원천).
 *
 * ⚠⚠ **이 판정은 "사용자가 정한 것"만 봐야 한다(W1 · 2026-07-31).** 종전엔 `makeItem` 기본값
 * `weeklyHours: 3` 때문에 **과목을 만드는 행위 자체가 목표까지 충족**시켰다 — `+ 첫 과목 추가`
 * 한 번에 3단계 중 2단계가 켜지고 `Today.tsx` 가 스크림을 영구히 걷어, 시각적으로 지배적인
 * primary 버튼이 곧 막다른 길이었다. 고친 자리는 판정식이 아니라 **생성부**(`Items.addItem` 이
 * `weeklyHours: 0` 으로 만든다) — 판정식을 비틀면 "3을 직접 고른 사용자"까지 미완으로 읽는다. */
export function setupComplete(items: AppState['items']): boolean {
  const hasSubjects = items.some((i) => i.name);
  const hasTargets = items.some(
    (i) =>
      i.name &&
      ((i.mode === 'daily' && (i.dailyMin || 0) > 0) ||
        (i.weeklyHours || 0) > 0 ||
        (i.chapters && i.chapters.length > 0)),
  );
  return hasSubjects && hasTargets;
}

export function SetupGuide() {
  const navigate = useNavigate();
  const items = useApp((s) => s.state.items);
  const routine = useApp((s) => s.state.routine);

  const scan = useQuery<VaultScan>({ queryKey: ['vault'], queryFn: skipToken }).data;

  const hasSubjects = items.some((i) => i.name);
  const hasTargets = setupComplete(items);
  const hasRoutine = (routine || []).length > 0;
  // 볼트가 실제로 무엇을 갖고 있나 — 없으면(브라우저·미설정) 이 줄 자체가 안 나온다.
  const vaultSubjects = scan?.subjects.length || 0;
  const vaultNotes = scan?.subjects.reduce((t, s) => t + s.notes, 0) || 0;
  if (hasSubjects && hasTargets) return null; // 셋업 완료 → 숨김(안전망 — Today가 이미 스위칭)

  const steps: { ok: boolean; title: string; desc: string; actions: React.ReactNode }[] = [
    {
      ok: hasSubjects,
      title: '공부할 과목 추가',
      desc: vaultSubjects
        ? '볼트를 통째로 가져오면 과목과 챕터(1·2단계)가 한 번에 채워져요. 직접 입력도 됩니다.'
        : '계획 › 과목에서 직접 입력하거나 “불러오기”로 볼트(전공 폴더)를 통째로 가져오세요.',
      actions: (
        <>
          {/* ⚠ **볼트가 있으면 그쪽이 primary 다**(W1). 종전엔 지배적인 버튼이 `+ 첫 과목 추가`
              였고 임포트는 그 옆 ghost 였다 — 눈에 띄는 쪽이 막다른 길이었다. */}
          <Button sm variant={vaultSubjects ? 'primary' : 'default'} onClick={() => navigate('/items?import=1')}>
            <Icon name="folder" /> 볼트에서 불러오기
          </Button>
          <Button sm variant={vaultSubjects ? 'default' : 'primary'} onClick={() => navigate('/items')}>
            직접 추가
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
        <Button sm onClick={() => navigate('/items?skeleton=1')}>
          가용시간(뼈대) 열기
        </Button>
      ),
    },
  ];
  const done = steps.filter((s) => s.ok).length;

  /* ⚠ 여기만 `ds-well` 에 **테두리를 명시로 되살린다.** 이 패널은 콜드스타트에서 화면을 통째로
     차지하는 단 하나의 표면이라 `--line-setup` 으로 자기 가장자리를 구분하는데, `ds-well` 은
     테두리가 없어 색 지정만 남으면(`border-[color:…]`) 폭이 0이라 **조용히 아무것도 안 그려진다**
     — 정의되지 않은 토큰이 회색으로 렌더되던 H20 과 같은 부류다. */
  return (
    <div className="ds-well w-full max-w-runner-narrow border border-[color:var(--line-setup)]! shadow-[var(--shadow-setup-card)]!">
      <h2>
        시작하기 <span className="ds-tiny text-mut">— 3단계만 채우면 오늘의 블록이 자동으로 잡혀요</span>
      </h2>
      {/* W3 — **볼트에 무엇이 있는지 먼저 말한다.** `scanVaultViaShell()` 은 폴더 선택도 권한도
          없는 한 번의 Rust 호출인데, 그걸 부르는 화면이 연동 탭과 임포트 패널뿐이라 콜드 화면은
          옆에 노트 604개가 있어도 빈 앱처럼 보였다. 지금은 `app/VaultSync` 가 부팅에 채운다. */}
      {vaultSubjects > 0 && !hasSubjects && (
        <div className="ds-well ds-tiny mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <b className="text-txt">
            볼트에 과목 {vaultSubjects}개 · 노트 {vaultNotes}개가 있어요
          </b>
          <span className="text-mut">— 아래 1단계에서 통째로 가져오면 챕터까지 함께 채워집니다.</span>
        </div>
      )}
      <div className="ds-row" style={{ alignItems: 'center', marginBottom: 6 }}>
        <Pill tone={done === 3 ? 'good' : 'warn'}>{done}/3 완료</Pill>
        <span className="h-1.5 min-w-20 flex-1 overflow-hidden rounded-full bg-panel2 shadow-[var(--shadow-inset-line-soft)]">
          <i
            style={{ width: `${Math.round((done / 3) * 100)}%` }}
            className="block h-full rounded-full bg-[image:var(--bg-setup-prog)] transition-[width] duration-draw ease-[var(--ease)]"
          />
        </span>
      </div>
      {steps.map((s, i) => (
        <div key={i} className="flex items-start gap-2.75 border-t border-line-soft px-0.5 py-2.75">
          <span
            className={`mt-px inline-flex size-5.5 flex-none items-center justify-center rounded-full [border-width:var(--setupck-border-w)] [border-style:solid] text-sm leading-text font-extrabold ${s.ok ? 'border-good bg-good text-on-acc' : 'border-line text-mut'}`}
            aria-hidden="true"
          >
            {s.ok ? '✓' : ''}
          </span>
          <div className="min-w-0 flex-1">
            <div className="mb-px text-base14 font-semibold">
              {s.ok ? <s className="text-mut [text-decoration-color:var(--setup-strike)]">{s.title}</s> : s.title}
            </div>
            <div className="ds-tiny text-mut">{s.desc}</div>
            {!s.ok && <div className="mt-2 flex flex-wrap gap-1.75">{s.actions}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
