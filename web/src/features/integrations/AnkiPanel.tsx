/* ============================================================
   AnkiPanel — Anki 현황(볼트 _anki 파일 + AnkiConnect). Phase 5 · 서버/외부.
   카드 스캔/실시간 due는 Query 캐시(['ankiFile']/['ankiLive']) — persist X. 단, 실시간 due는
   ① 오늘 탭 KPI가 읽도록 state._ankiLive로 write-through ② 주별 due 스냅샷(retentionLog)은
   앱 데이터라 recordRetentionSnapshot으로 persist(설계도 §1-B).
============================================================ */
import LiveRegion from '@/components/LiveRegion';
import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient, skipToken } from '@tanstack/react-query';
import { useApp } from '@/store/useApp';
import { useRuntime } from '@/store/useRuntime';
import { useUI } from '@/store/useUI';
import { ui, io } from '@/shell';
import { pickAndScanAnki, fetchAnkiLive, totalDue, totalCards, type AnkiFile, type AnkiLive } from '@/lib/anki';
import { recordRetentionSnapshot } from '@/lib/methodology';
import { idbPut } from '@/lib/idb';
import { makeItem, clamp, jsq, hhmm } from '@/lib/utils';
import { Button } from '@/components/ui';
import { Icon } from '@/components/Icon';

export function AnkiPanel() {
  const qc = useQueryClient();
  const mutate = useApp((s) => s.mutate);
  const setAnkiLive = useRuntime((s) => s.set); // plan-무관 캐시 — state 참조를 갈지 않음(B1/B3)
  const items = useApp((s) => s.state.items);
  // 구독형으로 읽어 연결/해제 시 패널이 즉시 반응(skipToken = fetch 없이 캐시만 구독).
  const file = useQuery<AnkiFile>({ queryKey: ['ankiFile'], queryFn: skipToken }).data;
  const live = useQuery<AnkiLive>({ queryKey: ['ankiLive'], queryFn: skipToken }).data;
  const [busy, setBusy] = useState<'' | 'file' | 'live'>('');
  const [err, setErr] = useState('');
  // 실시간 due 자동 새로고침 — 연결돼 있을 때 5분마다 + 탭 복귀 시 재조회(로컬 설정).
  // 2단계-A4: 예전엔 여기서 localStorage를 **직접** 만졌다(유일한 kv SSOT 우회 · 백업 누락).
  // 이제 useUI가 소유하므로 lh_ui_v1에 담기고 _local 사이드카를 타고 이관·백업된다.
  const autoRefresh = useUI((s) => s.ui.ankiAutoRefresh);
  const setAutoRefresh = useUI((s) => s.setAnkiAutoRefresh);
  const [lastAuto, setLastAuto] = useState<string>('');

  // 개별 해제 — 각 연동을 독립적으로 끊는다(다른 채널엔 영향 없음).
  const clearFile = () => {
    qc.removeQueries({ queryKey: ['ankiFile'], exact: true });
    ui.toast('Anki 카드 스캔을 비웠어요.', 'info');
  };
  const clearLive = () => {
    qc.removeQueries({ queryKey: ['ankiLive'], exact: true });
    setAnkiLive('_ankiLive', null); // 오늘 탭 due KPI도 초기화
    ui.toast('실시간 due 연결을 해제했어요.', 'info');
  };

  const scanFiles = async () => {
    setErr('');
    setBusy('file');
    try {
      const handle = qc.getQueryData<FileSystemDirectoryHandle>(['vaultHandle']);
      const r = await pickAndScanAnki(handle);
      if (r) {
        qc.setQueryData(['ankiFile'], r.scan);
        // 셸엔 핸들 개념이 없다(폴더를 안 물으므로) — 브라우저에서만 공유·영속한다.
        if (r.handle) {
          qc.setQueryData(['vaultHandle'], r.handle);
          idbPut('vaultHandle', r.handle); // 볼트 패널과 공유 — 다음 부팅 재연결
        }
      }
    } catch (e) {
      setErr((e as Error).message || String(e));
    } finally {
      setBusy('');
    }
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
      } catch {
        /* AnkiConnect 순간 단절 — 다음 주기/포커스에 복구 */
      }
    };
    const id = setInterval(refresh, 5 * 60 * 1000);
    const onVis = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [autoRefresh, everConnected, applyLive]);

  const addAnki = (name: string, mins: number) => {
    const nm = 'Anki: ' + name;
    if (items.some((s) => s.name === nm)) {
      ui.toast('이미 추가됨', 'warn');
      return;
    }
    mutate((st) => {
      st.items.push(makeItem({ source: 'Anki', name: nm, mode: 'daily', dailyMin: mins }));
    });
    ui.toast(`"${nm}" 매일 ${mins}분 복습으로 추가됨`, 'ok');
  };

  const dueBudget = () => {
    if (!live || !live.decks.length) {
      ui.toast('먼저 "AnkiConnect 실시간 due"로 현황을 불러오세요.', 'warn');
      return;
    }
    const due = totalDue(live.decks);
    if (due <= 0) {
      ui.toast('오늘 풀 due가 0이에요 — 잡을 예산이 없어요.', 'info');
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
    ui.toast(
      ex
        ? `"${nm}" 복습예산을 ${mins}분으로 갱신(due ${due}장).`
        : `"${nm}" 매일 ${mins}분 복습예산으로 추가(due ${due}장 → 시간 역연동).`,
      'ok',
    );
  };

  // 파일 스캔 결과: 과목별 묶기
  const bySubj: Record<string, AnkiFile['decks']> = {};
  (file?.decks || []).forEach((d) => {
    (bySubj[d.subj] = bySubj[d.subj] || []).push(d);
  });
  const grandDecks = (file?.decks || []).length;
  const grandCards = totalCards(file?.decks ?? []);
  const dueTot = live ? totalDue(live.decks) : 0;

  return (
    <>
      <div className="ds-rule">
        <h2>Anki 현황</h2>
        <div className="ds-row">
          <Button sm disabled={busy === 'file'} onClick={scanFiles}>
            {busy === 'file' ? (
              <>
                <span className="ds-spin" /> 스캔 중
              </>
            ) : (
              <>
                <Icon name="folder" /> 볼트 카드 스캔
              </>
            )}
          </Button>
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
            onClick={() => io.exportAnkiCards('all')}
            title="전체 3문장 요약·오답을 Anki import용 .txt 카드 초안으로"
          >
            <Icon name="cards" /> 요약·오답 → 카드(.txt)
          </Button>
          <div style={{ flex: 2 }} />
        </div>
        <div className="ds-foot">
          카드 스캔: 정본 _meta/cache/_index.json의 덱 목록(검사.sh --index 생성)을 읽음. 없으면 anki/*.txt 폴더 폴백.
          실시간: Anki 실행 + AnkiConnect 애드온 필요(localhost:8765). <b>카드 생성</b>: 그동안 적은 3문장 요약·반복
          오답을 import용 초안(.txt)으로 — Anki에서 추리고 손질(큐레이션).
        </div>
        {/* ⚠ 리전은 **상시 마운트**한다(H19) — 조건부로 넣으면 리전과 텍스트가 동시에 삽입돼 AT 에 따라 공지가 씹힌다. */}
        <LiveRegion message={err ?? ''} assertive />
        {err && (
          <div className="ds-warnbox" style={{ marginTop: 8 }}>
            {err}
          </div>
        )}
        {file && (
          <div className="ds-tiny text-mut" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>
              <Icon name="folder" /> 카드 스캔: {file.at}
              {file.src ? ' · ' + file.src : ''}
            </span>
            <Button sm variant="ghost" danger onClick={clearFile} title="카드 스캔 결과 비우기">
              ✕ 해제
            </Button>
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
            {autoRefresh && lastAuto && <span>↻ {lastAuto} 갱신</span>}
            <Button sm variant="ghost" danger onClick={clearLive} title="실시간 due 연결 해제">
              ✕ 해제
            </Button>
          </div>
        )}
      </div>

      {file && (
        <div className="ds-rule">
          <h3>볼트 카드(파일 기준)</h3>
          <table>
            <thead>
              <tr>
                <th scope="col">과목</th>
                <th scope="col">덱</th>
                <th scope="col">카드</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {Object.entries(bySubj).map(([s, dks]) =>
                dks.map((d, i) => (
                  <tr key={d.file}>
                    {i === 0 && (
                      <th rowSpan={dks.length} scope="rowgroup">
                        <b>{s}</b>
                        <br />
                        <span className="ds-tiny text-mut">{totalCards(dks)}장</span>
                      </th>
                    )}
                    <th className="ds-tiny" scope="row">
                      {d.file}
                    </th>
                    <td>{d.cards}</td>
                    <td>
                      <Button
                        sm
                        variant="ghost"
                        onClick={() => addAnki(jsq(d.file), Math.max(15, Math.round(d.cards * 0.5)))}
                      >
                        +스케줄
                      </Button>
                    </td>
                  </tr>
                )),
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>
                  <b>합계</b> · {grandDecks}덱
                </td>
                <td>
                  <b>{grandCards}</b>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
          <div className="ds-foot">
            '+스케줄'은 해당 덱을 '매일 복습' 항목으로 추가합니다(예상 분 = 카드수×0.5, 수정 가능).
          </div>
        </div>
      )}

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
                        onClick={() => addAnki(`${jsq(d.name)} (due)`, Math.max(10, Math.round(due * 0.5)))}
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
