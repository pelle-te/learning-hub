/* ============================================================
   shell/vt.ts — **전이의 방향 문법**(D-8 · 순수).

   `motion.css` 는 root 하나에 140/180ms 크로스페이드를 걸고 끝이었다. 그래서
   today→stats(**옆으로**) · schedule→items(**안으로**) · today→review-run(**몰입**) 셋이
   픽셀 단위로 동일했다 — 화면이 바뀌는 방식이 "어디로 갔는지"를 하나도 말해 주지 않았다.
   공간감은 장식이 아니라 **위치 감각**이다: 안으로 들어갔으면 나오는 길이 있다고 느껴야 한다.

   말은 셋뿐이다(모션 어휘의 `transit` · SSOT 는 `lib/motion.ts`):

   · `lateral` — 형제 도달점 사이(오늘 ↔ 통계). 방향(`fwd`/`back`)은 **`tabs.ts` 의 order 대소**.

   ⚠ 위치가 `shell/` 인 이유: 판정 재료가 전부 탭 레지스트리(`shell/tabs.ts`)다. `lib/` 에 두면
     lib → shell 역방향 의존이 생긴다(레이어 절대규칙 #2).
   · `descend` — 호스트 → 그 안의 조망(계획 → 과목). 반대 방향은 `ascend`.
   · `immerse` — 몰입 화면(복습 러너). 나올 때는 `ascend`.

   ⚠ **판정을 손으로 적지 않는다.** 방향은 `tabs.ts` 의 `order`·`SUBTAB_GROUPS` 에서 나온다 —
     탭을 옮기면 전이가 따라오고, "왜 이 화면만 다르게 움직이나" 하는 특례가 안 생긴다.
   ⚠ 호출부는 한 줄도 안 바뀐다(`navigate(to, {viewTransition:true})` 22곳 그대로). App 의
     레이아웃 이펙트가 경로 변화를 보고 `<html data-vt>` 를 세우고, CSS 가 그것을 읽는다.
============================================================ */
import { hostTabKey, tabByKey } from './tabs';

export type VtKind = 'lateral' | 'descend' | 'ascend' | 'immerse';
export interface VtMove {
  kind: VtKind;
  /** `lateral` 일 때만 — 순서상 앞으로(`fwd`) 갔는지 뒤로(`back`) 갔는지. */
  dir?: 'fwd' | 'back';
}

/** 몰입 화면 — 들어가면 세상이 닫히고, 나오면 열린다. 지금은 복습 러너 하나뿐이다
 *  (팔레트·모달은 라우트가 아니라 오버레이라 자기 애니를 갖는다). */
const IMMERSE = new Set(['review-run']);

/** 경로 → 기저 탭 key(중첩 라우트 `/atlas/:key` 는 `atlas`).
 *  ⚠ 쿼리·해시를 먼저 떼어낸다 — `/items?focus=x` 를 남의 탭으로 읽으면 **제자리 이동에
 *  방향이 붙어** 같은 화면이 옆에서 밀려 들어온다(딥링크가 이 앱에서 아주 잦다). */
function keyOf(path: string): string {
  return path.split(/[?#]/)[0]!.split('/')[1] || 'today';
}
const orderOf = (key: string): number => tabByKey(key)?.order ?? 0;

/** 두 경로 사이의 전이가 무슨 말을 해야 하는가. 같은 탭 안의 이동이면 `lateral`(방향 없음). */
export function vtMove(from: string, to: string): VtMove {
  const f = keyOf(from);
  const t = keyOf(to);
  if (f === t) return { kind: 'lateral' }; // 같은 탭 안(쿼리·중첩 라우트) — 방향을 지어내지 않는다
  if (IMMERSE.has(t)) return { kind: 'immerse' };
  if (IMMERSE.has(f)) return { kind: 'ascend' };

  const fh = hostTabKey(f);
  const th = hostTabKey(t);
  if (fh === th) {
    // 같은 호스트 안 — 호스트에서 조망으로 들어가면 descend, 그 반대는 ascend, 조망끼리는 lateral.
    if (f === fh) return { kind: 'descend' };
    if (t === th) return { kind: 'ascend' };
    return { kind: 'lateral', dir: orderOf(t) >= orderOf(f) ? 'fwd' : 'back' };
  }
  return { kind: 'lateral', dir: orderOf(th) >= orderOf(fh) ? 'fwd' : 'back' };
}
