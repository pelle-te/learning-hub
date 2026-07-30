/* ============================================================
   knowledge.ts — 지식상태(_지식상태.json) 소비 — 서버/외부 데이터(프레임워크 무관).
   원본 둘: ① 산출물 `knowledge`(지식엔진.py 산출 · 셸이 읽는다) ② 볼트 폴더의
   _meta/cache/_지식상태.json(FS Access). 둘 다 같은 Knowledge 모양을 돌려준다.
   TanStack Query가 캐시/로딩/에러를 소유(설계도 §1-B). 서버 JSON이라 필드는 느슨(전부 옵셔널).
============================================================ */
import { getArtifact } from './api';
import { parseArtifact } from './artifacts';

export interface KnowledgeConcept {
  title?: string;
  basename?: string;
  p_eff: number;
  state: string;
  weak?: boolean;
  frontier?: boolean;
  root_cause?: string;
}
export interface KnowledgeSubject {
  subject: string;
  /** 과목 평균 유효숙달. `null` = 이 과목에 관측 0건(measured=0) — 전부 사전분포라 평균이 사실이 아니다(부모 ②#54 사전분포 검역). */
  mastery: number | null;
  /** 실제 관측(evidence>0)이 있는 노트 수 — `mastery`가 측정인지 prior인지 가르는 분모. */
  measured?: number;
  n?: number;
  weak?: number;
  unknown?: number;
  concepts?: KnowledgeConcept[];
}
export interface KnowledgeFrontier {
  title?: string;
  basename?: string;
  subject?: string;
  prereq_in?: number;
}
export interface KnowledgeGap {
  title?: string;
  basename?: string;
  subject?: string;
  p_eff: number;
  root_cause?: string;
}
export interface KnowledgeCalibration {
  n_errors?: number;
  confident_wrong?: number;
  overconfidence_rate?: number;
  blank_total?: number;
  blank_pass?: number;
  blank_pass_rate?: number;
}
export interface Knowledge {
  generated?: string;
  n_notes?: number;
  /** 전체 평균 유효숙달. `null` = 사전분포 검역 중(증거덮개율 < 임계) — 숫자를 짓지 않는다. `evidence_coverage` 를 함께 읽어라. */
  overall?: number | null;
  /** 부모 ②#54 검역 상태 — measured/total/pct/threshold_pct/quarantined/note. */
  evidence_coverage?: {
    measured?: number;
    total?: number;
    pct?: number;
    threshold_pct?: number;
    quarantined?: boolean;
    note?: string;
  };
  states?: { mastered?: number; learning?: number; weak?: number; unknown?: number };
  subjects?: KnowledgeSubject[];
  frontier?: KnowledgeFrontier[];
  gaps?: KnowledgeGap[];
  calibration?: KnowledgeCalibration;
}

/** 약점의 근본원인(선수개념) 롤업 — 같은 root_cause가 몇 개 약점의 뿌리인지 내림차순(self·무근원 제외).
   프런티어의 prereq_in('이걸 배우면 N개가 풀린다')의 약점판 미러 — 가장 많은 약점의 뿌리를 먼저 메우면
   상류가 함께 풀린다(지식엔진 설계 B). 이미 페치된 k.gaps만 사용(신규 IO 0). */
export function rootCauseRollup(k: Knowledge | undefined, cap = 5): { cause: string; count: number }[] {
  const m = new Map<string, number>();
  (k?.gaps || []).forEach((g) => {
    const rc = g.root_cause;
    if (!rc || rc === 'self') return;
    m.set(rc, (m.get(rc) || 0) + 1);
  });
  return [...m.entries()]
    .map(([cause, count]) => ({ cause, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, cap);
}

/** 다음에 배울 프런티어 1개(I-8) — prereq_in('이걸 배우면 N개가 풀린다') 최대인 개념. 매몰자산 최대 해제.
   frontier 배열은 지식엔진이 이미 산출(신규 IO 0). 후보 없으면 null. */
export function frontierNext(k: Knowledge | undefined): KnowledgeFrontier | null {
  const f = (k?.frontier || []).filter((x) => x.title || x.basename);
  if (!f.length) return null;
  return [...f].sort((a, b) => (b.prereq_in || 0) - (a.prereq_in || 0))[0]!;
}

/** 산출물(읽기 전용) — 없으면 throw(Query isError로 폴백 안내). */
export async function fetchKnowledgeArtifact(): Promise<Knowledge> {
  const j = await getArtifact<Knowledge>('knowledge');
  if (!j || !j.ok || !j.data) throw new Error('지식상태 산출물(knowledge)을 찾지 못했어요.');
  parseArtifact('knowledge', j.data); // 버전 + 모양 드리프트 경고(비차단)
  return j.data;
}

/** 볼트 폴더에서 _meta/cache/_지식상태.json 로드 — 못 찾으면 null(아직 build 안 함). */
export async function loadKnowledgeStateFromVault(handle: FileSystemDirectoryHandle): Promise<Knowledge | null> {
  try {
    const meta = await handle.getDirectoryHandle('_meta');
    const aud = await meta.getDirectoryHandle('cache'); // P7 Phase 3: 감사→cache(파생)
    const fh = await aud.getFileHandle('_지식상태.json');
    const k = JSON.parse(await (await fh.getFile()).text()) as Knowledge;
    parseArtifact('knowledge', k); // 버전 + 모양 드리프트 경고(비차단)
    return k;
  } catch {
    return null;
  }
}
