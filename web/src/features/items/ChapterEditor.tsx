/* ChapterEditor — 과목의 챕터 표(추가·삭제·수정·드래그 정렬·일괄 붙여넣기).
   스타일: 공유 디자인 시스템은 styles/ds.css(`ds-*` 전역), 요소·토큰은 전역 base. */
import { useCallback, useState } from 'react';
import { rid, todayISO } from '@/lib/utils';
import { chapterSnapshot, riskWord } from '@/lib/chapterView';
import { useApp } from '@/store/useApp';
import { useSchedule } from '@/store/selectors';
import DetailDrawer from '@/components/DetailDrawer';
import { ui } from '@/shell';
import { Button, NumberField } from '@/components/ui';
import type { AppState, Item } from '@/lib/types';

type Mutate = (recipe: (st: AppState) => void) => void;

export function ChapterEditor({ item, mutate }: { item: Item; mutate: Mutate }) {
  const id = item.id;
  const chs = item.chapters || [];
  const totalH = chs.reduce((t, c) => t + (+c.hours || 0), 0);
  const [drag, setDrag] = useState<number | null>(null);
  const [bulk, setBulk] = useState('');
  const [peek, setPeek] = useState<string | null>(null);
  const state = useApp((s) => s.state);
  const res = useSchedule();
  const snap = peek ? chapterSnapshot(state, res.days || [], todayISO(state), id, peek) : null;

  /** 이 과목만 변형. */
  const upd = useCallback(
    (fn: (it: Item) => void) =>
      mutate((st) => {
        const it = st.items.find((x) => x.id === id);
        if (it) fn(it);
      }),
    [mutate, id],
  );

  const addCh = () => upd((it) => void it.chapters.push({ id: rid(), name: '새 챕터', hours: 2, done: false }));
  /** 완료 토글 — **끝낸 날을 함께 남긴다**(N-10). 스케줄러는 done 챕터의 블록을 더 이상 안 만들어
   *  계획이 재생성되는 순간 그 챕터의 날짜 링크가 사라지므로, 여기서 안 찍으면 "언제 끝냈나"를
   *  앱이 영영 모른다 → 유지 복습이 걸 사다리가 없다. 해제하면 지운다(거짓 앵커 방지). */
  const setDone = (i: number, on: boolean) =>
    mutate((st) => {
      const ch = st.items.find((x) => x.id === id)?.chapters[i];
      if (!ch) return;
      ch.done = on;
      if (on) ch.doneDs = todayISO(st);
      else delete ch.doneDs;
    });
  // 챕터 삭제 — 진행 기록도 함께 사라지므로 1단계 백업 + 되돌리기 토스트(과목 삭제·색 재배정과 동일 언두 관용).
  const delCh = (i: number) => {
    const nm = chs[i]?.name || '이 챕터';
    ui.backupNow();
    upd((it) => void it.chapters.splice(i, 1));
    ui.toastUndo(`"${nm}" 챕터 삭제됨`);
  };

  const drop = (to: number) => {
    const from = drag;
    setDrag(null);
    if (from == null || from === to) return;
    move(from, to);
  };

  const move = (from: number, to: number) => {
    upd((it) => {
      if (to < 0 || to >= it.chapters.length) return;
      const [m] = it.chapters.splice(from, 1);
      if (!m) return;
      it.chapters.splice(to, 0, m);
    });
  };

  const applyBulk = () => {
    const lines = bulk
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return;
    upd((it) => {
      for (const line of lines) {
        const [nm, h] = line.split('|').map((x) => x.trim());
        it.chapters.push({ id: rid(), name: nm ?? '', hours: h ? +h : 2, done: false });
      }
    });
    setBulk('');
  };

  return (
    <details open={chs.length === 0} className="ds-chapwrap">
      <summary>
        📖 챕터{' '}
        <span className="ds-muted" style={{ fontWeight: 400 }}>
          {chs.length ? `${chs.length}개 · 약 ${totalH}h` : '추가'}
        </span>
      </summary>
      <div className="ds-chapbody">
        {chs.length ? (
          <div className="ds-chaptbl">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 48 }}>#</th>
                  <th>챕터</th>
                  <th style={{ width: 96 }}>시간(h)</th>
                  <th style={{ width: 52 }}>완료</th>
                  <th style={{ width: 36 }}></th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {chs.map((c, i) => (
                  <tr
                    key={c.id}
                    draggable
                    onDragStart={() => setDrag(i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => drop(i)}
                    onKeyDown={(e) => {
                      // 키보드 재정렬(WCAG 2.1.1) — 행 안 어디에 포커스가 있든 Alt+↑↓(드래그 대안).
                      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                      e.preventDefault();
                      move(i, i + (e.key === 'ArrowDown' ? 1 : -1));
                    }}
                  >
                    <td className="ds-muted ds-tiny" style={{ whiteSpace: 'nowrap' }}>
                      <span className="ds-draghandle" title="드래그 또는 Alt+↑↓로 순서 변경">
                        ⠿
                      </span>{' '}
                      {i + 1}
                    </td>
                    <td>
                      <input
                        type="text"
                        value={c.name}
                        onChange={(e) => upd((it) => void (it.chapters[i]!.name = e.target.value))}
                        aria-label="챕터 이름"
                      />
                    </td>
                    <td>
                      {/* emptyValue 없음 — 예상시간을 비운 채 떠나면 0h가 아니라 직전 값이 남아야 한다
                          (0h 챕터는 스케줄러가 즉시 완료로 넘겨 계획에서 사라진다). */}
                      <NumberField
                        step={0.5}
                        min={0.5}
                        value={c.hours}
                        onCommit={(v) => upd((it) => void (it.chapters[i]!.hours = v))}
                        aria-label="예상시간(시간)"
                      />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={c.done}
                        onChange={(e) => setDone(i, e.target.checked)}
                        aria-label="완료"
                      />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {/* N-2 첫 조각 — 이 챕터의 현재 상태를 **그 자리에서** 편다. 지금까지
                          "노트 썼나·언제 복습" 을 알려면 4화면·6클릭이었다(객체가 목적지가 아니라
                          화면마다 흩어진 행이었다). 읽기 전용 v0 이라 액션은 아직 없다. */}
                      <Button
                        sm
                        variant="ghost"
                        onClick={() => setPeek(c.name)}
                        aria-label={`${c.name} 상태 보기`}
                        title="이 챕터의 상태"
                      >
                        ⓘ
                      </Button>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <Button sm variant="ghost" danger onClick={() => delCh(i)} aria-label="삭제" title="삭제">
                        ✕
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="ds-empty ds-tiny" style={{ padding: '14px 6px' }}>
            아직 챕터가 없어요. 아래에서 추가하거나 붙여넣기 하세요.
          </div>
        )}

        <div className="ds-row" style={{ marginTop: 8, gap: 6 }}>
          <Button sm variant="primary" onClick={addCh}>
            + 챕터 추가
          </Button>
          <span style={{ flex: 1 }} />
          <span className="ds-tiny ds-muted">↕ 드래그로 순서 변경</span>
        </div>

        <details className="ds-bulkwrap" style={{ marginTop: 10 }}>
          <summary className="ds-tiny">⊕ 여러 챕터 한 번에 붙여넣기</summary>
          <label htmlFor={`bulk-${id}`} style={{ marginTop: 6 }}>
            한 줄에 하나씩 · "이름 | 시간" 형식도 가능
          </label>
          <textarea
            id={`bulk-${id}`}
            rows={3}
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            placeholder={'2장 미분방정식 | 3\n3장 라플라스 변환 | 2'}
          />
          <Button sm style={{ marginTop: 6 }} onClick={applyBulk}>
            붙여넣기 적용
          </Button>
        </details>
      </div>

      {/* N-2 첫 조각 — 챕터 상태 서랍(읽기 전용). 볼트 산출물(mastery·ledger) 조인은 **일부러
          안 넣었다**: 조인 키가 basename 정확일치라 실패하면 절반이 빈칸인데, 빈 서랍은
          "데이터 없음"이 아니라 "이 도구가 나를 모른다"로 읽힌다(`lib/chapterView` 머리주석). */}
      <DetailDrawer
        open={!!snap}
        onClose={() => setPeek(null)}
        title={snap ? `${snap.subject} · ${snap.chapter}` : ''}
        placement="center"
      >
        {snap && (
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-md">
            <dt className="ds-muted">분량</dt>
            <dd className="m-0 font-bold">{snap.hours ? `${snap.hours}h` : '—'}</dd>
            <dt className="ds-muted">진행</dt>
            <dd className="m-0 font-bold">
              {snap.done ? `끝냄${snap.doneDs ? ` · ${snap.doneDs}` : ' · 날짜 기록 없음'}` : '진행 중'}
            </dd>
            <dt className="ds-muted">복습</dt>
            <dd className="m-0 font-bold">
              {riskWord(snap)}
              {snap.lastDs && (
                <span className="ds-muted ds-tiny">{` · 마지막 ${snap.lastDs} (${snap.daysSince}일 전)`}</span>
              )}
            </dd>
            <dt className="ds-muted">오답 기록</dt>
            <dd className="m-0 font-bold">{snap.cbms ? `${snap.cbms}건` : '없음'}</dd>
          </dl>
        )}
      </DetailDrawer>
    </details>
  );
}
