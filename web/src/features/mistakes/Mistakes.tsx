/* ============================================================
   Mistakes — 탭: ✗ 오답 노트 (ID-9 · fill 아카이브)

   ## 위치가 설계다 — 나브 탭이 아니라 **학습 기록 호스트의 세그먼트**

   '주간 리뷰'(review)는 *이번 주 처방*이고 여기는 *전 기간 아카이브*다. 시제가 달라서 한 화면에
   섞으면 주간 프레이밍이 흐려지고, 나브에 독립 탭으로 세우면 두 화면이 서로를 먹는다
   (I-14 가 같은 긴장에서 '독립탭 대신 강화'로 판정된 선례). 이웃 세그먼트가 그 관계를 화면으로
   말해 준다 — 기록(적기) → 주간 리뷰(처방) → 복습 실행(굴리기) → 오답 노트(아카이브).
   사용자 결정 2026-07-25.

   ## 세는 규칙은 `lib/mistakes` 가 소유한다

   백지 실패를 따로 합치지 않는 이유(중복 계상)는 그 파일 머리주석이 SSOT. 이 파일은 표시만 한다.

   레이어: store(useApp·usePageChrome)·lib 만 소비. app/다른 feature import 금지(boundaries).
============================================================ */
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { mistakeArchive, mistakeTotals, type MistakeRow } from '@/lib/mistakes';
import { CBMS_INFO, CBMS_CODES, addBacklog } from '@/lib/methodology';
import { openVaultSearch } from '@/lib/utils';
import { ui } from '@/shell';
import State from '@/components/State';
import { Button } from '@/components/ui';
import type { CbmsCode } from '@/lib/types';

const WRAP = 'flex h-full flex-col gap-3 p-6';
const FILTERS = 'flex flex-none flex-wrap items-center gap-2';
const CHIP =
  'cursor-pointer rounded-full border border-line px-3 py-1 text-xs text-mut hover:border-acc hover:text-txt';
const CHIP_ON = 'border-line-acc-hover bg-acc-glow text-acc';
const LIST = 'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto [scrollbar-width:thin]';
const ROW = 'flex flex-col gap-1.5 rounded-md border border-line bg-panel px-4 py-3';
const ROW_TOP = 'flex flex-wrap items-baseline gap-2';
const NAME = 'text-md font-bold text-txt';
const CH = 'text-sm text-mut';
const META = 'ml-auto flex flex-wrap items-center gap-2 text-xs text-mut tabular-nums';
const CODE_CHIP = 'rounded-full px-2 py-0.5 text-2xs font-bold';
const NOTE = 'truncate text-xs text-mut';
const ACTS = 'mt-0.5 flex flex-wrap gap-2';
const MINI = 'cursor-pointer rounded-sm border border-line px-2 py-1 text-xs text-mut hover:border-acc hover:text-txt';

/** 한 칸에 보여줄 최근 메모 수 — 아카이브는 목록이지 읽을거리가 아니다(펼침은 볼트가 한다). */
const NOTE_CAP = 2;

function CodeChip({ code, n }: { code: CbmsCode; n?: number }) {
  const info = CBMS_INFO[code];
  return (
    <span className={CODE_CHIP} style={{ background: 'var(--panel2)', color: info.color }} title={info.tip}>
      {info.label}
      {n != null && n > 1 ? ` ${n}` : ''}
    </span>
  );
}

function MistakeCard({ row, onDrill, onSeed }: { row: MistakeRow; onDrill: () => void; onSeed: () => void }) {
  return (
    <article className={ROW}>
      <div className={ROW_TOP}>
        <span className={NAME}>{row.subject}</span>
        {/* 챕터가 비어 있는 기록도 버리지 않는다 — 과목 단위로라도 "여기서 반복해 막힌다"는 사실이 남는다. */}
        <span className={CH}>{row.chapter || '(챕터 미기재)'}</span>
        <span className={META}>
          {row.codes.map((c) => (
            <CodeChip key={c} code={c} />
          ))}
          <span title="이 칸의 오답 기록 수">{row.count}회</span>
          {/* 과신은 따로 짚는다 — '안다고 믿어 복습을 건너뛰는' 방향이라 단순 횟수와 무게가 다르다. */}
          {row.confident > 0 && <span className="font-bold text-warn">확신 오답 {row.confident}</span>}
          <span title="마지막으로 틀린 날">{row.lastDs}</span>
        </span>
      </div>
      {row.notes.slice(0, NOTE_CAP).map((n) => (
        <div key={n.ds + n.text} className={NOTE} title={n.text}>
          {n.ds} — {n.text}
        </div>
      ))}
      <div className={ACTS}>
        <button type="button" className={MINI} onClick={onDrill}>
          ↻ 다시 인출하기
        </button>
        <button type="button" className={MINI} onClick={onSeed}>
          📥 보충에 담기
        </button>
        <button type="button" className={MINI} onClick={() => openVaultSearch(row.chapter || row.subject)}>
          🔎 볼트
        </button>
      </div>
    </article>
  );
}

export default function Mistakes() {
  const state = useApp((s) => s.state);
  const mutate = useApp((s) => s.mutate);
  const nav = useNavigate();
  /* ⚠ 필터 초기값을 **URL 에서 받는다**(A11). 종전엔 순수 로컬 state 라 `/mistakes?sid=…` 로
     보내도 전체 목록에 떨어졌다 — ⌘K 오답 히트·챕터 서랍의 '오답 N건' 이 데려다줄 곳이
     없었다는 뜻이다(찾아주는 것과 데려다주는 것은 다르다 · `contentSearch` 머리주석의 같은 규율).
     ⚠ 초기값만 읽고 그 뒤로는 사용자 조작이 소유한다 — URL 을 계속 따라가면 칩을 눌러 필터를
       바꾼 순간 주소와 화면이 어긋나거나, 되돌아가기가 필터 조작을 되감는다. */
  const [params] = useSearchParams();
  const [sid, setSid] = useState(() => params.get('sid') ?? '');
  const [code, setCode] = useState<CbmsCode | ''>(() => (params.get('code') as CbmsCode | null) ?? '');

  const rows = mistakeArchive(state, { sid: sid || undefined, code: code || undefined });
  const totals = mistakeTotals(rows);
  // 필터 칩은 **전 기간에 실제로 기록이 있는 과목**만 — 안 틀린 과목까지 나열하면 필터가 소음이 된다.
  const subjects = [...new Map((state.cbms || []).map((e) => [e.sid, e.name || '?'])).entries()];

  usePageChromeEffect(
    () => ({
      /* N-15 `primary` — 이 탭의 질문은 "어디가 막혔나"이고, 그 답이 곧 막힌 칸 수다.
         ⚠ 0이면 안 그린다(위 예보와 같은 규율) — 막힌 데가 없다는 것은 화면이 비어 있는 것으로
         이미 말해진다. */
      primary: totals.spots > 0 ? { value: String(totals.spots), unit: '칸', label: '막힘' } : null,
      readouts: [
        { label: '오답 기록', value: totals.records },
        { label: '확신 오답', value: totals.confident, accent: totals.confident > 0 },
      ],
      action: { label: '복습 실행', onClick: () => nav('/review-run') },
    }),
    [totals.spots, totals.records, totals.confident],
  );

  // 아카이브가 통째로 비었는가(필터 때문에 빈 것과 구분한다 — 두 상태의 처방이 다르다).
  const empty = !(state.cbms || []).length;

  if (empty) {
    return (
      <section className={WRAP}>
        <State
          glyph="✗"
          title="아직 오답 기록이 없어요"
          desc={
            <>
              <b>학습 기록</b> 탭의 <b>오답(CBMS)</b> 에 막힌 지점을 적으면, 여기에 과목·챕터별로 쌓여{' '}
              <b>무엇이 반복해서 나를 막는가</b>가 보여요.
            </>
          }
          next={
            <Button sm variant="primary" onClick={() => nav('/journal')}>
              기록하러 가기 →
            </Button>
          }
        />
      </section>
    );
  }

  const seed = (row: MistakeRow) => {
    const topic = row.chapter || row.subject;
    mutate((st) => addBacklog(st, row.sid, row.subject, topic, `오답 ${row.count}회 · ${CBMS_INFO[row.topCode].tip}`));
    ui.toast(`📥 보충에 담았어요 — ${topic}`, 'ok', 4000);
  };

  return (
    <section className={WRAP} aria-label="오답 노트">
      <div className={FILTERS}>
        <button
          type="button"
          className={`${CHIP} ${sid ? '' : CHIP_ON}`}
          onClick={() => setSid('')}
          aria-pressed={!sid}
        >
          전체 과목
        </button>
        {subjects.map(([id, name]) => (
          <button
            key={id}
            type="button"
            className={`${CHIP} ${sid === id ? CHIP_ON : ''}`}
            onClick={() => setSid(sid === id ? '' : id)}
            aria-pressed={sid === id}
          >
            {name}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-line2" aria-hidden="true" />
        <button
          type="button"
          className={`${CHIP} ${code ? '' : CHIP_ON}`}
          onClick={() => setCode('')}
          aria-pressed={!code}
        >
          전체 유형
        </button>
        {CBMS_CODES.map((c) => (
          <button
            key={c}
            type="button"
            className={`${CHIP} ${code === c ? CHIP_ON : ''}`}
            onClick={() => setCode(code === c ? '' : c)}
            aria-pressed={code === c}
            title={CBMS_INFO[c].tip}
          >
            {CBMS_INFO[c].label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        /* 필터가 만든 빈 상태 — 위 '기록 없음'과 다른 사건이라 다른 문장을 준다(막다른 골목 금지). */
        <p className="ds-muted py-4 text-sm" role="status">
          이 조건에 맞는 오답이 없어요 — 필터를 풀어 보세요.
        </p>
      ) : (
        <div className={LIST}>
          {rows.map((r) => (
            <MistakeCard key={r.key} row={r} onDrill={() => nav('/review-run')} onSeed={() => seed(r)} />
          ))}
        </div>
      )}
    </section>
  );
}
