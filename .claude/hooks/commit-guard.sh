#!/usr/bin/env bash
# PreToolUse(git commit) 인덱스 위생 가드.
# 러닝허브 밖 형제 폴더(전공/·시스템/·참고자료/·anki/) 파일이 스테이징돼 있으면 커밋을 차단한다.
# web/시스템/전공 세션이 같은 repo를 동시 편집하는 구조라 인덱스에 딴 세션 파일이 섞이는 사고가 반복됨.
# 판단은 git 인덱스를 직접 보므로 stdin(도구 입력) 파싱이 불필요하다.
staged=$(git -c core.quotepath=false diff --cached --name-only 2>/dev/null)
if printf '%s\n' "$staged" | grep -qE '^(전공|시스템|참고자료|anki)/'; then
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"인덱스 위생 가드: 스테이징에 러닝허브 밖 파일(전공/·시스템/·참고자료/·anki/)이 섞였습니다. `git restore --staged <경로>` 로 빼고 web 변경만 커밋하세요. (`git -c core.quotepath=false diff --cached --stat` 로 확인)"}}'
fi
exit 0
