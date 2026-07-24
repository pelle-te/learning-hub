# Cloudflare Workers + D1 — 셋업 런북

> **이 문서의 지위**: `클라우드전환-설계.md` §9-3(호스트 결정)의 **실행 절차서**다. 설계는 저기가 SSOT이고 여기는 "그래서 손으로 뭘 치는가"만 적는다.
> **호스트 변경**(사용자 결정 2026-07-19): **Oracle Cloud VM → Cloudflare Workers + D1.** Oracle 안은 폐기했고, 그 실행 런북도 함께 삭제했다.
> **검증일**: 2026-07-19. 아래 §10 의 사실표가 이 문서에서 유일하게 시간에 부패하는 부분이다. 착수 직전 다시 확인해라 — Oracle 이 왜 그래야 하는지 이미 증명했다.
> **적용 단계**: C-4(클라우드 백엔드). ⚠ **단, §6 의 판정이 C-2 범위를 바꾼다** — C-2 착수 전에 §6 을 읽어라.

---

## 0. 왜 바꿨나 — 근거 3개 중 2개가 소멸했다

설계서 §9-3 이 Oracle 을 고르고 Workers+D1 을 탈락시킨 근거는 셋이었다. 지금 남은 건 하나뿐이다.

| 원래 근거                                                          | 현재 상태                                                                                                                                                                                                  |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **① 성장 여지** (ARM 4 OCPU/24 GB 에 파이썬 도구·Ollama 도 나중에) | ❌ **소멸.** 2026-06-15 자 한도 반토막(2 OCPU/12 GB)으로 이미 취소됐고, 애초에 **I8 이 금지**하던 선택지였다(로컬 자원 기능은 인터넷에 의존하지 않는다) |
| **② 락인 없음** (Rust 단일 바이너리 + SQLite 파일 → 이식성 최대)   | ✅ **유효.** 이게 유일하게 살아남은 근거이고, Workers 로 가면 **실제로 지불한다.** §9 에서 정면으로 다룬다 — 축소해 적지 않는다                                                                            |
| **③ `rows.rs`(5-C)가 서버 매퍼로 재사용된다**                      | ❌ **소멸.** 서버가 TS 가 되면 `rows.ts` 를 **문자 그대로** 공유한다. `rows.rs` 는 다시 사장품이 된다(§6-4)                                                                                                |
| **(추가) 가입 가능성**                                             | ❌ **Oracle 은 실패했다.** 사용자가 카드 심사에서 반복적으로 막혔다. **가입되지 않는 호스트는 무료 티어가 아무리 커도 값이 0이다.** 이게 실질적 결정 사유다                                                |

**즉 이 전환은 "더 좋아 보여서"가 아니라 원래 근거가 무너져서다.** 그리고 대가는 §9(락인) 하나에 몰려 있다.

### 0-1. 이 전환이 **없애는** 작업 — VPS(Oracle) 절차 대비 절 단위 소멸

| Oracle 런북 절                                | Cloudflare 에서                                                                                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1-1 홈 리전(**영구 변경 불가**)              | **없다.** 전역 엣지 배포. 되돌릴 수 없는 결정 자체가 사라진다                                                                                        |
| §1-2 신용카드 · $1 승인 · 카드 거부           | **없다.** 무료 플랜은 카드 불요(§1)                                                                                                                  |
| §1-4 · §5 도메인 구매 + Caddy + TLS           | **없다.** `*.workers.dev` 에 신뢰되는 인증서가 자동(§10 표)                                                                                          |
| §3-3 "Out of host capacity" 재시도 루프       | **없다.** 프로비저닝할 호스트가 없다                                                                                                                 |
| §4 방화벽 **두 겹**(Security List + iptables) | **없다.** 이 런북 최대의 시간 함정이 통째로 사라진다                                                                                                 |
| §6 aarch64 크로스컴파일 · systemd 유닛        | **없다.** `wrangler deploy` 한 줄                                                                                                                    |
| §7-1 OS 자동 패치 · §7-2 SSH·fail2ban         | **없다.** 관리할 OS 가 없다                                                                                                                          |
| §7-3 인증서 갱신 확인                         | **없다.** 갱신 주체가 우리가 아니다                                                                                                                  |
| §8-1·8-2 **유휴 회수 방지**                   | **없다.** ⚠ 이게 가장 큰 이득이다 — Oracle 런북 §8 은 "사용자 1명 앱은 회수 판정에 정확히 걸린다"고 자백했고, 그 대응책 전부가 **인위적 노동**이었다 |
| §8-3 예산 알림                                | 남지만 성격이 다르다(§8)                                                                                                                             |

**남는 것은 §7-4(백업)와 §9(탈출)뿐이고, 그 둘은 호스트와 무관하게 G4 가 요구하던 것이다.**

---

## 1. 가입

**신용카드가 필요 없다.** 이메일 + 비밀번호로 계정을 만들고 Workers 무료 플랜을 바로 쓴다. 카드는 유료 플랜($5/월)으로 올라갈 때만 요구된다. ([Cloudflare 요금 페이지](https://www.cloudflare.com/plans/) · [Workers 요금](https://developers.cloudflare.com/workers/platform/pricing/))

> ⚠ **Oracle 과의 결정적 차이가 여기다.** Oracle 은 카드 심사가 **가입의 관문**이라 심사가 막히면 그 뒤 절차 전체가 시작조차 안 된다. Cloudflare 는 관문이 이메일 인증뿐이다.

절차:

1. https://dash.cloudflare.com/sign-up → 이메일 + 비밀번호
2. 이메일 인증 링크 클릭
3. 대시보드 좌측 **Compute (Workers)** 진입 → **workers.dev 서브도메인**을 정한다 (`<계정서브도메인>.workers.dev`)
   > ⚠ **서브도메인 이름은 신중히 정해라.** 배포 URL 이 `<worker이름>.<계정서브도메인>.workers.dev` 가 된다. 변경 가능 여부는 **미확인**(§10) — 처음에 원하는 값을 잡아라.
4. **2FA 를 켠다.** ⚠ 선택이 아니다 — 이 계정 하나가 데이터·인증키·배포 권한을 전부 쥔다(§8-3 의 단일 실패점).

**검증 — 이게 끝난 걸 어떻게 아는가**

- 대시보드에 로그인된다.
- Workers & Pages 화면에 본인 서브도메인이 `<이름>.workers.dev` 로 표시된다.
- 계정 설정에 2FA 가 **Enabled** 로 보인다.
- 결제 수단이 **등록돼 있지 않다**(= 실수로 과금될 경로가 없다).

---

## 2. wrangler 설치 · 인증 (Windows / PowerShell)

**Windows 11 은 공식 지원 대상이다. WSL 이 필요 없다.** 지원 OS 는 macOS 13.5+ / **Windows 11** / glibc 2.35+ 리눅스. ([설치 문서](https://developers.cloudflare.com/workers/wrangler/install-and-update/))

⚠ **전역 설치하지 마라.** 공식 권장이 프로젝트 로컬 devDependency 다. 전역 wrangler 는 버전이 저장소와 갈려서 "내 PC 에선 되는데" 계열 사고를 만든다 — 이 저장소가 `codegen:check` 로 막고 있는 것과 같은 종류의 드리프트다.

```powershell
# §4 에서 만들 server/ 폴더 안에서
npm i -D wrangler@latest
npx wrangler --version
```

Node 는 **22 이상**(루트 `web/package.json` 의 `engines.node: ">=22"` 와 일치 — 별도 요구가 늘지 않는다).

인증:

```powershell
npx wrangler login     # 브라우저가 열리고 OAuth 승인 → 로컬에 토큰 저장
npx wrangler whoami    # 계정 이메일 + Account ID 가 나와야 한다
```

> ⚠ **CI 에서는 `wrangler login` 이 안 된다**(브라우저가 없다). GitHub Actions 배포를 붙일 거면 `CLOUDFLARE_API_TOKEN` 을 저장소 시크릿으로 넣는다. 그리고 그 토큰은 **Workers 배포 + D1 편집 권한으로만** 좁혀라 — 계정 전역 토큰을 CI 에 넣으면 §8-3 의 단일 실패점이 CI 로 확장된다.

**검증**: `npx wrangler whoami` 가 계정 ID 를 출력한다. 이게 안 되면 그 뒤 모든 명령이 실패하므로 여기서 멈춰라.

---

## 3. D1 생성 + 스키마 이식 — ⚠ **이 런북에서 가장 위험한 절**

### 3-1. DB 생성

```powershell
npx wrangler d1 create hub-prod
npx wrangler d1 create hub-dev
```

출력의 `database_id` 를 `wrangler.jsonc` 에 붙인다(§7-2). 무료 플랜은 **DB 10개**까지라 dev/prod 두 벌은 여유롭다(§10).

### 3-2. ⚠ 스키마 두 벌 문제 — 이 저장소는 이미 두 번 물렸다

`src-tauri/src/db.rs` 가 **로컬 스키마의 SSOT** 다(파일 머리주석: _"프런트가 DDL 을 좌우하면 배포본마다 스키마가 갈릴 수 있다"_). 그런데 D1 도 SQLite 이고 **같은 테이블을 갖는다.** 즉 DDL 이 두 벌이 될 자리가 생긴다.

**이 저장소가 이 병에 걸린 이력**:

- `rows.ts` ↔ `rows.rs` 쌍둥이 — 5-C 가 매퍼를 손으로 두 벌 만들었고, 설계서 §5-2 가 그걸 _"행 모양 이중 정의"_ 로 지목했다.
- `outbox.ts:75-82` 가 세 번째 사본을 만들지 않으려고 `TABLES` 를 **파생**시킨 것도 같은 이유다("열 하나가 추가될 때 조용히 안 실려 나가는 필드가 생긴다").

**손으로 두 벌 쓰면 세 번째로 물린다. 세 안을 놓고 판정한다.**

| 안                                                          | 드리프트 방지                                  | 대가                                                                    |
| ----------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------- |
| ⓐ `migrations/*.sql` 을 손으로 작성                         | ❌ **없음.** 사람의 기억에 의존                | 0                                                                       |
| ⓑ `db.rs` → `.sql` **생성 스크립트** + `codegen:check`      | 🔶 검사로 **감지**(방지는 아님)                | 스크립트 + Rust 문자열 파싱. ⚠ 파서가 또 하나의 갈릴 수 있는 것         |
| **ⓒ `.sql` 파일을 SSOT 로 승격, `db.rs` 는 `include_str!`** | ✅ **원리적으로 불가능해진다** — 파일이 하나다 | `db.rs` 를 한 번 리팩터(⚠ 저장소 파일 수정 — 이 문서 범위 밖, C-4 작업) |

**판정: ⓒ.** 근거는 이 저장소의 기존 규율과 정확히 같다 — `gen-artifacts.mjs` 는 부모 저장소 JSON Schema 가 **원본이라 생성이 필요했지만**, 여기는 원본을 **양쪽이 공유할 수 있다.** 생성·검사는 원본을 공유할 수 없을 때 쓰는 차선책이지 목표가 아니다. 그리고 ⓑ 의 파서는 "드리프트를 막으려고 드리프트할 수 있는 물건을 하나 더 만드는" 구조다.

**ⓒ 의 구체적 형태**

```
src-tauri/migrations/
  0001_initial.sql        ← db.rs v1 의 sql 문자열 그대로
  0002_user_docs.sql      ← v2
  0003_sync.sql           ← v3
  0004_offline_queue.sql  ← v4
```

- `db.rs` 는 `sql: include_str!("../migrations/0001_initial.sql")` 로 바뀐다. **version·description·kind 메타는 Rust 에 남는다** — `tauri-plugin-sql` 이 요구하고, 그건 DDL 이 아니다.
- ⚠ **`db.rs` 의 주석은 옮기지 마라.** v2·v3·v4 머리주석에 "왜 툼스톤인가" "왜 `settings` 재사용을 안 하는가" 같은 **설계 근거가 대량**으로 있다. 그건 Rust 쪽에 남기고 `.sql` 은 DDL 만 담는다. 근거와 DDL 이 갈리는 건 드리프트가 아니다 — 근거는 실행되지 않는다.
- `wrangler.jsonc` 에서 같은 폴더를 가리킨다:

```jsonc
"d1_databases": [{ "binding": "DB", "database_name": "hub-prod", "database_id": "...",
                   "migrations_dir": "../src-tauri/migrations" }]
```

파일명 규약(`0001_name.sql`)은 wrangler 기본과 맞다. 적용 이력은 D1 이 `d1_migrations` 테이블에 남긴다. ([마이그레이션 문서](https://developers.cloudflare.com/d1/reference/migrations/))

### 3-3. ⚠ 스키마가 **완전히 같지는 않다** — 그 차이를 어떻게 다루나

`db.rs` 의 8테이블 중 서버에 **필요 없는 것이 셋**이다:

| 테이블          | 서버에 불필요한 이유                                                                          |
| --------------- | --------------------------------------------------------------------------------------------- |
| `meta`          | `present` 는 **파생값**(`rows.ts` 가 매번 재생성). `TableSpec.sync: false`                    |
| `runtime_cache` | 내보내기에서 빠지는 로컬 낙관적 캐시. `sync: false`                                           |
| `sync_state`    | **기기 로컬** 워터마크. `db.rs` v4 주석이 _"내보내기·동기화 대상이 되어선 안 된다"_ 고 못박음 |

**판정: D1 에도 8테이블을 전부 만들고, 서버는 `sync: true` 인 것만 건드린다.**

- 스키마를 필터링하면 마이그레이션 파일이 **두 갈래**가 되어 ⓒ의 이점이 즉시 사라진다.
- 안 쓰는 빈 테이블 3개의 비용은 **0에 가깝다**(무료 500MB/DB).
- 그리고 그 필터는 **이미 선언적으로 존재한다** — `rows.ts:96-105` 의 `TableSpec.sync`. 서버가 `TABLES.filter(t => t.sync)` 로 읽으면 필터가 코드에 한 번만 산다. `outbox.ts:82` 가 이미 정확히 그렇게 한다.

> ⚠ **서버에 `sync_state` 를 절대 쓰지 마라.** 워터마크는 기기별 값이다. 서버가 거기 쓰면 PC 의 워터마크로 폰의 진행을 덮는다 — **조용한 유실**이고 C-1 이 fence 로 막으려던 것과 같은 계열의 사고다.

### 3-4. 적용

```powershell
npx wrangler d1 migrations list  hub-dev  --remote
npx wrangler d1 migrations apply hub-dev  --remote
npx wrangler d1 migrations apply hub-prod --remote
```

⚠ **`--remote` 를 빼면 로컬 miniflare DB 에 적용된다.** dev 루프에선 그게 맞지만, "적용했는데 왜 안 보이지"의 1순위 원인이다.

⚠ **바인딩 이름(`DB`) 이 아니라 DB 이름(`hub-prod`)으로 불러라.** 바인딩은 환경마다 같은 이름으로 다른 DB 를 가리키므로 실수로 prod 에 적용된다. 공식 문서도 이걸 권한다.

### 3-5. 검증 — 두 벌이 실제로 같은가

```powershell
# ① D1 의 실제 스키마 덤프
npx wrangler d1 export hub-prod --remote --no-data --output=.\schema-d1.sql

# ② 로컬 Tauri DB 의 스키마 (앱을 한 번 띄운 뒤)
sqlite3 "$env:APPDATA\<앱데이터경로>\learning-hub.db" ".schema" > .\schema-local.sql

# ③ 눈으로 비교 (sync 대상 7테이블 + 인덱스)
Compare-Object (Get-Content .\schema-d1.sql) (Get-Content .\schema-local.sql)
```

**차이는 `d1_migrations` 테이블과 `_cf_KV` 뿐이어야 한다.** 그 외 한 줄이라도 다르면 ⓒ가 깨진 것이다 — 멈추고 원인을 찾아라.

⚠ **이 비교를 CI 에 넣을 유혹을 참아라.** `wrangler d1 export --remote` 는 실 DB 를 잠그고(문서: _"exports block other database requests"_) 요청 쿼터를 쓴다. **릴리스 전 수동 체크리스트**가 맞는 자리다.

---

## 4. Worker 프로젝트 배치 — `web/` 을 오염시키지 않는다

### 4-1. 판정: **`hub/server/` 형제 폴더**

```
hub/
  web/          ← 프런트 (건드리지 않는다)
  src-tauri/    ← Tauri 셸 + migrations/ (§3-2 ⓒ)
  server/       ← ★ 신설. Worker
    package.json      (자체 — wrangler·hono·zod)
    wrangler.jsonc
    tsconfig.json
    src/index.ts
```

**`web/` 안에 두면 안 되는 이유**(전부 절대규칙 위반 또는 게이트 오염):

| 넣었을 때 깨지는 것        | 어떻게                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run build`            | `tsc -b` 가 Worker 소스를 브라우저 타깃으로 컴파일하려 든다(`@cloudflare/workers-types` 충돌)  |
| `npm run budget`           | 번들 예산(393.9KB gzip)에 서버 코드가 섞인다                                                   |
| `knip`                     | Worker 전용 export 를 "미사용"으로 잡거나, 반대로 잡아주지 못한다                              |
| `eslint-plugin-boundaries` | Worker 는 `app/features/components/hooks/store/lib` 어느 층도 아니다 → 룰에 구멍을 뚫어야 한다 |
| **절대규칙 #1**            | Tauri 셸이 로드할 `web/dist` 에 서버 코드가 섞일 여지                                          |

**`src-tauri/` 안도 아니다** — 저긴 Rust 크레이트다.

### 4-2. ⚠ I2(레이어 단방향)는 **위반되지 않는다** — 방향을 확인해라

`server/` 가 `web/src/lib/` 을 import 한다. 방향은 **server → lib** 이다.

I2 는 _"`app → features → components → {hooks, store} → lib`, 역방향 금지"_ 이고 `lib` 은 **최하위**다. 즉 server 는 `components` 와 **같은 위치의 소비자**이지 역방향이 아니다. 그리고 설계서 §4 가 이미 이 구조를 명시했다 — _"폰 앱은 `features/` 가 아니라 `lib/` 을 재사용한다. 이게 가능한 유일한 이유가 절대규칙 #2다."_ **Worker 는 그 재사용의 첫 소비자**다.

> ⚠ **다만 `lib/` 이 전부 안전한 건 아니다.** `lib/tauri.ts`(invoke) · `lib/db/sqlite.ts`(tauri-plugin-sql) · `lib/api.ts`(전송 분기)는 **Tauri/브라우저 런타임을 요구**한다. Worker 에서 import 하면 런타임에 죽는다.
>
> **방어**: `server/tsconfig.json` 의 `paths` 로 허용 경로를 **화이트리스트**한다(`@hub/schema`, `@hub/rows`, `@hub/cloud/outbox` 정도). eslint `no-restricted-imports` 로 상대경로 우회를 막는다. ⚠ **관습에 두면 흘러내린다** — CLAUDE.md 가 `lint:css` 를 두고 내린 결론과 같다.

### 4-3. 프레임워크

**Hono** 를 권한다(표준 Fetch API 위에서 도는 라우터). ⚠ 근거는 편의가 아니라 **§9 의 탈출 비용**이다 — Hono 앱은 Node/Deno/Bun 어댑터가 있어 VPS 로 이사할 때 라우팅 층이 그대로 간다. Workers 전용 API 에 직접 붙으면 그 층이 이사 비용이 된다.

**검증**: `server/` 에서 `npx wrangler dev` 가 뜨고, `web/` 에서 `npm run verify` 와 `npm run build` 가 **이전과 동일하게** 통과한다. ← **후자가 이 절의 진짜 검증이다.**

---

## 5. 인증 — P0-2(토큰 수명·회전) + P1-4(기기 단위 주체)

### 5-1. 무엇을 어디에 두나

| 무엇                                                  | 어디                     | 왜                                                                                                         |
| ----------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| **서명 비밀키**                                       | **Workers Secret**       | `wrangler secret put HUB_SIGNING_KEY`. 코드·저장소에 없고 대시보드에서도 다시 못 읽는다                    |
| **기기 레코드**(id·이름·등록시각·마지막사용·폐기여부) | **D1**                   | 열거·폐기가 가능해야 한다(P1-4: _"폰을 잃었을 때 모든 기기를 끊는 것 외에 방법이 없다"_ 를 푸는 것이 목적) |
| **액세스 토큰**                                       | **어디에도 저장 안 함**  | HMAC 서명된 자기기술 토큰. 짧은 수명(예 15분). 서버가 상태를 안 들면 검증이 CPU 예산 안에 들어온다         |
| **폐기 목록**                                         | D1(기기 레코드의 플래그) | ⚠ KV 를 쓰지 마라 — 아래                                                                                   |

> ⚠ **KV 를 인증 경로에 쓰지 마라.** 무료 KV 는 **쓰기 1,000/일**(서로 다른 키 기준)이다(§10). "마지막 사용 시각 갱신" 같은 걸 KV 에 하면 **하루 1,000회에 인증이 멈춘다.** D1 쓰기는 100,000/일이라 두 자릿수 여유가 있다. KV 는 이 설계에서 **필요 없다.**

### 5-2. ⚠ **CPU 10ms 벽** — Oracle 에는 없던 제약이 인증 설계를 바꾼다

무료 Workers 는 요청당 **CPU 10ms** 다(§10). 이 예산이 인증 방식을 강제한다:

- ✅ **HMAC-SHA256 검증** — Web Crypto 네이티브. 마이크로초 단위. 안전하다.
- ❌ **bcrypt / scrypt / Argon2** — 의도적으로 느린 KDF 다. **10ms 를 넘긴다.** 비밀번호 로그인을 붙이지 마라.

**그래서 온보딩은 비밀번호가 아니라 등록 코드 방식이다:**

1. **관리자가 1회용 등록 코드를 발급**한다 → 서버가 D1 에 짧은 수명으로 저장. 발급은 관리 비밀
   (`HUB_ADMIN_KEY`)로 보호되는 `POST /api/enroll/new` 한 방이다:

   ```sh
   # 코드 한 개 발급(10분 만료). ADMIN_KEY 는 `wrangler secret put HUB_ADMIN_KEY` 로 넣은 값.
   curl -s -X POST https://<워커>.workers.dev/api/enroll/new \
     -H "Authorization: Bearer <HUB_ADMIN_KEY>"
   # → {"code":"A1B2C3…","expiresIn":600}
   ```

   > ⚠⚠ **앱 안에 '코드 발급' 버튼은 없고, 있으면 안 된다**(2026-07-24 감사가 잡은 결함 — 서버
   > 라우트는 있는데 부르는 클라이언트도 이 절차도 없어 온보딩이 막다른 길이었다. 폐기(§263)와 같은
   > 계열). `CloudCard`·폰 `Connect` 는 코드를 **제출(claim)**하는 쪽이고, 발급은 관리 비밀을 쥔
   > **관리자(=배포한 본인)의 수동 작업**이다 — 데스크톱에 `HUB_ADMIN_KEY` 를 심으면 코드 하나로
   > 새 기기가 붙는 그 비밀이 앱 번들에 박혀 유출면이 된다. 그래서 UI 버튼이 아니라 이 curl 이다.
   > 기기마다(폰·PC 각 1회) 코드를 새로 발급한다(claim 은 1회용이라 소비된다).
2. 기기가 그 코드를 제출(PC=설정 탭 `CloudCard`, 폰=`Connect` 화면) → 서버가 **기기 레코드 생성**
   + 장기 리프레시 토큰 발급(기기당 하나)
3. 이후 기기는 리프레시 토큰으로 **짧은 수명 액세스 토큰**을 받아 쓴다
4. **폐기** = D1 의 기기 레코드에 플래그 → 리프레시가 즉시 막힌다. ⚠ **액세스 토큰도 즉시 막힌다** — `requireDevice` 가 매 요청 폐기 여부를 확인하기 때문이다(무상태 서명에만 기대면 최대 15분간 계속 통과한다. 도난 시점에 15분은 짧지 않다). 라우트는 `GET /api/devices` · `POST /api/devices/revoke`, UI 는 설정 탭 `CloudCard`.
   > ⚠ 이 문서는 C-4 시점에 폐기를 **구현된 것처럼** 서술했지만, 실제로는 `revoked_at` 열과 검사만 있고 **쓰는 코드가 없었다**(2026-07-20 감사). 2026-07-20 에 실제로 넣었다.

> ⚠ **토큰을 URL 에 싣지 마라.** P0-2 가 지목한 현 모델(`server.rs:330`, URL PSK)의 재현을 막는 것이 이 절의 존재 이유다. `Authorization: Bearer` 헤더만 쓴다. (VPS 안이 쓰려던 `Referrer-Policy` 는 URL 에 토큰이 있을 때의 완화책이었을 뿐 — 헤더로만 나르면 애초에 샐 곳이 없다.)

⚠ 액세스 토큰 응답에 **`Cache-Control: no-store`** 를 붙인다(P1-6). Workers 는 기본 헤더를 안 붙이므로 **명시해야 한다** — 설계서 P1-6 이 axum 기본값을 두고 _"의도가 아니라 우연"_ 이라 지적한 것과 정확히 같은 함정이다.

⚠ **CORS 를 명시 설정한다**(P1-6). 폰 웹앱이 다른 오리진에서 붙으므로 필요하고, 넓게 열면 안 된다.

### 5-3. 검증

- 유효 토큰 없이 `/api/push` → **401**
- 만료 토큰 → **401**
- 기기를 폐기한 뒤 그 기기의 리프레시 → **401**, 다른 기기는 정상
- 응답 헤더에 `Cache-Control: no-store` 가 있다
- `npx wrangler secret list` 에 `HUB_SIGNING_KEY` 가 보이고 **값은 안 보인다**

---

## 6. 수신 검증 (P0-3) — ★ **C-2 범위 판정**

### 6-1. 판정: **JSON Schema → TS+Rust 양쪽 codegen 파이프라인은 불필요하다**

설계서 §9-3 이 _"서버가 TS 가 아니니 zod 를 문자 그대로 공유할 수 없다 → JSON Schema 를 SSOT 로 TS(zod) + Rust(serde/validator) 양쪽 생성"_ 이라 적었다. **그 전제가 호스트 변경으로 사라졌다.**

Worker 는 TypeScript 다. `web/src/lib/schema.ts` 의 zod 를 **import 해서 그대로 실행한다.** 생성기도, `codegen:check` 확장도, 스키마 언어(JSON Schema)를 하나 더 배우는 일도 **전부 필요 없다.**

> **원본을 공유할 수 있으면 생성하지 않는다.** §3-2 에서 `.sql` 을 SSOT 로 올린 판정과 같은 원칙이고, 이 저장소의 `gen-artifacts.mjs` 가 생성기인 것은 **원본이 부모 저장소에 있어 공유가 불가능했기 때문**이다. 여기는 그 조건이 아니다.

### 6-2. 그렇다고 C-2 가 작아지지는 않는다 — **범위가 이동한다**

| C-2 항목                                         | 호스트 변경 후                                                                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/tauri.ts` 무검증 `invoke<T>` 에 런타임 파싱 | **변동 없음.** 로컬 IPC 계약이라 호스트와 무관                                                                                                               |
| `.strict()` **수신 전용 파생**                   | **변동 없음, 오히려 더 중요해진다.** `ItemSchema`·`AppStateSchema` 가 `.passthrough()` 인 것은 I1(백업 호환)용 **의도**이고, 신뢰 경계에선 정반대로 작동한다 |
| 마이그레이션 테스트(v1→v2→v3→v4 순차 이행)       | **변동 없음.** ⚠ §3-2 ⓒ가 `.sql` 을 **양쪽 공용**으로 만들면 이 테스트의 값이 **올라간다** — 잘못된 이행이 이제 전 기기 + 서버로 복제된다                    |
| ~~JSON Schema SSOT + Rust 생성기~~               | ❌ **삭제.** 이게 C-2 에서 빠지는 유일한 항목이다                                                                                                            |
| **`OutboxBatch` 의 zod 스키마** ← **신설**       | ⚠ **새로 들어온다.** `outbox.ts:59-66` 의 `OutboxBatch` 는 지금 **TS 인터페이스일 뿐 런타임 검증이 0** 이다. 그런데 이게 **서버가 받는 바로 그 페이로드**다  |

**`OutboxBatchSchema` 가 C-2 의 새 핵심이다.** 근거:

- `OutboxRow.data` 는 `unknown[]` 이고 `key` 는 `string[]` 이다 — **가장 느슨한 타입이 신뢰 경계를 통과한다.**
- `tbl` 은 자유 문자열이다. 서버가 이걸 SQL 테이블명에 그대로 쓰면 **인젝션**이다. → `z.enum(TABLES.filter(t=>t.sync).map(t=>t.name))` 로 좁혀라. 값을 파생시키면 테이블이 늘 때 자동으로 따라온다(`outbox.ts:75-82` 와 같은 사상).
- `data` 길이는 `cols.length - keyLen` 과 **정확히 같아야** 한다. 안 맞는 배치는 열이 어긋난 채 upsert 된다 — 조용한 데이터 파손이다.
- `updatedAt`·`deletedAt` 은 유한 정수여야 한다. `NaN`/`Infinity` 가 워터마크 비교를 오염시킨다.
- ⚠ **배치 크기 상한**을 스키마에 넣어라(§8-2 의 CPU 벽 때문에 필요하다).

**→ C-2 범위 = (기존 3항목) − (JSON Schema/Rust codegen) + (`OutboxBatchSchema`).** 순증도 순감도 아니고, **더 구체적이 됐다.**

### 6-3. 코드 배치 — 공유가 성립하려면

`web/src/lib/schema.ts` 는 **React 무관 순수 zod** 라 그대로 import 된다(I2 가 지켜준 자산). `OutboxBatchSchema` 는 **`web/src/lib/cloud/` 안**에 둔다 — 그 타입의 원산지가 거기이고, `outbox.ts` 가 만들어 `push.ts` 가 보내고 서버가 받는다. 스키마가 타입 옆에 있어야 갈리지 않는다.

⚠ **서버 폴더에 스키마 사본을 만들지 마라.** 그게 이 문서가 §3-2 부터 계속 막고 있는 그 병이다.

### 6-4. ⚠ 부수 결과 — `rows.rs` 가 사장품이 된다

5-C 가 이식한 `src-tauri/src/rows.rs` 는 설계서 §7 이 _"서버가 어디 있든 필요하다"_ 며 완료 처리한 항목이다. **서버가 TS 가 되면 그 근거가 사라진다.** 그리고 커밋 이력상 **배선도 안 돼 있다**(`5단계-C … 배선은 안 함`).

**판정을 C-4 착수 시 내려야 한다** — 이 문서는 결정하지 않는다:

- **삭제** — 죽은 코드는 거짓 안전감을 준다. `rows.ts` 가 바뀌어도 아무도 안 알려주는 쌍둥이가 남는다
- **유지** — 로컬 Tauri 쪽 쓰기 경로를 Rust 로 내리는 계획이 살아 있다면

> ⚠ **어느 쪽이든 "일단 둔다"가 최악이다.** 갱신되지 않는 쌍둥이는 설계서가 지목한 divergence 그 자체다.

---

## 7. 배포 · 롤백 · 환경 분리

### 7-1. 환경 분리

`wrangler.jsonc` 의 `env` 로 dev/prod 를 가른다. **각각 다른 D1 · 다른 Secret · 다른 URL** 이다.

```jsonc
{
  "name": "hub-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-07-19",
  "d1_databases": [
    { "binding": "DB", "database_name": "hub-dev", "database_id": "…", "migrations_dir": "../src-tauri/migrations" },
  ],
  "env": {
    "prod": {
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "hub-prod",
          "database_id": "…",
          "migrations_dir": "../src-tauri/migrations",
        },
      ],
    },
  },
}
```

> ⚠ **`compatibility_date` 를 박아라.** 안 박으면 런타임 동작이 시간에 따라 바뀐다 — 이 저장소가 GPU 를 `--disable-gpu` 로 핀 고정한 것과 같은 이유다(재현 가능성).
>
> ⚠ **기본(무 env) 타깃을 prod 로 두지 마라.** `wrangler deploy` 를 무심코 치면 그게 나간다. 기본은 dev, prod 는 **명시적으로만**.

```powershell
npx wrangler dev                    # 로컬 (miniflare + 로컬 D1)
npx wrangler deploy                 # → dev
npx wrangler deploy --env prod      # → prod (의도적으로 한 단어 더 친다)
```

### 7-2. 롤백

```powershell
npx wrangler deployments list --env prod
npx wrangler rollback <DEPLOYMENT_ID> --env prod
```

> ⚠ **롤백은 코드만 되돌린다. D1 마이그레이션은 안 되돌아간다.** 이게 이 절의 유일한 진짜 함정이다.
>
> **그러므로 마이그레이션은 앞뒤 호환으로만 써라** — 열 추가는 되고, 열 삭제·이름 변경·타입 변경은 **두 배포로 나눠라**(① 새 열 추가 + 양쪽 쓰기 → ② 옛 열 제거). `db.rs` v3 가 `ADD COLUMN … DEFAULT 0` 만 쓴 것은 이 규율의 우연한 선례다.
>
> ⚠ **D1 에는 되돌리기(down) 마이그레이션이 없다.** 복구 수단은 **Time Travel**(무료 7일 시점 복원)뿐이다(§10). 마이그레이션 전에 §9-1 의 JSON 을 손에 쥐고 시작해라.

### 7-3. 검증

- `npx wrangler dev` 로 로컬 `/health` 200
- `deploy` 후 `https://hub-api.<서브도메인>.workers.dev/health` 200 **(HTTPS 자동 — §10)**
- **평문 폴백 확인**: `http://…/health` 가 **HTTPS 로 리다이렉트되거나 거부**돼야 한다. ⚠ 200 이 평문으로 오면 P0-1 위반이다 — Oracle 런북 §5-4 의 그 검증은 호스트가 바뀌어도 **그대로 유효하다**
- `deployments list` 에 두 환경이 **분리돼** 보인다
- prod D1 에 dev 데이터가 **없다** ← 이걸 꼭 확인해라. 바인딩 이름이 같아서 섞기 쉽다
- **정적 자산(C-6)** — `/` 와 `/plan` 이 200 `text/html`, `/api/health` 가 JSON. 절차와 함정은 **§7-6**

### 7-4. 왕복 검증은 **자동화돼 있다**(2026-07-20 신설)

`cd server && npm run verify` 가 typecheck·format·계약(SQL 의미론)에 더해 **`test:roundtrip`** 을 돌린다 — `@cloudflare/vitest-pool-workers` 로 **진짜 workerd + 진짜 D1** 을 인프로세스로 띄워 온보딩 → 토큰 → push → pull → **폐기**를 왕복한다(12케이스 1.7초). CI 의 `cloud-server` 잡이 같은 것을 돈다.

> ⚠ **§7-3 의 수동 확인을 대체하지 않는다.** 왕복 테스트는 *우리 코드*를 검증하고, §7-3 은 _배포된 실물과 Cloudflare 의 동작_(평문 폴백·환경 분리·D1 격리)을 검증한다. 후자는 로컬에서 재현할 수 없다.

### 7-5. ⚠ 레이트 리밋 — **주 방어는 코드가 아니라 대시보드다**

`server/src/index.ts` 의 카운터는 **아이솔레이트 로컬**이라 분산 요청은 그대로 통과한다(그 사실을 코드 주석이 명시한다). 실수·폭주 루프를 싸게 끊는 보조 방어일 뿐이다.

**진짜 방어는 Cloudflare WAF 레이트 리밋 규칙**(무료 플랜 1개 제공):

1. 대시보드 → 해당 도메인/Worker → **Security → WAF → Rate limiting rules**
2. 규칙 생성 — 매칭: `URI Path` starts with `/api/enroll` **또는** `/api/token`
3. 임계값: **10 requests / 1 minute / IP**, 동작 **Block**, 지속 **10분**
   - 근거: 정상 사용은 등록 1회 + 15분마다 토큰 1회다. 10/분이면 정상 사용의 100배 이상 여유다.
4. ⚠ `/api/sync/*` 에는 **걸지 말 것.** 이미 토큰이 필요하고, 여기 걸면 첫 전량 동기화(여러 배치로 나뉜다)가 자기 규칙에 막힌다.

D1 카운터로 만들지 않은 이유: 공격받는 동안 **카운터 쓰기가 그 자체로 D1 일일 한도를 태운다** — 막으려던 것을 방어가 대신 하게 된다(§8-2 가 지목한 실패 모드).

### 7-6. 정적 자산(폰 웹앱) 배포 — **같은 오리진**에서 나간다 (C-6)

C-6 부터 폰 웹앱을 **API 와 같은 Workers 오리진**에서 서빙한다. 별도 호스팅(Pages·Netlify)을 두지 않는 이유는 설계서 §9-1 과 같다 — 오리진이 갈리면 **CORS·인증·배포가 두 벌**이 되고, 그 둘을 동기화하는 일이 새 작업으로 남는다.

**설정은 `server/wrangler.jsonc` 의 `assets` 블록 하나다**(wrangler 4.112.0 스키마 기준):

```jsonc
"assets": {
  "directory": "../web/dist",
  "not_found_handling": "single-page-application",
  "run_worker_first": ["/api/*"],
}
```

#### 배포 절차 — ⚠ **순서가 있다**

```powershell
cd web;    npm run build       # ① dist 재생성 — 이게 실제로 배포되는 물건이다
cd ..\server; npm run verify   # ② 게이트(자산 라우팅 검사 포함)
npx wrangler deploy            # → dev   (자산은 wrangler 가 함께 올린다)
npx wrangler deploy --env prod # → prod
```

> ⚠ **①을 빼먹으면 옛 화면이 배포된다.** CLAUDE.md 절대규칙 1("Tauri 셸이 prebuilt `web/dist/` 를 로드한다 → 소스 수정 후 반드시 빌드")이 **클라우드에도 그대로 적용된다** — 이제 같은 `dist` 를 데스크톱 셸과 폰이 **함께** 본다. `wrangler deploy` 는 `web` 빌드를 자동으로 돌려 주지 않는다(`npm run tauri:build` 와 다른 점이다).
>
> ⚠⚠ **`../web/dist` 가 없거나 비어도 배포는 "성공"한다**(실측). wrangler·miniflare 는 조용히 자산 0개로 동작한다 — 즉 API 는 멀쩡한데 **폰만 안 뜬다**. 아래 확인을 건너뛰지 마라.

#### `/api/*` 가 SPA 폴백에 삼켜지지 않는 이유 — `run_worker_first`

`not_found_handling: "single-page-application"` 은 "매치되는 자산이 없으면 `index.html` 을 준다"는 뜻이다. 그 규칙과 API 라우트가 **같은 오리진에서 충돌**한다. 실 workerd 로 두 설정을 재 봤다:

| 경로          | `run_worker_first` 있음 | 없음                |
| ------------- | ----------------------- | ------------------- |
| `/`           | 200 `index.html`        | 200 `index.html`    |
| `/plan`       | 200 `index.html`        | **404 (워커로 샘)** |
| `/api/health` | 200 (워커)              | 200 (워커)          |
| `/nope.js`    | 200 `index.html`        | **404 (워커로 샘)** |

읽어야 할 것 둘:

1. **그 줄이 없으면 SPA 폴백이 안 산다** — 폰에서 `/plan` 을 **새로고침하는 순간 404** 다. 사용자 워커가 있으면 자산 워커는 *존재하는 자산*만 내주고 나머지를 워커로 흘려보내기 때문이다.
2. **`/api/*` 는 어느 쪽이든 워커에 닿지만 이유가 다르다** — 없을 때는 "자산이 없어서 흘러온" 것(우연)이고, 있을 때는 "그렇게 적어서"(의도)다. 설계서 §6 **P1-6** 이 지목한 구분이 정확히 이것이다. 우연에 기대면 `web/dist` 안에 `/api/…` 이름의 파일이 하나 생기는 순간 API 가 가려진다.

> ⚠ 뒤집어 말하면 **`/api/*` 밖의 워커 라우트는 이제 자산 워커가 삼킨다.** 새 라우트를 `/api/` 밖에 만들 거면 `run_worker_first` 배열에 같이 넣어라 — 안 그러면 200 + `index.html` 이 온다.

이 라우팅은 **`server/test/assets.test.ts` 가 실 workerd 로 잠근다**(`npm run verify` 에 포함). ⚠ `roundtrip.test.ts` 에는 넣을 수 없다 — `vitest-pool-workers` 0.18.6 의 `SELF` 는 자산 라우터를 건너뛴다(실측·그 파일 머리주석).

#### CORS 는 이제 **아무도 안 쓴다**

같은 오리진이 되면서 교차 출처 호출자가 **0** 이 됐다:

| 호출자            | 어떻게 오나                              | CORS 관여                       |
| ----------------- | ---------------------------------------- | ------------------------------- |
| 폰 웹앱           | 같은 Workers 오리진                      | **없음 — 동일 출처**            |
| 데스크톱 Tauri 셸 | 웹뷰가 아니라 **Rust(`reqwest`)가 중계** | **없음 — `Origin` 헤더가 없다** |

데스크톱 쪽은 오해하기 쉬우니 근거를 적어 둔다: `web/src/lib/cloud/client.ts` 의 `send()` 가 `isTauri()` 면 IPC(`cloudHttp`)로 내려가고 그 끝이 `src-tauri/src/cloud.rs` 다(C-3 의 CSP 가 웹뷰 fetch 를 막아서 그렇게 만들어졌다). 따라서 `tauri://localhost` 라는 Origin 은 **애초에 발생하지 않는다.**

그래도 허용목록 코드는 **지우지 않았다.** 지우면 "브라우저가 알아서 막아 주는" 상태로 돌아가는데 그건 다시 *우연히 안전*이다(P1-6 이 지적한 그 형태). 서버가 명시적으로 "허용목록이 비면 어떤 교차 출처도 열지 않는다"고 말하는 편이 낫고, 비용은 0 이다.

> ⚠ **`HUB_ALLOWED_ORIGINS` 는 비워 두는 것이 정상 운영 상태다.** 설정할 이유는 폰 웹앱을 다른 오리진에 따로 올릴 때뿐이고, 그건 C-6 이 **일부러 택하지 않은** 구성이다. 와일드카드(`*`)는 넣지 마라 — 허용목록이 비어 폰이 안 붙는 실패는 즉시 드러나지만, 와일드카드로 열린 채 도는 것은 드러나지 않는다.

#### 캐시 헤더

- **API(`/api/*`)** — `no-store`. `index.ts` 의 미들웨어가 붙인다. 전부 개인 데이터라 캐시할 것이 없다.
- **정적 자산** — 자산 워커가 전담하며 **Hono 를 아예 거치지 않는다.** 그래서 위 `no-store` 가 번들에 새어 붙지 않는다(붙으면 폰이 앱을 열 때마다 번들 전량을 셀룰러로 다시 받는다).
- **HTML 진입점** — 자산 워커가 `public, max-age=0, must-revalidate` 를 붙인다(실측). `no-store` 는 아니지만 **재검증을 강제**하므로 옛 번들에 고착되지 않는다. `no-store` 로 바꾸려면 `_headers` 파일이나 자산을 워커로 끌어와 직접 서빙하는 코드가 필요한데, 얻는 것(304 대신 200)보다 대가가 크다 → **바꾸지 않는다.** 그 *성질*은 `assets.test.ts` 가 단언한다.

#### 배포 후 확인

```powershell
curl.exe -I https://<워커>.workers.dev/            # 200 · content-type: text/html
curl.exe -I https://<워커>.workers.dev/plan        # 200 · text/html  ← SPA 폴백
curl.exe -s  https://<워커>.workers.dev/api/health # {"ok":true}      ← 자산에 안 삼켜짐
```

> ⚠ 세 번째가 `<!DOCTYPE html>` 을 뱉으면 `run_worker_first` 가 안 먹은 것이다. 두 번째가 404 면 `not_found_handling` 이 안 먹은 것이다. **폰으로 직접 열어 보기 전에 이 세 줄을 먼저 쳐라.**

---

## 8. 한도 모니터링 — **무엇이 먼저 터지는가**

### 8-1. 러닝허브 실사용 대입

설계서 §2-1: 앱 DB **106 KB**, 이관 대상 총 **800 KB**. 사용자 **1명**.

| 무료 한도           | 값             | 러닝허브 예상           | 여유             |
| ------------------- | -------------- | ----------------------- | ---------------- |
| Workers 요청        | 100,000/일     | 폴링 30초여도 ~2,900/일 | **34배**         |
| D1 스토리지(계정)   | 5 GB           | ~0.001 GB               | **5,000배**      |
| D1 스토리지(DB 1개) | 500 MB         | ~0.1 MB                 | **5,000배**      |
| D1 **행 읽기**      | 5,000,000/일   | 인덱스 사용 시 수천     | 크다             |
| **D1 행 쓰기**      | **100,000/일** | 편집당 수 행            | ⚠ **1순위 병목** |
| **Worker CPU**      | **10 ms/요청** | 배치 크기에 비례        | ⚠ **2순위 병목** |

### 8-2. ⚠ 먼저 터지는 것 둘 — 둘 다 Oracle 에는 없던 실패 모드다

**① D1 행 쓰기 100,000/일 — 절벽이지 경사가 아니다.**
초과하면 _"D1 API 가 일일 한도 초과 오류를 반환"_ 한다(§10). 즉 **쓰기가 전면 거부**되고 00:00 UTC 까지 복구되지 않는다.

- 평상시엔 안 닿는다. **닿는 시나리오는 하나** — **워터마크 0 에서의 전량 초기 동기화**, 또는 워터마크가 리셋된 재동기화.
- ⚠ **인덱스도 쓰기에 계산되는지는 미확인**(§10). `db.rs` v4 가 7테이블에 `updated_at` 인덱스를 깔았으므로, 계산된다면 쓰기 배수가 붙는다. **보수적으로 배수를 가정하고 설계해라.**
- ⚠ **`push.ts` 에 새 종료 조건이 필요하다.** 현재 백오프는 `maxDelayMs` 60초 상한이라(`push.ts:57`) 일일 한도에 걸리면 **하루 종일 1분마다 헛치는다** — 요청 한도는 견디지만 무의미한 소모다. 서버가 "일일 한도"를 **재시도 불가 오류로 구분해 반환**하고 클라이언트가 다음 UTC 자정까지 멈춰야 한다. → **C-5 범위 추가 항목.**

**② Worker CPU 10 ms — 배치가 크면 서버가 죽는다.**
무료 플랜은 요청당 CPU 10ms 다. 큰 `OutboxBatch` 의 JSON 파싱 + zod `.strict()` 검증 + D1 batch 준비가 **누적으로 10ms 를 넘길 수 있다.**

- **대응은 클라이언트가 아니라 계약에 넣는다**: `OutboxBatchSchema` 에 **행 수 상한**(§6-2). 서버는 초과 배치를 명시적으로 거부하고, `push.ts` 가 상한 단위로 쪼개 보낸다.
- ⚠ **워터마크 규율이 분할과 충돌하지 않는지 확인해라.** `collectOutbox` 는 `fence` 하나로 구간을 자르고 `commitWatermark(upto)` 로 **한 번에** 전진한다(`outbox.ts:118`, `push.ts:108`). 배치를 쪼개면 **부분 성공 시 워터마크를 어디까지 올릴지**가 새 질문이 된다. 안전한 답은 **연속 성공한 접두부의 마지막 `updatedAt` 까지만** — 과다 포함(재전송)은 LWW 라 무해하고 과소 포함만 위험하다는 `outbox.ts` 머리주석의 비대칭이 여기서도 그대로 적용된다.
- ⚠ **읽기 경로가 더 위험하다.** 폰이 전량을 받아오는 pull 이 서버에서 800KB 를 직렬화하면 10ms 를 넘길 소지가 크다. **커서 기반 페이지네이션이 선택이 아니라 요구사항**이다.

**서브리퀘스트 50/요청**(§10)은 러닝허브에 무관하다 — D1 접근은 바인딩이고 외부 fetch 를 안 한다.

### 8-3. 모니터링

- 대시보드 → Workers & Pages → 해당 Worker → **Metrics**(요청 수·오류율·CPU 시간 분포)
- 대시보드 → Storage & Databases → D1 → **행 읽기/쓰기 일일 사용량**
- ⚠ **CPU 시간은 평균이 아니라 p99 를 봐라.** 10ms 벽은 평균이 아니라 **꼬리에서** 터진다.
- **결제 수단을 등록하지 않는 것 자체가 최강의 예산 알림이다.** Oracle 런북 §8-3 이 $1 예산 알림을 세운 것은 PAYG 로 갈 여지가 있었기 때문이고, 여기선 카드가 없으면 **초과 시 과금이 아니라 거부**다. ⚠ 이건 안전이 **다르게** 배분된 것이지 없어진 게 아니다 — Oracle 은 "몰래 과금", Cloudflare 는 "몰래 정지"다.
- ⚠ **단일 실패점**: Cloudflare 계정 하나가 데이터·인증키·배포·(쓴다면) DNS 를 전부 쥔다. 계정 정지 = 전부 동시 상실. §1 의 2FA 와 §9 의 정기 반출이 이 위험의 유일한 대응이다.

---

## 9. 탈출 — G4 와의 관계

### 9-1. 데이터 탈출은 **Oracle 보다 쉽다**

```powershell
npx wrangler d1 export hub-prod --remote --output=.\hub-prod.sql
sqlite3 hub-restored.db < hub-prod.sql     # 평범한 SQLite 파일이 나온다
```

명령 두 줄이다. Oracle 은 SSH → `sqlite3 .backup` → `scp` 였다. **D1 이 SQLite 라는 점이 여기서 값을 낸다.**

**그러나 이게 백업의 본체는 아니다.** 설계서 I1·G4 가 정한 본체는 여전히 **`exportSnapshot` JSON** 이다:

| 층               | 수단                                     | 값                                                   |
| ---------------- | ---------------------------------------- | ---------------------------------------------------- |
| **① 정본 JSON**  | 앱에서 `exportSnapshot` → **PC 로 회수** | ⚠ **이게 진짜 백업.** 호스트·스키마·벤더 전부에 독립 |
| ② D1 `.sql` 덤프 | 위 명령                                  | 빠른 복구. SQLite 라 이식 가능                       |
| ③ Time Travel    | D1 내장, 무료 **7일**                    | 실수 되돌리기. ⚠ **Cloudflare 밖으로는 못 나온다**   |

> ⚠ **①이 없으면 ②③은 Cloudflare 에 종속된 백업**이다 — Oracle 런북 §7-4 의 결론이 호스트가 바뀌어도 **한 글자도 안 바뀐다.** _"PC 로 내려오지 않는 백업은 백업이 아니다."_
>
> ⚠ **복구를 한 번은 실제로 해봐라.** P2-8 은 백업을 만들라는 뜻이 아니라 **복원해 보라는 뜻**이다.
>
> ✅ **자동화됐다**(2026-07-20): `web/test/restoreDrill.test.ts` 가 `내보내기 JSON → 파싱 → migrate → sanitize → SQLite 행 → 아웃박스 수집`을 **한 체인으로** 흘린다. 링크별 검사는 원래 다 있었고 **없던 것은 체인**이었다 — v3 의 `updated_at = 0` 사고가 정확히 그 틈으로 빠져나갔다(각 링크는 통과, 합성만 실패). 드릴은 복구본 전량이 **워터마크 0 에서 수집 대상이 되는지**까지 단언한다.
>
> ⚠ 다만 이 드릴은 **앱 코드의 복구 경로**를 검증한다. _"D1 이 통째로 날아간 뒤 실제 파일로 되살렸다"_ 는 여전히 손으로 한 번 해 볼 값이 있다(§9-3 대피 절차).

### 9-2. ⚠ **코드 탈출은 Oracle 보다 비싸다** — 이게 이 전환이 지불하는 유일한 값

Oracle 안이 이렇게 지적했다: _"Workers+D1 을 택했다면 D1 스키마·바인딩·Workers 런타임 가정이 전부 이사 비용이었다."_

**정직한 판정: 그 지적은 3분의 1만 맞다.**

| 원래 지적한 이사 비용 | 실제                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| **D1 스키마**         | ❌ **비용 0.** SQLite 그 자체다. `.sql` 이 어느 SQLite 에나 그대로 들어간다(§3-2 ⓒ가 이걸 더 강화한다) |
| **D1 바인딩**         | ✅ **실비용.** `env.DB.prepare(...).bind(...)` 는 D1 고유 API 다                                       |
| **Workers 런타임**    | ✅ **실비용.** Node 파일시스템·장기 실행·10ms 초과 연산이 전제될 수 없다                               |

**완화책 — C-4 에서 지금 지불해라(나중엔 비싸다):**

1. **D1 접근을 어댑터 파일 하나로 격리한다.** 라우트가 `env.DB` 를 직접 만지면 그 줄 수만큼이 이사 비용이다. `interface Db { all(); run(); batch() }` 하나 뒤에 두면 `node:sqlite` 어댑터로 갈아끼우고 VPS 로 이사한다.
2. **Hono**(§4-3) — 라우팅·미들웨어가 표준 Fetch 위에 있어 Node 어댑터로 그대로 간다.
3. **비즈니스 로직을 `web/src/lib/` 에 둔다.** 병합·LWW·검증은 이미 순수하고 이미 공유된다. **Worker 는 얇은 껍데기여야 한다.**

> **이 세 가지를 하면 이사 비용이 "Worker 껍데기 한 파일 + 어댑터 한 파일"로 수렴한다.** Oracle 의 이식성 우위는 소멸하지 않지만 **작아진다.** 그리고 그 대가로 §0-1 의 인프라 노동 전부를 안 한다 — **이게 이 전환의 실제 거래 조건이다.**

### 9-3. 대피 절차

1. `exportSnapshot` JSON 을 PC 로 회수 (+ 여유 있으면 `wrangler d1 export`)
2. 데스크톱 Tauri 앱에서 **가져오기** → 로컬 SQLite 가 다시 정본
3. **이 시점에 앱은 완전히 동작한다.** G3/I8 에 따라 볼트·파이썬·AI·Anki 는 원래부터 로컬이므로 **잃는 건 "폰에서 편집" 하나뿐**이다
4. 새 호스트: ⓐ 다른 서버리스(Deno Deploy 등 — Hono 라 라우팅 재사용) ⓑ 유료 VPS(그땐 표준 VPS 셋업 — 리버스 프록시·systemd·TLS·백업. 옛 Oracle 런북에 그 절차가 있었으나 폐기와 함께 삭제했으니 그때 다시 도출한다)

---

## 10. 확인한 사실 / 미확인 사실

### 확인한 사실 (2026-07-19 확인, 출처 첨부)

| 사실                                                                                                                       | 출처                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Workers 무료 플랜에 신용카드 불요.** 카드는 유료 전환 시에만                                                             | [Cloudflare Plans](https://www.cloudflare.com/plans/) · [Workers 요금](https://developers.cloudflare.com/workers/platform/pricing/) |
| Workers 무료 **요청 100,000/일**, 초과 시 Error 1027, UTC 자정 리셋                                                        | [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)                                                        |
| Workers 무료 **CPU 10 ms/HTTP 요청**(Cron 도 10 ms)                                                                        | [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)                                                        |
| Worker **메모리 128 MB/isolate**, **서브리퀘스트 50/요청**, 동시연결 6                                                     | [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)                                                        |
| Worker 스크립트 **3 MB(gzip 후)**, 환경변수 64개·각 5 KB, 계정당 100 Worker                                                | [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)                                                        |
| Cron Trigger 무료 **3개**, 최소 간격 1분                                                                                   | [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)                                             |
| D1 무료 **DB당 500 MB · 계정 총 5 GB · DB 10개**                                                                           | [D1 Limits](https://developers.cloudflare.com/d1/platform/limits/)                                                                  |
| D1 무료 **행 읽기 5,000,000/일 · 행 쓰기 100,000/일**, 00:00 UTC 리셋                                                      | [D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/)                                                                |
| **한도 초과 시 D1 API 가 오류 반환**(쓰기 거부)                                                                            | [D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/)                                                                |
| D1 무료 **Worker 호출당 쿼리 50개**(유료 1,000), 쿼리 시간 **30초**                                                        | [D1 Limits](https://developers.cloudflare.com/d1/platform/limits/)                                                                  |
| D1 SQL 문 길이 **100 KB**, 바인딩 파라미터 **쿼리당 100개**, 행 크기 2 MB, 열 100개                                        | [D1 Limits](https://developers.cloudflare.com/d1/platform/limits/)                                                                  |
| D1 **Time Travel 무료 7일**(유료 30일)                                                                                     | [D1 Limits](https://developers.cloudflare.com/d1/platform/limits/)                                                                  |
| **D1 은 auto-commit.** `batch()` 는 순차·비동시 실행이며 하나라도 실패하면 **전체 롤백**                                   | [D1 Worker API](https://developers.cloudflare.com/d1/worker-api/d1-database/)                                                       |
| **읽기 복제는 기본 OFF**, 켜려면 대시보드+**Sessions API 필수**. 순차 일관성·read-your-own-writes                          | [D1 Read Replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)                                        |
| `wrangler d1 migrations create/list/apply`, `migrations/` 폴더, `d1_migrations` 테이블, `migrations_dir` 로 경로 변경 가능 | [D1 Migrations](https://developers.cloudflare.com/d1/reference/migrations/)                                                         |
| 마이그레이션은 **바인딩 이름이 아니라 DB 이름**으로 부르는 것이 안전                                                       | [D1 Migrations](https://developers.cloudflare.com/d1/reference/migrations/)                                                         |
| `wrangler d1 export --remote [--no-data]` 로 `.sql` 덤프, `execute --file` 로 임포트(≤5 GiB)                               | [Import/Export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)                                            |
| **export 는 실행 중 다른 DB 요청을 막는다**, `.sqlite3` 직접 임포트 불가                                                   | [Import/Export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)                                            |
| **`*.workers.dev` 에 공개 신뢰 인증서가 자동 발급된다**(TLS 무작업)                                                        | [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)                                         |
| 단, Cloudflare 는 프로덕션을 `workers.dev` 대신 커스텀 도메인에 두라고 권고                                                | [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)                                         |
| wrangler 는 **Windows 11 공식 지원**(WSL 불요), Node Current/Active/Maintenance, **프로젝트 로컬 설치 권장**               | [Wrangler 설치](https://developers.cloudflare.com/workers/wrangler/install-and-update/)                                             |
| **행 읽기는 스캔한 행 수**로 계산 — 인덱스 없는 필터는 전체 스캔이 과금됨                                                  | [D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/)                                                                |
| KV 무료 **읽기 100,000/일 · 서로 다른 키 쓰기 1,000/일 · 저장 1 GB**                                                       | [KV Limits](https://developers.cloudflare.com/kv/platform/limits/)                                                                  |

### 미확인 사실 (추측으로 채우지 않음)

| 항목                                                    | 상태                                                                                                                                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **인덱스 갱신이 "행 쓰기"에 계산되는가**                | ⚠ **미확인.** §8-2 는 **계산된다고 가정**하고 설계했다(보수적). `db.rs` v4 가 7개 인덱스를 깔았으므로 배수가 클 수 있다                                                       |
| **workers.dev 계정 서브도메인을 나중에 바꿀 수 있는가** | ⚠ **미확인.** §1 은 **못 바꾼다고 가정**한다                                                                                                                                  |
| Worker **요청 본문 크기 상한**(무료 플랜)               | ⚠ **미확인.** Cloudflare 무료 존은 100 MB 로 알려져 있으나 workers.dev 에 동일 적용되는지 확인 못 함. → **P1-7 은 서버에서 명시 상한을 걸어라**(§6-2 배치 상한이 이걸 겸한다) |
| **D1 읽기 복제의 무료 플랜 가용 여부**                  | ⚠ **미확인.** 문서가 플랜 구분을 안 한다. 어차피 §5 설계는 **복제 OFF 전제**다                                                                                                |
| `BEGIN`/`COMMIT` 명시 트랜잭션의 D1 지원 범위           | ⚠ **미확인.** 문서는 auto-commit 과 `batch()` 만 말한다. → **`batch()` 만 쓰고 명시 트랜잭션에 기대지 마라**                                                                  |
| **콜드스타트 실측치**                                   | ⚠ **미확인**(직접 측정 안 함). Workers 는 V8 isolate 라 컨테이너 대비 작다고 알려졌으나 이 앱에서의 체감은 미측정                                                             |
| **일부 국가·기업망에서 `*.workers.dev` 차단** 사례      | ⚠ **미확인.** 커뮤니티 보고가 있으나 검증 못 함. 막히면 커스텀 도메인이 대응책이다                                                                                            |
| 무료 한도의 **향후 변경 계획**                          | ⚠ **미확인**(당연히 비공개). Oracle 사례가 준 교훈은 **§9(탈출)를 장식으로 읽지 말라**는 것이고, 그건 호스트가 바뀌어도 유효하다                                              |
| Cloudflare 계정 정지 시 **사전 통지·유예**              | ⚠ **미확인.** §8-3 은 통지가 없다고 가정한다                                                                                                                                  |

---

## 부록 A — 설계서 §6 보안 항목 매핑

| 설계서 §6 항목                   | 이 런북에서                       | 인프라로 해결되나                                                                |
| -------------------------------- | --------------------------------- | -------------------------------------------------------------------------------- |
| **P0-1** TLS 전 구간             | **§1·§7-3** (`workers.dev` 자동)  | ✅ **전부. 무작업.** Oracle 은 §5 한 절 전체였다                                 |
| **P0-2** 토큰 URL 제거·수명·회전 | **§5-2**                          | ❌ **앱 작업.** 다만 KDF 금지(CPU 10ms)가 설계를 **제약**한다                    |
| **P0-3** 수신 스키마 strict      | **§6** (C-2)                      | ✅ 본문 라우트 **전부** zod `.strict()`(2026-07-20 에 4→1 비대칭 해소)           |
| **P1-4** 기기 단위 주체          | **§5-1** (D1 기기 테이블)         | ✅ 목록·폐기 라우트 + push/pull 접근 로그에 기기 id 기록                         |
| **P1-5** CSP                     | (C-3 · Tauri `csp: null` 교체)    | ❌ 앱 작업                                                                       |
| **P1-6** `no-store` · CORS       | **§5-2** ⚠ Workers 도 기본이 없다 | ❌ 앱 작업. **명시 설정 필수**                                                   |
| **P1-7** 요청 크기 상한·RL       | **§6-2**(배치 상한) · §7-5 · §8-2 | ✅ 1MB 본문 상한(2겹) + 무인증 라우트 RL. ⚠ **주 방어는 WAF 규칙**(§7-5)         |
| **P2-8** 백업·복구 검증          | **§9-1**                          | ✅ `restoreDrill.test.ts` — 내보내기 JSON → 행 → **아웃박스 수집**까지 체인 검증 |
| **P2-9** 접근 로그               | §8-3 대시보드 + 기기 ID 로깅      | 🔶 "누가"는 P1-4 가 채운다                                                       |

## 부록 B — 설계서·CLAUDE.md 에서 갱신이 필요해진 곳

⚠ **이 문서는 새 파일 하나만 쓰므로 아래는 반영하지 않았다. C-4 착수 시 별도 커밋으로 처리해라.**

1. **설계서 §9-3** — "채택: Oracle / 탈락: Cloudflare" 가 **뒤집혔다**. 표의 "서버 언어=Rust", "zod 를 문자 그대로 공유할 수 없다", "JSON Schema→TS+Rust 양쪽 codegen" 세 칸이 전부 무효다.
2. **설계서 §7 C-2 행** — 범위를 §6-2 대로 갱신(codegen 삭제, `OutboxBatchSchema` 추가).
3. **설계서 §7 "이미 완료된 것" 의 5-C 행** — _"서버가 어디 있든 필요하다"_ 의 근거 소멸(§6-4).
4. ~~**`oracle-런북.md`** 상단 경고 추가~~ → **문서 자체를 삭제**(2026-07-24 · Oracle 안 폐기로 이력 가치 소멸).
5. **`CLAUDE.md` 아키텍처 한눈** — `server/` 신설 반영(§4).
6. ~~**`docs` 툼스톤 갭**~~ → **판정 완료(2026-07-20)**: 제품에 `docs` 삭제 경로가 아예 없어(`db/docs.ts` 에 삭제 함수 없음) 실害가 발생할 수 없다. ⚠ 삭제를 추가하는 커밋이 툼스톤을 같이 넣어야 한다 — 조건은 `cloud/contract.ts` 의 `OUTBOX_TABLES` 주석이 소유한다.
