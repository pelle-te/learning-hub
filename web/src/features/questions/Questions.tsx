/* ============================================================
   Questions — 탭: **문항 원장**(T-7) + **시험 회수 창**(T-2)

   ## 위치가 설계다 — 인출 호스트의 세그먼트

   `review-run`(굴리기) → `forecast`(앞으로) → `mistakes`(틀린 사건) 옆이다. 이 넷은 전부
   *다시 꺼내는 일*이고, 여기는 그중 **꺼낼 대상 자체**를 쥔다. 오답 노트와 나란한 이유는
   서로를 먹지 않기 때문이다: `cbms` 는 틀린 **사건**(코드·메모), 여기는 다시 풀 수 있는
   **대상**. 시험 2주 전에 열리는 것은 후자다.

   ## 화면이 두 얼굴인 이유

   시험 직후에는 **회수 시트**가 위로 온다(T-2 · 직후 20분의 기억이 나중보다 정확하다는 전제).
   그 창이 닫히면 평범한 원장으로 돌아간다 — 창은 `lib/questions.recallWindows` 가 판정하고,
   여기서 기간을 다시 정하지 않는다.

   ## ⚠ 이 화면은 자기가 값을 내는지 스스로 말한다

   T-7 의 검증 조건이 _"2개 이상이 같은 챕터면 참"_ 이었다. `chapterHotspots` 가 그 판정을
   하고, **밀집이 없으면 화면이 그렇게 적는다** — 목록만 쌓이고 있는 상태를 "잘 되고 있다"로
   그리면 앱이 자기 기능을 과대평가한다(이 저장소가 `visits.ts` 에서 이미 물린 형태).

   레이어: store·lib·components 만. app/다른 feature import 금지(boundaries).
============================================================ */
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { addQuestion, chapterHotspots, questionsOf, recallWindows, removeQuestion } from '@/lib/questions';
import { EXAM_LABEL, examsOf } from '@/lib/semester';
import { rid, todayISO } from '@/lib/utils';
import { ui } from '@/shell';
import State from '@/components/State';
import { Button, Pill } from '@/components/ui';
import type { Question } from '@/lib/types';

const WRAP = 'flex h-full flex-col gap-3.5 p-6';
/* ⚠ `ds-well`(눌린 면)이다 — 옛 `rounded-md border bg-panel` 관용구는 원칙 ④가 폐기했고
   `check:tokens` 가 새 파일에서 그걸 막는다(오답 노트 등 기존 파일은 원장의 예외로만 남아 있다). */
const ROW = 'ds-well flex flex-col gap-1.5 px-4 py-3';
const LIST = 'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto [scrollbar-width:thin]';

/** 4칸 입력 — **한 문항 30초**가 이 항목의 전제라 칸이 넷을 넘지 않는다(정답·해설·태그 없음). */
function Capture({
  sid,
  chapters,
  fromRecall,
  onDone,
}: {
  sid: string;
  chapters: string[];
  fromRecall: boolean;
  onDone: () => void;
}) {
  const state = useApp((s) => s.state);
  const mutate = useApp((s) => s.mutate);
  const [prompt, setPrompt] = useState('');
  const [chapter, setChapter] = useState('');
  const [source, setSource] = useState('');
  const [why, setWhy] = useState('');

  const submit = (): void => {
    const q: Question = {
      id: rid(),
      ds: todayISO(state),
      sid,
      prompt: prompt.trim(),
      ...(chapter ? { chapter } : {}),
      ...(source.trim() ? { source: source.trim() } : {}),
      ...(why.trim() ? { why: why.trim() } : {}),
      ...(fromRecall ? { fromRecall: true } : {}),
    };
    let ok = false;
    mutate((st) => void (ok = addQuestion(st, q)));
    if (!ok) {
      ui.toast('문제 칸이 비어 있어요 — 나머지 셋은 비어도 됩니다.', 'warn');
      return;
    }
    /* 연속 입력이 이 시트의 목적이라 **칸만 비우고 화면을 안 닫는다**(회수 창은 여러 문항을
       한 번에 적는 자리다). 챕터는 유지 — 같은 챕터가 이어지는 것이 보통이다. */
    setPrompt('');
    setSource('');
    setWhy('');
    onDone();
  };

  return (
    <div className="ds-fieldgrid">
      <div className="ds-fld ds-wide">
        <label htmlFor={`q-prompt-${sid}`}>문제</label>
        <input
          id={`q-prompt-${sid}`}
          type="text"
          value={prompt}
          placeholder="무엇을 묻는 문제였나"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            // IME 조합 중 Enter 를 삼키지 않는다 — 한글 입력에서 첫 글자가 사라지는 그 함정.
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
          }}
        />
      </div>
      <div className="ds-fld">
        <label htmlFor={`q-ch-${sid}`}>챕터</label>
        <select id={`q-ch-${sid}`} value={chapter} onChange={(e) => setChapter(e.target.value)}>
          <option value="">(미기재)</option>
          {chapters.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="ds-fld">
        <label htmlFor={`q-src-${sid}`}>출처</label>
        <input
          id={`q-src-${sid}`}
          type="text"
          value={source}
          placeholder="교재 3-2 · 중간 5번"
          onChange={(e) => setSource(e.target.value)}
        />
      </div>
      <div className="ds-fld ds-wide">
        <label htmlFor={`q-why-${sid}`}>관건</label>
        <input
          id={`q-why-${sid}`}
          type="text"
          value={why}
          placeholder="무엇이 관건이었나 / 왜 틀렸나"
          onChange={(e) => setWhy(e.target.value)}
        />
      </div>
      <div className="ds-wide">
        <Button variant="primary" onClick={submit}>
          문항 넣기
        </Button>
      </div>
    </div>
  );
}

export default function Questions() {
  const state = useApp((s) => s.state);
  const mutate = useApp((s) => s.mutate);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const today = todayISO(state);
  const items = state.items;
  const urlSid = params.get('sid') || '';
  const sid = items.some((i) => i.id === urlSid) ? urlSid : (items[0]?.id ?? '');
  const item = items.find((i) => i.id === sid) ?? null;

  const windows = useMemo(() => recallWindows(state, today, (it) => examsOf(it)), [state, today]);
  const all = questionsOf(state);
  const mine = useMemo(
    () =>
      all
        .filter((q) => q.sid === sid)
        .slice()
        .reverse(),
    [all, sid],
  );
  const hotspots = useMemo(() => chapterHotspots(state, sid), [state, sid]);
  const win = windows.find((w) => w.item.id === sid) ?? windows[0] ?? null;

  usePageChromeEffect(
    () => ({
      primary: { label: '문항 원장', value: `${all.length}건` },
      readouts: [
        { label: '이 과목', value: mine.length },
        // 밀집이 이 원장의 값 판정이다 — 리드아웃이 그것을 1급으로 말한다.
        { label: '챕터 밀집', value: hotspots.length ? `${hotspots.length}곳` : '—' },
        ...(win ? [{ label: '회수 창', value: `${EXAM_LABEL[win.exam.kind]} 직후` }] : []),
      ],
    }),
    [all.length, mine.length, hotspots.length, win],
  );

  if (!items.length)
    return (
      <State
        kind="empty"
        glyph="notebook"
        title="과목이 아직 없어요"
        desc="문항은 과목에 붙습니다 — 과목을 먼저 만들면 여기서 문제를 모을 수 있어요."
        next={
          <Button variant="primary" onClick={() => navigate('/items')}>
            과목 만들기
          </Button>
        }
      />
    );

  const chapters = (item?.chapters || []).map((c) => c.name);

  return (
    <div className={WRAP}>
      <div className="flex flex-none flex-wrap items-center gap-2">
        <label htmlFor="q-sid" className="ds-caps">
          과목
        </label>
        <select
          id="q-sid"
          value={sid}
          onChange={(e) => setParams({ sid: e.target.value }, { replace: true })}
          className="max-w-60"
        >
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </div>

      {/* T-2 — 회수 창. 시험 직후에만 뜨고, 그 사실을 문장으로 말한다(왜 지금인가). */}
      {win && win.item.id === sid && (
        <div className="ds-rule">
          <div className="mb-2 flex items-baseline gap-2">
            <h3 className="ds-caps mb-0!">
              {EXAM_LABEL[win.exam.kind]}고사 회수 — {win.daysSince === 0 ? '오늘' : '어제'} 봤어요
            </h3>
            <Pill tiny tone={win.written ? 'good' : 'warn'}>
              {win.written ? `${win.written}건 적음` : '아직 0건'}
            </Pill>
          </div>
          <p className="ds-tiny mb-2.5 text-mut">
            기억이 가장 정확한 구간이에요. 떠오르는 문제를 <b>생각나는 대로</b> — 정답은 안 적어도 됩니다.
          </p>
          <Capture sid={sid} chapters={chapters} fromRecall onDone={() => {}} />
        </div>
      )}

      {/* T-7 — 평상시 원장. 회수 창이 떠 있으면 입력이 둘이 되므로 그때는 접는다. */}
      {!(win && win.item.id === sid) && (
        <div className="ds-rule">
          <h3 className="ds-caps mb-2!">문항 넣기</h3>
          <Capture sid={sid} chapters={chapters} fromRecall={false} onDone={() => {}} />
        </div>
      )}

      {hotspots.length > 0 ? (
        <div className="flex flex-none flex-wrap items-center gap-2">
          <span className="ds-caps">챕터 밀집</span>
          {hotspots.slice(0, 6).map((h) => (
            <Pill key={h.chapter} tiny tone="warn">
              {h.chapter} · {h.n}
            </Pill>
          ))}
        </div>
      ) : (
        /* ⚠ 밀집이 없다는 사실을 **말한다**. 이 원장이 시험 전에 열릴 이유는 밀집이고,
           없는데 있는 척하면 앱이 자기 기능을 과대평가한다. */
        <p className="ds-tiny flex-none text-mut">
          아직 같은 챕터에 두 건 이상 몰린 곳이 없어요 — 밀집이 생기면 여기에 뜹니다.
        </p>
      )}

      {mine.length === 0 ? (
        <State
          kind="empty"
          glyph="notebook"
          title="이 과목의 문항이 아직 없어요"
          desc="시험 직후·문제를 푼 직후가 가장 싸게 적히는 순간이에요."
          next={{ terminal: '위 칸에 바로 적으면 됩니다.' }}
        />
      ) : (
        <ul className={`m-0 list-none p-0 ${LIST}`}>
          {mine.map((q) => (
            <li key={q.id} className={ROW}>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-md font-bold">{q.prompt}</span>
                {q.chapter && <span className="text-sm text-mut">{q.chapter}</span>}
                <span className="ml-auto flex items-center gap-2 text-xs text-mut tabular-nums">
                  {q.fromRecall && (
                    <Pill tiny tone="good">
                      회수
                    </Pill>
                  )}
                  {q.source && <span>{q.source}</span>}
                  <span>{q.ds}</span>
                  <Button
                    sm
                    variant="ghost"
                    aria-label={`문항 "${q.prompt}" 지우기`}
                    onClick={() =>
                      ui.commitUndoable(`문항 "${q.prompt}" 삭제됨`, () => mutate((st) => removeQuestion(st, q.id)))
                    }
                  >
                    ✕
                  </Button>
                </span>
              </div>
              {q.why && <span className="truncate text-xs text-mut">{q.why}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
