/* ============================================================
   knowledge.test.ts — 지식상태(_지식상태.json) 로더 파싱/모양 회귀(Vitest).
   knowledge.ts는 두 출처(① serve.js /api/artifact/knowledge ② 볼트 FS _meta/감사/_지식상태.json)에서
   같은 Knowledge 모양을 돌려준다 — 이 모양(subjects[].mastery)이 스케줄러 graphPriority(subjectMastery)를 먹인다.
   외부 의존(fetch·FS Access)이라 fetch는 stub, 디렉터리 핸들은 최소 페이크로 주입한다.
============================================================ */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchKnowledgeArtifact, loadKnowledgeStateFromVault, rootCauseRollup, type Knowledge } from '@/lib/knowledge';

afterEach(() => vi.unstubAllGlobals());

function res(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return { ok: init.ok ?? true, status: init.status ?? 200, json: async () => body };
}
function stubFetch(impl: (...a: unknown[]) => unknown) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

const SAMPLE: Knowledge = {
  overall: 0.62,
  n_notes: 3,
  states: { mastered: 1, learning: 1, weak: 1, unknown: 0 },
  subjects: [
    { subject: '전자기학', mastery: 0.71, n: 2, weak: 1 },
    { subject: '수학', mastery: 0.4 },
  ],
};

describe('fetchKnowledgeArtifact — serve.js 산출물 파싱', () => {
  it('ok+data면 data(그래프 우선순위가 읽는 subjects[].mastery 모양)를 반환한다', async () => {
    stubFetch(async () => res({ ok: true, data: SAMPLE }));
    const k = await fetchKnowledgeArtifact();
    expect(k.overall).toBe(0.62);
    expect(k.subjects?.map((s) => [s.subject, s.mastery])).toEqual([
      ['전자기학', 0.71],
      ['수학', 0.4],
    ]);
  });
  it('data 없으면(빌드 전) 안내 메시지로 throw한다', async () => {
    stubFetch(async () => res({ ok: true }));
    await expect(fetchKnowledgeArtifact()).rejects.toThrow('지식상태 산출물');
  });
  it('ok:false면 throw한다', async () => {
    stubFetch(async () => res({ ok: false }));
    await expect(fetchKnowledgeArtifact()).rejects.toThrow('지식상태 산출물');
  });
  it('HTTP 오류(getArtifact 실패)는 그대로 전파한다', async () => {
    stubFetch(async () => res(null, { ok: false, status: 404 }));
    await expect(fetchKnowledgeArtifact()).rejects.toThrow('HTTP 404');
  });
});

/** _meta → 감사 → _지식상태.json 경로를 흉내내는 최소 디렉터리 핸들. missAt로 특정 단계 실패를 주입. */
function fakeVault(text: string | null, missAt?: 'meta' | '감사' | 'file'): FileSystemDirectoryHandle {
  const fileHandle = { getFile: async () => ({ text: async () => text }) };
  const audDir = {
    getFileHandle: async () => {
      if (missAt === 'file') throw new Error('no file');
      return fileHandle;
    },
  };
  const metaDir = {
    getDirectoryHandle: async () => {
      if (missAt === '감사') throw new Error('no 감사');
      return audDir;
    },
  };
  const root = {
    getDirectoryHandle: async () => {
      if (missAt === 'meta') throw new Error('no _meta');
      return metaDir;
    },
  };
  return root as unknown as FileSystemDirectoryHandle;
}

describe('loadKnowledgeStateFromVault — 볼트 FS 로더', () => {
  it('_meta/감사/_지식상태.json을 파싱해 Knowledge를 반환한다', async () => {
    const k = await loadKnowledgeStateFromVault(fakeVault(JSON.stringify(SAMPLE)));
    expect(k).not.toBeNull();
    expect(k!.subjects?.[0]).toMatchObject({ subject: '전자기학', mastery: 0.71 });
  });
  it('경로 부재(아직 build 안 함)면 null', async () => {
    expect(await loadKnowledgeStateFromVault(fakeVault(null, 'meta'))).toBeNull();
    expect(await loadKnowledgeStateFromVault(fakeVault(null, '감사'))).toBeNull();
    expect(await loadKnowledgeStateFromVault(fakeVault(null, 'file'))).toBeNull();
  });
  it('깨진 JSON이면 throw하지 않고 null', async () => {
    expect(await loadKnowledgeStateFromVault(fakeVault('{깨진'))).toBeNull();
  });
});

describe('rootCauseRollup — 약점 근본원인 롤업 (AN-2)', () => {
  it('self·무근원은 제외하고 같은 원인의 약점 수를 내림차순으로', () => {
    const k: Knowledge = {
      gaps: [
        { root_cause: '미분', p_eff: 0.2 },
        { root_cause: '극한', p_eff: 0.3 },
        { root_cause: '미분', p_eff: 0.1 },
        { root_cause: 'self', p_eff: 0.2 }, // 본인 개념 → 제외
        { root_cause: '미분', p_eff: 0.25 },
        { p_eff: 0.4 }, // 근원 없음 → 제외
      ],
    };
    expect(rootCauseRollup(k)).toEqual([
      { cause: '미분', count: 3 },
      { cause: '극한', count: 1 },
    ]);
  });
  it('gaps 없음/undefined면 빈 배열', () => {
    expect(rootCauseRollup(undefined)).toEqual([]);
    expect(rootCauseRollup({})).toEqual([]);
  });
  it('cap으로 상위 N만', () => {
    const k: Knowledge = {
      gaps: [
        { root_cause: 'a', p_eff: 0 },
        { root_cause: 'b', p_eff: 0 },
        { root_cause: 'c', p_eff: 0 },
      ],
    };
    expect(rootCauseRollup(k, 2).length).toBe(2);
  });
});
