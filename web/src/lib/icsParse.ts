/* ============================================================
   icsParse.ts — **`.ics` 를 거꾸로 읽는다**(I008 · 2026-08-22 발상 축). 순수 · React 무관 · IO 0.

   ## 왜 생겼나 — 파이프가 단방향이었다

   이 앱은 `.ics` 를 **쓰기만** 했다(`lib/ics.ts` 의 `buildICS`). 즉 계획을 캘린더로 **내보내는**
   문은 있는데, 학교가 이미 갖고 있는 **시간표와 학사일정을 들여오는** 문은 없었다. 그 결과가
   실 DB 에 그대로 남아 있었다(2026-08-22 실측): 일과의 수업 블록 넷이 **전부 이름이 그냥
   「수업」** 이고, 주 10시간을 먹으면서 어느 과목인지 앱은 모른다. 사람이 그것을 손으로
   네 번 치는 것보다 **파일 하나를 주는 것**이 싸다.

   ⚠ 착수 전에 전제를 확인했다: _"학교가 `.ics` 를 준다"_ → **준다**(사용자 확인 2026-08-22).
   안 준다면 이 파일은 지어지지 않았을 것이다.

   ## 무엇을 뽑는가 — 셋

   1. **시간표**(`lectures`) — `RRULE:FREQ=WEEKLY` 인 이벤트. 요일·시각·이름을 갖는 **일과 블록**의
      재료다. `.ics` 의 시간표는 정확히 이 형태로 온다.
   2. **학사일정 눈금**(`marks`) — 단발 종일/시각 이벤트 중 `syllabusIntake` 의 말뭉치에 걸리는 것
      (휴강 · 수강 정정 · 보강 …).
   3. **시험**(`exams`) — 단발 이벤트 중 중간/기말.

   ⚠⚠ **판정 어휘를 여기서 새로 짓지 않는다.** 무엇이 「휴강」이고 무엇이 「중간고사」인지는
   `lib/syllabusIntake` 가 이미 소유한다(`MARK_WORDS`·`MID_WORD`·`FINAL_WORD`). 사본을 두면
   붙여넣기 경로와 파일 경로가 **같은 줄을 다르게 읽는** 날이 온다 — 이 저장소가 목록 사본으로
   반복해 물린 형태다. 그래서 그쪽에서 `classifyLine` 을 꺼내 쓴다.

   ## 규율 — 인입구의 규율 셋을 그대로 승계한다

   1. **여기서 아무것도 저장하지 않는다.** 결과는 *초안*이고 사람이 고른다.
   2. **못 읽은 것을 센다**(`unparsed`) — 조용한 축소 보고를 막는 장치.
      ⚠ 분모는 **VEVENT 개수**다. 「파일에 이벤트가 40개인데 3개만 읽었다」를 말할 수 있어야 한다.
   3. **시간대를 해석하지 않는다.** `DTSTART;TZID=Asia/Seoul:20260302T090000` 의 벽시계 값을
      그대로 쓴다 — 학교 시간표의 「9시」는 그 자리의 9시이고, UTC 로 환산해 되돌리면 서머타임·
      TZID DB 를 앱이 지게 된다. ⚠ 단 **`Z`(UTC) 접미가 붙은 값은 예외**로 로컬로 환산한다
      (그건 벽시계가 아니라고 파일이 명시한 것이다).
============================================================ */
import { classifyLine, type IntakeMark, type SyllabusExam } from './syllabusIntake';
import { matchSubjectIndex } from './subjectMatch';
import { pad2, rid } from './utils';
import type { RoutineBlock } from './types';

/** 시간표 한 줄 — 그대로 `RoutineBlock` 이 되는 재료. */
export interface IcsLecture {
  /** `SUMMARY` — 강의명. 비면 이 이벤트는 버린다(이름 없는 블록은 일과에서 못 고른다). */
  name: string;
  /** 요일(0=일 … 6=토) — 앱의 `RoutineBlock.days` 와 **같은 축**(`WeekAllocSchema` 주석의 그 축). */
  days: number[];
  /** `HH:MM`. */
  start: string;
  /** `HH:MM`. */
  end: string;
  /** `LOCATION`(선택) — 강의실. 표시에만 쓴다. */
  where?: string;
}

export interface IcsDraft {
  lectures: IcsLecture[];
  marks: IntakeMark[];
  exams: SyllabusExam[];
  /** 뜻을 못 붙인 VEVENT 수(규율 2). */
  unparsed: number;
  /** 파일에 있던 VEVENT 총수 — `unparsed` 의 **분모**. */
  events: number;
}

/* ── 언폴딩과 속성 읽기 ─────────────────────────────────────────────────── */

/**
 * RFC 5545 의 접힌 줄을 편다 — 다음 줄이 공백/탭으로 시작하면 앞줄의 **이어짐**이다.
 *
 * ⚠ 이걸 건너뛰면 긴 `SUMMARY`(75옥텟 초과)가 두 줄로 잘려 강의명이 조용히 뭉개진다. 학교
 * 시간표의 강의명은 학수번호·분반이 붙어 길기 때문에 실제로 걸린다.
 */
function unfold(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (/^[ \t]/.test(raw) && out.length) out[out.length - 1] += raw.slice(1);
    else out.push(raw);
  }
  return out;
}

/** `\,` `\;` `\n` `\\` 를 되돌린다(`icsEsc` 의 역연산). */
function unesc(v: string): string {
  return v
    .replace(/\\n/gi, '\n')
    .replace(/\\([,;\\])/g, '$1')
    .trim();
}

/** 한 VEVENT = `이름 → 값` + `이름 → 파라미터 문자열`. 같은 이름이 두 번이면 **첫 값**을 쓴다. */
type Props = Map<string, { value: string; params: string }>;

function propsOf(lines: readonly string[]): Props {
  const m: Props = new Map();
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const head = line.slice(0, colon);
    const semi = head.indexOf(';');
    const name = (semi < 0 ? head : head.slice(0, semi)).toUpperCase();
    if (m.has(name)) continue;
    m.set(name, { value: line.slice(colon + 1), params: semi < 0 ? '' : head.slice(semi + 1) });
  }
  return m;
}

/** 파싱된 시각 하나 — 날짜와 (있으면) 자정 기준 분. */
interface IcsTime {
  ds: string;
  /** 종일 이벤트면 null. */
  min: number | null;
}

/**
 * `20260302T090000` · `20260302T000000Z` · `20260302`(VALUE=DATE) 를 읽는다.
 *
 * ⚠ `Z` 가 붙은 값만 로컬로 환산한다 — 머리주석의 그 이유다.
 */
export function readIcsTime(value: string): IcsTime | null {
  const v = value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, hh, mm, , z] = m;
  if (hh === undefined) return { ds: `${y}-${mo}-${d}`, min: null };
  if (z) {
    const utc = new Date(Date.UTC(+y!, +mo! - 1, +d!, +hh, +mm!, 0));
    return {
      ds: `${utc.getFullYear()}-${pad2(utc.getMonth() + 1)}-${pad2(utc.getDate())}`,
      min: utc.getHours() * 60 + utc.getMinutes(),
    };
  }
  return { ds: `${y}-${mo}-${d}`, min: +hh * 60 + +mm! };
}

const HHMM = (min: number): string => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;

/** `BYDAY=MO,WE` → `[1, 3]`. 앱의 요일 축(0=일)과 맞춘다. */
const DAY_CODE: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/**
 * `RRULE` 이 **주 반복**인가, 그렇다면 어느 요일인가.
 *
 * ⚠ `BYDAY` 가 없는 `FREQ=WEEKLY` 는 **`DTSTART` 의 요일**로 반복한다(RFC 5545) — 그 폴백이
 * 없으면 요일 하나짜리 시간표(주 1회 강의)가 통째로 `unparsed` 로 떨어진다.
 * ⚠ `BYDAY=2MO`(둘째 월요일) 같은 서수는 **주 반복이 아니다** — 일과 블록으로 옮기면 매주
 * 서는 수업이 되어 없는 시간을 지운다. 서수가 붙은 코드는 버린다.
 * ⚠⚠ `COUNT=n` 은 **유한 반복**이라 같은 이유로 거부한다(C035) — 아래 그 자리 주석 참조.
 *    `UNTIL` 은 반대다(학기 종료 표기 · 정상 시간표) — 둘을 한 부류로 읽지 마라.
 */
function weeklyDays(rrule: string | undefined, startWd: number): number[] | null {
  if (!rrule) return null;
  const parts = new Map(
    rrule.split(';').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).toUpperCase(), p.slice(i + 1)] as const;
    }),
  );
  if ((parts.get('FREQ') ?? '').toUpperCase() !== 'WEEKLY') return null;
  const interval = +(parts.get('INTERVAL') ?? '1');
  /* 격주 수업을 매주로 펴면 **없는 수업이 매주 시간을 먹는다** — 가용시간을 깎는 쪽이라 조용히
     틀리면 계획 전체가 눌린다. 주기가 1이 아니면 일과로 옮기지 않는다. */
  if (interval !== 1) return null;
  /* ⚠⚠ `COUNT=n` 도 같은 축의 다른 갈래다(C035 · 2026-08-22). 3주짜리 보강이
     `FREQ=WEEKLY;BYDAY=WE;COUNT=3` 으로 오면 `RoutineBlock` 에는 **종료 개념이 없어**
     3주 뒤부터 없는 수업이 매주 수요일을 영구히 먹는다 — 위 `INTERVAL` 문단이 거부하는
     것과 글자 그대로 같은 실패이고, 가용시간을 깎는 쪽이라 조용히 틀리면 계획 전체가 눌린다.
     재인입이 정상 사용(I010)이라 **반입할 때마다 유령 블록이 하나씩 쌓인다.**
     ⚠ `UNTIL` 은 여기 넣지 마라 — 그건 학기 종료 표기이고 `test/icsParse.test.ts` 에
     픽스처가 있는 **의도된 통과**다. 「끝이 있다」는 점만 같고 뜻이 반대다. */
  if (parts.has('COUNT')) return null;
  const byday = parts.get('BYDAY');
  if (!byday) return [startWd];
  const days = byday
    .split(',')
    .map((c) => DAY_CODE[c.trim().toUpperCase()])
    .filter((n): n is number => n !== undefined);
  return days.length ? [...new Set(days)].sort((a, b) => a - b) : null;
}

/* ── 본체 ─────────────────────────────────────────────────────────────── */

/**
 * `.ics` 텍스트 → 초안.
 *
 * ⚠ **한 이벤트는 한 자리에만 간다.** 시간표(주 반복)와 단발은 배타적이고, 단발 안에서는
 * 시험 > 눈금 순이다(`parseSyllabus` 와 같은 우선순위 — 두 경로가 다른 순서를 쓰면 같은
 * 파일이 어느 문으로 들어왔느냐에 따라 다르게 읽힌다).
 */
export function parseIcs(text: string): IcsDraft {
  const lectures: IcsLecture[] = [];
  const marks: IntakeMark[] = [];
  const exams: SyllabusExam[] = [];
  let events = 0;
  let unparsed = 0;

  let cur: string[] | null = null;
  for (const line of unfold(text)) {
    const up = line.trim().toUpperCase();
    if (up === 'BEGIN:VEVENT') {
      cur = [];
      continue;
    }
    if (up === 'END:VEVENT') {
      if (cur) {
        events++;
        if (!takeEvent(propsOf(cur), lectures, marks, exams)) unparsed++;
      }
      cur = null;
      continue;
    }
    if (cur) cur.push(line);
  }
  return { lectures, marks, exams, unparsed, events };
}

/** 이벤트 하나를 어느 목록에든 넣었는가. */
function takeEvent(p: Props, lectures: IcsLecture[], marks: IntakeMark[], exams: SyllabusExam[]): boolean {
  const name = unesc(p.get('SUMMARY')?.value ?? '');
  const dtStart = p.get('DTSTART');
  if (!name || !dtStart) return false;
  const st = readIcsTime(dtStart.value);
  if (!st) return false;
  const en = p.get('DTEND') ? readIcsTime(p.get('DTEND')!.value) : null;

  /* ① 시간표 — 주 반복 + 시각이 있는 것만. 종일 반복은 일과 블록이 될 수 없다(시각이 없다). */
  const wd = new Date(`${st.ds}T00:00:00`).getDay();
  const days = weeklyDays(p.get('RRULE')?.value, wd);
  if (days && st.min !== null) {
    /* 끝 시각이 없거나 시작보다 이르면(자정을 넘긴 표기) **한 시간**으로 둔다 — 0분 블록은
       일과 계산에서 아무것도 안 하면서 목록만 채운다. */
    const endMin = en?.min != null && en.min > st.min ? en.min : st.min + 60;
    lectures.push({
      name,
      days,
      start: HHMM(st.min),
      end: HHMM(Math.min(endMin, 1440)),
      ...(unesc(p.get('LOCATION')?.value ?? '') ? { where: unesc(p.get('LOCATION')!.value) } : {}),
    });
    return true;
  }

  /* ② 단발 — 이름을 붙여넣기 경로와 **같은 어휘**로 읽는다. 설명도 함께 본다(학사일정 `.ics` 는
     제목이 「학사일정」뿐이고 내용이 DESCRIPTION 에 있는 경우가 흔하다). */
  const hit = classifyLine(`${name} ${unesc(p.get('DESCRIPTION')?.value ?? '')}`);
  if (hit.exam) {
    exams.push({ kind: hit.exam, date: st.ds, week: null });
    return true;
  }
  if (hit.mark) {
    marks.push({ kind: hit.mark, ds: st.ds, label: name.slice(0, 40) });
    return true;
  }
  return false;
}

/**
 * 시간표 초안 → 일과 블록.
 *
 * ⚠ **여기서 상태를 안 만진다** — 호출부가 고른 것만 넘긴다(규율 1). `id` 를 여기서 발급하는
 * 이유는 그것이 저장 계약의 일부라 화면이 지어내면 두 벌이 되기 때문이다.
 * ⚠ 유형은 `BLOCK_CLASS`(수업) 로 고정한다 — `.ics` 시간표가 담는 것은 정의상 수업이고,
 *   유형을 파일에서 추론하면 「기타」가 섞여 가용시간 계산이 조용히 갈린다.
 */
export function lectureToBlock(l: IcsLecture, type: string, sid?: string): RoutineBlock {
  return { id: rid(), name: l.name, type, start: l.start, end: l.end, days: [...l.days], ...(sid ? { sid } : {}) };
}

/**
 * 고른 시간표 강의들을 일과에 **넣는다**. 같은 블록은 안 넣는다. 실제로 들어간 수를 돌려준다.
 *
 * ⚠⚠ **쓰기가 `lectureToBlock` 곁으로 내려온 이유**(C068 · 2026-08-22). 이 규칙은
 * `degree/CalendarIntake.tsx` 의 `mutate` 콜백 **안**에 살았고, 그래서 컴포넌트를 렌더하지
 * 않으면 도달 방법 자체가 없었다 — 근본 원인 **R3** 의 형태이고 `C036`(학사 눈금)과 **글자
 * 그대로 같은 짝**이다. 그쪽을 내리면서 이쪽만 남겨 두면 같은 파일에 정반대의 두 선례가 생긴다.
 *
 * ⚠ **중복 판정이 규칙의 본체다.** 학기 중에 시간표를 다시 받는 것이 정상 사용이고(I010 —
 * 시간표는 바뀐다), 그때마다 쌓이면 **가용시간이 실제보다 적어진다**(스케줄러가 그만큼 전부를
 * 누른다). 이 파일이 `INTERVAL`·`COUNT` 를 거부하는 것과 같은 축의 방어다.
 *
 * ⚠ 판정 키는 `(name, start, end, days)` 다 — `sid` 는 **키가 아니다**. 과목 연결이 나중에
 * 붙거나 떨어져도 같은 수업은 같은 수업이고, `sid` 를 키에 넣으면 연결이 바뀐 뒤 재인입이
 * **같은 시간에 블록 둘**을 만든다.
 * ⚠ `routine` 을 제자리에서 고친다(호출부가 `mutate` 안에서 부른다 · immer draft).
 *
 * @param sidOf 강의명 → 과목 id. 못 맞추면 `undefined` 를 주면 된다(`matchLectureSid` 참조).
 */
export function applyLectureBlocks(
  routine: RoutineBlock[],
  lectures: readonly IcsLecture[],
  type: string,
  sidOf: (name: string) => string | undefined,
): number {
  let n = 0;
  for (const l of lectures) {
    const dup = routine.some(
      (b) => b.name === l.name && b.start === l.start && b.end === l.end && b.days.join() === l.days.join(),
    );
    if (dup) continue;
    routine.push(lectureToBlock(l, type, sidOf(l.name)));
    n += 1;
  }
  return n;
}

/**
 * 강의명 → 과목 id(I013). 못 맞추면 `undefined` — **지어내지 않는다.**
 *
 * ⚠ 규칙을 여기서 새로 짓지 않는다: `lib/subjectMatch` 가 이 저장소의 이름 맞추기 SSOT 이고
 * (공백 무시 · 정확 우선 · 포함이면 길이차 최소), 그 규칙은 배분을 구동하며 검증돼 온 것이다.
 * 사본을 두면 「물리 ↔ 물리화학」류 오매핑이 여기서만 다르게 난다.
 * ⚠ 안 붙는 것이 **정상이다** — 교양 수업·전공 밖 강의는 학습 항목이 아예 없다. 그래서
 *   호출부가 「N개 중 M개 연결됨」을 말해야 한다(조용한 축소 보고 금지).
 */
export function matchLectureSid(name: string, items: readonly { id: string; name: string }[]): string | undefined {
  const at = matchSubjectIndex(
    name,
    items.map((i) => i.name),
  );
  return at >= 0 ? items[at]!.id : undefined;
}

/** 초안이 비었나 — 화면이 "한 건도 못 읽었다"를 말할 수 있게(규율 2). */
export function icsDraftIsEmpty(d: IcsDraft): boolean {
  return !d.lectures.length && !d.marks.length && !d.exams.length;
}
