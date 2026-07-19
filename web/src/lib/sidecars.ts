/* ============================================================
   sidecars.ts — 백업 범위 정정(0단계-E ③).
   문제: 내보내기 페이로드는 `exportSnapshot(AppState)` + `_reads` 두 갈래뿐인데,
   **AppState에도 reads에도 속하지 않는 로컬 저작물/설정이 4개** 있어 *어떤 백업에도 안 들어갔다*:
     · atlas.stars / atlas.notes  — 사용자가 직접 쓴 진로 메모·관심 표시(대체 불가 저작물)
     · lh:research-history        — 리서치 이력
     · lh_ui_v1                   — UI 환경설정(뷰·액센트·나브·최근명령)
   Tauri 이행(1단계)은 WebView2가 Chrome과 **별개 저장소 오리진**이라 수동 export→import가
   유일한 경로다 → 이 정정 없이 1단계로 넘어가면 아틀라스 메모가 영구 유실된다.

   계약(I1 백업 호환):
     · 새 백업의 `_local`은 **추가 키**다 — 구 앱은 모르는 키를 무시하므로 계속 읽힌다.
     · 구 백업엔 `_local`이 없다 — importLocalExtras가 조용히 no-op(복원 0건).
   `_reads`(lib/reads.ts)와 같은 사이드카 관용구지만, 저기는 IDB 미러·전용 스키마를 가진
   독립 데이터 레이어고 여기는 **평문 JSON KV 값의 통짜 보존**이라 층을 나눈다.
============================================================ */
import { storage } from './kv';
import { announce } from './sync';
import { UI_KEY } from './uiState';

/** 아틀라스 관심 표시(string[]) — features/atlas가 소비하는 키 SSOT. */
export const ATLAS_STARS_KEY = 'atlas.stars';
/** 아틀라스 분야별 내 메모(Record<key,string>) — 사용자의 대체 불가 저작물. */
export const ATLAS_NOTES_KEY = 'atlas.notes';
/** 리서치 실행 이력(HistEntry[]) — features/control이 소비. */
export const RESEARCH_HISTORY_KEY = 'lh:research-history';

/** 백업 페이로드의 사이드카 필드명. */
export const LOCAL_EXTRAS_FIELD = '_local';

/* 백업에 동봉할 KV 키 화이트리스트.
   화이트리스트인 이유: 가져오기는 **신뢰 불가 파일**이라 임의 키 쓰기를 허용하면
   백업 파일 하나로 앱 상태 키(study_planner_v3)나 손상 보존 키를 덮어쓸 수 있다. */
export const LOCAL_EXTRA_KEYS = [ATLAS_STARS_KEY, ATLAS_NOTES_KEY, RESEARCH_HISTORY_KEY, UI_KEY] as const;
export type LocalExtraKey = (typeof LOCAL_EXTRA_KEYS)[number];

/** 내보내기 — 저장된 키를 파싱해 값째로 담는다(원문 문자열이 아니라 JSON 값: 파일 가독성·안정성).
    미저장/손상 키는 조용히 생략(부분 백업이 전체 실패보다 낫다). */
export function exportLocalExtras(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of LOCAL_EXTRA_KEYS) {
    try {
      const raw = storage.getItem(k);
      if (raw == null) continue;
      out[k] = JSON.parse(raw);
    } catch {
      /* 미저장·파싱 실패 — 이 키만 건너뛴다 */
    }
  }
  return out;
}

/** 가져오기 — `_local` 블롭을 KV에 복원하고 복원된 키 목록을 반환.
    화이트리스트 밖 키는 무시한다. 형태가 아니면 빈 배열(throw X). */
export function importLocalExtras(v: unknown): LocalExtraKey[] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return [];
  const src = v as Record<string, unknown>;
  const restored: LocalExtraKey[] = [];
  for (const k of LOCAL_EXTRA_KEYS) {
    // hasOwn: 프로토타입 오염된 파일이 상속 속성으로 값을 흘리는 것 차단(serve.js 가드와 동형).
    if (!Object.hasOwn(src, k)) continue;
    const val = src[k];
    if (val === undefined) continue;
    try {
      storage.setItem(k, JSON.stringify(val));
      restored.push(k);
    } catch {
      /* 저장공간 가득 등 — 이 키만 실패 */
    }
  }
  // 복원값은 메모리에 이미 로드된 소비자(Atlas useState·Control useState·useUI)보다 새롭다.
  // 알리지 않으면 다음 편집이 **낡은 메모리 상태로 복원본을 덮어써 방금 되살린 데이터를 지운다**.
  // alsoLocal=true — 가져오기는 현재 탭에서 일어나는 화면 밖 경로다(_reads와 동일 관용구).
  if (restored.length) announce({ kind: 'local' }, true);
  return restored;
}
