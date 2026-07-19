/* ============================================================
   durability.ts — 저장소 내구성(0단계-E ①②).
   문제: 앱이 `navigator.storage`를 한 번도 호출하지 않아 오리진 저장소가 **best-effort 등급**에
   머문다 — 브라우저가 디스크 압박 시 localStorage/IDB를 **예고 없이 축출**할 수 있고, 그러면
   앱 데이터(study_planner_v3)와 IDB 미러가 *동시에* 사라진다(미러가 같은 오리진에 있으므로
   복구층이 함께 증발 — idb.ts의 위협모델이 못 막는 유일한 경로).
   해결: ① 부팅 시 persist() 승격 요청 ② estimate()로 쿼터 80% 사전 경고.
   순수 IO만 — 토스트/문구는 호출부(app/StorageGuard)가 소유한다.
============================================================ */

/** 쿼터 경고 임계 — 이 비율을 넘으면 부팅 시 1회 안내. */
export const QUOTA_WARN_RATIO = 0.8;

export interface DurabilityReport {
  /** true=영속 승격됨 · false=best-effort(축출 가능) · null=API 미지원(판단 불가). */
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
  /** usage/quota. quota가 0이거나 미지원이면 null. */
  ratio: number | null;
}

const UNKNOWN: DurabilityReport = { persisted: null, usage: null, quota: null, ratio: null };

/** StorageManager 접근 — 미지원(구 브라우저·jsdom·비보안 컨텍스트)이면 null. */
function manager(): StorageManager | null {
  if (typeof navigator === 'undefined') return null;
  const sm = (navigator as Navigator).storage;
  return sm && typeof sm === 'object' ? sm : null;
}

/** 저장소를 영속 등급으로 승격 요청.
    이미 영속이면 재요청하지 않는다(persist()는 멱등하지만 일부 브라우저에서 권한 UI를 유발). */
async function requestPersist(sm: StorageManager): Promise<boolean | null> {
  try {
    if (typeof sm.persisted === 'function' && (await sm.persisted())) return true;
    if (typeof sm.persist !== 'function') return null;
    return await sm.persist();
  } catch {
    return null; // 권한 거부·비보안 컨텍스트 — 판단 불가로 처리(앱은 정상 동작)
  }
}

/** 사용량/쿼터 추정. 미지원이거나 실패면 전부 null. */
async function readEstimate(sm: StorageManager): Promise<Pick<DurabilityReport, 'usage' | 'quota' | 'ratio'>> {
  if (typeof sm.estimate !== 'function') return { usage: null, quota: null, ratio: null };
  try {
    const { usage, quota } = await sm.estimate();
    const u = typeof usage === 'number' ? usage : null;
    const q = typeof quota === 'number' ? quota : null;
    // quota 0 나눗셈 방지 — 0이면 비율이 무의미(Infinity/NaN)하므로 판단 불가로 둔다.
    return { usage: u, quota: q, ratio: u != null && q != null && q > 0 ? u / q : null };
  } catch {
    return { usage: null, quota: null, ratio: null };
  }
}

/** 부팅 1회 호출 — 영속 승격 + 쿼터 추정을 한 번에. 어떤 경로로도 throw하지 않는다. */
export async function ensureDurableStorage(): Promise<DurabilityReport> {
  const sm = manager();
  if (!sm) return UNKNOWN;
  // 병렬 — estimate는 persist 결과와 무관하고, 부팅 경로라 왕복 하나라도 아낀다.
  const [persisted, est] = await Promise.all([requestPersist(sm), readEstimate(sm)]);
  return { persisted, ...est };
}

/** 쿼터 임계 초과 여부(경고 게이트). ratio를 모르면 경고하지 않는다(오탐 금지). */
export function isQuotaTight(r: DurabilityReport): boolean {
  return r.ratio != null && r.ratio >= QUOTA_WARN_RATIO;
}

/** 바이트 → 사람이 읽는 크기(경고 문구용). */
export function fmtBytes(n: number): string {
  if (!isFinite(n) || n < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)}${units[i]}`;
}
