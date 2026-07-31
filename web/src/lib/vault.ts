/* ============================================================
   vault.ts — 옵시디언 볼트 현황(File System Access API) — 서버/외부 데이터.
   정본 _meta/cache/_index.json(검사.sh --index 산출)을 우선 소비하고, 없으면 .md 직접 스캔.
   순수 계산 + FS 읽기만(앱 상태에 복제 X). TanStack Query가 스캔 결과를 캐시(설계도 §1-B).
============================================================ */
import { SKIP, rid } from './utils';
import { dirEntries, pickDirectory, queryPermission, requestPermission } from './fsAccess';
import { vaultScan } from './tauri';
import { parseArtifact } from './artifacts';
import type { Chapter } from './types';

export interface VaultChapter {
  name: string;
  notes: number;
  verified: number;
  exported: number;
  legacy: number;
  wip: number;
  /** 이 챕터 노트들의 `reviewed:` 중 **가장 최근**(없으면 ''). 볼트가 아는 유일한 망각 시계다(W2). */
  reviewedRecent: string;
  /** `anki_state === 'stale'` 인 노트 수 — 노트는 고쳤는데 카드가 안 따라온 것. */
  ankiStale: number;
  /** 이 챕터에서 `prereq_in`(이걸 알면 몇 개가 풀리나) 최댓값. */
  prereqIn: number;
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

/* ⚠⚠ **경계에서 필드를 버리지 말 것(W2 · 2026-07-31).** 종전엔 17키 중 5키만 뽑았고, 증발하는
   것 중에 **`reviewed`(468건에 날짜가 있다)** 와 **`anki_state`** 가 있었다 — 앱은 "복습 0/0"이라
   말하면서 그 답을 아는 파일을 매번 읽고 있었다. 인덱스 스키마(`artifacts.gen.ts` `indexArtifactSchema`)
   는 이 필드를 **이미 전부** 알고 있었으므로, 여기 좁은 인터페이스가 유일한 병목이었다.
   ⚠ 필드를 늘려도 **집계는 여전히 이 파일 하나**가 소유한다(Rust 는 레코드까지만 · 3단계-B 규율). */
export interface IndexNote {
  kind?: string;
  subject?: string;
  folder?: string;
  status?: string;
  anki_exported?: boolean;
  /** 검증 통과일(파이프라인). ⚠ **인출일이 아니다** — 위험을 올리는 방향으로만 쓴다(vaultAnchors). */
  reviewed?: string | null;
  /** 'ok' | 'none' | 'stale' — 노트↔카드 동기 상태. */
  anki_state?: string | null;
  /** 이 노트를 선행으로 삼는 노트 수(링크 인입). */
  prereq_in?: number;
  tier_hint?: string | null;
  role?: string | null;
  type?: string | null;
  flags?: unknown[];
}

/** _index.json.notes → 과목→챕터 집계. status=null=구버전(verified와 구분 · A-2). */
export function subjectsFromIndex(idx: { notes?: IndexNote[] }): VaultSubject[] {
  const bySubj: Record<string, VaultSubject & { _ch: Record<string, VaultChapter> }> = {};
  const zero = { notes: 0, verified: 0, exported: 0, legacy: 0, wip: 0, reviewedRecent: '', ankiStale: 0, prereqIn: 0 };
  for (const n of idx.notes || []) {
    if (n.kind === '실전문제') continue; // 실전문제는 검증%·노트수 분모에서 제외(대시보드 isProb와 정합)
    const sj = n.subject || '?';
    const parts = (n.folder || sj).split('/');
    const ch = parts.length > 1 ? parts.slice(1).join('/') : '(과목 루트)';
    const S = bySubj[sj] || (bySubj[sj] = { name: sj, _ch: {}, ...zero, chapters: [] });
    const C = S._ch[ch] || (S._ch[ch] = { name: ch, ...zero });
    // `reviewed` 는 **최댓값**(가장 최근) — 챕터 안에서 한 노트라도 최근에 검증됐으면 그게 앵커다.
    const rv = n.reviewed || '';
    if (rv > C.reviewedRecent) C.reviewedRecent = rv;
    if (rv > S.reviewedRecent) S.reviewedRecent = rv;
    if (n.anki_state === 'stale') {
      C.ankiStale++;
      S.ankiStale++;
    }
    const pin = +(n.prereq_in || 0);
    if (pin > C.prereqIn) C.prereqIn = pin;
    if (pin > S.prereqIn) S.prereqIn = pin;
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

/** 순회에서 통째로 건너뛸 폴더인가 — `_`/`.` 접두(파생·시스템)와 SKIP 목록.
    ⚠ **모든 깊이에서** 적용해야 한다. 실제 볼트에 `기초 수학/미적분/.trash`·`.../_리포트` 처럼
    깊은 곳에도 있어서, 최상위에서만 거르면 휴지통 노트가 집계에 섞인다. */
function skipDir(name: string): boolean {
  return name.startsWith('_') || name.startsWith('.') || SKIP.has(name);
}
/** 집계에서 뺄 노트 파일인가(파일명 기준). 정본 인덱스는 파이프라인이 생성 시점에 걸러 주므로
    이 필터는 **폴백 경로가 인덱스의 분모를 흉내내는** 장치다.
    ⚠ 흉내에는 원리적 한계가 있다 — 인덱스는 `kind`(개념노트·집합체·실전문제)로 분류하는데
    폴백엔 그 정보가 없어 파일명으로만 유추한다. 실측(실제 볼트): 이 차이로 남는 오차는
    **노트 1개**(`기초 수학/🏠 수학노트 홈.md` — 이름에 MOC 가 없지만 파이프라인은 제외).
    깊이 결함을 고치기 전엔 오차가 **239개**였으니, 남은 1개는 감수한다. */
function skipNote(fn: string): boolean {
  return !fn.endsWith('.md') || fn.includes('MOC') || fn.includes('실전문제');
}

/** 볼트 트리를 **임의 깊이**로 순회해 정본 인덱스와 같은 모양의 노트 레코드를 만든다.
 *
 *  ⚠ **깊이 2단 고정이 실제로 46%를 버리고 있었다.** 예전 구현은 `과목/챕터/` 안에서 파일만
 *  집계하고 디렉터리는 조용히 `continue` 했다 — 실측(2026-07-19, 실제 볼트): 전체 519개 중
 *  폴백이 보는 건 280개, **239개(46%)가 누락**. `기초 수학/미적분/01 극한과 연속/*.md` 처럼
 *  3단 구조가 실재하는데, 사용자에겐 "노트 수가 좀 적네"로만 보여 진단이 불가능했다.
 *
 *  인덱스 경로(`subjectsFromIndex`)는 `folder` 문자열을 쪼개 임의 깊이를 이미 지원했다 —
 *  즉 두 경로가 **서로 다른 볼트 구조를 지원**하고 있었고 그게 문서화된 적도 없었다.
 *  이제 폴백도 같은 레코드를 만들어 **같은 집계 함수**에 넣는다(분기 자체를 없앤다). */
async function notesFromFiles(handle: FileSystemDirectoryHandle): Promise<IndexNote[]> {
  const out: IndexNote[] = [];
  const walk = async (dir: FileSystemDirectoryHandle, subject: string, folder: string): Promise<void> => {
    for await (const [name, h] of dirEntries(dir)) {
      if (h.kind === 'directory') {
        if (skipDir(name)) continue;
        await walk(h as FileSystemDirectoryHandle, subject, `${folder}/${name}`);
      } else if (h.kind === 'file' && !skipNote(name)) {
        const fm = await readFM(h as FileSystemFileHandle);
        out.push({
          subject,
          folder,
          status: fm.status,
          // ⚠ 값은 boolean 이 아니라 **날짜 문자열**이다(실측: `anki_exported: 2026-07-11`).
          //    존재 자체가 "내보냄"이므로 truthy 판정이 맞다 — boolean 으로 파싱하려 들면 안 된다.
          anki_exported: !!fm.anki_exported,
          // W2 — 폴백도 같은 레코드를 만든다(인덱스 경로와 모양이 갈리면 같은 볼트에서 숫자가 갈린다).
          // ⚠ `anki_state`·`prereq_in` 은 프론트매터에 없다(파이프라인 파생) — 폴백에선 원리적으로 모른다.
          reviewed: fm.reviewed || '',
        });
      }
    }
  };
  for await (const [name, h] of dirEntries(handle)) {
    if (h.kind !== 'directory' || skipDir(name)) continue;
    await walk(h as FileSystemDirectoryHandle, name, name);
  }
  return out;
}

/** 폴백: 정본 인덱스가 없을 때 .md 직접 스캔(구버전 status 없음도 집계).
    집계는 **인덱스 경로와 같은 함수**를 쓴다 — 예전엔 별도 구현이라 깊이·verified 판정이
    서로 달랐다(같은 볼트에서 숫자가 갈렸다). */
export async function scanVaultFromFiles(handle: FileSystemDirectoryHandle): Promise<VaultSubject[]> {
  return subjectsFromIndex({ notes: await notesFromFiles(handle) });
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

/** 셸(Tauri)에서 볼트를 읽는다 — **폴더 선택도 권한도 없다.**
 *  `workspace.rs` 가 이미 워크스페이스를 알고 볼트는 `<workspace>/knowledge` 라, 사용자에게
 *  폴더를 물을 이유가 자체가 없다. 브라우저에선 null → 호출부가 기존 FSA 경로로 간다.
 *
 *  ⚠ Rust 는 **노트 레코드까지만** 만든다. 집계는 여기 `subjectsFromIndex` 하나가 소유한다 —
 *  3단계-B 에서 집계가 두 벌이라 같은 볼트에서 숫자가 갈리던 결함을 고쳤으니, 언어를 바꿔
 *  세 번째 구현을 만들지 않는다. */
export async function scanVaultViaShell(): Promise<VaultScan | null> {
  const res = await vaultScan();
  if (!res) return null;
  return {
    at: new Date().toLocaleString('ko'),
    src: res.src,
    subjects: subjectsFromIndex({ notes: res.notes as IndexNote[] }),
  };
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
