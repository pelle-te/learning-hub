/* ============================================================
   observations.ts — **기기-로컬 관측 원장의 백업 범위**(H-14 · 2026-08-06 감사).

   ## 무엇이 빠져 있었나

   `route_visits`(N-11 · 어느 화면을 언제 몇 번 열었나)와 `day_signals`(E23 · 그날의 밀림·대기
   스냅샷)는 **클라우드로 동기화하지 않는다.** 그건 의도다 — 기기마다 다른 관측이고, 합치면
   "이 기기에서 안 쓰는 탭"이라는 판정 자체가 성립하지 않는다(`sidecars.ts` 가 KV 를 나눈 것과
   같은 층 분리).

   그런데 **내보내기에도 없었다.** 그 둘은 다른 이야기다: 동기화는 *기기 간 합침*이고 백업은
   *같은 기기의 연속성*이다. 재설치·오리진 이동(WebView2 ↔ 브라우저)·PC 교체에서 이 원장이
   0 이 되면, 그것을 기다리는 로드맵 판정 일곱(탭 은퇴 표본 게이트 · `markets` 삭제 · '정적의
   설계' 착수 게이트 …)이 **처음부터 다시** 쌓아야 한다. 그리고 게이트가 관측일 10·방문 30이라
   그 대기는 몇 주다.

   ## 계약

   · 백업 필드는 `_obs` — `_reads`·`_local` 과 같은 **추가 키** 관용구다(구 앱은 모르는 키를
     무시하고, 구 백업엔 이 키가 없어 가져오기가 조용히 no-op).
   · 복원은 **행 단위 upsert**이고 방문 수는 `MAX` 로 합친다 — 가져오기가 현재 기기의 더 큰
     관측을 깎으면 그건 복원이 아니라 손실이다.
   · DB 가 없으면(브라우저·dev·트랙 A) 내보내기는 빈 값, 가져오기는 0건이다. 조용히 실패하지만
     **원장이 애초에 없는 환경**이라 잃을 것이 없다(그 판단이 `sidecars` 의 미저장 키 처리와 같다).
============================================================ */
import { execDb, isDbAvailable, selectDb } from './db/sqlite';

/** 백업 페이로드의 관측 원장 필드명. */
export const OBSERVATIONS_FIELD = '_obs';

interface VisitRow {
  key: string;
  day: string;
  via: string;
  n: number;
}
interface SignalRow {
  ds: string;
  pending: number;
  overdue: number;
  backlog: number;
  anki_due: number;
  due_soon: number;
}
export interface Observations {
  visits: VisitRow[];
  signals: SignalRow[];
}

/** 내보내기 — 두 표를 통째로 담는다(둘 다 상한이 있어 크기가 유계다: 방문 90일·신호 90일). */
export async function exportObservations(): Promise<Observations> {
  if (!(await isDbAvailable())) return { visits: [], signals: [] };
  const visits = (await selectDb<VisitRow>('SELECT key, day, via, n FROM route_visits')) ?? [];
  const signals =
    (await selectDb<SignalRow>('SELECT ds, pending, overdue, backlog, anki_due, due_soon FROM day_signals')) ?? [];
  return { visits, signals };
}

/** 형태 가드 — 신뢰 불가 파일이므로 행마다 확인한다(하나가 이상해도 나머지는 복원한다). */
const 수 = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const 글자 = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * 가져오기 — `_obs` 블롭을 두 표에 복원하고 **복원한 행 수**를 돌려준다.
 *
 * ⚠ 방문 수는 `MAX(기존, 들어온 값)` 다. 백업이 현재 기기보다 오래됐을 때 덮어쓰면 지금 기기의
 * 관측이 깎이고, 그러면 이 원장이 재는 "충분히 봤는가"가 **뒤로 간다**(게이트가 영영 안 열린다).
 * 신호는 그날의 스냅샷 하나라 마지막 값이 이긴다(같은 날짜의 두 관측은 같은 사실을 잰다).
 */
export async function importObservations(v: unknown): Promise<number> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 0;
  if (!(await isDbAvailable())) return 0;
  const src = v as Partial<Observations>;
  let n = 0;
  for (const r of Array.isArray(src.visits) ? src.visits : []) {
    const key = 글자(r?.key);
    const day = 글자(r?.day);
    if (!key || !day) continue;
    const ok = await execDb(
      `INSERT INTO route_visits (key, day, via, n) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(key, day, via) DO UPDATE SET n = MAX(n, excluded.n)`,
      [key, day, 글자(r?.via), 수(r?.n)],
    );
    if (ok) n += 1;
  }
  for (const r of Array.isArray(src.signals) ? src.signals : []) {
    const ds = 글자(r?.ds);
    if (!ds) continue;
    const ok = await execDb(
      `INSERT INTO day_signals (ds, pending, overdue, backlog, anki_due, due_soon)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(ds) DO UPDATE SET pending = excluded.pending, overdue = excluded.overdue,
           backlog = excluded.backlog, anki_due = excluded.anki_due, due_soon = excluded.due_soon`,
      [ds, 수(r?.pending), 수(r?.overdue), 수(r?.backlog), 수(r?.anki_due), 수(r?.due_soon)],
    );
    if (ok) n += 1;
  }
  return n;
}
