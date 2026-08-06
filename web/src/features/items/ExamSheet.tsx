/* ============================================================
   ExamSheet — **T-18 시험 전날 한 장**(`/subject/:id?view=sheet`).

   ## 왜 새 탭이 아닌가

   이 화면은 **한 과목의 상세**다 — 객체 축(`/subject/:id`)이 이미 그 자리이고, W7 이 탭을 줄이는
   중이라 여기서 25번째 탭을 세우면 재편이 아니라 증식이 된다. `graph` 가 `/items?view=structure`
   로 내려온 것과 **같은 관용구**(P-19): 호스트는 그대로, 뷰만 하나 더. lazy 라 시트를 안 여는
   방문에는 파서도 이 화면도 안 내려온다.

   ## 화면 = 선택 목록 + 접힌 결과

   왼쪽에서 챕터를 고르고 오른쪽에 한 장이 선다. **기본 선택은 다가오는 시험의 범위**다
   (`examScopes` · T-1 이 만든 그릇) — 시험 전날에 여는 화면이므로 고를 것을 고르게 두되
   *첫 화면부터 답에 가깝게* 둔다.

   ## ⚠ 이 화면이 조용히 거짓말할 수 있는 자리 셋 — 전부 다르게 말한다

   ① **볼트를 못 읽는다**(브라우저·워크스페이스 미설정) → 콜드 게이트 문구.
   ② **폴더는 읽혔는데 노트가 0** → 그 챕터 이름의 폴더가 볼트에 없다는 뜻(직접 만든 과목).
   ③ **노트는 읽혔는데 항목이 0**(`parsed=false`) → 마크업이 우리 규약과 다르다.
   ②와 ③을 같은 픽셀로 그리면 사용자는 자기 노트가 비었다고 오해한다(`lib/examSheet` 규율 2).
============================================================ */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { Item } from '@/lib/types';
import { vaultNotesText } from '@/lib/tauri';
import { isTauri } from '@/lib/isTauri';
import { buildSheet, countByKind, SHEET_KINDS, type SheetKind, type SheetNote } from '@/lib/examSheet';
import { EXAM_LABEL, examScopes, nextExamOf } from '@/lib/semester';
import { dayDiff, ddayInfo } from '@/lib/utils';
import { Button, Pill, type PillTone } from '@/components/ui';
import State from '@/components/State';

/** 종류별 배지 톤 — **함정만 경고 톤**이다(시험 전날에 눈이 먼저 가야 하는 것). */
const KIND_TONE: Record<SheetKind, PillTone> = {
  요약: 'neutral',
  정의: 'neutral',
  정리: 'good',
  함정: 'warn',
};

/** 한 번에 읽는 챕터 수 상한. 이걸 넘기면 그건 '한 장'이 아니라 교재다. */
const MAX_PICK = 12;

function SheetBody({ notes }: { notes: SheetNote[] }) {
  const empty = notes.every((n) => !n.items.length);
  if (empty) {
    /* ⚠ ②와 ③을 여기서 가른다 — 노트를 한 장이라도 읽었는가. */
    const read = notes.length;
    const parsed = notes.some((n) => n.parsed);
    return (
      <State
        kind="empty"
        glyph="file"
        title={read ? '접을 것을 못 찾았어요' : '그 챕터 폴더가 볼트에 없어요'}
        desc={
          read
            ? parsed
              ? `노트 ${read}개를 읽었지만 정의·정리·함정 콜아웃이 없어요.`
              : `노트 ${read}개를 읽었는데 콜아웃 마크업이 안 보여요 — 파이프라인을 안 거친 노트일 수 있어요.`
            : '과목·챕터 이름이 볼트 폴더 이름과 같아야 찾을 수 있어요.'
        }
        next={{ terminal: '고를 챕터를 바꾸거나 볼트 노트를 확인해 주세요.' }}
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {notes
        .filter((n) => n.items.length)
        .map((n) => (
          <article key={`${n.folder}/${n.title}`} className="ds-rule">
            <h3 className="ds-caps mb-2!">{n.title}</h3>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {n.items.map((it, i) => (
                <li key={i} className="flex flex-col gap-1">
                  <p className="m-0 flex items-baseline gap-1.5 text-md">
                    <Pill tiny tone={KIND_TONE[it.kind]}>
                      {it.kind}
                    </Pill>
                    {it.title ? <b className="text-ink">{it.title}</b> : null}
                    <span className="text-mut">{it.gist}</span>
                  </p>
                  {it.formulas.map((f, k) => (
                    /* 수식은 **부분 변환**이다(`lib/examSheet` 규율 3) — 조판하지 않고 등폭으로 준다. */
                    <code key={k} className="ds-tiny overflow-x-auto rounded-chip bg-panel2 px-2 py-1 text-ink">
                      {f}
                    </code>
                  ))}
                </li>
              ))}
            </ul>
          </article>
        ))}
    </div>
  );
}

export default function ExamSheet({ item, todayDs }: { item: Item; todayDs: string }) {
  const navigate = useNavigate();
  const chapters = useMemo(() => item.chapters || [], [item.chapters]);
  const exam = nextExamOf(item, todayDs);

  /* 기본 선택 = 다가오는 시험의 범위. 시험이 없으면 **아무것도 안 고른다** — 51챕터를 통째로
     읽어 오는 것이 기본값이면 그건 한 장이 아니고, 볼트를 통째로 훑는 IO 이기도 하다. */
  const preset = useMemo(() => {
    const sc = exam ? examScopes(item).find((s) => s.exam.id === exam.id) : null;
    if (!sc) return new Set<string>();
    return new Set(chapters.slice(sc.fromIdx, sc.thruIdx + 1).map((c) => c.name));
  }, [item, exam, chapters]);
  const [picked, setPicked] = useState<Set<string>>(preset);
  const [asked, setAsked] = useState<string[] | null>(null);

  const q = useQuery({
    queryKey: ['examSheet', item.name, asked],
    enabled: !!asked?.length,
    queryFn: async () => {
      const out = await Promise.all((asked ?? []).map((ch) => vaultNotesText(`${item.name}/${ch}`)));
      return buildSheet(out.flatMap((n) => n ?? []));
    },
  });

  const toggle = (name: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name);
      else if (next.size < MAX_PICK) next.add(name);
      return next;
    });

  const counts = q.data ? countByKind(q.data) : null;
  /* ⚠ 셸 전용은 **오른쪽 칸만**이다 — 화면 전체를 콜드 게이트로 덮으면 브라우저에서 이 화면이
     통째로 존재하지 않게 되고, 그러면 시각 베이스라인이 이 표면을 **한 픽셀도 안 본다**(트랙 A 는
     브라우저다). 고르는 일은 볼트 없이도 되므로 왼쪽은 언제나 그린다. */
  const shellOnly = !isTauri();

  return (
    <section className="flex min-h-0 flex-1 gap-4 px-5.5 pt-2 pb-5.5 max-wide:flex-col max-wide:overflow-y-auto">
      {/* 선택 목록은 **폭이 고정**이다 — 내용 폭에 맡기면 챕터 이름 길이에 따라 두 칸의 균형이
          매 과목 달라진다(실렌더로 확인한 것 · §15-4). */}
      <div className="flex min-h-0 w-68 flex-none [scrollbar-width:thin] flex-col gap-3 overflow-y-auto max-wide:w-full">
        <div className="flex items-center gap-2">
          <Button sm variant="ghost" onClick={() => navigate(`/subject/${item.id}`)}>
            ← {item.name}
          </Button>
          {exam ? (
            <Pill tiny tone="warn">
              {EXAM_LABEL[exam.kind]} {ddayInfo(dayDiff(todayDs, exam.date)).lab}
            </Pill>
          ) : null}
        </div>
        <div className="ds-rule">
          <h3 className="ds-caps mb-2!">
            챕터 고르기 — {picked.size}/{MAX_PICK}
          </h3>
          {chapters.length ? (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {chapters.map((c) => (
                <li key={c.id}>
                  <label className="flex items-center gap-2 text-md">
                    <input
                      type="checkbox"
                      checked={picked.has(c.name)}
                      onChange={() => toggle(c.name)}
                      disabled={!picked.has(c.name) && picked.size >= MAX_PICK}
                    />
                    <span className="truncate">{c.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ds-tiny text-mut">챕터가 없어요.</p>
          )}
          <Button
            variant="primary"
            className="mt-2.5"
            disabled={!picked.size || shellOnly}
            onClick={() => setAsked([...picked])}
          >
            한 장 만들기
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 [scrollbar-width:thin] flex-col gap-3 overflow-y-auto">
        {counts ? (
          <p className="ds-tiny m-0 text-mut">
            {SHEET_KINDS.filter((k) => counts[k])
              .map((k) => `${k} ${counts[k]}`)
              .join(' · ') || '항목 없음'}
          </p>
        ) : null}
        {shellOnly ? (
          <State
            kind="empty"
            glyph="file"
            title="데스크톱 앱에서 만들 수 있어요"
            desc="한 장은 볼트 노트 본문을 접어 만들어요 — 브라우저에는 볼트가 없어요."
            next={{ terminal: '러닝허브 앱에서 같은 화면을 열면 여기에 한 장이 섭니다.' }}
          />
        ) : !asked ? (
          <State
            kind="empty"
            glyph="file"
            title="고른 챕터로 한 장을 만들어요"
            desc="볼트 노트에서 정의·정리·함정과 식만 접어 내려요."
            next={{ terminal: '왼쪽에서 챕터를 고르고 「한 장 만들기」를 눌러 주세요.' }}
          />
        ) : q.isPending ? (
          <State kind="loading" title="볼트에서 접는 중…" shape="indeterminate" />
        ) : q.isError ? (
          <State
            kind="error"
            glyph="file"
            title="볼트를 읽지 못했어요"
            desc={String(q.error)}
            next={
              <Button variant="primary" onClick={() => void q.refetch()}>
                다시 시도
              </Button>
            }
          />
        ) : (
          <SheetBody notes={q.data ?? []} />
        )}
      </div>
    </section>
  );
}
