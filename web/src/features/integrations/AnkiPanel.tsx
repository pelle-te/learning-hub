/* ============================================================
   AnkiPanel — Anki 현황(AnkiConnect). Phase 5 · 서버/외부.
   실시간 due는 Query 캐시(['ankiLive']) — persist X. 단,
   ① 오늘 탭 KPI가 읽도록 state._ankiLive로 write-through ② 주별 due 스냅샷(retentionLog)은
   앱 데이터라 recordRetentionSnapshot으로 persist(설계도 §1-B).

   ⛔ **「볼트 카드 스캔」과 그 결과 표는 2026-09-01 에 은퇴했다**(C072) — 읽던 두 원천이 모두
      사라져 「0장」이라는 거짓만 냈다. 근거는 `lib/anki.ts` 머리주석.
============================================================ */
import LiveRegion from '@/components/LiveRegion';
import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient, skipToken } from '@tanstack/react-query';
import { useApp } from '@/store/useApp';
import { useRuntime } from '@/store/useRuntime';
import { useUI } from '@/store/useUI';
import { exportAnkiCards, importAnkiDeck, toast } from '@/shell';
import { fetchAnkiLive, totalDue, type AnkiLive } from '@/lib/anki';
import { recordRetentionSnapshot } from '@/lib/methodology';
import { onVisible } from '@/lib/visibility';
import { makeItem, clamp, jsq, hhmm } from '@/lib/utils';
import { Button } from '@/components/ui';
import { Icon } from '@/components/Icon';

export function AnkiPanel() {
  const qc = useQueryClient();
  const mutate = useApp((s) => s.mutate);
  const setAnkiLive = useRuntime((s) => s.set); // plan-무관 캐시 — state 참조를 갈지 않음(B1/B3)
  const items = useApp((s) => s.state.items);
  // 구독형으로 읽어 연결/해제 시 패널이 즉시 반응(skipToken = fetch 없이 캐시만 구독).
  const live = useQuery<AnkiLive>({ queryKey: ['ankiLive'], queryFn: skipToken }).data;
  const [busy, setBusy] = useState<'' | 'live'>('');
  const [err, setErr] = useState('');
  // 실시간 due 자동 새로고침 — 연결돼 있을 때 5분마다 + 탭 복귀 시 재조회(로컬 설정).
  // 2단계-A4: 예전엔 여기서 localStorage를 **직접** 만졌다(유일한 kv SSOT 우회 · 백업 누락).
  // 이제 useUI가 소유하므로 lh_ui_v1에 담기고 _local 사이드카를 타고 이관·백업된다.
  const autoRefresh = useUI((s) => s.ui.ankiAutoRefresh);
  const setAutoRefresh = useUI((s) => s.setAnkiAutoRefresh);
  const [lastAuto, setLastAuto] = useState<string>('');
  /* ⚠⚠ **자동 갱신 실패를 상태로 남긴다(H8 · 2026-08-01).** 아래 이펙트의 `catch` 가 비어 있고
     `lastAuto` 는 **성공했을 때만** 갱신되므로, Anki 를 끄면 화면은 마지막 성공 시각(`↻ 09:14
     갱신`)을 **하루 뒤까지** 계속 보여 준다 — 그건 "9시 14분에 갱신됐고 그 뒤로도 정상"이라는
     뜻으로 읽힌다. 실제로는 그 시점 이후 한 번도 못 받았다.
     조용한 것 자체는 옳다(5분마다 토스트는 소음이다). 틀린 것은 **아무 데도 안 남는다**는
     것이었다 — `useCollectTool.lastError` 가 같은 계열에서 이미 쓴 처방을 그대로 옮긴다. */
  const [autoErr, setAutoErr] = useState<string | null>(null);

  const clearLive = () => {
    qc.removeQueries({ queryKey: ['ankiLive'], exact: true });
    setAnkiLive('_ankiLive', null); // 오늘 탭 due KPI도 초기화
    toast('실시간 due 연결을 해제했어요.', 'info');
  };

  // 실시간 due 반영 — 쿼리 캐시 + 오늘 탭 KPI(_ankiLive) + 주별 유지율 스냅샷. 수동/자동 공용.
  const applyLive = useCallback(
    (l: AnkiLive) => {
      qc.setQueryData(['ankiLive'], l);
      setAnkiLive('_ankiLive', l); // 오늘 탭 Anki due KPI가 소비
      mutate((st) => recordRetentionSnapshot(st, l.decks)); // 주별 due 스냅샷(유지율 추세) — persist
    },
    [qc, setAnkiLive, mutate],
  );

  const goLive = async () => {
    setErr('');
    setBusy('live');
    try {
      applyLive(await fetchAnkiLive());
    } catch (e) {
      setErr(
        'AnkiConnect 연결 실패. Anki가 실행 중이고 AnkiConnect 애드온이 설치됐는지, 설정 webCorsOriginList에 "*" 또는 "null"이 있는지 확인하세요. ' +
          ((e as Error).message || ''),
      );
    } finally {
      setBusy('');
    }
  };

  const toggleAuto = () => setAutoRefresh(!autoRefresh);

  /* 자동 새로고침 — **한 번이라도 연결한 적이 있고** 켜졌을 때. 5분 주기 + 탭 복귀 시 즉시.
     실패는 조용히(다음 주기/포커스에 복구).

     ⚠⚠ **게이트가 `!!live` 였던 동안 이 이펙트는 재시작 뒤 한 번도 안 돌았다.** `live` 는
     `skipToken` 구독이라(위 `useQuery`) 부팅 직후엔 언제나 undefined 이고, 그 값을 채우는
     유일한 경로가 수동 '실시간 연결' 버튼이다 — 즉 "자동"이 매 세션 수동 1회를 요구했다.
     그런데 `_ankiLive` 는 `runtime` 테이블에 살아남아 오늘 탭이 그 옛 숫자를 계속 그렸다
     (갱신은 멈췄는데 표시는 멈추지 않는 조합 — 조용하고 그럴듯한 오류).
     → 판정 기준을 "지금 캐시에 값이 있나"에서 **"이 기기가 Anki 를 연결한 적 있나"** 로.
       영속된 `_ankiLive` 가 정확히 그 증거다. */
  const cachedLive = useRuntime((s) => s.cache._ankiLive);
  const everConnected = !!live || !!cachedLive;
  useEffect(() => {
    if (!autoRefresh || !everConnected) return;
    let alive = true;
    const refresh = async () => {
      try {
        const l = await fetchAnkiLive();
        if (!alive) return;
        applyLive(l);
        const now = new Date();
        setLastAuto(hhmm(now));
        setAutoErr(null); // 성공이 사유를 지운다 — 낡은 경고가 남으면 그게 다음 오진이다
      } catch (e) {
        /* AnkiConnect 순간 단절 — 다음 주기/포커스에 복구된다. 토스트는 안 띄우되(소음)
         **표시가 거짓말을 하지 않도록** 사유를 남긴다(H8). */
        if (alive) setAutoErr(String((e as Error)?.message || e).slice(0, 120) || '연결 실패');
      }
    };
    /* ⚠ `void refresh` 는 **함수를 즉시 버리는** 표현식이라 `undefined` 를 넘긴다(C051 자동
       삽입이 여기서 틀렸다 · 타입이 그것을 잡았다). 감싸는 것이 맞다 — 콜백은 «호출될 때»
       거부를 버려야지 «등록될 때»가 아니다. */
    const id = setInterval(() => void refresh(), 5 * 60 * 1000);
    const off = onVisible(() => void refresh());
    return () => {
      alive = false;
      clearInterval(id);
      off();
    };
  }, [autoRefresh, everConnected, applyLive]);

  /* Anki 임포트 규칙은 `shell/importAnkiDeck` 가 소유한다 — 다른 입구와 **같은 함수**여야
     한다(종전엔 11줄 사본 둘이었다 · C037 · 바로 위 볼트 쪽이 H22 에서 같은 처방을 받았다). */

  const dueBudget = () => {
    if (!live || !live.decks.length) {
      toast('먼저 "AnkiConnect 실시간 due"로 현황을 불러오세요.', 'warn');
      return;
    }
    const due = totalDue(live.decks);
    if (due <= 0) {
      toast('오늘 풀 due가 0이에요 — 잡을 예산이 없어요.', 'info');
      return;
    }
    const mins = clamp(Math.round(due * 0.5), 10, 180);
    const nm = 'Anki: 오늘 due 복습';
    const ex = items.find((s) => s.name === nm);
    mutate((st) => {
      const cur = st.items.find((s) => s.name === nm);
      if (cur) {
        cur.mode = 'daily';
        cur.dailyMin = mins;
        cur.source = 'Anki';
      } else {
        st.items.push(makeItem({ source: 'Anki', name: nm, mode: 'daily', dailyMin: mins }));
      }
    });
    toast(
      ex
        ? `"${nm}" 복습예산을 ${mins}분으로 갱신(due ${due}장).`
        : `"${nm}" 매일 ${mins}분 복습예산으로 추가(due ${due}장 → 시간 역연동).`,
      'ok',
    );
  };

  const dueTot = live ? totalDue(live.decks) : 0;

  return (
    <>
      <div className="ds-rule">
        <h2>Anki 현황</h2>
        <div className="ds-row">
          <Button sm disabled={busy === 'live'} onClick={goLive}>
            {busy === 'live' ? (
              <>
                <span className="ds-spin" /> 연결 중
              </>
            ) : (
              <>
                <Icon name="plug" /> AnkiConnect 실시간 due
              </>
            )}
          </Button>
          <Button
            sm
            variant="ghost"
            onClick={() => exportAnkiCards('all')}
            title="전체 3문장 요약·오답을 Anki import용 .txt 카드 초안으로"
          >
            <Icon name="cards" /> 요약·오답 → 카드(.txt)
          </Button>
          <div style={{ flex: 2 }} />
        </div>
        {/* ⚠ 종전 이 각주는 「볼트 카드 스캔·**카드 생성**이 은퇴했다」고 적었는데, 바로 위
            「요약·오답 → 카드(.txt)」 버튼은 **앱 자신의 요약·오답**에서 카드를 만들어 지금도
            동작한다(부모의 `exports/` 와 무관하다). 은퇴한 것은 **볼트 파일을 세던 입구**뿐이다. */}
        <div className="ds-foot">
          <b>볼트 카드 스캔은 2026-09-01 에 은퇴했습니다</b> — 부모(pipeline)가 Anki 축을 닫으면서 그 스캔이 읽던 덱
          매니페스트와 카드 파일이 모두 사라졌습니다(복구: 부모 태그 <code>은퇴/anki-2026-09-01</code>). 지금{' '}
          <b>카드가 몇 장인지 아는 곳은 Anki 앱 자신</b>뿐이니 위 <b>AnkiConnect 실시간 due</b> 를 쓰세요(Anki 실행 +
          애드온 필요 · localhost:8765).
          <b>요약·오답 → 카드(.txt)</b> 는 앱 안의 기록에서 만들므로 그대로 씁니다.
        </div>
        {/* ⚠ 리전은 **상시 마운트**한다(H19) — 조건부로 넣으면 리전과 텍스트가 동시에 삽입돼 AT 에 따라 공지가 씹힌다. */}
        <LiveRegion message={err ?? ''} assertive />
        {err && (
          <div className="ds-warnbox" style={{ marginTop: 8 }}>
            {err}
          </div>
        )}
        {live && (
          <div
            className="ds-tiny text-mut"
            style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
          >
            <span>
              <Icon name="plug" /> 실시간 연결됨: {live.at}
            </span>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
              <input type="checkbox" checked={autoRefresh} onChange={toggleAuto} /> 자동 새로고침(5분)
            </label>
            {/* ⚠ 실패했으면 **마지막 성공 시각을 그대로 두지 않는다**(H8) — 그 표시는 "그 뒤로도
                정상"으로 읽힌다. 시각은 남기되 *멈췄다는 사실*을 같은 자리에 붙인다. */}
            {autoRefresh &&
              lastAuto &&
              (autoErr ? (
                <span className="text-warn" title={autoErr}>
                  ↻ {lastAuto} 이후 갱신 실패 — Anki 가 꺼져 있을 수 있어요
                </span>
              ) : (
                <span>↻ {lastAuto} 갱신</span>
              ))}
            {/* 한 번도 성공하지 못한 채 실패한 경우 — 시각조차 없으므로 사실만 말한다. */}
            {autoRefresh && !lastAuto && autoErr && (
              <span className="text-warn" title={autoErr}>
                ↻ 자동 갱신 실패
              </span>
            )}
            <Button sm variant="ghost" danger onClick={clearLive} title="실시간 due 연결 해제">
              ✕ 해제
            </Button>
          </div>
        )}
      </div>

      {live && (
        <div className="ds-rule">
          <h3>실시간 due (AnkiConnect)</h3>
          <div className="ds-row" style={{ marginBottom: 6, alignItems: 'center' }}>
            <Button
              sm
              onClick={dueBudget}
              title={`오늘 풀 due 합계(${dueTot}장)를 '매일 복습' 분 예산으로 — FSRS due를 시간으로 역연동`}
            >
              <Icon name="inbox" /> 오늘 due 합계 → 복습 시간예산
            </Button>
            <span className="ds-tiny text-mut">
              오늘 풀 due 합 <b>{dueTot}</b>장
            </span>
          </div>
          <table>
            <thead>
              <tr>
                <th scope="col">덱</th>
                <th scope="col">신규</th>
                <th scope="col">학습</th>
                <th scope="col">복습</th>
                <th scope="col">오늘 합</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {live.decks.map((d) => {
                const due = d.new + d.learn + d.review;
                return (
                  <tr key={d.name}>
                    <th scope="row">{d.name}</th>
                    <td>{d.new}</td>
                    <td>{d.learn}</td>
                    <td>{d.review}</td>
                    <td>
                      <b>{due}</b>
                    </td>
                    <td>
                      <Button
                        sm
                        variant="ghost"
                        onClick={() => importAnkiDeck(`${jsq(d.name)} (due)`, Math.max(10, Math.round(due * 0.5)))}
                      >
                        +스케줄
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="ds-foot">
            '+스케줄'은 덱별로 항목을 추가하고, '복습 시간예산'은 <b>전체 due 합</b>을 하나의 매일 복습 항목으로
            잡아요(스케줄 용량에 반영). 시점(due)은 FSRS가 소유.
          </div>
        </div>
      )}
    </>
  );
}
