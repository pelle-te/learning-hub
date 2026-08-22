#!/usr/bin/env bash
# ============================================================
# PreToolUse(git commit) 인덱스 위생 가드.
#
# ## ⚠⚠ 표적이 바뀌었다 (O026 · 2026-08-22 운영 축)
#
# 종전 조건은 «hub 밖 형제 폴더(knowledge/·pipeline/·sources/·exports/)가 스테이징됐는가» 였고,
# 그 파일 자신이 *"(P1 서브모듈 분리 후 대체로 무효)"* 라 적어 뒀다. 실측하면 «대체로»가 아니라
# **저장소 전 생애 도달 불가**였다: `git ls-files` 로 그 경로 **0건**, 그리고 503커밋 이력에
# `--diff-filter=A` 로도 **0건**. 즉 이 훅은 도입 이래 한 번도 아무것도 막은 적이 없다.
#
# 그런데 **지우면 안 되는 이유**가 있었다: 인덱스 위생이라는 축 자체는 살아 있고(CLAUDE.md
# 절대규칙 #5), 이 저장소에는 «커밋 직전에 기계가 한 번 봐 주면 값이 큰» 실패 모드가 **실재**한다.
# 그래서 지우는 대신 **살아 있는 표적으로 겨눈다.**
#
# ## 새 표적 — 되돌릴 수 없는 유출
#
# `src-tauri/.updater-key`(업데이터 개인키)와 `server/.dev.vars`(워커 시크릿)는 `.gitignore` 에
# 있지만 **`git add -f` 한 줄이면 스테이징된다.** 그리고 그 유출은:
#   · **되돌릴 수 없다** — `릴리스.md` 가 *"push 된 시점에 이미 유출"* 이라 적었고, CI 의
#     gitleaks 는 **push 뒤**에 잡는다(1차 방어가 아니라 사후 통보다).
#   · **재생성 불가** — 개인키를 잃으면 이 앱에 다시는 업데이트를 배포할 수 없고, 새면 업데이트를
#     사칭당한다(사용자 PC 에서 임의 코드 실행과 같다).
# 즉 「지금 막으면 공짜, 놓치면 복구 불가」인 부류이고, 그게 PreToolUse 훅이 값을 내는 자리다.
#
# ⚠ **`.gitignore` 가 이미 막지 않나?** 아니다 — gitignore 는 *추적되지 않는* 파일만 가린다.
#   `-f` 로 한 번 스테이징되면 그다음부터는 추적 대상이라 gitignore 가 관여하지 않는다.
#
# 판단은 git 인덱스를 직접 보므로 stdin(도구 입력) 파싱이 불필요하다.
# ============================================================
staged=$(git -c core.quotepath=false diff --cached --name-only 2>/dev/null)

# ⚠ 경로를 **여기 손으로 적는다** — 정본은 `.gitignore` 의 시크릿 절이고 이건 그 사본이다.
#   사본인 것을 알면서 두는 이유: 훅은 `.gitignore` 를 해석할 수 없고(그건 git 의 일이다),
#   여기서 재는 것은 «무시되는가»가 아니라 **«이 이름이 인덱스에 있는가»** 라 서로 다른 질문이다.
#   ⚠ `.gitignore` 에 시크릿을 새로 더하면 이 목록도 함께 늘려라.
SECRETS='^(src-tauri/\.updater-key|server/\.dev\.vars)'

if printf '%s\n' "$staged" | grep -qE "$SECRETS"; then
  hit=$(printf '%s\n' "$staged" | grep -E "$SECRETS" | tr '\n' ' ')
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"⛔ 시크릿이 스테이징돼 있습니다: '"$hit"'— 이것은 되돌릴 수 없는 유출입니다(push 된 시점에 이미 유출이고, CI 의 gitleaks 는 그 뒤에 잡습니다). `git restore --staged <경로>` 로 빼세요. 업데이터 개인키는 재생성이 불가능하고, 새면 이 앱의 업데이트를 사칭당합니다 — 절차는 web/docs/릴리스.md §1."}}'
fi
exit 0
