/* ============================================================
   backup.ts — **백업 페이로드의 SSOT**. 파일 내보내기·볼트 백업·**폰 내보내기**가 같은 범위를 쓴다.

   ⚠ `shell/actions.ts` 에 있던 것을 옮겼다(I033 · 2026-08-22 발상 축). 옮긴 이유가 이 파일의
   존재 이유다: **폰 원장이 판정자에게 도달할 길이 없었다.**

   폰은 자기 SQLite(OPFS)에 `route_visits` 를 쌓는데 그 표는 동기화 대상이 아니고(설계다 —
   기기별 관측을 합치면 "이 기기에서 안 쓰는 화면"이라는 판정이 성립하지 않는다) 폰에는
   **내보내기 자체가 없었다.** 그래서 "폰 뷰를 쓰는가"는 원리적으로 답할 수 없는 질문이었고,
   그 질문에 매달린 항목이 둘이다(I012 시험 직후 회수 시트 · 폰 은퇴 계열 · 리포트 §5-C).

   `src/phone/**` 은 `shell` 배럴을 물 수 없으므로(§13-0 · H7 — `actions.ts` 가 스토어·IPC 를
   나른다) 폰이 쓰려면 이 조립이 `lib/` 에 있어야 한다. 사본을 만드는 선택지는 없다:
   이 함수는 애초에 *"두 곳이 각자 조립한 탓에 사이드카 추가가 한쪽에만 반영됐다"* 를 고치려고
   생긴 SSOT 다.
============================================================ */
import type { AppState } from './types';
import { exportSnapshot } from './persistence';
import { exportLocalExtras, LOCAL_EXTRAS_FIELD } from './sidecars';
import { exportObservations, OBSERVATIONS_FIELD } from './observations';
import { exportAllDocs, DOCS_FIELD } from './db/docs';

/** 백업 페이로드 SSOT — 파일 내보내기와 볼트 백업이 **같은 범위**를 쓰게 한다.
    (두 곳이 각자 조립하던 탓에 사이드카 추가가 한쪽에만 반영될 수 있었다.)
    export인 이유: `test/importRoundtripLarge.test.ts`가 **진짜 내보내기 범위**로 왕복을 검증한다.
    테스트가 페이로드를 자기 손으로 조립하면 "내가 값을 복사했다"만 증명하게 된다(1단계 교훈). */
/* ⚠ **비동기다**(H-14 · 2026-08-06 감사). 관측 원장(`route_visits`·`day_signals`)은 KV 가 아니라
   SQL 표라 읽기가 비동기이고, 그 둘이 **어떤 백업에도 없어서** 재설치·오리진 이동 때 0 이
   됐다(그것을 기다리는 로드맵 판정이 일곱이고 게이트가 관측일 10·방문 30이라 대기가 몇 주다).
   근거 전문은 `lib/observations.ts` 머리주석이 소유한다. */
/* ⚠⚠ `docs` 표를 **전량** 싣는다(D005 · 2026-08-21). P10 W4 가 `_reads` 를 걷은 뒤 이 표는
   **어떤 백업에도 없었다** — 그런데 비어 있지 않았다: 실 DB 에 3행 51,793 B 가 도달 불가인
   채(읽을 수도 지울 수도 없는데 D1·폰까지 밀린 채) 있었고 그중 하나는 사용자가 쓴 글이었다.
   당시 살아 있던 세입자(`ics:feed`)도 같은 이유로 재설치에서 사라졌다(그 세입자는 이후
   I050 이 걷어 **레지스트리는 다시 0**이다 · C042 — 그래도 이 전량 싣기는 그대로다: 표가
   비어 있지 않다는 것이 D005 의 요지이고 레지스트리와 표의 내용은 별개다).
   ⚠ 회수 경로가 삭제 경로보다 **먼저** 서야 한다는 것이 그 항목 처방의 순서다. */
export async function backupPayload(s: AppState): Promise<Record<string, unknown>> {
  return {
    ...exportSnapshot(s),
    [LOCAL_EXTRAS_FIELD]: exportLocalExtras(),
    [OBSERVATIONS_FIELD]: await exportObservations(),
    [DOCS_FIELD]: await exportAllDocs(),
  };
}
