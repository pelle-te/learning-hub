/* ============================================================
   lib/dayBuffer.ts — **하루를 텍스트 한 장으로**(N-15 · W7 · 발산 6회차).

   ## 무엇이 없었나

   이 앱은 하루를 **여섯 표면**으로 말한다(히어로 · 흐름 · 막대 · 스트립 · 레일 · 리드아웃).
   각각은 그 자리에서 옳지만, "오늘 전체를 한 번에 훑는다"는 동작이 없다 — 그래서 사용자는
   그 훑기를 **머릿속에서**(또는 볼트에 손으로) 한다. 텍스트 한 장은 그 훑기를 앱 안으로 들인다.

   ## ⚠⚠ **읽기 전용이다 — 파서를 만들지 않는다**

   로드맵이 적은 가장 싼 검증이 정확히 그것이다: _"파서 **없이** 읽기 전용 렌더 → 사흘 '고치고
   싶었나' O/X"_. 편집을 먼저 만들면 텍스트↔상태 왕복 파서가 필요하고(그건 이 앱에서 가장 비싼
   부류의 배관이다), **그 비용을 치른 뒤에야** 사람들이 실제로 고치려 드는지 알게 된다.
   → 순서를 뒤집는다: 먼저 보여 주고, *고치고 싶었나*를 관측한 뒤에 파서를 판단한다.
   ⚠ **폐기 조건**: 사흘 동안 "고치고 싶었다"가 0이면 편집은 안 만든다(그리고 이 화면은 그대로
     남는다 — 훑기 자체가 값이라면 읽기 전용으로 충분하다).

   ⚠ 순수다: 시계·스토어·DOM 을 안 읽는다. 그래야 "무엇이 한 장에 들어가는가"라는 판단 자체가
   유닛으로 잠긴다(이 파일의 유일한 규칙이 그 선택이다).
============================================================ */
import { hLabel, toHM } from './utils';

export interface BufferBlock {
  /** 시작 시각(분). 없으면 시각 미정 — 목록 끝에 모인다. */
  start: number | null;
  min: number;
  done: boolean;
  name: string;
  /** 챕터 등 구체적 대상. 없으면 이름만 적는다. */
  detail?: string;
  /** 학습이 아닌 것(수업·일과) — 체크박스를 안 그린다. */
  routine?: boolean;
}

export interface BufferInput {
  ds: string;
  blocks: readonly BufferBlock[];
  /** 오늘 남긴 3문장 요약들. */
  summaries: readonly string[];
  /** 오늘 남긴 오답 한 줄들. */
  misses: readonly string[];
  /** 하루 판정 한 줄(`dayCapacity.fitLine`). 없으면 안 적는다. */
  fitLine?: string | null;
  /** 어제 남긴 한 줄(있으면 맨 위에 문맥으로). */
  prevNote?: string | null;
}

/** 체크박스 — 마크다운 관용구 그대로다(볼트로 복사해 붙이는 것이 이 형식의 목적). */
const box = (done: boolean): string => (done ? '- [x]' : '- [ ]');

/**
 * 하루 → 한 장의 텍스트.
 *
 * ⚠ **형식이 마크다운인 것이 의도다.** 이 앱의 볼트가 마크다운이고, 복사해 붙이는 것이 이
 * 화면의 첫 용도이기 때문이다(편집이 없는 동안에도 *가져나갈* 수는 있어야 한다).
 * ⚠ **빈 절은 안 적는다** — 비어 있는 제목은 "여기에 뭔가 있어야 하는데 없다"로 읽히고,
 * 그건 이 앱이 화면 곳곳에서 지켜 온 규율("말할 것이 없으면 안 그린다")과 같다.
 */
export function dayBuffer(i: BufferInput): string {
  const lines: string[] = [`# ${i.ds}`];
  if (i.prevNote?.trim()) lines.push('', `> 어제 — ${i.prevNote.trim()}`);
  if (i.fitLine) lines.push('', i.fitLine);

  const timed = i.blocks.filter((b) => b.start != null).sort((a, b) => a.start! - b.start!);
  const untimed = i.blocks.filter((b) => b.start == null);
  if (timed.length || untimed.length) {
    lines.push('', '## 오늘');
    for (const b of [...timed, ...untimed]) {
      const when = b.start == null ? '시각 미정' : toHM(b.start);
      const what = b.detail ? `${b.name} · ${b.detail}` : b.name;
      /* 일과·수업은 **체크박스를 안 준다** — 내가 완료를 표시하는 대상이 아니라 그냥 일어나는
         일이다. 체크박스를 주면 "안 한 것"처럼 보이고 하루가 실패로 읽힌다. */
      const head = b.routine ? '-' : box(b.done);
      lines.push(`${head} ${when} · ${what} (${hLabel(b.min)})`);
    }
  }
  if (i.summaries.length) {
    lines.push('', '## 남긴 것');
    for (const s of i.summaries) lines.push(`- ${s}`);
  }
  if (i.misses.length) {
    lines.push('', '## 틀린 것');
    for (const m of i.misses) lines.push(`- ${m}`);
  }
  return lines.join('\n');
}
