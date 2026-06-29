/* ============================================================
   vault.test.ts — 옵시디언 볼트 스캔의 집계·FS 에러 경로(Vitest).
   순수 집계(subjectsFromIndex·estH)는 직접, FS 의존(loadVaultIndex·pickAndScanVault·
   scanVaultFromFiles)은 가짜 File System Access 핸들로 검증 — 외부 의존의 우아한 실패 보장.
============================================================ */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chaptersFromVault,
  estH,
  loadVaultIndex,
  pickAndScanVault,
  scanVaultFromFiles,
  subjectsFromIndex,
} from '@/lib/vault';

afterEach(() => vi.unstubAllGlobals());

/* ── 가짜 File System Access 핸들 빌더 ── */
type FakeHandle = ReturnType<typeof file> | ReturnType<typeof dir>;
function file(content: string) {
  return {
    kind: 'file' as const,
    getFile: async () => ({
      text: async () => content,
      slice: (a: number, b: number) => ({ text: async () => content.slice(a, b) }),
    }),
  };
}
function dir(children: Record<string, FakeHandle>) {
  return {
    kind: 'directory' as const,
    entries: async function* () {
      for (const [name, h] of Object.entries(children)) yield [name, h] as [string, FakeHandle];
    },
    getDirectoryHandle: async (name: string) => {
      const c = children[name];
      if (!c || c.kind !== 'directory') throw new Error('NotFound: ' + name);
      return c;
    },
    getFileHandle: async (name: string) => {
      const c = children[name];
      if (!c || c.kind !== 'file') throw new Error('NotFound: ' + name);
      return c;
    },
  };
}
// FS Access 타입 대신 가짜 핸들을 주입(테스트 한정 캐스팅).
const asHandle = (d: FakeHandle) => d as unknown as FileSystemDirectoryHandle;
const fm = (status: string, anki = false) => `---\nstatus: ${status}${anki ? '\nanki_exported: true' : ''}\n---\n본문`;

describe('subjectsFromIndex — 정본 인덱스 집계', () => {
  it('과목→챕터로 notes·verified·exported·legacy·wip를 센다', () => {
    const out = subjectsFromIndex({
      notes: [
        { subject: '수학', folder: '수학/미적분', status: 'verified', anki_exported: true },
        { subject: '수학', folder: '수학/미적분', status: 'drafted' }, // wip
        { subject: '수학', folder: '수학/미적분', status: '' }, // status 없음 → legacy
      ],
    });
    expect(out).toHaveLength(1);
    const s = out[0];
    expect(s.name).toBe('수학');
    expect({ notes: s.notes, verified: s.verified, exported: s.exported, legacy: s.legacy, wip: s.wip }).toEqual({
      notes: 3,
      verified: 1,
      exported: 1,
      legacy: 1,
      wip: 1,
    });
    expect(s.chapters[0].name).toBe('미적분');
  });
  it('실전문제 kind는 분모에서 제외한다', () => {
    const out = subjectsFromIndex({
      notes: [
        { subject: '물리', folder: '물리/역학', status: 'verified' },
        { subject: '물리', folder: '물리/역학', kind: '실전문제', status: 'verified' },
      ],
    });
    expect(out[0].notes).toBe(1); // 실전문제 1건 제외
  });
  it('folder가 과목 1단계면 (과목 루트)로 묶는다', () => {
    const out = subjectsFromIndex({ notes: [{ subject: '화학', folder: '화학', status: 'verified' }] });
    expect(out[0].chapters[0].name).toBe('(과목 루트)');
  });
  it('빈 입력은 빈 배열', () => {
    expect(subjectsFromIndex({})).toEqual([]);
    expect(subjectsFromIndex({ notes: [] })).toEqual([]);
  });
});

describe('estH / chaptersFromVault — 순수 변환', () => {
  it('estH는 노트수×0.5를 반올림하되 최소 1', () => {
    expect(estH(0)).toBe(1);
    expect(estH(1)).toBe(1); // round(0.5)=1(>=최소)
    expect(estH(10)).toBe(5);
    expect(estH(7)).toBe(4); // round(3.5)=4
  });
  it('chaptersFromVault는 학습항목 챕터(done=false·예상시간)로 변환', () => {
    const chs = chaptersFromVault([{ name: '1장', notes: 10, verified: 0, exported: 0, legacy: 0, wip: 0 }]);
    expect(chs).toHaveLength(1);
    expect(chs[0]).toMatchObject({ name: '1장', hours: 5, done: false });
    expect(typeof chs[0].id).toBe('string');
  });
});

describe('loadVaultIndex — 정본 인덱스 로드/폴백', () => {
  it('_meta/감사/_index.json을 찾으면 파싱해 반환', async () => {
    const tree = dir({ _meta: dir({ 감사: dir({ '_index.json': file('{"notes":[{"subject":"수학"}]}') }) }) });
    const idx = await loadVaultIndex(asHandle(tree));
    expect(idx?.notes).toEqual([{ subject: '수학' }]);
  });
  it('인덱스가 없으면(디렉터리 부재) throw 없이 null', async () => {
    const tree = dir({}); // _meta 없음 → getDirectoryHandle reject → catch → null
    await expect(loadVaultIndex(asHandle(tree))).resolves.toBeNull();
  });
  it('인덱스 JSON이 손상돼도 null로 폴백', async () => {
    const tree = dir({ _meta: dir({ 감사: dir({ '_index.json': file('{깨진') }) }) });
    await expect(loadVaultIndex(asHandle(tree))).resolves.toBeNull();
  });
});

describe('scanVaultFromFiles — .md 직접 스캔(폴백)', () => {
  it('과목/챕터의 .md를 집계하고 _폴더·MOC·실전문제는 건너뛴다', async () => {
    const tree = dir({
      수학: dir({
        미적분: dir({
          'n1.md': file(fm('verified', true)),
          'n2.md': file(fm('')), // status 없음 → legacy
          'MOC.md': file(fm('verified')), // MOC 제외
        }),
        '루트노트.md': file(fm('drafted')), // 과목 루트 .md → wip
        _assets: dir({ 'x.md': file(fm('verified')) }), // _폴더 제외
      }),
    });
    const subs = await scanVaultFromFiles(asHandle(tree));
    expect(subs).toHaveLength(1);
    const s = subs[0];
    expect(s.name).toBe('수학');
    expect(s.notes).toBe(3); // 미적분 2 + 루트 1
    expect(s.verified).toBe(1);
    expect(s.legacy).toBe(1);
    expect(s.wip).toBe(1);
    expect(s.exported).toBe(1);
    expect(s.chapters.map((c) => c.name)).toEqual(['미적분']);
  });
});

describe('pickAndScanVault — 폴더 선택/분기', () => {
  it('showDirectoryPicker 미지원이면 안내와 함께 throw', async () => {
    vi.stubGlobal('window', {}); // picker 없음
    await expect(pickAndScanVault()).rejects.toThrow('지원하지 않아요');
  });
  it('사용자가 선택을 취소하면 null', async () => {
    vi.stubGlobal('window', {
      showDirectoryPicker: vi.fn(async () => {
        throw Object.assign(new Error('cancel'), { name: 'AbortError' });
      }),
    });
    await expect(pickAndScanVault()).resolves.toBeNull();
  });
  it('정본 인덱스가 있으면 그것으로 스캔(src=정본 _index.json)', async () => {
    vi.stubGlobal('window', {});
    const tree = dir({
      _meta: dir({
        감사: dir({ '_index.json': file('{"notes":[{"subject":"수학","folder":"수학/미적분","status":"verified"}]}') }),
      }),
    });
    const r = await pickAndScanVault(asHandle(tree));
    expect(r?.scan.src).toBe('정본 _index.json');
    expect(r?.scan.subjects[0].name).toBe('수학');
  });
  it('인덱스가 없으면 .md 파일 스캔으로 폴백(src=파일 스캔)', async () => {
    vi.stubGlobal('window', {});
    const tree = dir({ 물리: dir({ 역학: dir({ 'a.md': file(fm('verified')) }) }) });
    const r = await pickAndScanVault(asHandle(tree));
    expect(r?.scan.src).toBe('파일 스캔(.md)');
    expect(r?.scan.subjects[0].name).toBe('물리');
  });
});
