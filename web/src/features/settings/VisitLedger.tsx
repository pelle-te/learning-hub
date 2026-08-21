/* ============================================================
   VisitLedger — 관측 원장 리드아웃(방문·홉·유휴) + **점검 모드 스위치**.

   ⚠ `Settings.tsx` 에서 갈라져 나왔다(I034 실행 중 · 2026-08-22). 이유는 취향이 아니라
   **래칫**이다: `max-lines` 가 그 파일에 걸려 있고, 점검 토글이 들어가면서 한도를 넘었다.
   한도를 올리는 것은 처방이 아니다(같은 거짓말을 20줄 뒤로 미룰 뿐 · `budget` 축 ③이 같은
   판단을 이미 적어 뒀다). 이 블록은 원래 «판단의 입력을 정직하게 보여 주는» 한 덩어리라
   갈라 나올 자리도 여기가 맞다 — 같은 폴더의 `OrphanDocs`·`RailAssembly` 와 같은 형태.

   ⚠ **화면이 판정하지 않는다.** 판정은 `hasSample`·`idleVerdict` 가 소유하고 여기는 그
   결과를 그린다. 화면이 문장을 조립하기 시작하면 "관측 0일"과 "부재 0회"가 같은 회색으로
   보이고, 그 구분이 정확히 이 원장의 값이다.
============================================================ */
import { useEffect, useState } from 'react';
import { useApp } from '@/store/useApp';
import { useUI } from '@/store/useUI';
import {
  visitSummary,
  visitSample,
  hasSample,
  hourHistogram,
  eveningShare,
  roundTrips,
  SAMPLE_MIN,
  type RoundTrip,
  type VisitRow,
} from '@/lib/visits';
import { idleSample, idleSummary, idleVerdict, type IdleRow } from '@/lib/idleLedger';
import { aiUsage, aiUsageReady, AI_SAMPLE_MIN_DAYS } from '@/lib/aiUsage';
import { importObservations, OBSERVATIONS_FIELD } from '@/lib/observations';
import { observationsReady, type ObsAnswer, type ObsQuestion } from '@/lib/observationsQuery';
import { todayISO } from '@/lib/utils';
import OrphanDocs from './OrphanDocs';

/* ⚠ `Settings.tsx` 의 `S.bdLine` 과 **같은 값**이다. 공유 상수로 끌어올리지 않은 것은,
   저기 `S` 가 그 파일의 이식 표기 묶음이고 여기 필요한 것은 한 줄뿐이기 때문 —
   묶음을 통째로 export 하면 다음 분리 때 두 파일이 서로의 표기를 물게 된다. */
const BD_LINE = 'mt-1! tabular-nums'; // 'ds-foot' 의 margin-top(7px) 을 4px 로 이김

/**
 * 방문 원장 리드아웃(H23 · 2026-07-26 감사) — **소비처가 없는 계측은 계측이 아니다.**
 *
 * `route_visits`(N-11)는 도입 나흘 동안 쓰기만 있고 읽는 곳이 0 이었다. 그 사이 로드맵의 다섯
 * 항목이 이 데이터를 기다렸고, 정작 폰 계측은 **도달조차 못 하고 있었다** — 값을 볼 수 있었다면
 * 첫날에 드러났을 사실이다. 그래서 화려한 화면이 아니라 **원본에 가까운 표**다: 판단(탭 은퇴 등)은
 * 사람이 하고, 여기는 그 입력을 정직하게 보여 주기만 한다(via 를 합치지 않는 것이 그 정직함이다).
 */
export default function VisitLedger() {
  const [rows, setRows] = useState<VisitRow[] | null>(null);
  /* I030 — 점검 모드. **원장 바로 옆**이 이 스위치의 자리다: 관측을 멈추는 노브가 관측
     리드아웃에서 멀리 있으면, 켜 놓은 것을 잊은 채 그 리드아웃의 0 을 읽게 된다. */
  const inspectDs = useUI((s) => s.ui.inspectDs);
  const setInspecting = useUI((s) => s.setInspecting);
  const today = todayISO(useApp((s) => s.state));
  /* ⚠ **분모를 함께 보여 준다**(P1/P2 · 2026-08-01). 합계만 보이면 "안 쓴다"와 "안 쟀다"가
     같은 0 으로 보이고, `shell/tabs.ts` 의 은퇴 규칙이 그 0 을 근거로 탭을 지운다. */
  const [sample, setSample] = useState<{ days: number; total: number } | null>(null);
  /* W2(발산 6회차) — 홉 원장. **이 두 줄이 결정 셋을 막고 있던 것**이다: 두 페인(왕복이
     실재하나) · 시간 조명(하루에 여러 번 여나) · 확정판의 시제(저녁에 여나).
     ⚠ 여기 보이는 것도 판단이 아니라 **입력**이다 — 위 표와 같은 규율. */
  const [trips, setTrips] = useState<RoundTrip[] | null>(null);
  const [hours, setHours] = useState<number[] | null>(null);
  useEffect(() => {
    void visitSummary().then(setRows);
    void visitSample().then(setSample);
    void roundTrips().then(setTrips);
    void hourHistogram().then(setHours);
  }, []);
  /* ⚠ 점검 중이면 **행이 없어도 그린다.** 안 그러면 첫날부터 켠 사용자는 끄는 스위치에
     도달할 수 없고, 그 순간 이 노브는 «영원히 관측을 끄는 함정»이 된다. */
  const inspecting = inspectDs === today;
  if (!rows?.length && !inspecting) return null;
  const enough = sample ? hasSample(sample) : false;
  const peak = hours ? Math.max(...hours) : 0;
  return (
    <details className={`ds-foot ${BD_LINE}`}>
      <summary>방문 원장(최근 14일) — 어디를 얼마나 열었나</summary>
      {/* I030 — 점검 트래픽 분리. 켠 **그 날짜**만 유효하고 자정에 스스로 꺼진다(부울이 아닌
          이유는 `lib/visits` 머리주석). 켜져 있으면 그 사실을 표 위에 크게 말한다. */}
      <label className="ds-chkRow mt-1.5">
        <input type="checkbox" checked={inspecting} onChange={(e) => setInspecting(e.target.checked ? today : null)} />
        오늘은 점검 중 — 방문·홉을 원장에 남기지 않기 (화면을 훑는 순회가 「사용」으로 집계되지 않게)
      </label>
      {inspecting && (
        <div className="ds-tiny mt-1 text-warn">
          오늘({inspectDs})은 기록하지 않습니다 — 아래 수치에 오늘 몫이 없습니다. 내일 자동으로 꺼집니다.
        </div>
      )}
      {sample && (
        <div className="ds-tiny mt-1.5">
          <b>표본</b> — 관측 {sample.days}일 · 총 {sample.total}회{' '}
          <span className={enough ? 'text-mut' : 'text-warn'}>
            {enough
              ? `(기준 ${SAMPLE_MIN.days}일·${SAMPLE_MIN.total}회 충족 — 탭 은퇴 판정 가능)`
              : `(기준 ${SAMPLE_MIN.days}일·${SAMPLE_MIN.total}회 미달 — 판정 불가. 이 수치로 탭을 지우지 말 것)`}
          </span>
        </div>
      )}
      <div className="ds-tiny mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {(rows ?? []).slice(0, 16).map((r) => (
          <span key={`${r.key}:${r.via}`}>
            {r.key} <span className="text-mut">· {r.via}</span> {r.n}
          </span>
        ))}
      </div>
      {/* 왕복쌍 — **양방향이 다 있어야** 한 줄이 된다(단방향은 경로이지 왕복이 아니다). */}
      <div className="ds-tiny mt-2">
        <b>왕복쌍</b>{' '}
        {trips?.length ? (
          <span className="inline-flex flex-wrap gap-x-3 gap-y-1">
            {trips.slice(0, 6).map((t) => (
              <span key={`${t.a}:${t.b}`}>
                {t.a} <span className="text-mut">↔</span> {t.b} {t.n}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-mut">아직 없음 — 오간 화면이 없으면 두 페인은 만들 이유가 없다</span>
        )}
      </div>
      {/* 시각 분포 — 24칸. 한 칸에 몰려 있으면 "캔버스가 하루를 싣는" 안은 상수가 된다. */}
      {hours && peak > 0 && (
        <div className="ds-tiny mt-2">
          <b>여는 시각</b> <span className="text-mut">· 저녁(18~24시) {Math.round(eveningShare(hours) * 100)}%</span>
          <div className="mt-1 flex items-end gap-px" aria-hidden="true">
            {hours.map((n, h) => (
              <span
                key={h}
                className="w-1.5 bg-acc"
                style={{ height: `${Math.max(1, Math.round((n / peak) * 16))}px`, opacity: n ? 1 : 0.25 }}
              />
            ))}
          </div>
          {/* A-15 — 축 눈금은 **주석**이다(읽지 않아도 문장이 성립한다) → 세 번째 값 평면. */}
          <div className="mt-0.5 text-anno">0시 — 6 — 12 — 18 — 23</div>
        </div>
      )}
      <ObsQuestions />
      <IdleLedger />
      <AiUsageLine />
      <MergeObservations />
      <OrphanDocs />
    </details>
  );
}

/**
 * 유휴 원장 리드아웃(N-8 · W3) — **트리거를 만들지 말지의 유일한 근거**.
 *
 * ⚠ 판정 문장을 여기서 조립하지 않는다(`idleVerdict` 가 낸다). 화면이 판정하면 "관측 0일"과
 * "부재 0회"가 같은 회색 문장으로 보이고, 그 구분이 정확히 이 원장의 값이다.
 * ⚠ 같은 `<details>` 안에 두는 이유: 둘 다 **판단의 입력**이지 화면이 아니다. 새 섹션을 파면
 * 설정이 계측 대시보드가 되기 시작한다(그건 이 앱이 다섯 번 강등한 부류다).
 */
function IdleLedger() {
  const [rows, setRows] = useState<IdleRow[] | null>(null);
  const [sample, setSample] = useState<{ days: number; spells: number } | null>(null);
  useEffect(() => {
    void idleSummary().then(setRows);
    void idleSample().then(setSample);
  }, []);
  if (!rows || !sample) return null;
  const v = idleVerdict(rows, sample);
  return (
    <div className="ds-tiny mt-2">
      <b>자리 비움</b> <span className="text-mut">· 5분+ 무입력 · 최근 14일</span>
      <div className={v.ok ? 'text-mut' : 'text-warn'}>{v.text}</div>
      {rows.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {rows.map((r) => (
            <span key={r.hour}>
              {r.hour}시 <span className="text-mut">·</span> {r.n}회 {Math.round(r.sec / 60)}분
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 로컬 LLM 축 계기(I023 · 2026-08-22) — **분기 항목의 유일한 입력**.
 *
 * 복리 각도는 «키우자», 은퇴·백지 각도는 «지우자»로 갈렸고 두 안의 최싼검증이 같았다:
 * *호출 카운터 1주 · 0이면 은퇴, 0이 아니면 복리*(리포트 §5-A). 그 수를 여기서 읽는다.
 *
 * ⚠ **판정 문장을 조립하지 않는다** — `aiUsageReady` 가 «판정해도 되는가»를 소유하고, 화면은
 * 아직 이르면 그 사실을 말한다. 이 리드아웃의 결론이 *"Rust 473줄을 지운다"* 라, 여기서
 * 0 을 «안 쓴다»로 성급히 읽으면 되돌리기 비용이 가장 큰 실수가 된다.
 */
function AiUsageLine() {
  const u = aiUsage();
  const ready = aiUsageReady(u);
  return (
    <div className="ds-tiny mt-2">
      <b>로컬 LLM</b> <span className="text-mut">· 회고 코치 · 임베딩 · 최근 14일</span>
      <div className={ready ? 'text-mut' : 'text-warn'}>
        {u.since === null
          ? '아직 한 번도 안 쟀습니다 — 이 값이 없는 것은 「안 쓴다」가 아닙니다(첫 호출부터 셉니다).'
          : ready
            ? `${u.total}회 · 쓴 날 ${u.activeDays}일 / 관측 ${u.observedDays}일 (${u.since}~) — 판정 가능`
            : `${u.total}회 · 관측 ${u.observedDays}일 (${u.since}~) — ${AI_SAMPLE_MIN_DAYS}일 미달. 이 수로 축을 지우지 말 것`}
      </div>
    </div>
  );
}

/**
 * 다른 기기(= 폰)의 관측을 **합친다**(I033 · 2026-08-22).
 *
 * ## ⚠⚠ 왜 통째 가져오기를 쓰면 안 되나
 *
 * `importJSON` 은 `loadState` 로 앱 상태를 **교체**한다. 폰 백업으로 그걸 하면 폰의 앱 데이터가
 * PC 를 덮는데, 앱 데이터의 정본은 **클라우드 동기화**다 — 두 정본이 서로를 덮는 경로를 손으로
 * 여는 셈이다. 여기서 원하는 것은 그게 아니라 *"폰 뷰를 실제로 쓰는가"* 한 질문의 입력이다.
 *
 * → `_obs` 만 꺼내 `importObservations` 로 upsert 한다. 방문 수는 `MAX` 라 이 기기의 관측이
 * 깎이지 않는다(그 규칙은 `lib/observations` 가 소유한다).
 *
 * ⚠ 합친 뒤 표가 즉시 안 바뀐다 — 이 리드아웃은 마운트 때 한 번 읽는다. 복원 건수를 말해
 * 주고 «다시 열면 반영»을 명시한다: 화면이 조용하면 사용자는 실패했다고 읽는다.
 */
function MergeObservations() {
  const [msg, setMsg] = useState<string | null>(null);
  const onFile = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setMsg('읽는 중…');
    void f
      .text()
      .then(async (txt) => {
        const obj: unknown = JSON.parse(txt);
        const blob = obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[OBSERVATIONS_FIELD] : undefined;
        if (!blob) {
          setMsg('그 파일엔 관측 원장이 없어요(구 백업이거나 다른 형식).');
          return;
        }
        const n = await importObservations(blob);
        setMsg(`${n}행을 합쳤어요 — 이 화면을 다시 열면 반영됩니다.`);
      })
      .catch(() => setMsg('읽기 실패: JSON 형식이 아닙니다.'));
  };
  return (
    <div className="ds-tiny mt-2">
      <b>다른 기기 관측 합치기</b>{' '}
      <span className="text-mut">· 폰 홈의 「이 폰의 기록 내보내기」로 만든 파일 · 앱 데이터는 안 건드립니다</span>
      <div className="mt-1">
        <input type="file" accept="application/json,.json" onChange={onFile} aria-label="관측 원장 파일 고르기" />
      </div>
      {msg && <div className="mt-1 text-mut">{msg}</div>}
    </div>
  );
}

/**
 * I031 — **관측이 막고 있던 결정들**과, 지금 그것을 답할 수 있는가(2026-08-22 발상 축).
 *
 * 각 원장의 머리주석은 자기가 막고 있던 결정을 정확히 적어 뒀는데, 실측하면 그 값을 읽는
 * 곳은 **바로 위 리드아웃 하나**였다 — 즉 「관측이 쌓이면 판정한다」가 판정하는 쪽 없이 돌고
 * 있었다. 이 목록이 그 자리다: 무엇을 기다리고 있었는지와, 지금 답이 나왔는지.
 *
 * ⚠ **판정 문장을 화면이 조립하지 않는다** — `observationsReady` 가 `why` 를 준다. 화면이
 * 문장을 만들면 «관측 0일»과 «부재 0회»가 같은 회색 문장이 되고, 그 구분이 이 원장의 값이다.
 */
const OBS_QUESTIONS: { q: ObsQuestion; label: string }[] = [
  { q: 'tab-retire', label: '이 탭을 지워도 되나' },
  { q: 'two-pane', label: '두 페인을 만들 이유가 있나' },
  { q: 'day-phase', label: '하루의 국면을 화면에 실을 값이 있나' },
  { q: 'idle-trigger', label: '재수신성 트리거를 만들 이유가 있나' },
];

function ObsQuestions() {
  const [answers, setAnswers] = useState<Record<string, ObsAnswer> | null>(null);
  useEffect(() => {
    void Promise.all(OBS_QUESTIONS.map(({ q }) => observationsReady(q).then((a) => [q, a] as const))).then((rows) =>
      setAnswers(Object.fromEntries(rows)),
    );
  }, []);
  if (!answers) return null;
  return (
    <div className="ds-tiny mt-2">
      <b>관측이 답해야 할 것</b> <span className="text-mut">· 무엇을 기다리고 있었나</span>
      <ul className="m-0! mt-1 flex list-none flex-col gap-1 p-0!">
        {OBS_QUESTIONS.map(({ q, label }) => {
          const a = answers[q];
          if (!a) return null;
          /* 셋을 가른다: 답 나옴 / 아직 부족 / **아예 못 쟀다**. 마지막을 「부족」으로 접으면
             이 파일이 막으려는 그 혼동(0 이 「없다」인가 「안 쟀다」인가)을 스스로 저지른다. */
          const tone = a.unavailable ? 'text-mut' : a.ready ? 'text-acc' : 'text-warn';
          return (
            <li key={q} className="m-0!">
              <span className="text-txt">{label}</span> <span className={tone}>— {a.why}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
