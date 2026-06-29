/* ============================================================
   knowledge.ts — 지식상태(_지식상태.json) 소비 — 서버/외부 데이터(프레임워크 무관).
   원본 둘: ① serve.js GET /api/artifact/knowledge(지식엔진.py 산출) ② 볼트 폴더의
   _meta/감사/_지식상태.json(FS Access). 둘 다 같은 Knowledge 모양을 돌려준다.
   TanStack Query가 캐시/로딩/에러를 소유(설계도 §1-B). 서버 JSON이라 필드는 느슨(전부 옵셔널).
============================================================ */
import { getArtifact } from './api';

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
  mastery: number;
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
  overall?: number;
  states?: { mastered?: number; learning?: number; weak?: number; unknown?: number };
  subjects?: KnowledgeSubject[];
  frontier?: KnowledgeFrontier[];
  gaps?: KnowledgeGap[];
  calibration?: KnowledgeCalibration;
}

/** serve.js 산출물(읽기 전용) — 없으면 throw(Query isError로 폴백 안내). */
export async function fetchKnowledgeArtifact(): Promise<Knowledge> {
  const j = await getArtifact<Knowledge>('knowledge');
  if (!j || !j.ok || !j.data) throw new Error('지식상태 산출물(knowledge)을 찾지 못했어요.');
  return j.data;
}

/** 볼트 폴더에서 _meta/감사/_지식상태.json 로드 — 못 찾으면 null(아직 build 안 함). */
export async function loadKnowledgeStateFromVault(handle: FileSystemDirectoryHandle): Promise<Knowledge | null> {
  try {
    const meta = await handle.getDirectoryHandle('_meta');
    const aud = await meta.getDirectoryHandle('감사');
    const fh = await aud.getFileHandle('_지식상태.json');
    return JSON.parse(await (await fh.getFile()).text()) as Knowledge;
  } catch {
    return null;
  }
}
