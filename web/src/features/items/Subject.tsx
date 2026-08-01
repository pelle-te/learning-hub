/* ============================================================
   Subject — **객체 축**(`/subject/:id`). W12 · 2026-07-31. 이 발산 최대 스윙.

   ## 왜 생겼나
   ⌘K 는 이미 **객체 6종**(과목·챕터·책·보충·약점·오답)을 동사까지 붙여 인덱싱하는데
   (`shell/actions.ts` `contentSearch`·`verbsFor`) **착지할 화면이 없어** 4개 탭으로 흩뿌렸다.
   코드가 그 사실을 자백해 뒀다: _"챕터 단위 앵커가 없으니 소속 과목 카드까지가 정직한 최선"_.
   라우트 23개 중 객체 상세는 `/atlas/*` 하나뿐이었고, features 본문의 `navigate('/x')` 25건 중
   1위가 `/items`(9건)인데 그건 **레일에 없는 lens** 다.

   관측(2026-07-31): _"회로이론 지금 어떤가?"_ = `items`→`stats`→`mastery`→`ledger`→`forecast`
   →`mistakes` = **7클릭·6화면**이고, 매 화면에서 그 과목 행을 눈으로 찾아야 했다
   (`?sid=` 를 받는 화면은 `Mistakes` 하나였다).

   ## 구조 — 상단 리드아웃 + 3열
   [챕터·정의 | 앎(원장 5단계 + 숙달) | 인출·오답(sid 고정)].
   챕터는 `#ch-<id>` 앵커를 얻는다 — ⌘K 의 챕터 히트가 처음으로 **자기 자리**에 착지한다.

   ⚠ 자기비평(로드맵에 적힌 그대로 남긴다): 과목이 10개 미만이면 교차 매트릭스(ledger·mastery
   히트맵)가 객체 화면보다 빠르고, 그러면 이 층은 클릭을 하나 더 만드는 것뿐일 수 있다. 그래서
   1단계는 **흡수를 하지 않는다** — `ledger`·`mastery` 탭은 그대로 살아 있고 여기선 그 화면들이
   이미 계산하는 파생을 *이 과목 한 줄로* 요약해 보여 주고 딥링크만 건다.
============================================================ */
import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { useSchedule } from '@/store/selectors';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { useLedger, useKnowledge, usePing } from '@/store/queries';
import { ui } from '@/shell';
import { riskChapters } from '@/lib/spacedReview';
import { subjectRollup, LEDGER_STAGES, STAGE_META } from '@/lib/ledger';
import { matchSubjectIndex } from '@/lib/subjectMatch';
import { weakCountBySid } from '@/lib/insights';
import { removeSidFromAlloc, rowSumMin, allocView, weekMonOf } from '@/lib/weekAlloc';
import { removeSidFromDayPlans } from '@/lib/dayPlans';
import { todayISO, hNum, ddayInfo, dayDiff, pctLabel } from '@/lib/utils';
import { Button, Pill } from '@/components/ui';
import State from '@/components/State';
import { SubjectDefinition } from './SubjectDefinition';

const COL = 'flex min-h-0 min-w-0 flex-col gap-3.5 overflow-y-auto [scrollbar-width:thin]';
const CARD_T = 'mb-2! ds-caps';

/** 앎 컬럼 — 원장 5단계(이 과목) + 지식엔진 숙달. **계산은 각 lib 이 이미 소유한다.** */
function Knowing({ name }: { name: string }) {
  const led = useLedger();
  const ping = usePing();
  const know = useKnowledge(ping.isSuccess).data;
  const navigate = useNavigate();

  const names = Object.keys(led.data?.subjects || {});
  const li = matchSubjectIndex(name, names);
  const roll = li >= 0 ? subjectRollup(names[li]!, led.data!.subjects[names[li]!]!) : null;

  const kSubs = know?.subjects || [];
  const kNames = kSubs.map((s) => s.subject);
  const ki = matchSubjectIndex(name, kNames);
  const mastery = ki >= 0 ? (kSubs[ki]?.mastery ?? null) : null;

  return (
    <div className={COL}>
      <div className="ds-rule">
        <h3 className={CARD_T}>원장 — 챕터가 얼마나 멀리 갔나</h3>
        {roll ? (
          <>
            <div className="flex flex-col gap-1.5">
              {LEDGER_STAGES.map((st) => {
                const n = roll.reached[st];
                return (
                  <div key={st} className="flex items-center gap-2 text-md">
                    <span className="w-14 flex-none text-mut">{STAGE_META[st].label}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel2">
                      <i
                        className="block h-full rounded-full"
                        style={{
                          width: `${roll.total ? (n / roll.total) * 100 : 0}%`,
                          background: STAGE_META[st].color,
                        }}
                      />
                    </span>
                    <b className="w-12 flex-none text-right tabular-nums">
                      {n}/{roll.total}
                    </b>
                  </div>
                );
              })}
            </div>
            <Button sm variant="ghost" className="mt-2.5" onClick={() => navigate('/ledger')}>
              원장 전체 보기 →
            </Button>
          </>
        ) : (
          <p className="ds-tiny text-mut">볼트 원장에 이 과목이 아직 없어요(워크스페이스·빌드 필요).</p>
        )}
      </div>
      <div className="ds-rule">
        <h3 className={CARD_T}>숙달도 — 지식엔진</h3>
        {mastery != null ? (
          <>
            <div className="text-2xl font-extrabold tabular-nums">{pctLabel(mastery)}</div>
            <Button sm variant="ghost" className="mt-2" onClick={() => navigate('/mastery')}>
              숙달도 지도 →
            </Button>
          </>
        ) : (
          /* ⚠ "0%" 로 그리지 않는다 — 값 부재와 값 0 이 같은 픽셀이 되면 그게 곧 조용한 거짓말이다
             (`visits.ts` 가 물린 "쌓이고 있다는 믿음만 쌓인다"와 같은 부류). */
          <p className="ds-tiny text-mut">아직 관측이 없어요 — 지식엔진이 이 과목을 아직 모릅니다.</p>
        )}
      </div>
    </div>
  );
}

/** 인출 컬럼 — 이 과목의 밀린 챕터 + 반복 약점. sid 가 고정이라 눈으로 행을 찾지 않는다. */
function Retrieval({ sid }: { sid: string }) {
  const state = useApp((s) => s.state);
  const res = useSchedule();
  const navigate = useNavigate();
  const today = todayISO(state);
  const risky = riskChapters(state, res.days || [], today, 100).filter((c) => c.sid === sid);
  const weak = (state.cbms || []).filter((c) => c.sid === sid);

  return (
    <div className={COL}>
      <div className="ds-rule">
        <h3 className={CARD_T}>복습 위험 — 오래 안 본 챕터</h3>
        {risky.length ? (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {risky.slice(0, 10).map((c) => (
              <li key={c.chapter} className="flex items-center gap-2 text-md">
                <span className="min-w-0 flex-1 truncate">{c.chapter}</span>
                {c.fromVault && <span className="ds-pill ds-tiny">볼트</span>}
                <b className={`tabular-nums ${c.risk === 'overdue' ? 'text-bad' : 'text-warn'}`}>{c.daysSince}일</b>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ds-tiny text-mut">밀린 챕터가 없어요.</p>
        )}
        <Button sm variant="ghost" className="mt-2.5" onClick={() => navigate('/review-run')}>
          지금 인출 →
        </Button>
      </div>
      <div className="ds-rule">
        <h3 className={CARD_T}>오답 · 약점 {weak.length ? `· ${weak.length}건` : ''}</h3>
        {weak.length ? (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {weak.slice(0, 8).map((c) => (
              <li key={c.id} className="truncate text-md">
                <span className="ds-tiny mr-1.5 text-mut">{c.code}</span>
                {c.chapter || '(챕터 미기재)'}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ds-tiny text-mut">기록된 약점이 없어요.</p>
        )}
        {/* `?sid=` 를 원래 받던 유일한 화면 — 객체 축이 서면 그 관용구가 예외가 아니라 규칙이 된다. */}
        <Button sm variant="ghost" className="mt-2.5" onClick={() => navigate(`/mistakes?sid=${sid}`)}>
          오답 노트에서 보기 →
        </Button>
      </div>
    </div>
  );
}

export default function Subject() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const items = useApp((s) => s.state.items);
  const state = useApp((s) => s.state);
  const mutate = useApp((s) => s.mutate);
  const res = useSchedule();
  const item = items.find((i) => i.id === id) ?? null;
  const today = todayISO(state);
  const wk = weekMonOf(today);
  const allocMin = item ? rowSumMin(allocView(state, res, wk)[item.id]) : 0;
  const chs = item?.chapters || [];
  const doneCh = chs.filter((c) => c.done).length;
  const weakN = item ? (weakCountBySid(state)[item.id] ?? 0) : 0;

  /* W22 의 짝 — destination 이 아니어도 **객체 화면은 자기 이름과 수를 크게 말한다**(원칙 ②).
     이 화면의 존재 이유가 "그 과목 지금 어떤가"라 리드아웃이 곧 답의 첫 줄이다. */
  usePageChromeEffect(
    () => ({
      primary: item ? { label: item.name || '(이름 없음)', value: `${doneCh}/${chs.length || 0} 챕터` } : null,
      readouts: !item
        ? []
        : [
            { label: '이번 주 배분', value: `${hNum(allocMin)} h` },
            { label: '약점', value: weakN || '—' },
            {
              label: item.deadline ? '마감' : '유형',
              value: item.deadline
                ? ddayInfo(dayDiff(today, item.deadline)).lab
                : item.mode === 'daily'
                  ? '매일'
                  : '주간',
            },
          ],
    }),
    [item, doneCh, chs.length, allocMin, weakN, today],
  );

  const removeItem = useCallback(
    async (sid: string) => {
      const it = items.find((s) => s.id === sid);
      const ok = await ui.confirm(
        `"${(it && it.name) || '이 과목'}"을(를) 삭제할까요? (챕터·진행 기록도 함께 사라집니다)`,
        {
          title: '과목 삭제',
          okLabel: '삭제',
          danger: true,
        },
      );
      if (!ok) return;
      ui.backupNow();
      mutate((st) => {
        st.items = st.items.filter((s) => s.id !== sid);
        removeSidFromAlloc(st, sid); // 참조 무결성 — Items 의 삭제와 **같은 세 줄**이어야 한다
        removeSidFromDayPlans(st, sid);
      });
      ui.toastUndo(`"${(it && it.name) || '과목'}" 삭제됨`);
      navigate('/items', { replace: true });
    },
    [items, mutate, navigate],
  );

  if (!item)
    return (
      <State
        kind="empty"
        glyph="🔍"
        title="그 과목이 없어요"
        desc="삭제됐거나 링크가 낡았어요."
        next={
          <Button variant="primary" onClick={() => navigate('/items')}>
            과목 목록으로
          </Button>
        }
      />
    );

  return (
    <section className="grid min-h-0 flex-1 grid-cols-3 gap-4 px-5.5 pt-2 pb-5.5 max-wide:grid-cols-1 max-wide:overflow-y-auto">
      <div className={COL}>
        <div className="flex items-center gap-2">
          <Pill tiny>{item.source || '직접'}</Pill>
          <Button sm variant="ghost" onClick={() => navigate('/items')}>
            ← 과목 목록
          </Button>
        </div>
        <SubjectDefinition item={item} mutate={mutate} onDelete={(sid) => void removeItem(sid)} />
      </div>
      <Knowing name={item.name} />
      <Retrieval sid={item.id} />
    </section>
  );
}
