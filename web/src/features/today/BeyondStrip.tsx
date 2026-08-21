/* ============================================================
   today/BeyondStrip — **'오늘 밖'에 무엇이 있나**(W7 에서 분리 · 2026-08-07).

   ⚠ 파일을 가른 이유는 래칫 둘이다(`cognitive-complexity` · `max-lines`). A-10(오늘 몫)과
   A-13(확정)이 붙으며 `TodaySignature` 가 상한을 넘었고, 래칫이 막으려는 것이 정확히 그것이다 —
   **한 함수가 화면 전체의 분기를 다 쥐는 것**. 뺀 기준은 *응집*이다: 이 덩어리는 "오늘 밖에
   무엇이 있나"라는 한 질문에만 답하고 히어로·타이머·흐름과 상태를 공유하지 않는다.
   ⚠ 컴포넌트가 아니라 **함수**인 것도 의도다 — 렌더 상태가 없고 인자만으로 결정된다.
============================================================ */
import { Fragment } from 'react';
import { ddayInfo } from '@/lib/utils';
import { ankiFreshness } from '@/lib/anki';
import { todayShare } from '@/lib/todayShare';
import { MARK_LABEL } from '@/lib/syllabusIntake';
import type { MarkDue } from '@/lib/semester';
import { AnkiTag, S, tone } from './signatureParts';

/** '오늘 밖' 스트립 — 본체에서 뺀 조립부(응집 하나: *오늘 밖에 무엇이 있나*). */
export function buildBeyondStrip(p: {
  soon: { name: string; dday: number; color?: string }[];
  /** I010 — 오늘·곧 있는 학사 눈금(휴강·정정 마감·보강). 판정은 `lib/semester.upcomingMarks`. */
  marks: MarkDue[];
  due: number | null | undefined;
  ankiFresh: ReturnType<typeof ankiFreshness>;
  openBl: number;
  riskN: number;
  share: ReturnType<typeof todayShare>;
  shareText: string | null;
  go: (to: string) => void;
}): React.ReactNode {
  const { soon, marks, due, ankiFresh, openBl, riskN, share, shareText, go } = p;
  const stripGroups: { key: string; node: React.ReactNode }[] = [];
  if (soon.length)
    stripGroups.push({
      key: 'dday',
      node: (
        <div className={S.grp}>
          <span className={S.grpL}>마감 임박</span>
          {soon.map((st) => {
            const { lab } = ddayInfo(st.dday);
            return (
              <button key={st.name} type="button" className={S.tag} onClick={() => go('/items')}>
                <span className={S.dot} style={{ background: st.color || 'var(--acc)' }} />
                {st.name} <b className={S.hot}>{lab}</b>
              </button>
            );
          })}
        </div>
      ),
    });
  /* ── I010 학사 눈금 — **학기 중에 들어온 것이 오늘에 닿는 유일한 자리** ────────────────
     종전에 눈금을 그리는 곳은 월 달력과 졸업탭 국면판 둘뿐이었다. 즉 「내일 휴강」을 넣어도
     *오늘 화면*은 그 사실을 모르고, 그러면 상시 인입구를 만들어도 넣을 이유가 안 생긴다
     (넣어도 아무 데서도 안 보이므로). 그래서 인입구와 이 자리는 **같은 항목**이다.
     ⚠ 지난 눈금은 애초에 안 온다 — 그 판정은 `upcomingMarks` 가 소유한다(자책 금지 규율). */
  if (marks.length)
    stripGroups.push({
      key: 'marks',
      node: (
        <div className={S.grp}>
          <span className={S.grpL}>학사일정</span>
          {marks.map((m) => (
            <button key={m.mark.id} type="button" className={S.tag} onClick={() => go('/schedule')}>
              {m.mark.label || MARK_LABEL[m.mark.kind]}{' '}
              <b className={tone(m.daysLeft === 0)}>{m.daysLeft === 0 ? '오늘' : `D-${m.daysLeft}`}</b>
            </button>
          ))}
        </div>
      ),
    });
  if (due != null && due > 0)
    stripGroups.push({
      key: 'anki',
      node: <AnkiTag due={due} fresh={ankiFresh} onGo={() => go('/integrations')} />,
    });
  if (openBl > 0)
    stripGroups.push({
      key: 'backlog',
      node: (
        <div className={S.grp}>
          <span className={S.grpL}>열린 보충</span>
          {/* A-10 — **오늘 몫**을 크게, 적재량은 옆에 작게. 적재량을 지우지 않는 이유는
              상세로 가는 사람에게 여전히 필요하기 때문이고, 크기를 가른 이유는 *먼저 읽을
              것*이 오늘 몫이기 때문이다(한 양 = 한 자리 규율의 위계 판). */}
          <button type="button" className={S.tag} onClick={() => go('/day')}>
            <b className={tone(true)}>{share.backlog.today}</b> 건
            {share.backlog.total > share.backlog.today && (
              <span className="ml-1 text-anno">/ {share.backlog.total}</span>
            )}
          </button>
        </div>
      ),
    });
  /* W18 '오늘 밖' 구역 — **레일 컬럼 안에 살지만 빈 날엔 히어로 아래로 내려온다**(W19).
     ⚠ 자리를 옮기는 것이지 지우는 것이 아니다: 빈 날에 컬럼을 접으면서 이 신호까지 함께
     사라지면, 마감·Anki·보충이 **가장 한가한 날에만 안 보이는** 뒤집힌 상태가 된다. */
  return riskN > 0 || stripGroups.length > 0 ? (
    <div className={S.beyond}>
      {riskN > 0 && (
        <button type="button" className={S.reviewCta} onClick={() => go('/review-run')}>
          <span className={S.reviewDot} aria-hidden="true" />
          {/* A-10 — `복습 12개 밀림` 이 여기 있었다. 지금은 **오늘 손댈 수 있는 수**다. */}
          복습 {share.review.today}개
          {share.review.total > share.review.today && <span className="ml-1 text-anno">/ {share.review.total}</span>}{' '}
          <b className="ml-0.5 font-extrabold text-acc">복습 세션 →</b>
        </button>
      )}
      {stripGroups.map((g) => (
        <Fragment key={g.key}>{g.node}</Fragment>
      ))}
      {/* A-10 — 마지막 한 줄이 **오늘 몫의 언어**로 닫는다(알림 A-1 과 같은 화법).
            ⚠ 시간이 없으면 수 대신 사정을 말한다 — 판정은 `shareLine` 이 소유한다. */}
      {shareText && <span className="text-anno">{shareText}</span>}
    </div>
  ) : null;
}
