# 업데이트 매니페스트 — 같은 오리진의 정적 자산 (C3 · 2026-07-26 감사)

이 폴더는 `web/dist/updates/` 로 복사되고(Vite `public/`), Workers 자산으로 그대로 서빙된다 →
`https://<워커>.workers.dev/updates/latest.json`. **추가 호스팅이 0**인 것이 이 자리를 고른 이유다
(폰 웹앱을 이미 같은 오리진에서 서빙하고 있다 — 런북 §7-6).

## 왜 GitHub Releases 가 아닌가

`tauri.conf.json` 의 기본 엔드포인트(`github.com/.../releases/latest/download/latest.json`)는
**실측 404** 였다 — 저장소가 비공개라(`api.github.com` 도 404) 업데이터가 토큰을 싣지 않는다.
즉 배포 후 "전달" 층이 **한 번도 왕복된 적이 없었다.** 근거·신뢰 경계 논증은
`src-tauri/src/updater.rs` 머리주석이 SSOT.

## 지금 들어 있는 `latest.json` 은 현재 배포본을 가리킨다

일부러 그렇다. 파일이 없으면 엔드포인트가 404 라 업데이터가 **오류**를 내는데, 그건 "확인했는데
새 버전이 없다"와 사용자에게 다른 사실이다. 현재 버전을 적어 두면 확인이 200 으로 끝나고
"최신 버전입니다"가 뜬다. `url` 이 `.invalid`(RFC 2606 예약 TLD)인 것도 의도다 — 버전이 같아
내려받기가 일어나지 않고, 혹시 불려도 **실패로 닫힌다**.

## 릴리스할 때 (절차 SSOT = `web/docs/릴리스.md`)

1. `latest.json` 을 새 버전으로 통째 교체 — `signature` 는 `.sig` 파일의 **내용**, `url` 은
   인스톨러의 **절대 URL**.
2. 인스톨러(`러닝허브_x.y.z_x64-setup.exe`)를 이 폴더에 함께 둔다(같은 오리진에서 내려받게).
   ⚠ git 에는 안 올린다(`.gitignore`) — 저장소에 바이너리를 쌓지 않는다.
3. `cd web && npm run build && cd ../server && npx wrangler deploy`
4. **엔드포인트 200 확인** — 이 확인이 없어서 404 가 배선된 채로 남았다:
   `curl.exe -I https://<워커>.workers.dev/updates/latest.json`
