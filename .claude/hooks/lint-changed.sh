#!/usr/bin/env bash
# PostToolUse(Edit|Write) — 방금 편집된 web/src TS(X) 파일을 eslint로 검사.
# asyncRewake로 배선돼 편집을 막지 않고 백그라운드로 돌며, 위반이 있을 때만 exit 2로 모델을 깨운다.
# (eslint 단일파일 ~4s라 동기 실행은 편집 지연이 커서 async로 둔다. jq 부재 → node로 stdin JSON 파싱.)
input=$(cat)
f=$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).tool_input?.file_path||"")}catch{}})')
[ -z "$f" ] && exit 0
norm=$(printf '%s' "$f" | tr '\\' '/')
case "$norm" in
  */hub/web/src/*.ts|*/hub/web/src/*.tsx) ;;
  *) exit 0 ;;
esac
# 훅 파일(hub/.claude/hooks/) 기준 자기상대 — 워크스페이스 루트 개명·이동에 불변.
out=$(cd "$(dirname "$0")/../../web" && npx --no-install eslint "$f" 2>&1)
if [ $? -ne 0 ]; then
  printf 'eslint 위반 — %s\n%s\n' "$norm" "$out"
  exit 2
fi
exit 0
