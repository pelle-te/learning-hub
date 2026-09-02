#!/usr/bin/env bash
# Stop — web/src가 web/dist보다 최신이면 재빌드 리마인더.
# Tauri 셸이 prebuilt web/dist를 로드하므로 소스만 고치고 빌드를 안 하면 "안 바뀐다"의 1순위 원인이 된다.
# dist가 이미 최신이거나 아예 없으면(=한 번도 빌드 안 함) 침묵한다(오탐 방지).
# 훅 파일(hub/.claude/hooks/) 기준 자기상대 — 워크스페이스 루트 개명·이동에 불변.
HUB="$(cd "$(dirname "$0")/../.." && pwd)"
dist="$HUB/web/dist/index.html"
[ -f "$dist" ] || exit 0
# ⚠ `web/src` 의 ts/tsx/css 만 보고 있었다(O039 · 2026-09-02). 엔트리 둘(`index.html`·`phone.html` — CSP 메타가
#   거기 있다)·`public/`·`vite.config.ts` 를 고치면 dist 가 낡아도 침묵했다. 「안 바뀐다」의 1순위 원인을 정확히
#   그 파일들에서 못 잡는 형태라 **빌드 입력 전부**로 넓혔다(없는 경로는 find 가 stderr 로 흘리고 계속 간다).
newer=$(find "$HUB/web/src" "$HUB/web/public" "$HUB/web/index.html" "$HUB/web/phone.html" "$HUB/web/vite.config.ts" \
  -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' -o -name '*.html' -o -name '*.json' -o -name '*.svg' -o -name '*.woff2' \) \
  -newer "$dist" 2>/dev/null | head -1)
if [ -n "$newer" ]; then
  printf '%s' '{"systemMessage":"⚠ web/src가 web/dist보다 최신입니다 — Tauri 셸이 로드할 빌드가 오래됨. 반영하려면 (cd web && npm run build). dev 서버(npm run dev)만 쓰는 중이면 무시하세요."}'
fi
exit 0
