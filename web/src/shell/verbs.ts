/* ============================================================
   shell/verbs.ts — **⌘K 의 객체·동사 카탈로그**(2026-08-20 리뷰 m-18).

   ## 왜 `actions.ts` 에서 나왔나

   그 파일은 머리주석이 "데이터·백업·테마"라 말하는데 실제로는 여섯 가지를 들고 있었고, 그중
   하나가 **사용자 명령 카탈로그**였다. 그래서 이 저장소엔 카탈로그가 **둘**이었다 —
   `shell/palette.ts` 의 `PaletteCommand[]`(탭 이동·액션)과 여기 `HitVerb[]`(객체 위의 동사).
   둘 다 `app/CommandPalette` 하나가 소비하는데 서로를 모르고 각자 다른 파일에 살았다.

   ⚠ **그 자리가 중복이 자라던 곳이다**: 주간 배정 레버가 화면·팔레트·⌘K 세 벌로 복제돼 있던
   M-9 의 사본 하나가 정확히 이 파일의 `planVerbs` 였다(지금은 `lib/weekAlloc.applyWeeklyHours`
   가 소유한다). 카탈로그를 팔레트 옆에 두면 다음 동사가 어디에 사는지 물을 필요가 없다.

   ## ⚠ 규율은 그대로다 — **새 동사를 짓지 않는다**

   여기 있는 동사는 전부 이미 화면에 있는 버튼이고, 근거는 아래 각 블록 주석이 진다.
============================================================ */
import { useApp } from '@/store/useApp';
import { usePrefill } from '@/store/prefill';
import { semanticSearch, semanticAvailable, type SemHit } from '@/lib/semantic';
import { addBacklog, toggleBacklog } from '@/lib/methodology';
import { applyWeeklyHours } from '@/lib/weekAlloc';
import { contentSearch as searchContent, type ContentHit } from '@/lib/contentSearch';
import { PROMOTE_TOAST } from '@/lib/promote';
import { openVaultSearch, vaultQuery } from '@/lib/utils';
import { fileCapture } from '@/lib/quickCapture';
import { toast, toastUndoable } from './toast';

const st = () => useApp.getState();

export function captureSubjects(): { id: string; name: string }[] {
  return st().state.items.map((i) => ({ id: i.id, name: i.name }));
}

/** ⌘K 의미 검색 — store 스냅샷을 lib/semantic에 위임
   (components→store 금지 경계: 팔레트는 이 shell 표면만 부른다). Ollama 불가면 []. */
export function semanticPalette(query: string): Promise<SemHit[]> {
  if (!semanticAvailable()) return Promise.resolve([]);
  return semanticSearch(query, st().state);
}

/* ⚠ `ContentHit` 은 **`lib/contentSearch` 가 소유한다**(H15). 여기서는 기존 소비처(`shell` 배럴·
   `CommandPalette`)의 import 경로를 깨지 않기 위해 재수출만 한다. */
export type { ContentHit } from '@/lib/contentSearch';

/* ── N-1 명사→동사 ────────────────────────────────────────────────────────
   ⌘K 는 **찾아주고 데려다만 줬다**. `ContentHit` 은 4필드였고 `onSelect` 는
   `close(); navigate()` 가 전부라, "이 약점을 보충에 담기"는 팔레트에서 찾은 뒤 화면을
   옮겨 다시 그 항목을 찾아 버튼을 누르는 4클릭이었다.

   ## ⚠ 규율: **새 동사를 짓지 않는다**

   여기 있는 동사는 전부 **이미 화면에 있는 버튼**이다 — 요약·오답 프리필(오늘 탭 블록
   버튼과 같은 경로) · 보충에 담기(`Review.tsx` I-1 의 `addBacklog`+토스트 그대로) ·
   볼트 열기(5개 feature 의 `openVaultSearch`) · 보충 완료(`BacklogCard` 의 `toggleBacklog`).
   이 규율을 어기는 순간 팔레트가 **두 번째 IA** 가 되고, 어느 쪽이 진짜인지 모르게 된다.

   ## ⚠ 프리필에 `sid` 를 넘기는 것이 이 항목의 절반이다

   팔레트의 `act:add-sum`·`act:add-cbms` 는 `request(form, '')` 로 **과목을 빈 채** 넘겼다.
   즉 키보드 경로가 마우스보다 못했다(오늘 탭 버튼은 그 블록의 과목을 채워 준다). 객체
   위에서 부르는 동사는 그 객체를 안다 — 같은 폼이 채워진 채로 열린다. */
export interface HitVerb {
  id: string;
  label: string;
  hint: string;
  run: () => void;
  /** 실행 후 이동할 라우트(없으면 제자리 — 볼트 열기·보충 완료가 그렇다). */
  to?: string;
}

/* ── Q-19 계획 동사 ─────────────────────────────────────────────────────────
   여기 오기 전까지 `verbsFor` 의 동사는 **전부 기록 동사**였다(요약·오답·보충·볼트). 즉 팔레트에서
   약점을 찾아도 할 수 있는 일은 *적는 것*뿐이고, 계획을 바꾸려면 화면을 옮겨야 했다 — 그런데
   발산이 짚은 수렴 ①이 정확히 그것이다(_"앱은 계산하는 것보다 결과가 적다"_).

   ⚠ **새 동사를 짓지 않았다.** `+1h` 는 `Review.tsx` 의 E-4 레버 그대로이고(식은 이제 둘이 공유하는
   `lib/weekAlloc.bumpWeeklyHours`), `이번 주 쉼` 은 **이미 있는 상태에 이름을 준 것**이다 —
   `weeklyHours = 0` 은 스케줄러가 이미 "이번 주 제외"로 읽는 값이다(`weekAlloc.isUnschedulable`).
   없던 개념을 만들었다면 이 동사는 팔레트를 두 번째 IA 로 만들었을 것이다.
   ⚠ `mode === 'daily'` 과목엔 안 붙는다 — 그 레버 자체가 없다(`Review.tsx` 의 `leverFor` 와 같은
   판정). 없는 레버를 팔레트에서만 보이게 하면 눌렀을 때 아무 일도 안 일어난다. */
function weeklyItem(sid: string): { id: string; name: string; weeklyHours?: number } | null {
  const it = st().state.items.find((x) => x.id === sid);
  return it && it.mode !== 'daily' ? it : null;
}

function planVerbs(sid: string, subject: string): HitVerb[] {
  const it = sid ? weeklyItem(sid) : null;
  if (!it) return [];
  const name = subject || it.name || '과목';
  /* M-9 — 찾기·하한·daily 가드는 전부 `lib/weekAlloc.applyWeeklyHours` 가 소유한다.
     ⚠ 종전 "이번 주 쉼"은 `setWeekly(0)` 으로 그 함수를 건너뛰어 **하한 계약이 한 호출부에서만**
     강제됐다 — `{ set: 0 }` 가지가 그 어휘를 되돌려 놓는다. */
  const verbs: HitVerb[] = [
    {
      id: 'v:allot',
      label: '주간 배정 +1h',
      hint: '계획',
      run: () => {
        st().mutate((s) => void applyWeeklyHours(s, it.id, { delta: 1 }));
        toastUndoable(`"${name}" 주간 배정 +1h`);
      },
    },
  ];
  /* 이미 0 이면 "쉼"은 아무것도 바꾸지 않는다 — 바뀌지 않는 동사를 보여 주는 것은
     `verbsFor` 가 빈 배열일 때 단계를 안 여는 것과 같은 이유로 틀렸다. */
  if ((it.weeklyHours || 0) > 0)
    verbs.push({
      id: 'v:rest',
      label: '이번 주 쉼',
      hint: '계획',
      run: () => {
        st().mutate((s) => void applyWeeklyHours(s, it.id, { set: 0 }));
        toastUndoable(`"${name}" 이번 주 배정 0h`);
      },
    });
  return verbs;
}

/** 보충 담기 — `Review.tsx` 의 I-1 경로(addBacklog + 승격 토스트)를 그대로 승격한 것. */
function seedBacklog(sid: string, name: string, topic: string, note: string): void {
  st().mutate((s) => addBacklog(s, sid, name, topic, note));
  toast(PROMOTE_TOAST, 'ok');
}

/**
 * 히트 위에서 쓸 수 있는 동사들. 빈 배열이면 팔레트가 동사 단계를 열지 않는다
 * (열어 놓고 "없음"을 보여 주는 것은 키를 배운 사람에게 벌을 주는 것이다).
 */
export function verbsFor(hit: ContentHit): HitVerb[] {
  const subject = hit.subject ?? '';
  const chapter = hit.chapter ?? '';
  const sid = hit.sid ?? '';
  /* 볼트 질의 — **`lib/utils.vaultQuery` 하나가 소유한다**(H14 · 2026-08-01).
     여기 있던 주석은 *"`Mistakes.tsx` 가 같은 폴백을 쓴다"* 라고 적었는데 그쪽은
     `chapter || subject` 라 **정반대**였다(챕터가 있으면 과목을 버린다). 사본이 5벌이고
     주석이 그것들을 같다고 말하는 상태였다. */
  const q = vaultQuery(subject, chapter);
  const openVault: HitVerb = {
    id: 'v:vault',
    label: '볼트에서 열기',
    hint: 'Obsidian',
    run: () => openVaultSearch(q),
  };

  switch (hit.kind) {
    case 'subject':
    case 'chapter':
      return [
        {
          id: 'v:sum',
          label: '3문장 요약 남기기',
          hint: '기록',
          run: () => usePrefill.getState().request('sum', sid),
          to: '/day',
        },
        {
          id: 'v:cbms',
          label: '오답(CBMS) 기록',
          hint: '기록',
          // 보충 폼과 달리 요약 폼엔 챕터 칸이 없다 — 챕터는 CBMS 로만 넘긴다(runQuickCapture 와 같은 판단).
          run: () => usePrefill.getState().request('cbms', sid, '', chapter),
          to: '/day',
        },
        {
          id: 'v:bl',
          label: '보충에 담기',
          hint: '보충',
          run: () => seedBacklog(sid, subject || hit.label, chapter || subject || hit.label, ''),
        },
        ...planVerbs(sid, subject),
        openVault,
      ];
    case 'weak':
      /* 약점은 **이미 진단된 것**이라 처방이 먼저다 — 발산이 든 대표 사례
         ("리뷰 약점→보충 = 4클릭+스크롤+화면전환 1"). 순서가 곧 권고다. */
      return [
        {
          id: 'v:bl',
          label: '보충에 담기',
          hint: '처방',
          run: () => seedBacklog(sid, '반복 약점', `${subject} — ${chapter}`, '2회 이상 막힌 지점 — 백지로 인출'),
        },
        /* 약점 위에서는 계획 동사가 **기록보다 앞이다** — 이미 진단된 것이라 처방이 먼저라는
           그 순서 규율(위 주석)의 연장이고, `+1h` 는 보충보다도 직접적인 처방이다. */
        ...planVerbs(sid, subject),
        {
          id: 'v:cbms',
          label: '오답(CBMS) 기록',
          hint: '기록',
          run: () => usePrefill.getState().request('cbms', sid, '', chapter),
          to: '/day',
        },
        openVault,
      ];
    case 'backlog':
      return [
        {
          id: 'v:done',
          label: '보충 완료 처리',
          hint: '보충',
          run: () => {
            if (!hit.blId) return;
            st().mutate((s) => toggleBacklog(s, hit.blId!));
            toast('보충을 닫았어요.', 'ok');
          },
        },
      ];
    default:
      return [];
  }
}

/** ⌘K 오프라인 통합 검색 — **엔진은 `lib/contentSearch` 가 소유한다**(H15). 여기 남는 것은
    스토어 스냅샷을 채우는 한 줄뿐이다(`components→store` 금지 경계상 팔레트는 이 셸 표면을 부른다). */
export function contentSearch(query: string, limit = 8): ContentHit[] {
  return searchContent(query, st().state, limit);
}

/* ── E2 캡처는 **언제나 커밋한다**(2026-07-29) ─────────────────────────────
   종전엔 같은 ⌘Enter 가 입력에 따라 두 갈래로 갈렸다:

   · 파서가 아무것도 못 뽑은 **생 문장** → `addBacklog` 로 **즉시 저장**
   · 파서가 토큰을 뽑은 **구조화 입력** → 기록 탭으로 화면을 옮기고 **폼만 프리필**

   그래서 "내일 3시 전자기 3장 복습"을 치고 ⌘Enter 하면 **아무것도 저장되지 않았다** — 사람이
   폼을 확인하고 다시 저장해야 했고, 그러지 않으면 친 글자가 통째로 사라졌다(프리필은 과목·날짜만
   나른다). **입력이 정교할수록 결말이 나쁜 역전**이고, 캡처는 정확히 그 반대여야 하는 기능이다.

   ⚠ 착지가 보충인 것은 D-2 가 이미 내린 판단 그대로다 — _"텍스트를 그대로 보존하는 backlog 가
   유일하게 정직한 목적지"_. 달라진 것은 **구조화 입력도 같은 곳에 착지한다**는 것과, 파싱 결과를
   버리지 않고 함께 싣는다는 것이다(과목 → `sid`·`name`, 나머지 토큰을 걷어낸 제목 → `topic`,
   **원문 전체 → `note`**). 종전에 저 넷은 화면 하나를 열고 사라졌다.
   ⚠ **화면을 옮기지 않는다.** 캡처는 떠올랐을 때 쓰는 것이라 문맥 이탈이 곧 비용이다. 담은 것은
   기록 탭 보충 목록에서 인라인 편집(`editBacklog`)으로 고칠 수 있으므로 "열어서 고치기" 경로는
   그대로 살아 있다 — 다만 **기본값이 아니게** 됐다.
   ⚠ 되돌리기가 짝이다: 파서가 잘못 뽑으면 곧 잘못된 레코드다. 그 짝은 이제 **전역 ⌘Z** 이고
   (근본① · 2026-08-01) 6.5초 창이 아니다 — 캡처는 "떠올랐을 때" 쓰는 것이라, 되돌릴 수 있는
   시간이 *다른 창으로 넘어가기 전까지*로 잘려 있는 것이 이 기능의 목적과 정면으로 어긋났다. */
export function commitCapture(raw: string, summary: string): void {
  /* ⚠ 파싱부터 저장까지 **lib 이 소유한다**(`fileCapture`) — 폰 캡처 바와 *같은 함수*여야 한다.
     종전엔 여기와 `phone/CaptureBar` 가 각자 조립·저장했고, 그래서 `MiniHud` 주석의 "같은 함수"가
     거짓이었다(G7). 여기 남는 것은 **표시**뿐이다(확인 토스트). */
  let out: { topic: string } | null = null;
  st().mutate((s) => {
    const r = fileCapture(s, raw, new Date());
    if (r) out = { topic: r.rec.topic };
  });
  if (!out) return;
  const { topic } = out as { topic: string };
  toastUndoable('보충에 담았어요 — ' + (summary || topic));
}

/* ── 볼트 과목 임포트 — **W4 규칙의 단일 원천**(H22 · 2026-08-01) ─────────────────────

⚠ 종전엔 이 28줄이 `features/items/VaultImport` 와 `features/integrations/VaultPanel` 에
**사본 둘**로 있었다. 임포트 입구가 둘인 것은 의도지만(과목 탭에서도, 연동 탭에서도 볼트를
붙일 수 있다) **규칙이 둘인 것은 아니다** — 특히 W4(원장이 "카드까지 갔다"고 아는 챕터를
자동으로 찍지 않고 한 번 묻는다)는 한쪽만 고쳐지면 조용히 갈린다.

⚠ **감사(H22)는 이걸 "`hooks/` 로 승격할 자리가 없다"로 묶어 뒀는데 그건 오진이었다.**
이 함수가 필요로 하는 것은 스토어(`mutate`·`items`)와 UI(토스트·confirm)이고, 그 둘을 엮는
자리가 바로 여기(액션 표면)다 — 레이어 계약 변경 없이 처음부터 올 수 있었다. 훅이 아니라서
훅 레이어에 자리가 없던 것이다.

⚠ `ledger` 를 인자로 받는 이유: 원장은 TanStack 쿼리라 구독은 컴포넌트의 일이다. 여기서
캐시를 직접 들추면 "누가 원장을 읽는가"가 두 곳이 된다.
⚠ `tail` 은 화면마다 다른 **길 안내**다(과목 탭에서는 "여기서 조정", 연동 탭에서는 "학습 항목
탭에서 조정"). 규칙이 아니라 문맥이라 갈리는 것이 맞다. */
