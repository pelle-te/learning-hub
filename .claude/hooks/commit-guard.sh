#!/usr/bin/env bash
# PreToolUse(git commit) 인덱스 위생 가드.
# hub 밖 형제 폴더(knowledge/·pipeline/·sources/·exports/) 파일이 스테이징돼 있으면 커밋을 차단한다.
# web/pipeline/knowledge 세션이 같은 repo를 동시 편집하던 구조의 잔재 가드(P1 서브모듈 분리 후 대체로 무효).
# 판단은 git 인덱스를 직접 보므로 stdin(도구 입력) 파싱이 불필요하다.
staged=$(git -c core.quotepath=false diff --cached --name-only 2>/dev/null)
if printf '%s\n' "$staged" | grep -qE '^(knowledge|pipeline|sources|exports)/'; then
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"인덱스 위생 가드: 스테이징에 hub 밖 파일(knowledge/·pipeline/·sources/·exports/)이 섞였습니다. `git restore --staged <경로>` 로 빼고 web 변경만 커밋하세요. (`git -c core.quotepath=false diff --cached --stat` 로 확인)"}}'
fi
exit 0
