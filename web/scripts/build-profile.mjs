#!/usr/bin/env node
/* 프로파일링 빌드 — **소스맵을 켜서** CPU 프로파일이 함수 단위로 귀속되게 한다(P044 · 2026-08-28).

   ## 왜 별도 진입점인가

   기본 빌드는 소스맵을 안 낸다(`vite.config.ts` 의 `build.sourcemap` 머리주석이 근거: `.map` 은
   dist 에 남아 데스크톱 번들·Workers 자산으로 **그대로 배포되고** 우리 소스를 공개한다).
   그런데 그 탓에 성능 축 1회차가 «어느 함수가 느린가»에 **두 번 막혔고**, 매번 `vite.config.ts`
   사본을 손으로 만들어 우회했다. 그 우회를 이름 있는 경로로 만든다.

   ⚠ **이 산출물은 배포하지 마라.** `npm run budget` 이 그 dist 를 시끄럽게 잡는다(축 ④) —
   그게 의도다. 프로파일이 끝나면 `npm run build` 로 되돌린다.
   ⚠ 환경변수를 셸 문법으로 넘기지 않는 이유: Windows `cmd` 는 `VAR=1 cmd` 를 이해하지 못하고,
   그걸 위해 의존성(`cross-env`)을 하나 들이는 것보다 이 여섯 줄이 싸다. */
import { spawnSync } from 'node:child_process';

console.log('[build:profile] 소스맵을 켜고 빌드합니다 — ⚠ 이 dist 는 배포용이 아닙니다.');
const r = spawnSync('npx', ['vite', 'build'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, HUB_SOURCEMAP: '1' },
});
if (r.status !== 0) process.exit(r.status ?? 1);
console.log('[build:profile] 끝. 프로파일 뒤에는 `npm run build` 로 배포 가능한 dist 를 되돌리세요.');
