/* ChapterEditor — 과목의 챕터 표(추가·삭제·수정·드래그 정렬·일괄 붙여넣기).
   스타일: 공유 디자인 시스템은 styles/ds.css(`ds-*` 전역), 요소·토큰은 전역 base. */
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { openVaultSearch, rid, todayISO } from '@/lib/utils';
import { chapterSnapshot, chapterVault, riskWord } from '@/lib/chapterView';
import { STAGE_META } from '@/lib/ledger';
import { useLedger } from '@/store/queries';
import { useApp } from '@/store/useApp';
import { useSchedule } from '@/store/selectors';
import { useFlushOnUnmount } from '@/hooks/interactions';
import { useListCursor } from '@/hooks/useListCursor';
import DetailDrawer from '@/components/DetailDrawer';
import { toastUndoable } from '@/shell';
import { Button, NumberField } from '@/components/ui';
import type { AppState, Chapter, Item } from '@/lib/types';
import { Icon } from '@/components/Icon';

type Mutate = (recipe: (st: AppState) => void) => void;

/**
 * 챕터 이름 — **커밋은 blur/Enter 에서만** 한다(H16 · 2026-07-31 `/감사 근본` → 2026-08-01 출하).
 *
 * 종전엔 `onChange` 가 곧장 `mutate` 라, 한 글자마다 `items` 슬라이스가 갈려 파생 전량이 다시
 * 돌았다(10배 규모 실측 12.3ms/글자 · 현 규모 1.52ms). `DayPlanner` 의 일정 제목(H8)이 같은
 * 형태였고 처방도 같다 — 이 저장소에서 텍스트 필드가 키 입력마다 `mutate` 하던 자리는 둘뿐이었다.
 *
 * ## ⚠ 감사가 이 항목을 미뤄 둔 사유는 **실측으로 성립하지 않았다**
 *
 * 로드맵은 _"편집 도중 다른 패널(`AvailRail`·배분 배지)이 같은 값을 실시간으로 읽는다"_ 를 이유로
 * 실렌더 확인을 선행으로 걸었는데, 그 미러들이 읽는 것은 **`hours`·`done`·챕터 개수**다 —
 * 챕터 *이름* 을 타이핑 중에 비추는 표면은 이 화면에도 옆 패널에도 **없다**(`AvailRail` 은
 * `chapters` 를 아예 안 읽고, `Subject` 리드아웃은 과목명과 챕터 **수**만 쓴다).
 * ⚠ 그래서 같은 처방을 **과목 이름**(`SubjectDefinition`)에는 쓰지 않는다 — 저건 상단 리드아웃과
 *   카드 헤더가 실시간으로 비추므로 초안으로 바꾸면 타이핑 중 낡은 이름이 보인다.
 *
 * ⚠ 커밋은 **id 로** 찾아 쓴다(인덱스가 아니라) — blur 와 커밋 사이에 정렬이 바뀌면 인덱스는
 *   다른 챕터를 가리킨다.
 * ⚠ 언마운트 안전망(SR-16) — g키 라우트 이동처럼 blur 없이 떠나는 경로에서 미커밋 초안이 사라지던
 *   부류를 이 저장소가 이미 한 번 물렸다.
 */
function ChapterNameField({
  value,
  onCommit,
  className,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  /* 외부에서 값이 바뀌면(볼트 재조인·되돌리기·클라우드 pull) 따라간다 — 단 **편집 중이 아닐 때만**.
     렌더 중 조건부 setState 는 React 권장 관용구다(효과가 아니다 · `ArticlePractice` 선례). */
  if (!editing && draft !== value) setDraft(value);

  const commit = (v: string) => {
    if (v !== value) onCommit(v);
  };
  useFlushOnUnmount(() => commit(draft));

  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setEditing(true)}
      onBlur={() => {
        setEditing(false);
        commit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(draft);
      }}
      aria-label="챕터 이름"
      className={className}
    />
  );
}

export function ChapterEditor({ item, mutate }: { item: Item; mutate: Mutate }) {
  const id = item.id;
  // ⚠ `useMemo` 로 감싼다 — 아래 커서 목록(Q-7)이 이걸 deps 로 쓰는데, `|| []` 는 매 렌더 새
  //   배열을 만들어 커서가 매번 재등록된다(린트가 그 사실을 정확히 짚었다).
  const chs = useMemo(() => item.chapters || [], [item.chapters]);
  const totalH = chs.reduce((t, c) => t + (+c.hours || 0), 0);
  const [drag, setDrag] = useState<number | null>(null);
  const [bulk, setBulk] = useState('');
  const [peek, setPeek] = useState<string | null>(null);
  const state = useApp((s) => s.state);
  const res = useSchedule();
  const snap = peek ? chapterSnapshot(state, res.days || [], todayISO(state), id, peek) : null;
  /* N-2 2단계 — 원장은 이미 다른 화면들이 쓰는 **같은 쿼리 캐시**다(추가 페치 0). 서랍이 안 열려
     있어도 훅은 최상위에서 부른다(조건부 훅 금지) — 캐시 히트라 비용이 없다. */
  const led = useLedger().data;
  const vault = snap ? chapterVault(led, snap.subject, snap.chapter) : null;

  /** 이 과목만 변형. */
  /* Q-7 — 챕터 표의 커서. 동사는 이 화면이 **실제로 구현한 것만** 준다(없는 키는 조용히 무시).
     `x` 완료 · `d` 삭제 · `v` 볼트 — `e`(편집)는 주지 않는다: 이름 칸이 이미 인라인 입력이라
     `e` 가 "포커스를 옮긴다"는 뜻이 되면 다른 화면의 `e`(상세 열기)와 뜻이 갈린다. */
  const cursorItems = useMemo(() => chs.map((c) => ({ key: c.id, item: c })), [chs]);

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
  /* 챕터 삭제 — 진행 기록도 함께 사라진다. ⚠ 종전엔 여기서 `ui.backupNow()` 로 `BACKUP_KEY`
     스냅샷을 덮었는데, 그 스냅샷의 소비처는 **가져오기·초기화의 되돌리기**다 → 챕터 하나를 지울
     때마다 *그쪽* 되돌림 지점이 여기로 끌려왔다. 지금은 전역 ⌘Z 가 행 단위로 덮는다(근본①). */
  const delCh = (i: number) => {
    const nm = chs[i]?.name || '이 챕터';
    upd((it) => void it.chapters.splice(i, 1));
    toastUndoable(`"${nm}" 챕터 삭제됨`);
  };

  /* ── A-12(W9 · 2026-08-07) — **일괄 완료·삭제는 한 번의 쓰기다** ────────────────────
     로드맵의 관측이 이 화면 것이다: _"챕터 7개 완료 = 25 키스트로크 · 토스트 7장 · ⌘Z 7회"_.
     키스트로크는 절반이 되고(`j m` 씩 찍고 `x` 한 번), **되돌림이 하나**가 되는 것이 요지다 —
     한 번의 결정이 일곱 개의 ⌘Z 로 쪼개지면 사용자는 그것을 되돌릴 수 없는 것으로 여긴다.
     ⚠ 개별 동사를 반복 호출하지 않는다(그러면 결함이 그대로다) — 아래는 **한 `mutate`** 다.
     ⚠ 완료의 뜻은 단일 판과 같아야 한다: `doneDs` 를 함께 찍고, 해제하면 지운다(N-10).
     ⚠ 섞여 있으면(일부만 완료) **전부 완료**로 민다 — 토글은 여럿에 대해 뜻이 없다. */
  const bulkDone = (list: Chapter[]) => {
    const ids = new Set(list.map((c) => c.id));
    const on = list.some((c) => !c.done); // 하나라도 안 끝났으면 전부 완료 · 전부 끝났으면 전부 해제
    mutate((st) => {
      const it = st.items.find((x) => x.id === id);
      if (!it) return;
      for (const ch of it.chapters) {
        if (!ids.has(ch.id)) continue;
        ch.done = on;
        if (on) ch.doneDs = todayISO(st);
        else delete ch.doneDs;
      }
    });
    toastUndoable(`챕터 ${list.length}개 ${on ? '완료' : '완료 해제'}`);
  };
  const bulkDel = (list: Chapter[]) => {
    const ids = new Set(list.map((c) => c.id));
    upd((it) => void (it.chapters = it.chapters.filter((c) => !ids.has(c.id))));
    toastUndoable(`챕터 ${list.length}개 삭제됨`);
  };

  const cursor = useListCursor<Chapter>({
    items: cursorItems,
    docTitle: '이 화면 · 챕터',
    verbs: {
      x: (c) => setDone(chs.indexOf(c), !c.done),
      d: (c) => delCh(chs.indexOf(c)),
      v: (c) => openVaultSearch(c.name),
    },
    bulk: { x: bulkDone, d: bulkDel },
  });

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
        <Icon name="book" /> 챕터{' '}
        <span className="text-mut" style={{ fontWeight: 400 }}>
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
                    /* Q-7 커서 — 행 하나가 탭 스톱 하나가 된다. 종전엔 **행당 5 탭스톱 × 51행**
                       이라 30번째 챕터에 닿는 데 Tab 약 150회였다(마우스는 1클릭). 어휘는
                       `useListCursor` 가 닫아 둔 7동사를 그대로 쓴다 — 여기서 새 키를 만들지
                       않는다(그러면 "이 화면에서 d 가 뭐였지"가 매번 생긴다).
                       ⚠ **Q-1 이 이 편집의 대부분을 이미 흡수했다** — 진도 커밋이 오늘 화면에서
                       챕터를 확정하므로, 이 표는 *정리·재정렬*용으로 남는다. 그래서 커서가
                       있으면 좋지만 없어도 치명적이지 않은 순서로 배치했다. */
                    ref={cursor.register(c.id)}
                    tabIndex={cursor.tabStop === c.id ? 0 : -1}
                    onFocusCapture={() => cursor.onItemFocus(c.id)}
                    /* W12 — **챕터가 자기 앵커를 얻는다.** ⌘K 의 챕터 히트가 `/subject/:id#ch-<cid>`
                       로 오면 이 행에 선다. 그전엔 "챕터 단위 앵커가 없으니 소속 과목까지가
                       정직한 최선"이라 코드가 자백해 뒀던 자리다. */
                    id={`ch-${c.id}`}
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
                    <td className="ds-tiny text-mut" style={{ whiteSpace: 'nowrap' }}>
                      <span className="ds-draghandle" title="드래그 또는 Alt+↑↓로 순서 변경">
                        ⠿
                      </span>{' '}
                      {/* A-12 — 표시된 행. **문자로** 말한다(색만으로 상태를 표현하지 않는다 · 대비 규율). */}
                      {cursor.marked.has(c.id) ? <span className="font-extrabold text-acc">✓ </span> : null}
                      {i + 1}
                    </td>
                    <td>
                      <ChapterNameField
                        value={c.name}
                        className={c.deferred ? 'ds-shed' : undefined}
                        onCommit={(v) =>
                          upd((it) => {
                            const ch = it.chapters.find((x) => x.id === c.id);
                            if (ch) ch.name = v;
                          })
                        }
                      />
                      {/* 이번 범위에서 빠진 챕터(P-9) — **되돌리기가 여기 산다.** 컷 카드는 부족분이
                          닫히면 사라지므로, 되돌릴 자리가 카드에만 있으면 되돌리기가 함께 사라진다.
                          그러면 '제외'와 '조용한 삭제'가 사용자 입장에서 구분되지 않는다. */}
                      {c.deferred && (
                        <Button
                          sm
                          variant="ghost"
                          onClick={() => upd((it) => void delete it.chapters[i]!.deferred)}
                          title="이번 범위에 다시 넣기"
                        >
                          이번 범위 제외됨 · 되돌리기
                        </Button>
                      )}
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
          <span className="ds-tiny text-mut">
            <Icon name="arrowUpDown" /> 드래그로 순서 변경
          </span>
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

      {/* N-2 — 챕터 상태 서랍(읽기 전용). **2단계에서 볼트 조인이 들어왔다**(2026-08-06):
          유보의 근거였던 "조인 실패 → 절반이 빈칸"이 실측으로 부정됐다(과목 4/4 · 개념 626/626).
          ⚠ 그래도 **못 붙으면 그 칸을 아예 안 그린다** — 유보의 원래 취지(빈칸 금지)는 유지한다. */}
      <DetailDrawer
        open={!!snap}
        onClose={() => setPeek(null)}
        title={snap ? `${snap.subject} · ${snap.chapter}` : ''}
        placement="center"
      >
        {snap && (
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-md">
            <dt className="text-mut">분량</dt>
            <dd className="m-0 font-bold">{snap.hours ? `${snap.hours}h` : '—'}</dd>
            <dt className="text-mut">진행</dt>
            <dd className="m-0 font-bold">
              {snap.done ? `끝냄${snap.doneDs ? ` · ${snap.doneDs}` : ' · 날짜 기록 없음'}` : '진행 중'}
            </dd>
            <dt className="text-mut">복습</dt>
            <dd className="m-0 font-bold">
              {riskWord(snap)}
              {snap.lastDs && (
                <span className="ds-tiny text-mut">{` · 마지막 ${snap.lastDs} (${snap.daysSince}일 전)`}</span>
              )}
            </dd>
            <dt className="text-mut">오답 기록</dt>
            {/* ⚠ 숫자만 있으면 막다른 골목이다 — "3건"을 보고 그 3건을 보려면 오답 탭에서 과목을
                다시 골라야 했다. 서랍이 표방한 "객체가 목적지"와 어긋나던 유일한 칸이라 링크를 준다.
                ⚠ 조인은 **과목 id** 로만 한다(챕터 이름 매칭이 아니다) → 실패가 원리적으로 없다. */}
            <dd className="m-0 font-bold">
              {snap.cbms ? (
                <Link to={`/mistakes?sid=${encodeURIComponent(id)}`} className="text-acc">
                  {snap.cbms}건 →
                </Link>
              ) : (
                '없음'
              )}
            </dd>
            {/* N-2 2단계 — 볼트 진척. **조인이 성립할 때만** 두 줄이 존재한다(`vault === null` 이면
                `<dt>` 자체가 없다). 원장이 아직 안 돌았거나 이름이 갈리면 서랍은 종전 모습 그대로다. */}
            {vault && (
              <>
                <dt className="text-mut">자료</dt>
                <dd className="m-0 font-bold">
                  노트 {vault.notes}
                  {vault.verified ? <span className="ds-tiny text-mut">{` · 검증 ${vault.verified}`}</span> : null}
                  {/* ⚰ `vault.cards` 를 걷였다(X074 · 2026-09-01 부모 Anki 축 은퇴(태그 `은퇴/anki-2026-09-01`)) — 볼트 산출물이 이제 카드를
                      모른다. ⛔ 「카드 0」을 그리는 것으로 대체하지 마라 — 못 재는 것과 0 은 다르다. */}
                </dd>
                <dt className="text-mut">파이프라인</dt>
                <dd className="m-0 font-bold">
                  {/* ⚠ `planned` 는 5단계 **밖**이다(원장에 이름만 있고 아직 아무것도 안 만든 챕터).
                      `STAGE_META` 에 그 키가 없어서 타입이 잡아 줬다 — 없는 칸을 지어내지 않는다. */}
                  {vault.furthest === 'planned' ? '아직 시작 안 함' : STAGE_META[vault.furthest].label}
                  {vault.reviewedRecent && (
                    <span className="ds-tiny text-mut">{` · 검증일 ${vault.reviewedRecent}`}</span>
                  )}
                </dd>
              </>
            )}
          </dl>
        )}
      </DetailDrawer>
    </details>
  );
}
