#!/usr/bin/env bash
# Stop — web/src가 web/dist보다 최신이면 재빌드 리마인더.
# serve.js는 prebuilt web/dist를 서빙하므로 소스만 고치고 빌드를 안 하면 "안 바뀐다"의 1순위 원인이 된다.
# dist가 이미 최신이거나 아예 없으면(=한 번도 빌드 안 함) 침묵한다(오탐 방지).
dist="C:/작업 폴더/러닝허브/web/dist/index.html"
[ -f "$dist" ] || exit 0
newer=$(find "C:/작업 폴더/러닝허브/web/src" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) -newer "$dist" 2>/dev/null | head -1)
if [ -n "$newer" ]; then
  printf '%s' '{"systemMessage":"⚠ web/src가 web/dist보다 최신입니다 — serve.js가 서빙할 빌드가 오래됨. 반영하려면 (cd web && npm run build). dev 서버(npm run dev)만 쓰는 중이면 무시하세요."}'
fi
exit 0
