/* ============================================================
   conflictView.ts — 충돌 그림자를 **사람이 읽는 형태로** 바꾸는 순수 규칙(H20 · 2026-07-30).

   ## 왜 lib 인가

   충돌 목록은 이제 **두 화면**이 그린다: 데스크톱 설정(`features/settings/ConflictsNotice`)과
   폰(`phone/ConflictsView`). C-6 의 결론이 _"화면은 따로, 규칙은 lib"_ 이고(설계서 §13-0),
   그 결론을 지키지 않으면 두 기기가 **같은 충돌을 다르게 설명**하게 된다 — 그리고 그 차이는
   아무 데도 안 적힌다(`syncLedger.ts` 가 같은 이유로 lib 에 있다).

   여기 있는 것은 라벨·미리보기·시각 표기뿐이다. **되살리기 자체는 `store/syncController` 가
   소유한다** — 검증된 병합 기계(`applyPull`)를 합성 배치로 재사용하는 그 경로가 테이블 무관
   안전성의 근거이고, 화면마다 다시 짜면 그 불변식을 두 번 구현하게 된다.
============================================================ */

/** 테이블 → 사람이 읽는 이름(모르는 테이블은 원래 이름 그대로 — 숨기지 않는다). */
const TBL_LABEL: Record<string, string> = {
  docs: '문서(독후감·노트)',
  completions: '완료 기록',
  settings: '설정',
  ds_map: '일자별 기록',
  records: '학습 기록',
  summaries: '요약',
  week_alloc: '주간 배분',
};

export function tableLabel(tbl: string): string {
  return TBL_LABEL[tbl] ?? tbl;
}

/** 행 값 배열 → 짧은 미리보기(원시값만이라 안전하게 문자열화 · `rows.ts` 계약). */
export function previewOf(data: unknown[], max = 90): string {
  const s = data
    .map((v) => (v == null ? '' : String(v)))
    .join(' · ')
    .trim();
  if (!s) return '(빈 값)';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** 감지 시각 → 짧은 한국어 표기(실패 시 빈 문자열 — 못 읽는 값을 지어내지 않는다). */
export function whenLabel(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** 되살리기 확인 문구 — 두 화면이 **같은 약속**을 하게 한다(한쪽만 파급을 안 말하면 안 된다). */
export const RESTORE_CONFIRM =
  '이 기기의 옛 값으로 되살릴까요? 지금 값(다른 기기 편집)을 덮어쓰고 다른 기기에도 반영돼요.';
