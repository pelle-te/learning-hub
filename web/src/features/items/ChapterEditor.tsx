/* ChapterEditor — 과목의 챕터 표(추가·삭제·수정·드래그 정렬·일괄 붙여넣기).
   스타일: 공유 디자인 시스템은 ds.module(ds.*), 요소·토큰은 전역 base(Phase 9 전환). */
import { useCallback, useState } from 'react';
import { rid } from '@/lib/utils';
import { Button } from '@/components/ui';
import ds from '@/styles/ds.module.css';
import type { AppState, Item } from '@/lib/types';

type Mutate = (recipe: (st: AppState) => void) => void;

export function ChapterEditor({ item, mutate }: { item: Item; mutate: Mutate }) {
  const id = item.id;
  const chs = item.chapters || [];
  const totalH = chs.reduce((t, c) => t + (+c.hours || 0), 0);
  const [drag, setDrag] = useState<number | null>(null);
  const [bulk, setBulk] = useState('');

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
  const delCh = (i: number) => upd((it) => void it.chapters.splice(i, 1));

  const drop = (to: number) => {
    const from = drag;
    setDrag(null);
    if (from == null || from === to) return;
    upd((it) => {
      const [m] = it.chapters.splice(from, 1);
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
        it.chapters.push({ id: rid(), name: nm, hours: h ? +h : 2, done: false });
      }
    });
    setBulk('');
  };

  return (
    <details open={chs.length === 0} className={ds.chapwrap}>
      <summary>
        📖 챕터{' '}
        <span className={ds.muted} style={{ fontWeight: 400 }}>
          {chs.length ? `${chs.length}개 · 약 ${totalH}h` : '추가'}
        </span>
      </summary>
      <div className={ds.chapbody}>
        {chs.length ? (
          <div className={ds.chaptbl}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 48 }}>#</th>
                  <th>챕터</th>
                  <th style={{ width: 96 }}>시간(h)</th>
                  <th style={{ width: 52 }}>완료</th>
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
                  >
                    <td className={`${ds.muted} ${ds.tiny}`} style={{ whiteSpace: 'nowrap' }}>
                      <span className={ds.draghandle} title="드래그로 순서 변경">
                        ⠿
                      </span>{' '}
                      {i + 1}
                    </td>
                    <td>
                      <input
                        type="text"
                        value={c.name}
                        onChange={(e) => upd((it) => void (it.chapters[i].name = e.target.value))}
                        aria-label="챕터 이름"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step={0.5}
                        min={0.5}
                        value={c.hours}
                        onChange={(e) => upd((it) => void (it.chapters[i].hours = +e.target.value))}
                        aria-label="예상시간(시간)"
                      />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={c.done}
                        onChange={(e) => upd((it) => void (it.chapters[i].done = e.target.checked))}
                        aria-label="완료"
                      />
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
          <div className={`${ds.empty} ${ds.tiny}`} style={{ padding: '14px 6px' }}>
            아직 챕터가 없어요. 아래에서 추가하거나 붙여넣기 하세요.
          </div>
        )}

        <div className={ds.row} style={{ marginTop: 8, gap: 6 }}>
          <Button sm variant="primary" onClick={addCh}>
            + 챕터 추가
          </Button>
          <span style={{ flex: 1 }} />
          <span className={`${ds.tiny} ${ds.muted}`}>↕ 드래그로 순서 변경</span>
        </div>

        <details className={ds.bulkwrap} style={{ marginTop: 10 }}>
          <summary className={ds.tiny}>⊕ 여러 챕터 한 번에 붙여넣기</summary>
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
    </details>
  );
}
