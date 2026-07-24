/* ============================================================
   artifactMirror.ts — **PC 의 산출물을 폰이 볼 수 있는 곳으로 옮긴다**(설계 §13-8 잔여).

   ## 무엇이 문제였나

   산출물 8종은 워크스페이스의 JSON 파일이고, 읽는 경로는 Rust 커맨드(`artifact_read`)다.
   폰은 Tauri 도 아니고 그 파일시스템도 없다 — 즉 **원리적으로 못 본다.** C-6 은 캘린더·할일
   (= `AppState`)만 채웠고 여기는 빈칸으로 남았다.

   ## 왜 `docs` 에 얹는가 (전용 테이블·전용 라우트를 만들지 않은 이유)

   `docs` 는 **이미 동기화된다**(`cloud/contract.ts` `DOCS_SPEC.sync = true`). 즉 여기에 쓰면
   기존 아웃박스 → push → D1 → pull → 폰 SQLite 경로를 **한 줄도 안 건드리고** 탄다.
   전용 테이블을 만들면 마이그레이션 · 서버 계약 · 왕복 테스트 · pull 페이지네이션이 전부
   한 벌씩 더 생기는데, 그 대가로 사는 것이 "성격이 다른 값을 다른 테이블에" 뿐이다.

   ⚠ 대가는 정직하게 적는다: `docs` 는 원래 **사용자 저작물** 전용이었고 여기에 파생물이 섞인다.
   그래서 키에 `artifact:` 접두를 박아 **소유자를 이름으로 구분**하고, 백업/내보내기에서
   구분할 수 있게 한다. 그리고 미러는 **PC → 클라우드 단방향**이다 — 폰이 이 키를 쓰면 다음
   미러가 덮으므로, 폰 화면은 읽기 전용이어야 한다.

   ## 왜 8종 전부가 아닌가 — 실측으로 골랐다

   | 산출물         | 크기  | 폰에서 쓰나                                             |
   | -------------- | ----- | ------------------------------------------------------- |
   | `knowledge`    | 175KB | ✗ 소비처가 graph·mastery 인데 둘 다 폰에 없다           |
   | `reads`        |  41KB | ✅ **본문(`text`)이 들어 있다** — 폰에서 읽는 게 자연스럽다 |
   | `markets`      |  18KB | ✅ 뉴스 목록 — 이동 중 훑기 좋다                          |
   | `ledger`       |  34KB | ✗ 챕터 원장. 폰의 캘린더는 `AppState` 만 본다            |
   | `curriculum`   |  26KB | ✗ 위와 같다                                             |
   | `goals`        |   4KB | ✗ 소비처가 goals 탭(폰에 없음)                          |
   | `anki`         |  없음 | ✗ 원료가 PC 에만 있다(§3-2)                             |
   | `discovery`    |  없음 | ✗ 화면 없음                                             |

   → **`reads` + `markets` 만**(약 60KB). 나머지는 "폰에 화면이 생기면" 여기 목록에 한 줄
   더하면 된다. 지금 전부 올리면 300KB 를 매 동기화에 얹으면서 **아무도 안 본다.**

   ## ⚠ `_index.json`(볼트 목록, 348KB)은 **의도적으로 뺐다**

   설계 §3-1 이 클라우드 대상으로 적어 뒀지만, 같은 문단이 _"노트 본문은 안 옮긴다"_ 고 적는다
   (`vault_scan` 의 정본 경로가 본문을 아예 안 읽는다 — subject·folder·kind·status 만).
   그러면 폰에 남는 것은 **열 수 없는 제목 목록 348KB** 다. 가장 큰 단일 페이로드가 가장 낮은
   가치를 갖는 조합이라, 붙이지 않는 것이 정직하다. 되살리려면 본문 이관이 선행이다.
============================================================ */
import { docGet, docSet } from './db/docs';
import { getArtifact } from './api';

/** 폰으로 미러하는 산출물 — 위 표의 근거로 고른 둘. 화면이 생기면 여기 한 줄. */
export const MIRRORED_ARTIFACTS = ['reads', 'markets'] as const;
export type MirroredArtifact = (typeof MIRRORED_ARTIFACTS)[number];

/** `docs` 키 — `artifact:` 접두가 "파생물이고 PC 가 소유자"라는 표시다.
 *  목록 자체는 `db/docs.ts` 가 소유한다(순환 import 회피 — 그쪽 주석 참조). */
export const mirrorKey = (name: MirroredArtifact): string => `artifact:${name}`;

/** 미러된 산출물 읽기(폰·PC 공용, **동기**) — 없으면 null. 파싱 실패도 null. */
export function readMirrored<T>(name: MirroredArtifact): T | null {
  const raw = docGet(mirrorKey(name));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null; // 손상된 미러는 "없음"으로 — 다음 미러가 덮는다
  }
}

export interface MirrorResult {
  /** 실제로 내용이 바뀌어 새로 쓴 산출물. */
  updated: MirroredArtifact[];
  /** 읽지 못한 산출물(파일 없음·백엔드 없음). 실패가 아니라 정상 상태일 수 있다. */
  missing: MirroredArtifact[];
}

/**
 * 산출물을 읽어 `docs` 에 반영한다. **셸에서만 의미가 있다**(폰엔 원본이 없다).
 *
 * ⚠ **내용이 같으면 쓰지 않는다.** `docSet` 은 새 스탬프를 찍고 그 행은 아웃박스에 실리므로,
 * 무조건 쓰면 동기화할 때마다 60KB 를 다시 밀어 올린다(산출물은 파이프라인이 돌 때만 바뀐다).
 *
 * 던지지 않는다 — 미러는 편의지 정본이 아니고, 실패가 동기화를 멈추면 안 된다.
 */
export async function mirrorArtifacts(): Promise<MirrorResult> {
  const updated: MirroredArtifact[] = [];
  const missing: MirroredArtifact[] = [];
  for (const name of MIRRORED_ARTIFACTS) {
    let json: string | null = null;
    try {
      const r = await getArtifact(name);
      // ⚠ `ok:false`(미생성·손상)도 '없음'으로 흡수한다 — 미러가 부분 실패로 동기화를 막지 않게.
      json = r.ok && r.data != null ? JSON.stringify(r.data) : null;
    } catch {
      json = null; // 백엔드 없음(브라우저)·404 — 정상 상태일 수 있다
    }
    if (json == null) {
      missing.push(name);
      continue;
    }
    const key = mirrorKey(name);
    if (docGet(key) === json) continue; // 무변경 — 스탬프를 찍지 않는다
    docSet(key, json);
    updated.push(name);
  }
  return { updated, missing };
}
