/* ============================================================
   CoveragePanel — **N-6 카드 커버리지**(W8 · 2026-08-07). 51챕터의 구멍 지도.

   ## 왜 이 호스트인가

   덱은 **과목 단위**라 이 앱은 "Anki 340장 밀림"까지만 말하고 *어느 챕터에 카드가 아예 없는지*
   는 모른다. 그리고 카드가 없는 챕터는 due 에도 밀림에도 어느 경고에도 **안 나타난다** —
   가장 위험한 구멍이 가장 조용하다. 그 답을 만들려면 AnkiConnect 에 챕터마다 물어야 하고,
   그 연결을 쥔 화면이 여기다(조회는 **버튼을 눌렀을 때만** 돈다 — 렌더 경로에 IO 를 두지 않는다).

   ## ⚠ 전 칸이 0이면 지도를 안 그린다

   그건 "카드가 없다"가 아니라 **"셀 수 없다"** 다(카드 본문에 챕터 표기가 없는 경우). 둘을 같은
   픽셀로 그리면 앱이 없는 구멍을 만들어 보여 준다 — 판정은 `lib/cardCoverage` 의 `verdict` 다.
============================================================ */
import { useState } from 'react';
import { useApp } from '@/store/useApp';
import { ankiConnect } from '@/lib/anki';
import { coverage, scanCoverage, type Coverage } from '@/lib/cardCoverage';
import { Button, Pill } from '@/components/ui';

export default function CoveragePanel() {
  const items = useApp((s) => s.state.items);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [map, setMap] = useState<Record<string, number> | null>(null);

  const scan = async (): Promise<void> => {
    setBusy(true);
    setErr('');
    /* ⚠ `try/finally` 를 쓰지 않는다 — React Compiler 가 `finally` 절에서 바일아웃하고
       (`compiler-ratchet` 이 잡았다) 이 함수는 그 대가를 낼 이유가 없다. `catch` 가 값을
       돌려주게 하면 정리(`setBusy(false)`)가 한 자리에 남는다. */
    /* ⚠ 개수만 받는다 — `findCards` 는 카드 **id 배열**을 준다(내용이 아니다). 노트 본문을
       받아오면 이 패널이 Anki 의 사본을 들게 되고, 그 사본은 즉시 낡는다. */
    const counts = await scanCoverage(
      items,
      async (q) => (await ankiConnect<number[]>('findCards', { query: q })).length,
    ).catch((e: unknown) => {
      setErr(e instanceof Error ? e.message : String(e));
      return null;
    });
    if (counts) setMap(counts);
    setBusy(false);
  };

  const cov: Coverage | null = map ? coverage(items, map) : null;

  return (
    <div className="ds-rule">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="mb-0!">카드 커버리지</h3>
        <span className="ds-tiny text-mut">챕터마다 Anki 에 카드가 있는지 — 없는 칸은 어느 경고에도 안 뜹니다</span>
        <Button sm className="ml-auto" disabled={busy || !items.length} onClick={() => void scan()}>
          {busy ? '조회 중…' : '조회'}
        </Button>
      </div>

      {err && <p className="ds-tiny text-warn">Anki 에 물어보지 못했어요 — {err}</p>}

      {cov && cov.verdict === 'none' && (
        /* ⚠ 이 문장이 이 항목의 **존재 판정**이다(로드맵 N-6 의 가장 싼 검증). 표기가 없으면
           지도는 만들 수 없고, 그 사실을 숨기면 앱이 없는 구멍을 보여 준다. */
        <p className="ds-tiny mb-0 text-mut">
          어느 챕터 이름으로도 카드를 못 찾았어요 — 카드 본문·태그에 챕터 표기가 없으면 이 지도는 만들 수 없습니다.
        </p>
      )}

      {cov && cov.verdict !== 'none' && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Pill tiny tone={cov.gaps.length ? 'warn' : 'good'}>
              {cov.gaps.length ? `끝낸 챕터 중 카드 없음 ${cov.gaps.length}` : '끝낸 챕터엔 모두 카드가 있어요'}
            </Pill>
          </div>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {cov.rows.map((r) => (
              <li key={r.sid} className="flex items-center gap-2">
                <span className="w-28 shrink-0 truncate text-md">{r.name}</span>
                {/* 격자 — 칸 하나가 챕터 하나다. 색이 아니라 **채움**으로 말한다(과목색은 파생이라
                    여기서 정하지 않는다 · 절대규칙 #3). */}
                <span className="flex min-w-0 flex-1 flex-wrap gap-0.5">
                  {r.cells.map((c) => (
                    <i
                      key={c.chapter}
                      title={`${c.chapter} — 카드 ${c.cards}${c.done ? ' · 끝낸 챕터' : ''}`}
                      className={`size-2.5 rounded-xs ${c.cards > 0 ? 'bg-acc' : c.done ? 'bg-bad' : 'bg-track-cat'}`}
                    />
                  ))}
                </span>
                <span className="ds-tiny shrink-0 text-mut tabular-nums">
                  {r.withCards}/{r.total}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
