/* ============================================================
   AnkiPanel — Anki 현황(볼트 _anki 파일 + AnkiConnect). Phase 5 · 서버/외부.
   카드 스캔/실시간 due는 Query 캐시(['ankiFile']/['ankiLive']) — persist X. 단, 실시간 due는
   ① 오늘 탭 KPI가 읽도록 state._ankiLive로 write-through ② 주별 due 스냅샷(retentionLog)은
   앱 데이터라 recordRetentionSnapshot으로 persist(설계도 §1-B).
============================================================ */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/store/useApp';
import { ui, legacyFns } from '@/shell';
import { pickAndScanAnki, fetchAnkiLive, totalDue, type AnkiFile, type AnkiLive } from '@/lib/anki';
import { recordRetentionSnapshot } from '@/lib/methodology';
import { PALETTE, rid, clamp, jsq } from '@/lib/utils';
import { Button } from '@/components/ui';
import ds from '@/styles/ds.module.css';

export function AnkiPanel() {
  const qc = useQueryClient();
  const mutate = useApp((s) => s.mutate);
  const setRuntimeCache = useApp((s) => s.setRuntimeCache);
  const items = useApp((s) => s.state.items);
  const file = qc.getQueryData<AnkiFile>(['ankiFile']);
  const live = qc.getQueryData<AnkiLive>(['ankiLive']);
  const [busy, setBusy] = useState<'' | 'file' | 'live'>('');
  const [err, setErr] = useState('');

  const scanFiles = async () => {
    setErr('');
    setBusy('file');
    try {
      const handle = qc.getQueryData<FileSystemDirectoryHandle>(['vaultHandle']);
      const r = await pickAndScanAnki(handle);
      if (r) {
        qc.setQueryData(['ankiFile'], r.scan);
        qc.setQueryData(['vaultHandle'], r.handle);
      }
    } catch (e) {
      setErr((e as Error).message || String(e));
    } finally {
      setBusy('');
    }
  };

  const goLive = async () => {
    setErr('');
    setBusy('live');
    try {
      const l = await fetchAnkiLive();
      qc.setQueryData(['ankiLive'], l);
      setRuntimeCache('_ankiLive', l); // 오늘 탭 Anki due KPI가 소비
      mutate((st) => recordRetentionSnapshot(st, l.decks)); // 주별 due 스냅샷(유지율 추세) — persist
    } catch (e) {
      setErr(
        'AnkiConnect 연결 실패. Anki가 실행 중이고 AnkiConnect 애드온이 설치됐는지, 설정 webCorsOriginList에 "*" 또는 "null"이 있는지 확인하세요. ' +
          ((e as Error).message || ''),
      );
    } finally {
      setBusy('');
    }
  };

  const addAnki = (name: string, mins: number) => {
    const nm = 'Anki: ' + name;
    if (items.some((s) => s.name === nm)) {
      ui.toast('이미 추가됨', 'warn');
      return;
    }
    mutate((st) => {
      st.items.push({
        id: rid(),
        source: 'Anki',
        name: nm,
        color: PALETTE[st.items.length % PALETTE.length],
        mode: 'daily',
        dailyMin: mins,
        weeklyHours: 3,
        deadline: '',
        chapters: [],
      });
    });
    ui.toast(`"${nm}" 매일 ${mins}분 복습으로 추가됨`, 'ok');
  };

  const dueBudget = () => {
    if (!live || !live.decks.length) {
      ui.toast('먼저 "🔌 AnkiConnect 실시간 due"로 현황을 불러오세요.', 'warn');
      return;
    }
    const due = totalDue(live.decks);
    if (due <= 0) {
      ui.toast('오늘 풀 due가 0이에요 — 잡을 예산이 없어요. 👍', 'info');
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
        st.items.push({
          id: rid(),
          source: 'Anki',
          name: nm,
          color: PALETTE[st.items.length % PALETTE.length],
          mode: 'daily',
          dailyMin: mins,
          weeklyHours: 3,
          deadline: '',
          chapters: [],
        });
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
  const dueTot = live ? totalDue(live.decks) : 0;

  return (
    <>
      <div className={ds.card}>
        <h2>Anki 현황</h2>
        <div className={ds.row}>
          <Button sm disabled={busy === 'file'} onClick={scanFiles}>
            {busy === 'file' ? (
              <>
                <span className={ds.spin} /> 스캔 중
              </>
            ) : (
              '📁 볼트 카드 스캔'
            )}
          </Button>
          <Button sm disabled={busy === 'live'} onClick={goLive}>
            {busy === 'live' ? (
              <>
                <span className={ds.spin} /> 연결 중
              </>
            ) : (
              '🔌 AnkiConnect 실시간 due'
            )}
          </Button>
          <Button
            sm
            variant="ghost"
            onClick={() => legacyFns.exportAnkiCards('all')}
            title="전체 3문장 요약·오답을 Anki import용 .txt 카드 초안으로"
          >
            🃏 요약·오답 → 카드(.txt)
          </Button>
          <div style={{ flex: 2 }} />
        </div>
        <div className={ds.foot}>
          카드 스캔: 정본 _meta/감사/_index.json의 덱 목록(검사.sh --index 생성)을 읽음. 없으면 anki/*.txt 폴더 폴백.
          실시간: Anki 실행 + AnkiConnect 애드온 필요(localhost:8765). <b>카드 생성</b>: 그동안 적은 3문장 요약·반복
          오답을 import용 초안(.txt)으로 — Anki에서 추리고 손질(큐레이션).
        </div>
        {err && (
          <div className={ds.warnbox} style={{ marginTop: 8 }}>
            {err}
          </div>
        )}
        {file && (
          <div className={`${ds.muted} ${ds.tiny}`} style={{ marginTop: 6 }}>
            카드 스캔: {file.at}
            {file.src ? ' · ' + file.src : ''}
          </div>
        )}
        {live && (
          <div className={`${ds.muted} ${ds.tiny}`} style={{ marginTop: 6 }}>
            실시간: {live.at}
          </div>
        )}
      </div>

      {file && (
        <div className={ds.card}>
          <h3>볼트 카드(파일 기준)</h3>
          <table>
            <thead>
              <tr>
                <th>과목</th>
                <th>덱</th>
                <th>카드</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {Object.entries(bySubj).map(([s, dks]) =>
                dks.map((d, i) => (
                  <tr key={d.file}>
                    {i === 0 && (
                      <td rowSpan={dks.length}>
                        <b>{s}</b>
                        <br />
                        <span className={`${ds.tiny} ${ds.muted}`}>{dks.reduce((t, x) => t + x.cards, 0)}장</span>
                      </td>
                    )}
                    <td className={ds.tiny}>{d.file}</td>
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
          </table>
          <div className={ds.foot}>
            '+스케줄'은 해당 덱을 '매일 복습' 항목으로 추가합니다(예상 분 = 카드수×0.5, 수정 가능).
          </div>
        </div>
      )}

      {live && (
        <div className={ds.card}>
          <h3>실시간 due (AnkiConnect)</h3>
          <div className={ds.row} style={{ marginBottom: 6, alignItems: 'center' }}>
            <Button
              sm
              onClick={dueBudget}
              title={`오늘 풀 due 합계(${dueTot}장)를 '매일 복습' 분 예산으로 — FSRS due를 시간으로 역연동`}
            >
              📥 오늘 due 합계 → 복습 시간예산
            </Button>
            <span className={`${ds.muted} ${ds.tiny}`}>
              오늘 풀 due 합 <b>{dueTot}</b>장
            </span>
          </div>
          <table>
            <thead>
              <tr>
                <th>덱</th>
                <th>신규</th>
                <th>학습</th>
                <th>복습</th>
                <th>오늘 합</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {live.decks.map((d) => {
                const due = d.new + d.learn + d.review;
                return (
                  <tr key={d.name}>
                    <td>{d.name}</td>
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
          <div className={ds.foot}>
            '+스케줄'은 덱별로 항목을 추가하고, '복습 시간예산'은 <b>전체 due 합</b>을 하나의 매일 복습 항목으로
            잡아요(스케줄 용량에 반영). 시점(due)은 FSRS가 소유.
          </div>
        </div>
      )}
    </>
  );
}
