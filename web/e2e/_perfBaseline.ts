/* ============================================================
   _perfBaseline.ts — 부팅 계량의 **회차 간 보존**(P033 · 2026-08-27 성능 축).

   ## 왜 있나 — 재고 버리고 있었다

   `e2e-shell/shell.spec.ts` 와 `e2e/phone.spec.ts` 는 부팅 웨이브를 실제로 계산해
   **`console.log` 로 찍기만** 했다. CI reporter 는 `list`(stdout)이고 `upload-artifact` 는
   인스톨러 1건뿐이라, **다음 회차가 그 수를 읽을 방법이 없었다.** `phone.spec.ts` 가 스스로
   *"실측치는 로그로 남긴다 — 다음 회차가 그 수를 읽고 상수를 조일지 판단한다"* 라 적어 뒀는데,
   2026-08-27 성능 회차가 바로 그 「다음 회차」였고 **읽을 수 없었다.**
   결과: `entry→app` 이 200 ms 늘어도 아무 술어도 위반하지 않는다.

   ## 무엇을 잡고 무엇을 안 잡나

   ⚠ **절대 시간에 임계를 걸지 않는다** — 두 스펙의 기존 판단 그대로다(러너·디스크·콜드캐시에
   좌우된다). 잡는 것은 **계단식 변화**다: 이 저장소가 실제로 물린 부류(부팅 260 ms · P028 의
   한 커밋)는 +50% 를 훌쩍 넘고 하드웨어 잡음은 그 아래에 머문다.
   ⚠ **같은 호스트끼리만 비교한다.** 다른 머신의 값과 대면 그 대조 자체가 거짓 빨강이다 —
   러너가 바뀌면 기준선을 새로 세우고 그 회차는 비교하지 않는다.
   ⚠ **원시 트레이스를 보존하지 마라.** 저장소 이력 축(P032)의 잔여 활주로가 43 MiB 다 —
   요약 수치 JSON 한 장이 상한이고, 그래서 이 파일은 **덮어쓴다**(append 하지 않는다).
============================================================ */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const 파일 = join(process.cwd(), 'docs/성능/기준선.json');

/** 한 축의 보존된 값. `host` 가 다르면 비교하지 않는다(위 머리주석). */
type 칸 = { at: string; host: string; ms: Record<string, number> };
type 장부 = Record<string, 칸>;

const 읽기 = (): 장부 => {
  if (!existsSync(파일)) return {};
  try {
    return JSON.parse(readFileSync(파일, 'utf8')) as 장부;
  } catch {
    /* 깨진 기준선은 «비교 안 함» 으로 떨어뜨린다 — 여기서 throw 하면 계량이 게이트를 죽인다.
       계량은 관측이지 판정이 아니다(그 판정은 각 스펙의 자기 단언이 진다). */
    return {};
  }
};

/**
 * 이번 회차의 값을 기록하고, **같은 호스트의 직전 값**을 돌려준다.
 * 임계 판정은 호출부가 한다 — 축마다 무엇이 계단인지 다르기 때문이다.
 */
export function 기준선기록(축: string, ms: Record<string, number>): Record<string, number> | null {
  const 장부 = 읽기();
  const 이전 = 장부[축];
  const host = process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? '?';
  장부[축] = { at: new Date().toISOString(), host, ms };
  mkdirSync(dirname(파일), { recursive: true });
  writeFileSync(파일, JSON.stringify(장부, null, 2) + '\n', 'utf8');
  return 이전 && 이전.host === host ? 이전.ms : null;
}

/** 계단식 회귀 판정 — 잡음은 통과시키고 계단은 잡는다(배수 1.5 + 절대 여유 20 ms). */
export const 계단인가 = (이번: number, 이전: number) => 이번 > 이전 * 1.5 + 20;
