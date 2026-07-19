/* ============================================================
   vault.ts — 옵시디언 볼트 현황(File System Access API) — 서버/외부 데이터.
   정본 _meta/cache/_index.json(검사.sh --index 산출)을 우선 소비하고, 없으면 .md 직접 스캔.
   순수 계산 + FS 읽기만(앱 상태에 복제 X). TanStack Query가 스캔 결과를 캐시(설계도 §1-B).
============================================================ */
import { SKIP, rid } from './utils';
import { dirEntries, pickDirectory, queryPermission, requestPermission } from './fsAccess';
import { parseArtifact } from './artifacts';
import type { Chapter } from './types';

export interface VaultChapter {
  name: string;
  notes: number;
  verified: number;
  exported: number;
  legacy: number;
  wip: number;
}
export interface VaultSubject extends VaultChapter {
  chapters: VaultChapter[];
}
export interface VaultScan {
  at: string;
  src: string;
  subjects: VaultSubject[];
}

/** 정본 인덱스(_meta/cache/_index.json) 로드 — 없으면 null(호출부가 파일스캔 폴백). */
export async function loadVaultIndex(
  handle: FileSystemDirectoryHandle,
): Promise<{ notes?: unknown[]; anki?: unknown[] } | null> {
  try {
    const meta = await handle.getDirectoryHandle('_meta');
    const aud = await meta.getDirectoryHandle('cache'); // P7 Phase 3: 감사→cache(파생)
    const fh = await aud.getFileHandle('_index.json');
    const idx = JSON.parse(await (await fh.getFile()).text());
    parseArtifact('index', idx); // parent↔hub 버전 + 모양 드리프트 경고(비차단)
    return idx;
  } catch {
    return null;
  }
}

interface IndexNote {
  kind?: string;
  subject?: string;
  folder?: string;
  status?: string;
  anki_exported?: boolean;
}

/** _index.json.notes → 과목→챕터 집계. status=null=구버전(verified와 구분 · A-2). */
export function subjectsFromIndex(idx: { notes?: IndexNote[] }): VaultSubject[] {
  const bySubj: Record<string, VaultSubject & { _ch: Record<string, VaultChapter> }> = {};
  for (const n of idx.notes || []) {
    if (n.kind === '실전문제') continue; // 실전문제는 검증%·노트수 분모에서 제외(대시보드 isProb와 정합)
    const sj = n.subject || '?';
    const parts = (n.folder || sj).split('/');
    const ch = parts.length > 1 ? parts.slice(1).join('/') : '(과목 루트)';
    const S =
      bySubj[sj] ||
      (bySubj[sj] = { name: sj, _ch: {}, notes: 0, verified: 0, exported: 0, legacy: 0, wip: 0, chapters: [] });
    const C = S._ch[ch] || (S._ch[ch] = { name: ch, notes: 0, verified: 0, exported: 0, legacy: 0, wip: 0 });
    const st = n.status || '';
    const ver = st === 'verified';
    const leg = !st;
    const wip = !!st && !ver; // raw/drafted(파이프라인 진행중)
    const exp = !!n.anki_exported;
    C.notes++;
    S.notes++;
    if (ver) {
      C.verified++;
      S.verified++;
    }
    if (exp) {
      C.exported++;
      S.exported++;
    }
    if (leg) {
      C.legacy++;
      S.legacy++;
    }
    if (wip) {
      C.wip++;
      S.wip++;
    }
  }
  return Object.values(bySubj).map((s) => {
    const chapters = Object.values(s._ch);
    const { _ch, ...rest } = s;
    void _ch;
    return { ...rest, chapters };
  });
}

async function readFM(fh: FileSystemFileHandle): Promise<Record<string, string>> {
  try {
    const f = await fh.getFile();
    const t = (await f.slice(0, 1600).text()) as string;
    // `\s*\n`이 아니라 `[ \t]*\r?\n` — `\s`가 개행을 포함해 `\s*\n`과 뒤따르는 lazy `[\s\S]*?`가
    // 같은 문자를 두고 겹치면서 백트래킹이 초선형이 된다(sonarjs/super-linear-regex).
    // 문자 클래스를 겹치지 않게 가르면 모호성이 사라지고, 덤으로 CRLF 볼트도 인식한다.
    const m = t.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return {};
    const o: Record<string, string> = {};
    m[1]!.split('\n').forEach((l) => {
      const i = l.indexOf(':');
      if (i > 0) o[l.slice(0, i).trim()] = l.slice(i + 1).trim();
    });
    return o;
  } catch {
    return {};
  }
}

/** 폴백: 정본 인덱스가 없을 때 .md 직접 스캔(구버전 status 없음도 집계). */
export async function scanVaultFromFiles(handle: FileSystemDirectoryHandle): Promise<VaultSubject[]> {
  const subjects: VaultSubject[] = [];
  for await (const [name, h] of dirEntries(handle)) {
    if (h.kind !== 'directory' || name.startsWith('_') || SKIP.has(name)) continue;
    const subj: VaultSubject = { name, chapters: [], notes: 0, verified: 0, exported: 0, legacy: 0, wip: 0 };
    for await (const [cn, ch] of dirEntries(h as FileSystemDirectoryHandle)) {
      if (ch.kind === 'directory') {
        if (cn.startsWith('_') || SKIP.has(cn)) continue;
        const chap: VaultChapter = { name: cn, notes: 0, verified: 0, exported: 0, legacy: 0, wip: 0 };
        for await (const [fn, fh] of dirEntries(ch as FileSystemDirectoryHandle)) {
          if (fh.kind !== 'file' || !fn.endsWith('.md') || fn.includes('MOC') || fn.includes('실전문제')) continue;
          chap.notes++;
          const fm = await readFM(fh as FileSystemFileHandle);
          if ((fm.status || '').includes('verified')) chap.verified++;
          else if (!fm.status) chap.legacy++;
          else chap.wip++;
          if (fm.anki_exported) chap.exported++;
        }
        if (chap.notes) {
          subj.chapters.push(chap);
          subj.notes += chap.notes;
          subj.verified += chap.verified;
          subj.exported += chap.exported;
          subj.legacy += chap.legacy;
          subj.wip += chap.wip;
        }
      } else if (ch.kind === 'file' && cn.endsWith('.md') && !cn.includes('MOC') && !cn.includes('실전문제')) {
        subj.notes++;
        const fm = await readFM(ch as FileSystemFileHandle);
        if ((fm.status || '').includes('verified')) subj.verified++;
        else if (!fm.status) subj.legacy++;
        else subj.wip++;
        if (fm.anki_exported) subj.exported++;
      }
    }
    if (subj.notes) subjects.push(subj);
  }
  return subjects;
}

/** 폴더 선택 → 스캔(정본 인덱스 우선·.md 폴백). 사용자가 취소하면 null.
 *  handle도 함께 반환 — Anki 패널이 같은 볼트 폴더를 재선택 없이 재사용(레거시 vaultHandle 공유). */
export async function pickAndScanVault(
  existing?: FileSystemDirectoryHandle,
): Promise<{ scan: VaultScan; handle: FileSystemDirectoryHandle } | null> {
  let handle = existing;
  if (!handle) {
    const picked = await pickDirectory(); // 미지원이면 FsUnsupportedError, 취소면 null
    if (!picked) return null;
    handle = picked;
  }
  const idx = await loadVaultIndex(handle);
  let subjects: VaultSubject[];
  let src: string;
  if (idx && Array.isArray(idx.notes)) {
    subjects = subjectsFromIndex(idx as { notes: IndexNote[] });
    src = '정본 _index.json';
  } else {
    subjects = await scanVaultFromFiles(handle);
    src = '파일 스캔(.md)';
  }
  return { scan: { at: new Date().toLocaleString('ko'), src, subjects }, handle };
}

/* ── 저장된 핸들 재사용(FS 권한) — IDB에 영속한 폴더 핸들로 재선택 없이 재연결.
   권한은 재시작 뒤 'prompt'로 돌아갈 수 있어(브라우저 정책), 조회→요청 2단계로 다룬다. */
/** 저장된 핸들의 읽기 권한 상태 — 'granted'면 제스처 없이 스캔 가능. */
export async function queryVaultPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  return queryPermission(handle, 'read');
}
/** 저장된 핸들에 읽기 권한 요청(사용자 제스처 안에서 호출). */
export async function requestVaultPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  return requestPermission(handle, 'read');
}

/** 노트 수 → 예상시간(h). */
export function estH(notes: number): number {
  return Math.max(1, Math.round(notes * 0.5));
}

/** 볼트 챕터 → 학습 항목 챕터(예상시간 추정). */
export function chaptersFromVault(chs: VaultChapter[]): Chapter[] {
  return chs.map((c) => ({ id: rid(), name: c.name, hours: estH(c.notes), done: false }));
}
