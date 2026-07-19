/* ============================================================
   sync.ts — 멀티탭 동기화(BroadcastChannel).
   문제: 두 탭이 같은 localStorage 스냅샷을 last-writer-wins로 덮어써 서로의 편집을 유실했다
   (A탭 완료 체크 → B탭 전환 → B의 낡은 flush가 체크를 지움). 해결: 저장한 탭이 방송하면
   다른 탭이 그 스냅샷을 채택한다 — 유실이 사라지고, 보조 모니터 '대시보드 모드'가 공짜로 생긴다.
   BroadcastChannel은 보낸 탭 자신에게는 배달되지 않는다(메아리 루프 없음). 미지원 환경(jsdom 등)은
   조용히 no-op. 순수 pub/sub만 — 상태 채택 정책(미저장 편집 우선 등)은 구독자(useApp)가 정한다.
============================================================ */

/** 'local' = 사이드카 KV(아틀라스 메모·리서치 이력·UI 설정)가 밖에서 교체됨(가져오기 복원).
    구독자는 메모리 상태를 KV에서 다시 읽어야 한다 — 안 하면 다음 편집이 복원본을 덮는다. */
export type SyncMsg = { kind: 'app' } | { kind: 'reads' } | { kind: 'local' };
const KINDS: readonly SyncMsg['kind'][] = ['app', 'reads', 'local'];

const CHANNEL = 'lh-sync';
const listeners = new Set<(m: SyncMsg) => void>();
let bc: BroadcastChannel | null = null;
let tried = false;

function ensure(): void {
  if (tried) return;
  tried = true;
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    bc = new BroadcastChannel(CHANNEL);
    bc.onmessage = (e: MessageEvent) => emit(e.data as SyncMsg);
  } catch {
    bc = null;
  }
}

function emit(m: SyncMsg): void {
  if (!m || !KINDS.includes(m.kind)) return;
  listeners.forEach((fn) => {
    try {
      fn(m);
    } catch {
      /* 구독자 오류가 다른 구독자를 막지 않게 */
    }
  });
}

/** 동기화 이벤트 구독. 반환값을 호출하면 해지. */
export function onSync(fn: (m: SyncMsg) => void): () => void {
  ensure();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 변경 방송 — 다른 탭에게 "localStorage에 방금 썼다"를 알린다.
    alsoLocal=true면 같은 탭 구독자에게도 비동기로 전달(가져오기 등 외부 경로가 현재 화면을 갱신할 때).
    비동기인 이유: 저장이 React 상태 갱신 함수 안에서 불릴 수 있어, 동기 재진입 setState를 피한다. */
export function announce(m: SyncMsg, alsoLocal = false): void {
  ensure();
  try {
    bc?.postMessage(m);
  } catch {
    /* 채널 닫힘 등 — 동기화는 보강 기능이라 실패해도 앱은 정상 */
  }
  if (alsoLocal) queueMicrotask(() => emit(m));
}
