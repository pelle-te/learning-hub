/* ============================================================
   quickCapture.ts — 자연어 빠른 캡처 파서 (순수·무의존, 프레임워크 무관).
   명령 팔레트에 친 한 줄("내일 오후 3시 알고리즘 2챕터 복습")을 구조화된 의도로 분해.
   앱이 이를 학습 블록/저널로 바꾼다. store/features/components 어디에도 의존하지 않음(lib 계약).

   설계 원칙:
   ① 결정적: 기준시각 now를 '주입'받아 상대날짜를 계산 → 테스트가 벽시계에 흔들리지 않음.
   ② 절대 throw 금지: 인식 실패는 조용히 넘기고, raw가 공백일 때만 null.
   ③ title은 매칭된 토큰(날짜/시간/유형/과목/챕터)을 raw에서 걷어낸 '나머지' — 비면 raw로 폴백(항상 비지 않음).
   한국어 우선, 영어(today/tomorrow/ch) 관용 표현도 수용.

   ⚠⚠ **시각(`minute`·`timeLabel`)과 세션 유형(`sessionType`)이 여기서 삭제됐다**(P-18 · 2026-08-01).
   파서는 그 둘을 정확히 뽑았고 팔레트가 `오후 3:00 · 복습` 이라고 **칩으로 보여줬는데**, 착지
   지점인 `captureRecord` 는 `sid·name·topic·note` 넷만 만든다 — 즉 화면이 약속한 것의 절반이
   어디에도 안 갔다. 없는 기능을 있는 것처럼 그리는 것이 없는 것보다 나쁘다.

   ⚠ 왜 과목·챕터는 남기고 이 둘만 지웠나 — **약속하는 토큰과 서술하는 토큰이 다르다.**
   `알고리즘 · 2챕터` 는 이 캡처가 *무엇에 관한 것인지*를 말하고 그건 실제로 레코드가 담는다
   (`sid`·`topic`, 못 담은 조각은 `note` 의 원문에 남는다). 반면 `오후 3:00 · 복습` 은 *블록을
   만들겠다*는 약속으로 읽히는데 이 경로는 블록을 만들지 않는다.

   ⚠ 반대 선택지(⇧⌘Enter 로 그 날짜에 실제 블록 꽂기)를 안 고른 이유는 부작용이다: 하루에 수동
   블록 하나를 꽂으면 그 날이 `mode:'manual'` 로 굳어 자동 배분에서 통째로 빠진다. _"메모 하나
   남겼는데 그날 계획이 얼었다"_ 가 되고, 그 부작용 설계가 본체라 파서에 얹을 일이 아니다.
============================================================ */

export interface CaptureResult {
  title: string; // 토큰 제거 후 남은 텍스트(트림). 절대 비지 않음 — 비면 원본 raw.
  dateISO?: string; // 'YYYY-MM-DD'(로컬), now 기준으로 산출.
  dateLabel?: string; // 확인칩용 사람말 라벨: '내일' · '금요일' · '3월 2일'
  subject?: string; // 제공된 목록과 매칭된 정확한 항목명
  chapter?: string; // '2챕터' · '3장' · 'ch 5' (매칭된 형태 보존)
}

/* 날짜 헬퍼는 utils가 단일 원천 — 이 파일은 한때 iso/addDays/startOfDay/mondayOf 넷을 자체
   재구현했다(주석이 "utils와 동일 규약"이라 자인까지 했다). 같은 lib 계층이라 import에 제약도 없다.
   ⚠ 옛 로컬 addDays는 인자를 자정으로 절삭했지만 utils.addDays는 시각을 보존한다 — 여기 호출부는
   전부 이미 절삭된 base(startOfDay·mondayOf 산출)를 넘기므로 동작은 동일하다. */
import { iso, addDays, mondayOf, startOfDay } from './utils';
import { addBacklog } from './methodology';
import type { AppState } from './types';

/** raw에서 needle(대소문자 무시) 첫 등장을 공백으로 치환 — title 걷어내기용. */
function stripOnce(hay: string, needle: string): string {
  if (!needle) return hay;
  const i = hay.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return hay;
  return hay.slice(0, i) + ' ' + hay.slice(i + needle.length);
}

/* 요일 문자 → JS getDay (일=0..토=6) */
const WEEKDAY_DAYIDX: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
/* 월요일 시작 주 인덱스(월=0..일=6) — '이번주/다음주 X요일' 계산용 */
const WEEK_MON_ORDER = '월화수목금토일';

interface DateHit {
  dateISO: string;
  label: string;
  strip: string;
}

/** 날짜 인식 — 우선순위: 상대어 → 절대(N월 N일) → N/N → 요일. 첫 매칭만 채택. */
function matchDate(raw: string, now: Date): DateHit | null {
  const base = startOfDay(now);

  // ① 상대어: 오늘/내일/모레/글피 + 영어 today/tomorrow
  const rel: Array<[RegExp, number, string]> = [
    [/모레/, 2, '모레'],
    [/글피/, 3, '글피'],
    [/내일/, 1, '내일'],
    [/오늘/, 0, '오늘'],
    [/\btomorrow\b/i, 1, '내일'],
    [/\btoday\b/i, 0, '오늘'],
  ];
  for (const [re, off, label] of rel) {
    const m = raw.match(re);
    if (m) return { dateISO: iso(addDays(base, off)), label, strip: m[0] };
  }

  // ② 절대 N월 N일 — 올해 기준, 이미 지났으면 내년으로 롤.
  const mAbs = raw.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (mAbs) {
    const mo = Number(mAbs[1]);
    const dy = Number(mAbs[2]);
    if (mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31) {
      let cand = new Date(base.getFullYear(), mo - 1, dy);
      if (cand.getTime() < base.getTime()) cand = new Date(base.getFullYear() + 1, mo - 1, dy);
      return { dateISO: iso(cand), label: `${mo}월 ${dy}일`, strip: mAbs[0] };
    }
  }

  // ③ N/N (슬래시) — 시간 HH:MM(콜론)과 구문이 겹치지 않음.
  const mSlash = raw.match(/(\d{1,2})\/(\d{1,2})/);
  if (mSlash) {
    const mo = Number(mSlash[1]);
    const dy = Number(mSlash[2]);
    if (mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31) {
      let cand = new Date(base.getFullYear(), mo - 1, dy);
      if (cand.getTime() < base.getTime()) cand = new Date(base.getFullYear() + 1, mo - 1, dy);
      return { dateISO: iso(cand), label: `${mo}/${dy}`, strip: mSlash[0] };
    }
  }

  // ④ 요일 — '이번주/다음주/담주' 접두 + X요일, 또는 X요일, 또는 홀로 선 X요일 문자.
  //    접두+요일(요일 옵션) → 접두없는 요일 → 홀로 선 문자 순으로 시도.
  const weekRes: RegExp[] = [
    /(이번주|다음주|담주)\s*([월화수목금토일])요일/,
    /(이번주|다음주|담주)\s*([월화수목금토일])/,
    /([월화수목금토일])요일/,
    /(?:^|\s)([월화수목금토일])(?=\s|$)/,
  ];
  for (const re of weekRes) {
    const m = raw.match(re);
    if (!m) continue;
    // 접두가 있는 규칙은 m[1]=접두·m[2]=요일, 없는 규칙은 m[1]=요일.
    const hasPrefix = m[1] === '이번주' || m[1] === '다음주' || m[1] === '담주';
    const prefix = hasPrefix ? m[1] : '';
    const ch = hasPrefix ? m[2]! : m[1]!;
    const dayIdx = WEEKDAY_DAYIDX[ch];
    if (dayIdx === undefined) continue;

    let target: Date;
    if (prefix === '이번주') {
      target = addDays(mondayOf(base), WEEK_MON_ORDER.indexOf(ch));
    } else if (prefix === '다음주' || prefix === '담주') {
      target = addDays(mondayOf(base), 7 + WEEK_MON_ORDER.indexOf(ch));
    } else {
      // 홑 요일 → now 이후 '다음 등장'(오늘이 그 요일이면 다음 주).
      let ahead = (dayIdx - base.getDay() + 7) % 7;
      if (ahead === 0) ahead = 7;
      target = addDays(base, ahead);
    }
    const label = (prefix ? `${prefix} ` : '') + `${ch}요일`;
    return { dateISO: iso(target), label, strip: m[0] };
  }

  return null;
}

/** 챕터 인식 — 'N챕터' · 'N장' · 'ch N' · 'chapter N'. 매칭된 형태를 그대로 라벨로. */
function matchChapter(raw: string): { chapter: string; strip: string } | null {
  // 수량자를 상한 있는 형태로 — 무한 `\d+`/`\s*`는 매칭 실패 시 시작위치마다 재스캔해
  // 초선형이 된다(sonarjs/super-linear-regex). 챕터 번호가 4자리를 넘을 일은 없으므로 의미 손실 0.
  let m = raw.match(/\d{1,4}[ \t]{0,4}(?:챕터|장)/);
  if (m) return { chapter: m[0].trim(), strip: m[0] };
  m = raw.match(/(?:chapter|ch)[ \t]{0,4}\d{1,4}/i);
  if (m) return { chapter: m[0].trim(), strip: m[0] };
  return null;
}

/** 과목 매칭 — ① 부분문자열(대소문자 무시) 중 가장 긴 항목명, ② 없으면 토큰 공유 중 가장 긴 항목명. */
function matchSubject(raw: string, subjects: string[]): { subject: string; strip: string } | null {
  const lower = raw.toLowerCase();
  // ① 부분문자열 매칭 — 긴 이름 우선(가장 구체적인 것).
  const subs = subjects.filter((s) => s && lower.includes(s.toLowerCase())).sort((a, b) => b.length - a.length);
  if (subs.length) {
    const subject = subs[0]!;
    const i = lower.indexOf(subject.toLowerCase());
    const strip = raw.slice(i, i + subject.length); // raw 원본 표기 보존
    return { subject, strip };
  }
  // ② 토큰 공유 — raw 토큰과 과목명 토큰이 하나라도 겹치면 후보, 가장 긴 이름 채택.
  const rawTokens = new Set(lower.split(/\s+/).filter(Boolean));
  let best: string | null = null;
  let bestStrip = '';
  for (const s of subjects) {
    if (!s) continue;
    const stoks = s.toLowerCase().split(/\s+/).filter(Boolean);
    const shared = stoks.find((t) => rawTokens.has(t));
    if (shared && (best === null || s.length > best.length)) {
      best = s;
      const i = lower.indexOf(shared);
      bestStrip = i >= 0 ? raw.slice(i, i + shared.length) : shared;
    }
  }
  if (best) return { subject: best, strip: bestStrip };
  return null;
}

/**
 * 자연어 한 줄 → 구조화된 캡처 의도.
 * @param raw      사용자가 친 원문
 * @param now      기준시각(주입) — 상대날짜 계산의 결정성 확보
 * @param subjects 알려진 항목명 목록(과목 매칭용, 선택)
 * @returns raw가 공백이면 null, 그 외엔 항상 CaptureResult(최소 title).
 */
export function parseCapture(raw: string, now: Date, subjects?: string[]): CaptureResult | null {
  if (!raw || !raw.trim()) return null;

  const result: CaptureResult = { title: '' };
  const strips: string[] = [];

  try {
    // 날짜
    const d = matchDate(raw, now);
    if (d) {
      result.dateISO = d.dateISO;
      result.dateLabel = d.label;
      strips.push(d.strip);
    }

    // 챕터
    const c = matchChapter(raw);
    if (c) {
      result.chapter = c.chapter;
      strips.push(c.strip);
    }

    // 과목
    if (subjects && subjects.length) {
      const sub = matchSubject(raw, subjects);
      if (sub) {
        result.subject = sub.subject;
        strips.push(sub.strip);
      }
    }
  } catch {
    // 견고성: 어떤 단계든 예외는 삼키고 최소 title만 반환.
  }

  // title — 매칭 substring을 긴 것부터 걷어내고 공백 정리. 비면 raw로 폴백.
  let title = raw;
  for (const st of strips.slice().sort((a, b) => b.length - a.length)) {
    title = stripOnce(title, st);
  }
  title = title.replace(/\s+/g, ' ').trim();
  result.title = title || raw.trim();

  return result;
}

/**
 * 여러 줄 → 다건 캡처(I-11). 각 줄을 parseCapture로 독립 파싱, 빈 줄·파싱 실패는 조용히 제외.
 * 배치 프리필(usePrefill.requestBatch)의 입력. now 주입으로 결정적.
 */
export function parseCaptureBatch(raw: string, now: Date, subjects?: string[]): CaptureResult[] {
  return (raw || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => parseCapture(l, now, subjects))
    .filter((x): x is CaptureResult => x !== null);
}

/* ── 캡처 → 보충 레코드(E2·E14 · 2026-07-29) ─────────────────────────────
   데스크톱 ⌘Enter 와 폰 캡처 바가 **같은 규칙**으로 같은 곳에 착지해야 한다(§9-4 — 화면은
   따로, 규칙은 lib). 두 화면이 각자 조립하면 어느 기기에서 담았느냐에 따라 레코드 모양이
   달라지고, 그 차이는 목록에서만 뒤늦게 보인다. */
export interface CaptureRecord {
  /** 매칭된 과목 id — 못 찾으면 ''(보충 스키마가 허용한다). */
  sid: string;
  /** 매칭된 과목명 — 못 찾으면 ''. */
  name: string;
  /** 토큰을 걷어낸 제목. */
  topic: string;
  /** 원문 — `topic` 이 이미 원문이면 ''(같은 글자를 두 칸에 넣지 않는다). */
  note: string;
}

/**
 * 파싱 결과 + 원문 → 보충 레코드 필드. 빈 입력이면 null.
 *
 * ⚠ **원문은 어느 칸에든 반드시 온전히 남는다.** 토큰을 전부 뽑았을 때 `parseCapture` 는
 * `title` 을 원문으로 폴백하므로(그 계약이 여기 전제다) `topic` 이 원문을 들고 `note` 는 빈다.
 * 일부만 뽑았으면 `topic` 은 남은 조각이라 `note` 가 원문을 든다. 어느 쪽이든 사용자가 친
 * 글자가 사라지는 경우는 없다 — 그것이 이 함수의 유일한 불변식이다.
 */
export function captureRecord(
  cap: CaptureResult | null,
  raw: string,
  subjects: readonly { id: string; name: string }[],
): CaptureRecord | null {
  const text = (raw || '').trim();
  if (!text) return null;
  const name = cap?.subject ?? '';
  const sid = name ? (subjects.find((i) => i.name === name)?.id ?? '') : '';
  const topic = (cap?.title || text).trim() || text;
  return { sid, name, topic, note: topic === text ? '' : text };
}

/**
 * 캡처 한 줄을 **보충 백로그에 담기까지** — 파싱·레코드 조립·저장을 한 함수로.
 *
 * ## 왜 이게 여기 있나 (G7 → H22 · 2026-08-01)
 *
 * 캡처 입구가 셋이다: ⌘K 팔레트 · 미니 HUD · 폰 캡처 바. `MiniHud` 는 오랫동안 자기 주석에
 * *"폰 캡처 바와 같은 함수"* 라 적고 있었는데 **사실이 아니었다**(G7 이 잡았다) — 폰은 레이어
 * 규약상 `@/shell` 을 못 물어 커밋 사슬을 **따로 갖고** 있었고, 공유되는 것은 레코드 조립까지였다.
 * 즉 세 입구 중 둘만 같은 함수였다. 캡처는 "떠올랐을 때 한 줄"을 받는 기능이라 결말이 갈리면
 * 그게 곧 조용한 데이터 손실이다(D-2·W8 이 같은 부류에 물렸다).
 *
 * ⚠ **경계 정책을 바꿀 일이 아니었다.** H22 는 이 수렴을 `hooks → shell/toast` 개방에 묶어
 * 뒀는데, 갈려 있던 것은 *데이터 경로*이고 그건 순수 lib 이다. 토스트를 쓸 자리가 없어서가
 * 아니라 **공통부가 lib 으로 안 내려와 있어서** 갈렸다.
 *
 * ⚠ **표시는 여기 없다** — 데스크톱은 되돌리기 토스트, 폰은 6초 인라인 확인 줄이다. 그 차이는
 * 드리프트가 아니라 표면의 차이다(폰엔 토스트 자리가 없다). 되돌리기용 `id` 만 돌려준다.
 */
export function fileCapture(state: AppState, raw: string, now: Date): { id: string; rec: CaptureRecord } | null {
  const items = state.items;
  const rec = captureRecord(
    parseCapture(
      raw,
      now,
      items.map((i) => i.name),
    ),
    raw,
    items,
  );
  if (!rec) return null;
  return { id: addBacklog(state, rec.sid, rec.name, rec.topic, rec.note), rec };
}
