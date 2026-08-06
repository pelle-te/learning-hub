/* ============================================================
   RetrievalSlot — 오늘 레일의 **인출 카드 한 장**(F5 추출 · 2026-08-06).

   ## 왜 갈라 나왔나 — 오라클은 줄 수가 아니라 **부모가 들고 있던 방어**다

   `SummaryEditor` 추출(F5 선례)이 세운 기준 그대로다: 부모에 남아 있던 *파생 상태 방어*를
   `key` 리마운트가 **구조로** 대체할 수 있으면 그 블록은 자기 컴포넌트다. 여기 그 방어가
   정확히 그 형태로 있었다 — `TodaySignature` 가

     ① `recallShown`(정답 공개 여부) ② `recallKeyShown`(마지막으로 본 카드 키)
     ③ **렌더 중 조건부 setState**(카드가 바뀌면 ①을 false 로 되돌리는 블록)

   셋을 들고 있었고, ②·③은 오로지 ①을 리셋하려고 존재했다. 부모가 `key={recallKey}` 를 주면
   그 셋이 **하나로 줄고**(①만 · 이 파일 안) 리셋은 리마운트가 공짜로 해 준다.

   ⚠ 이 파일은 **아무것도 고르지 않는다.** 어느 카드를 띄울지(`slot`)는 `lib/todaySlots` 의
   `pickRetrievalSlot` 이, 후보 자체는 `lib/retrieval` 이 정한다 — 판정=lib · 그리기=여기.
   ⚠ W20 판정(_"인출 슬롯은 **하나**다 · 착각이 회상을 이긴다"_)은 그 lib 이 소유한다. 여기서
     둘을 나란히 그릴 수 있게 만들지 말 것 — 같은 모양이 둘이면 그건 카드가 아니라 목록이다.
============================================================ */
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { CBMS_INFO } from '@/lib/methodology';
import type { ConfidentWrongCard, RetrievalCard } from '@/lib/retrieval';
import type { RetrievalSlot as RetrievalSlotKind } from '@/lib/todaySlots';

/* 부모(`TodaySignature`)의 `S` 맵에서 **이 블록만 쓰던 8줄**을 함께 데려왔다 — 남겨 두면
   스타일과 마크업이 두 파일로 갈려, 한쪽만 고치는 부류의 드리프트가 열린다. */
const S = {
  card: 'mt-2.5 flex-none rounded-base border border-line2 px-3.5 py-3 animate-[enter-fade_var(--dur-slow)_var(--ease)_both]',
  top: 'mb-1.5 flex items-baseline gap-2',
  tag: 'flex-none text-2xs font-extrabold tracking-skel uppercase',
  meta: 'truncate text-xs leading-text font-bold text-mut',
  q: 'text-recall-q leading-snug font-bold text-txt',
  btn: 'mt-2.5 w-full rounded-blk! border-0! bg-[var(--acc-soft)]! px-3! py-2! text-hint! font-extrabold! text-acc! shadow-[var(--shadow-inset-acc-glow)] hover:shadow-[var(--shadow-inset-acc-solid)]',
  answer:
    'mt-2 flex flex-col gap-1.25 text-hint leading-body text-mut animate-[enter-fade_var(--dur-slow)_var(--ease)_both]',
  reset: 'mt-0.5 self-start border-0! bg-transparent! p-0! text-xs! leading-auto font-bold! text-mut! underline',
  note: 'mt-1.5 text-sm leading-body text-mut',
};

export interface RetrievalSlotProps {
  /** 오늘 어느 카드를 띄우나 — `lib/todaySlots` 의 하루 회전 결과. */
  slot: RetrievalSlotKind;
  recall: RetrievalCard | null;
  confWrong: ConfidentWrongCard | null;
  /** 오늘 착각 후보 총수(1이면 안 적는다 — `외 0` 은 정보가 아니다). */
  confWrongN: number;
  /** 라우팅은 부모가 소유한다(이 파일은 어디로 가는지 모른다). */
  onGo: (to: string) => void;
}

/** 회상 카드 — 질문을 먼저 보이고, 답은 **누른 뒤에** 편다(그게 인출이다). */
function Recall({ card }: { card: RetrievalCard }) {
  const [shown, setShown] = useState(false);
  return (
    <div className={`${S.card} bg-[var(--panel-acc-faint)]`}>
      <div className={S.top}>
        <span className={`${S.tag} text-txt`}>
          <Icon name="brain" /> 회상
        </span>
        <span className={S.meta}>
          {card.ageDays}일 전 · {card.summary.name || '요약'}
        </span>
      </div>
      <div className={S.q}>{card.summary.s1 || '이 개념을 스스로 다시 설명할 수 있나요?'}</div>
      {shown ? (
        <div className={S.answer}>
          {card.summary.s2 && (
            <div>
              <b className="mr-1 font-bold text-txt">도구·어떻게</b> {card.summary.s2}
            </div>
          )}
          {card.summary.s3 && (
            <div>
              <b className="mr-1 font-bold text-txt">결과·의미</b> {card.summary.s3}
            </div>
          )}
          <button type="button" className={S.reset} onClick={() => setShown(false)}>
            가리기
          </button>
        </div>
      ) : (
        <button type="button" className={S.btn} onClick={() => setShown(true)}>
          떠올렸다 · 정답 보기
        </button>
      )}
    </div>
  );
}

/** I-10 착각 재확인 — 확신했지만 틀렸던 개념을 지금 다시 인출(회상과 같은 언어·시각). */
function ConfWrong({ card, n, onGo }: { card: ConfidentWrongCard; n: number; onGo: (to: string) => void }) {
  return (
    <div className={`${S.card} bg-[var(--conf-wrong-bg)]`}>
      <div className={S.top}>
        <span className={`${S.tag} text-warn`}>
          <Icon name="alert" /> 착각 재확인
        </span>
        <span className={S.meta}>
          {card.ageDays}일 전 · {CBMS_INFO[card.cbms.code].label}
          {n > 1 ? ` · 외 ${n - 1}` : ''}
        </span>
      </div>
      <div className={S.q}>
        {card.cbms.name}
        {card.cbms.chapter ? ` · ${card.cbms.chapter}` : ''}
      </div>
      <div className={S.note}>확신했지만 틀렸던 것 — 지금 다시 인출</div>
      <button type="button" className={S.btn} onClick={() => onGo('/review-run')}>
        다시 확인 · 복습 세션 →
      </button>
    </div>
  );
}

/** 오늘의 인출 카드 **한 장**(없으면 아무것도 안 그린다 — 0은 그리지 않는 이 앱의 규율). */
export default function RetrievalSlot({ slot, recall, confWrong, confWrongN, onGo }: RetrievalSlotProps) {
  if (slot === 'recall' && recall) return <Recall card={recall} />;
  if (slot === 'conf' && confWrong) return <ConfWrong card={confWrong} n={confWrongN} onGo={onGo} />;
  return null;
}
