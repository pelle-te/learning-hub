/* ============================================================
   LapseCard — **T-19 Anki 카드 → 챕터 접합**(lapses). 오답 노트의 한 칸.

   ## 왜 오답 노트인가

   이 화면은 이미 _"무엇이 반복해서 틀리나"_ 를 묻는다. 다만 그 답을 **앱 안의 CBMS 기록**에서만
   찾았다 — 그런데 같은 질문의 더 큰 표본이 **Anki 안**에 이미 있다(`prop:lapses`). 한 화면에서
   두 원천을 나란히 놓으면 "앱에는 안 적었지만 Anki 는 알고 있는 것"이 보인다.

   ## ⚠⚠ 세 상태를 다르게 말한다

   `ok`(붙었고 결과가 이렇다) · `no-tags`(태그가 안 걸려 **접합 자체가 안 됐다**) ·
   `unavailable`(Anki 가 안 떠 있다). 셋을 뭉뚱그려 "0건"으로 그리면 **접합 실패가 "잘하고
   있다"로 읽힌다** — 이 저장소가 반복해 물린 형태이고, `lib/ankiLapses` 가 그래서 판정을 셋으로
   가른다.

   ## ⚠ 자동으로 안 부른다

   Anki 조회는 왕복 셋이고 Anki 가 꺼져 있으면 타임아웃을 기다린다. 화면을 열 때마다 그 비용을
   내면 오답 노트가 느려진다 — 누를 때만 부른다(`ankiAutoRefresh` 설정이 due 조회에 대해 내린
   것과 같은 판단).
============================================================ */
import { useState } from 'react';
import { fetchLapses, LAPSE_MIN, type LapseResult } from '@/lib/ankiLapses';
import { Button, Pill } from '@/components/ui';

export default function LapseCard() {
  const [res, setRes] = useState<LapseResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = (): void => {
    setBusy(true);
    void fetchLapses()
      .then(setRes)
      .finally(() => setBusy(false));
  };

  return (
    <div className="ds-rule">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="ds-caps mb-0!">Anki 에서 반복해 무너지는 챕터</h3>
        <Button sm variant="ghost" className="ml-auto" onClick={run} disabled={busy}>
          {busy ? '읽는 중…' : res ? '다시 읽기' : '읽기'}
        </Button>
      </div>

      {!res && !busy && (
        <p className="ds-tiny text-mut">
          Anki 가 켜져 있으면 <b>{LAPSE_MIN}회 이상</b> 무너진 카드를 챕터로 접어 보여 줘요.
        </p>
      )}

      {res?.kind === 'unavailable' && <p className="ds-tiny text-mut">Anki 에 연결하지 못했어요 — {res.why}</p>}

      {/* ⚠ 이 상태를 "0건"으로 그리면 접합 실패가 "잘하고 있다"로 읽힌다(머리주석). */}
      {res?.kind === 'no-tags' && (
        <p className="ds-tiny text-warn">
          <b>{'요약::'}</b> 태그가 붙은 카드가 하나도 없어요 — 무너진 카드가 없는 게 아니라 <b>접합이 안 된</b>
          상태입니다(볼트에서 만든 카드를 import 했는지 확인해 주세요).
        </p>
      )}

      {res?.kind === 'ok' &&
        (res.rows.length === 0 ? (
          <p className="ds-tiny text-mut">{LAPSE_MIN}회 이상 무너진 카드가 없어요.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {res.rows.slice(0, 10).map((r) => (
              <li key={`${r.subject}|${r.chapter ?? ''}`} className="flex items-center gap-2 text-md">
                <span className="ds-tiny flex-none text-mut">{r.subject}</span>
                <span className="min-w-0 flex-1 truncate">{r.chapter ?? '(챕터 미기재)'}</span>
                <Pill tiny tone={r.lapses >= 5 ? 'bad' : 'warn'}>
                  {r.lapses}회
                </Pill>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
