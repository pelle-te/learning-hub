# Oracle Cloud Always Free — 셋업 런북 ⚠ **보류(채택 안 됨)**

> # ⚠ 이 문서는 실행하지 마라 — 호스트가 바뀌었다
>
> **2026-07-19, 호스트가 Oracle → Cloudflare Workers + D1 로 재결정됐다**(설계서 **§9-3b**). 현재 실행 문서는 **`cloudflare-런북.md`** 다.
>
> **뒤집힌 이유**: Oracle 가입이 반복 거부됐고(§2-5 가 예고한 자동 거부), 그 참에 근거를 재점검하니 **§9-3 이 Cloudflare 를 탈락시킨 근거 3개 중 2개가 이미 죽어 있었다** — "성장 여지"는 §0 의 한도 반토막으로, "TLS·운영 부담 감수"는 **아직 한 푼도 안 낸 비용**이라 지금이 가장 싼 취소 시점이었다.
>
> **그래도 지우지 않는 이유**: ① §0(한도 반토막)·§8(회수 조건 임계값)의 조사 결과를 **설계서가 인용**하고 있다 ② 되돌아올 가능성이 0은 아니다 ③ 뒤집은 판단을 나중에 읽으려면 **무엇을 근거로 골랐었는지**가 필요하다.
>
> 아래 내용은 2026-07-19 시점 조사로는 정확하지만 **검증이 갱신되지 않는다.**

> **이 문서의 지위**: ~~`클라우드전환-설계.md` §9-3(호스트 결정 = Oracle Cloud Always Free)의 **실행 절차서**~~ → **이력 문서**. 설계는 §9-3b 가 현재 SSOT.
> **검증일**: 2026-07-19. 설계서 §9-3 말미가 _"무료 티어 조건과 가입 절차는 이 문서 작성 시점 기준이다. 가입 직전 현재 조건을 직접 확인할 것"_ 이라 경고했고, **그 경고가 맞았다** — 아래 §0 참조.
> **적용 단계**: C-4(클라우드 백엔드). C-1~C-3 은 계정 없이 끝나므로 **이 런북을 지금 실행할 필요는 없다**. 읽고 결정만 미리 내려두는 용도다.

---

## 0. ⚠ 먼저 — 설계서가 낡았다 (2026-06-15 변경)

**Oracle 은 2026-06-15 자로 Always Free Ampere A1 한도를 절반으로 깎았다.** 공지·블로그·메일 없이 **문서만 조용히 바꿨다**.

| 항목       | 설계서 §9-3 기재 (구 한도) | **현재 (2026-07)**       |
| ---------- | -------------------------- | ------------------------ |
| ARM OCPU   | 4                          | **2**                    |
| ARM RAM    | 24 GB                      | **12 GB**                |
| OCPU-시간  | 3,000/월                   | **1,500/월**             |
| GB-시간    | 18,000/월                  | **9,000/월**             |

출처: [Oracle 공식 Always Free Resources 문서](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) · [InfoQ 보도](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/) · [Linuxiac](https://linuxiac.com/oracle-quietly-cuts-free-tier-ampere-a1-resources-in-half/)

**이게 설계 결정에 미치는 영향**

- **채택 근거 자체는 살아남는다.** 러닝허브 서버는 Rust axum + SQLite 800KB 데이터셋이다. 2 OCPU / 12 GB 는 **여전히 과잉**이다. 호스트를 다시 고를 이유가 없다.
- **깨지는 건 §9-3 표의 "성장 여지" 칸**이다. _"나중에 파이썬 도구·Ollama 도 올릴 수 있다(ARM 4코어/24GB)"_ — **12 GB 로는 쓸 만한 로컬 LLM 이 안 돈다.** 이 칸은 사실상 취소로 봐야 한다. 어차피 I8(로컬 자원 기능은 인터넷에 의존하지 않는다)이 Ollama 를 PC 에 묶어두므로 **설계상 손실은 0**이지만, "언젠가 옮길 수 있다"는 여지를 근거로 삼는 판단은 이제 하면 안 된다.
- **더 중요한 교훈**: 무료 티어는 **공지 없이 반토막날 수 있다.** 이게 §9-3 "가용성 위험" 칸과 G4(내보내기 JSON 복구)의 값을 다시 한 번 올린다. 이번엔 한도만 깎였지만 다음엔 폐지일 수 있다. **§9(롤백/탈출)를 장식으로 읽지 말 것.**

> ⚠ **PAYG 예외설은 미확인이다.** Oracle 지원 상담원이 "PAYG 계정은 4 OCPU/24 GB 유지"라고 메일로 답했다는 보고가 여럿 있으나, **공식 문서는 계정 유형을 구분하지 않고** _"All tenancies get the first 1,500 OCPU hours..."_ 라고만 적는다. 상담원 구두 답변을 근거로 4 OCPU 를 띄우지 마라 — 과금될 수 있다.

---

## 1. 가입 전 결정 (되돌릴 수 없는 것 먼저)

### 1-1. ⚠ 홈 리전 — **가입 후 변경 불가**

가입 화면에서 고르는 **홈 리전(Home Region)은 나중에 바꿀 수 없다.** 그리고 **Always Free 리소스는 홈 리전에만 만들 수 있다.** 즉 리전 선택 = 이 서버의 영구 물리 위치이자, 용량 확보 가능성이 결정되는 지점이다.

출처: [Oracle Cloud Free Tier FAQ](https://www.oracle.com/cloud/free/faq/) · [Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

**고르는 기준 두 개가 충돌한다:**

| 기준          | 함의                                                                                   |
| ------------- | -------------------------------------------------------------------------------------- |
| **지연시간**  | 한국 사용자 → `ap-seoul-1` 또는 `ap-chuncheon-1`. RTT 수 ms                            |
| **ARM 용량**  | 서울/춘천은 **AD 가 1개**뿐이다. AD 3개짜리 대형 리전(예 `us-ashburn-1`)이 용량 확보에 유리하다 |

**판정: 서울(`ap-seoul-1`)을 고른다.** 러닝허브의 유선 페이로드는 전량 800KB, dirty-only 쓰기 이후엔 훨씬 작다(§C-3). **지연시간이 이 앱의 체감을 지배**하고, 용량 문제는 §3-3 의 재시도 루프로 **시간을 들여** 풀 수 있는 반면 리전은 **영영 못 바꾼다.** 되돌릴 수 없는 쪽을 사용성에 맞추고, 되돌릴 수 있는 쪽(용량)에 노동을 넣는다.

### 1-2. 결제 수단

**신용카드(또는 신용카드처럼 동작하는 체크카드)가 필수다.** 가입 시 본인확인 목적으로 **USD $1 승인(authorization)** 이 걸리며, 계정을 유료로 업그레이드하지 않는 한 **청구되지 않는다**. **선불/가상/일회용 카드는 거부된다. PIN 방식 체크카드도 거부된다.**
출처: [Oracle Cloud Free Tier FAQ](https://www.oracle.com/cloud/free/faq/)

### 1-3. 계정 유형 — Always Free 로 남을 것인가

가입하면 30일 $300 크레딧의 **Free Trial** 로 시작하고, 30일 후(또는 크레딧 소진 후) **Always Free 리소스만 남기고 자동으로 축소**된다. 업그레이드하지 않으면 **카드에 청구되지 않는다.**

> ⚠ **PAYG 업그레이드는 §3-3 에서 "용량 부족의 가장 확실한 해법"으로 다시 등장한다.** 그때 이 결정을 되짚게 되므로, 지금은 **Always Free 로 시작**하고 막히면 그때 판단한다.

### 1-4. 도메인을 살 것인가 (→ §5 에 직결)

**§5 에서 TLS 방식이 여기서 갈린다.** 지금 정해라:

- **ⓐ 도메인 구매(연 1~2만원)** — Let's Encrypt HTTP-01 로 Caddy 자동 발급. 가장 단순하고 가장 튼튼하다. **권장.**
- **ⓑ DDNS 무료 호스트명** — 비용 0. 단, 서브도메인 제공자에 따라 Let's Encrypt **rate limit 을 공유**해 발급이 막힐 수 있고, 제공자가 사라지면 도메인이 사라진다.

**검증**: 이 절이 끝난 시점에 종이(또는 메모)에 네 값이 적혀 있어야 한다 — **홈 리전 / 카드 / 계정유형 / 도메인 전략.**

---

## 2. 계정 가입

1. https://www.oracle.com/cloud/free/ → **Start for free**
2. 국가(변경 불가에 준함) · 이메일 → 이메일 인증
3. **홈 리전 선택** ← §1-1 에서 정한 값. ⚠ **이 화면을 지나면 끝이다.**
4. 카드 등록 ($1 승인)
5. 승인 대기 — 즉시 되는 경우도, 수 시간 걸리는 경우도, **거부되는 경우도 있다**(카드/국가 조합에 따라 자동 거부 사례가 흔하다)

**검증 — 이게 끝난 걸 어떻게 아는가**

- OCI 콘솔에 로그인된다.
- 우상단 리전 표시가 §1-1 에서 고른 리전이다.
- Governance → **Limits, Quotas and Usage** 에서 `Compute` → `Cores for Ampere A1 based VM and BM instances` 의 서비스 한도가 **2** 로 보인다(§0 의 새 한도).

> ⚠ 여기서 한도가 **0** 이면 계정이 아직 완전 활성화되지 않았거나 리전에 A1 자체가 없다. 인스턴스 생성으로 넘어가지 말고 먼저 이걸 해결해라.

---

## 3. ARM 인스턴스 프로비저닝

### 3-1. 만들 것

| 항목      | 값                                                        |
| --------- | --------------------------------------------------------- |
| Shape     | `VM.Standard.A1.Flex`                                     |
| OCPU/RAM  | **2 OCPU / 12 GB** (= 현재 Always Free 전량)              |
| 이미지    | **Canonical Ubuntu 24.04 LTS (aarch64)**                  |
| 부트볼륨  | 50 GB (기본). Always Free 블록스토리지 총량은 **200 GB**  |
| SSH 키    | 로컬에서 생성해 **공개키만** 붙여넣기                     |
| 공인 IP   | 할당 (Assign a public IPv4 address)                       |

> 부트볼륨 최소는 47 GB, 총 블록스토리지 한도 200 GB, 아웃바운드 전송 10 TB/월. [출처](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

SSH 키 생성 (Windows PowerShell):

```powershell
ssh-keygen -t ed25519 -C "hub-oracle" -f $env:USERPROFILE\.ssh\hub_oracle
Get-Content $env:USERPROFILE\.ssh\hub_oracle.pub
```

### 3-2. 왜 2 OCPU 를 통째로 잡는가

Always Free 한도 **전량**이므로 나눠 쓸 두 번째 인스턴스를 만들 계획이 없다면 통째로 잡는 게 맞다. 그리고 **§8 회수 정책이 CPU 사용률 하한을 보므로 코어를 적게 잡을수록 사용률이 높게 잡혀 회수를 피하기 쉽다**는 반대 논리도 있다 — 이건 §8 에서 정면으로 다룬다.

### 3-3. ⚠ "Out of host capacity" — 실무자가 가장 많이 막히는 지점

**2026-07 현재도 여전하다.** A1 은 상시 수요 초과이고, 무료 계정은 우선순위가 낮다.
출처: [Ampere 개발자 커뮤니티](https://community.amperecomputing.com/t/how-to-get-around-the-out-of-capacity-error-on-the-always-free-tier-of-oci/3432) · [hitrov/oci-arm-host-capacity](https://github.com/hitrov/oci-arm-host-capacity)

대응을 **싼 것부터** 순서대로:

1. **AD 를 바꿔본다** — 홈 리전에 AD 가 2~3개면. ⚠ **서울/춘천은 AD 1개라 이 수단이 없다**(§1-1 의 대가가 여기서 청구된다).
2. **시간을 바꿔 재시도** — 용량은 주기적으로 풀린다. 한국 시간 새벽대 성공 보고가 많다(민간 경험칙, **미확인**).
3. **자동 재시도 스크립트** — `LaunchInstance` API 를 주기 호출해 용량이 나는 순간 잡는다. [hitrov/oci-arm-host-capacity](https://github.com/hitrov/oci-arm-host-capacity) 가 대표적. ⚠ **호출 빈도를 과하게 올리면 API 레이트 리밋에 걸린다.** 수 분 간격이면 충분하다.
4. **PAYG 로 업그레이드** — **가장 확실한 해법**이다. PAYG 계정은 용량 우선순위가 올라가고, Always Free 한도 내에만 리소스를 두면 **여전히 청구 0**이다.
   > ⚠ 단, PAYG 는 **실수하면 진짜로 과금된다.** 이 길을 택하면 §8 의 예산 알림을 **선택이 아니라 필수**로 격상해라. 그리고 §0 의 "PAYG 는 4 OCPU 유지" 설을 믿고 한도를 넘기지 마라 — **미확인**이다.

**검증**

```bash
ssh -i ~/.ssh/hub_oracle ubuntu@<PUBLIC_IP>
# 접속 후
nproc            # → 2
free -g          # → 약 11~12
uname -m         # → aarch64
```

세 줄이 다 맞으면 이 단계 끝이다.

---

## 4. 네트워크 — ⚠ 방화벽이 **두 겹**이다

**이게 이 런북에서 가장 많은 시간을 잡아먹는 함정이다.** OCI 콘솔에서 포트를 열었는데도 접속이 안 되면, 십중팔구 **VM 안의 iptables** 다.

Oracle 의 Ubuntu 이미지는 UFW 를 끄고 **iptables 로 SSH(22) 외 거의 전부를 REJECT** 한다. 클라우드 쪽 Security List 와 OS 쪽 iptables **둘 다** 열려야 통한다.
출처: [Oracle 개발자 블로그 — Enabling Network Traffic to Ubuntu Images in OCI](https://blogs.oracle.com/developers/enabling-network-traffic-to-ubuntu-images-in-oracle-cloud-infrastructure)

### 4-1. 층 ①: OCI Security List (또는 NSG)

콘솔 → Networking → Virtual Cloud Networks → (VCN) → Security Lists → Default Security List → **Add Ingress Rules**

| Source CIDR | Protocol | Dest Port | 용도                       |
| ----------- | -------- | --------- | -------------------------- |
| `0.0.0.0/0` | TCP      | 80        | Let's Encrypt HTTP-01 챌린지 |
| `0.0.0.0/0` | TCP      | 443       | 앱 트래픽 (TLS)            |

> **80 을 왜 여는가**: Caddy 의 HTTP-01 발급·갱신이 80 을 쓴다. 앱 트래픽은 443 만 받고 **80 은 443 으로 리다이렉트만 시킨다**(Caddy 기본 동작). ⚠ 설계서 P0-1 의 _"평문 HTTP 폴백 경로를 절대 남기지 않는 것"_ 이 여기 걸린다 — **80 은 리다이렉트 전용이어야 하고, 어떤 API 라우트도 80 에서 응답해선 안 된다.**
>
> ⚠ **22 를 `0.0.0.0/0` 으로 열어두지 마라.** 기본 규칙이 그렇게 돼 있다. 고정 IP 가 있으면 그 CIDR 로 좁혀라. 없다면 최소한 §7 의 fail2ban 을 켜라.

**NSG vs Security List**: 인스턴스가 하나뿐이면 Security List 로 충분하다. NSG 는 인스턴스별로 다른 규칙이 필요할 때 쓴다 — 지금은 불필요한 복잡도다.

### 4-2. 층 ②: VM 안 iptables ← ⚠ **여기가 함정**

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo apt update && sudo apt install -y netfilter-persistent iptables-persistent
sudo netfilter-persistent save
```

> ⚠ **`-I INPUT 6`(삽입)이지 `-A`(추가)가 아니다.** 규칙 체인 끝에는 포괄 REJECT 가 있어서, 뒤에 붙이면 **절대 도달하지 않는다.** 규칙이 먹지 않으면 `sudo iptables -L INPUT --line-numbers` 로 REJECT 줄 번호를 확인하고 그 **앞** 번호에 넣어라.
>
> ⚠ **저장을 빼먹으면 재부팅에 사라진다.** `netfilter-persistent save` 는 선택이 아니다.

### 4-3. 검증 — 두 층을 **따로** 확인해라

```bash
# VM 안에서: 리스너가 떠 있고 로컬로 통하는가 (층 ② 무관)
sudo ss -tlnp | grep -E ':(80|443)'
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1

# 외부(개발 PC PowerShell)에서: 두 층을 다 통과하는가
Test-NetConnection <PUBLIC_IP> -Port 443
```

**진단 규칙**: 로컬 `curl` 은 되는데 외부 `Test-NetConnection` 이 실패 → **방화벽 문제**(4-1 또는 4-2). 로컬 `curl` 부터 실패 → **앱/Caddy 문제**. 이 분기를 안 하면 엉뚱한 층을 몇 시간 뒤진다.

---

## 5. 도메인 + TLS (Caddy) — **P0-1 이 여기서 충족된다**

설계서 §9-3 이 _"TLS 는 무료로 딸려오지 않는다. P0-1 의 비용이 '거의 0'에서 **실작업**으로 올라간다"_ 고 지목한 부분이 이 절 전체다.

### 5-1. DNS

도메인 관리자에서 **A 레코드** → VM 공인 IP. TTL 은 초기엔 짧게(300초).

```powershell
nslookup hub.example.com   # → VM 공인 IP 가 나와야 다음 단계로
```

⚠ **DNS 전파 전에 Caddy 를 띄우면 발급이 실패하고, Let's Encrypt 실패 카운터를 소모한다.** 위 `nslookup` 이 맞을 때까지 기다려라.

### 5-2. Caddy 설치 (aarch64)

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

### 5-3. `/etc/caddy/Caddyfile`

```caddyfile
hub.example.com {
	encode zstd gzip

	# 러닝허브 서버는 127.0.0.1 에만 바인딩한다 (§5-5 참조)
	reverse_proxy 127.0.0.1:8080

	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "no-referrer"
		-Server
	}

	request_body {
		max_size 4MB     # 설계서 P1-7 (요청 크기 상한)
	}

	log {
		output file /var/log/caddy/access.log
		format json
	}
}
```

```bash
sudo systemctl reload caddy
```

> **왜 Caddy 인가**: 인증서 발급·**자동 갱신**·HTTP→HTTPS 리다이렉트가 기본값이다. certbot 은 갱신 타이머와 nginx 리로드 훅을 따로 얹어야 하고, **"갱신이 조용히 멈춰 있었다"가 이 구성의 대표 사고**다. 설정 파일 12줄로 그 사고 계열 전체를 없애는 게 Caddy 를 고르는 이유다.
>
> ⚠ **`Referrer-Policy: no-referrer` 는 장식이 아니다.** 설계서 P0-2 가 _"`history.replaceState` 는 주소창만 지우지 프록시 로그·Referer 는 못 막는다"_ 고 적었다. 토큰을 URL 에서 빼는 게 본 해법이고(C-4 앱 작업), 이 헤더는 그 전까지의 방어다.
>
> ⚠ **`log` 는 설계서 P2-9(접근 로그)의 절반이다.** 나머지 절반 — "누가" — 은 P1-4(기기 단위 주체)가 앱에서 붙여야 채워진다. Caddy 로그만으로는 IP 밖에 모른다.

### 5-4. 검증

```bash
# 인증서가 실제로 발급됐나
sudo ls /var/lib/caddy/.local/share/caddy/certificates/*/hub.example.com/

# 만료일 확인 (개발 PC 에서도 가능)
echo | openssl s_client -connect hub.example.com:443 -servername hub.example.com 2>/dev/null \
  | openssl x509 -noout -dates

# 평문 폴백이 없는가 — P0-1 의 핵심 검증
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://hub.example.com/api/state
```

**마지막 줄이 `301 https://...` 여야 한다.** `200` 이면 **평문으로 상태가 나갔다는 뜻이고 P0-1 위반이다** — 즉시 멈추고 고쳐라.

추가로 [SSL Labs](https://www.ssllabs.com/ssltest/) 에서 A 이상.

### 5-5. ⚠ 앱 바인딩 — TLS 를 우회할 구멍을 남기지 마라

러닝허브 서버는 반드시 **`127.0.0.1:8080`** 에만 바인딩한다. `0.0.0.0` 에 바인딩하면 Security List 를 8080 에 열지 않는 한 외부에서 못 닿긴 하지만, **그건 방어가 아니라 우연**이다(설계서 P1-6 이 axum CORS 기본값을 두고 한 지적과 같은 종류). 바인딩 주소로 못 박아라.

---

## 6. Rust 바이너리 배포 — aarch64

**개발 PC 는 Windows x86_64, 타깃은 Linux aarch64.** 세 갈래다.

| 방식                          | 장점                          | 대가                                                                 |
| ----------------------------- | ----------------------------- | -------------------------------------------------------------------- |
| **ⓐ VM 에서 직접 빌드**       | 툴체인 이슈 0. 확실히 돈다    | 2 OCPU / 12 GB 에서 릴리스 빌드는 느리다. VM 에 Rust·소스가 얹힌다   |
| **ⓑ WSL2 + `cross` (Docker)** | PC 성능 활용. 재현 가능       | WSL2 + Docker 설치. 초기 세팅 비용                                   |
| **ⓒ Windows 네이티브 크로스** | 추가 런타임 없음              | ⚠ **권장 안 함** — Linux 크로스 링커를 Windows 에 갖추는 게 지저분하다 |

**판정: ⓐ 로 시작해 ⓑ 로 옮긴다.**

- **ⓐ 로 시작하는 이유**: C-4 초기엔 배포 빈도가 낮고, "빌드 환경 문제인가 코드 문제인가"를 가르는 변수를 하나 줄이는 게 값싸다. 12 GB RAM 이면 `codegen-units` 를 줄이지 않는 한 OOM 은 안 난다.
- **ⓑ 로 옮기는 신호**: 빌드가 반복 작업이 되는 순간, 또는 §8 의 CPU 사용률이 빌드 때문에 튀어 회수 지표를 오염시키기 시작할 때.

> ⚠ **어느 쪽이든 SQLx 오프라인 모드를 켜라.** 컴파일 타임에 DB 에 붙는 매크로가 있으면 빌드 환경마다 결과가 갈린다. `cargo sqlx prepare` 로 `.sqlx/` 를 커밋해 두는 게 이 저장소의 codegen 규율(`codegen:check`)과도 같은 사상이다.

### 6-ⓐ VM 에서 빌드

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
sudo apt install -y build-essential pkg-config libssl-dev git
git clone <repo> ~/hub && cd ~/hub/<server-crate>
cargo build --release
```

### 6-ⓑ WSL2 + cross

```bash
# WSL2 Ubuntu 안에서
cargo install cross --git https://github.com/cross-rs/cross
cross build --release --target aarch64-unknown-linux-gnu
```

산출물: `target/aarch64-unknown-linux-gnu/release/<bin>` → `scp` 로 VM 에.

### 6-1. systemd 유닛 — `/etc/systemd/system/hub.service`

```ini
[Unit]
Description=Learning Hub cloud backend
After=network-online.target

[Service]
Type=simple
User=hub
Group=hub
ExecStart=/opt/hub/bin/hub-server
Environment=HUB_BIND=127.0.0.1:8080
Environment=HUB_DB=/var/lib/hub/hub.db
Restart=always
RestartSec=3

# 최소권한 — 침해 시 폭발 반경 축소
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/hub

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd --system --no-create-home hub
sudo mkdir -p /var/lib/hub && sudo chown hub:hub /var/lib/hub
sudo systemctl daemon-reload && sudo systemctl enable --now hub
```

> ⚠ **root 로 돌리지 마라.** 설계서가 이걸 명시하진 않았지만, `/api/state` 가 DB 전량을 뱉는 서버(P0-1 의 전제)를 root 로 돌리는 건 P0 의 취지에 정면으로 반한다.

### 6-2. 검증

```bash
systemctl status hub --no-pager
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/health   # 200
sudo systemctl restart hub && sleep 2 && systemctl is-active hub          # active
sudo reboot        # 재부팅 후에도 자동 기동하는가 ← 이걸 꼭 해봐라
```

### 6-3. ⚠ 이 절이 **끝내지 못하는** P0 두 건

| P0                       | 이 런북에서의 위치                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| **P0-1 TLS**             | **§5 에서 충족.** 검증은 §5-4 마지막 줄(평문 폴백 없음) + §5-5(127.0.0.1 바인딩)                        |
| **P0-3 수신 스키마 strict** | ⚠ **인프라로 못 채운다.** C-2 의 앱 작업(`.strict()` 파생 + JSON Schema→Rust 생성)이다. 이 서버 바이너리가 그걸 **이미 담고 있어야** §6 배포가 정당하다 |
| **P0-2 토큰 수명·회전**  | ⚠ 동일. §5-3 의 `Referrer-Policy` 는 완화지 해결이 아니다. **URL 에서 토큰을 뺀 바이너리를 배포해라**   |
| **P1-4 기기 단위 주체**  | 앱 작업. 이게 없으면 §5-3 의 접근 로그가 IP 만 남긴다(P2-9 반쪽)                                        |

**즉 §6 의 진짜 진입 조건은 "빌드가 된다"가 아니라 "P0 3건이 담긴 바이너리인가"다.** 인프라가 다 서 있어도 그 전엔 공인 IP 를 붙이지 마라.

---

## 7. 운영

### 7-1. OS 자동 패치

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

`/etc/apt/apt.conf.d/50unattended-upgrades` 에서 커널 업데이트 시 자동 재부팅을 켤지 정한다:

```
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
```

> **켜는 걸 권한다.** 사용자 1명짜리 앱이고 systemd 가 자동 기동하므로(§6-2 에서 검증했다) 04시 재부팅의 대가는 사실상 0이다. 반대로 안 켜면 **커널 취약점이 무기한 남는다** — "운영 책임이 전부 내 몫"(§9-3)의 실물이 이거다.

**검증**: `sudo unattended-upgrade --dry-run --debug` 가 대상 패키지를 나열한다. 그리고 며칠 뒤 `/var/log/unattended-upgrades/` 에 실제 로그가 쌓였는지 본다.

### 7-2. SSH 강화

```bash
sudo sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
sudo apt install -y fail2ban && sudo systemctl enable --now fail2ban
```

**검증**: `sudo fail2ban-client status sshd`

### 7-3. 인증서 갱신 확인

Caddy 가 자동 갱신하지만 **"자동"을 믿고 확인을 안 하는 게 사고의 형태**다. 만료 30일 전에 알림이 오게 해라 — 최소한 달력에 반복 일정을 걸고 §5-4 의 `openssl x509 -dates` 를 친다.

```bash
journalctl -u caddy --since "30 days ago" | grep -i "certificate obtained"
```

### 7-4. 백업 — G4 와의 관계

**설계서 I1·G4 가 이미 백업 포맷을 정해 뒀다**: `exportSnapshot` JSON 은 구 백업을 읽을 수 있고 구 앱이 읽을 수 있으며, _"클라우드가 사라져도 이 파일 하나로 복구된다."_

**그러므로 VM 백업 전략의 목표는 "VM 을 복원하는 것"이 아니라 "그 JSON 을 손에 쥐는 것"이다.**

| 층                | 수단                                          | 값                                              |
| ----------------- | --------------------------------------------- | ----------------------------------------------- |
| **①정본 JSON**    | 주기적 `exportSnapshot` → **개발 PC 로 회수** | ⚠ **이게 진짜 백업이다.** 호스트 폐업에도 살아남는다 |
| **②DB 파일**      | `sqlite3 .backup` → 로컬 사본 + PC 로 rsync   | 빠른 복구용                                     |
| **③부트볼륨 백업** | OCI 콘솔 백업 정책 (Always Free 는 **5개까지**) | VM 통째 복원. ⚠ Oracle 이 사라지면 같이 사라진다 |

```bash
# ② 예시 — cron
sqlite3 /var/lib/hub/hub.db ".backup '/var/backups/hub-$(date +%F).db'"
```

> ⚠ **①이 없으면 ②③은 전부 Oracle 에 종속된 백업**이다. §0 이 보여줬듯 Oracle 은 공지 없이 조건을 바꾼다. **PC 로 내려오지 않는 백업은 백업이 아니다.**
>
> ⚠ **복구를 한 번은 실제로 해봐라.** 설계서 P2-8 이 _"백업·복구 경로 검증"_ 이라 적은 건 백업을 만들라는 뜻이 아니라 **복원해 보라는 뜻**이다. 랜섬웨어·계정 탈취·호스트 폐업이 전부 같은 경로를 쓴다.

---

## 8. 회수 방지 + 비용 0 확인

### 8-1. Idle 회수 정책 (현행)

**7일간** 다음이 **모두** 해당하면 유휴로 판정해 회수될 수 있다:

- CPU 사용률 95 퍼센타일 **< 20%**
- 네트워크 사용률 **< 20%**
- 메모리 사용률 **< 20%** (**A1 shape 에만 적용**)

출처: [Oracle 공식 Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

**⚠ 러닝허브는 이 판정에 정확히 걸린다.** 사용자 1명이 하루 몇 번 쓰는 800KB 앱이다. **CPU·네트워크·메모리 세 지표 전부 20% 를 한참 밑돈다.**

### 8-2. 대응 — 정직한 것부터

1. **⚠ 회수는 "정지"가 아니라 "삭제"일 수 있다.** 그래서 §7-4 의 ①(PC 로 내려온 JSON)이 **회수 대비책의 본체**다. 회피를 아무리 잘해도 이게 없으면 도박이다.
2. **메모리를 실제로 쓰게 한다** — 12 GB 의 20% = 2.4 GB. SQLite 캐시·페이지 캐시를 넉넉히 잡으면 자연스럽게 올라가고, **인위적 낭비가 아니라 실제 성능 이득**이다.
3. **정기 작업을 붙인다** — 백업(§7-4), 로그 로테이션, 헬스체크. 이것도 실제 유용한 일이면서 CPU·네트워크를 만든다.
4. **⚠ 순수 부하 생성기(`stress-ng` 상시 구동 등)는 권하지 않는다.** 유휴 회수 정책의 목적 자체를 무력화하는 행위라 정책 위반 소지가 있고, **계정 전체가 날아가면 인스턴스 하나 잃는 것보다 나쁘다.** 위 2·3 처럼 **실제로 하는 일**로 채워라.
5. **§3-2 의 반대 논리**: OCPU 를 1 로 줄이면 같은 절대 작업량이 **더 높은 사용률**로 계산된다. 러닝허브에 2 OCPU 는 명백히 과잉이므로, **회수가 실제로 관측되면 1 OCPU / 6 GB 로 줄이는 게 합리적 대응**이다. 지금은 안 줄여도 되지만 이 카드가 있다는 걸 알아둬라.

**검증**: OCI 콘솔 → Compute → Instance → **Metrics** 에서 CPU/Network/Memory 7일 그래프를 본다. 20% 선을 어디쯤 지나는지 **눈으로 확인**하는 게 이 절의 실제 검증이다.

### 8-3. 예산 알림 — 0원을 넘지 않는지

Always Free 만 쓰면 청구가 0 이지만, **"Always Free 범위 안이라고 믿는 것"과 "실제로 그런 것"은 다르다.** 특히 §3-3 에서 PAYG 로 갔다면 필수다.

콘솔 → **Billing & Cost Management → Budgets → Create Budget**

- Target: **Tenancy(전체)**
- Amount: **$1**
- Alert Rule: **실제 지출(Actual)이 100% 초과 시 이메일** — 즉 $0.01 이라도 나가면 알림
- 추가로 **예측(Forecast) 50%** 알림도 걸면 발생 전에 잡힌다

**검증**: Budgets 목록에 예산이 보이고 알림 규칙에 본인 이메일이 있다. 그리고 **Cost Analysis 에서 이번 달 지출이 $0.00 인지** 매달 1회 확인 — 달력에 반복 일정으로 박아라.

---

## 9. 롤백 / 탈출 — 이 호스트를 버릴 때

**§0 이 이 절을 가설에서 실무로 바꿨다.** 무료 티어는 공지 없이 반토막났다. 다음은 폐지일 수 있고, 회수(§8)일 수도, 계정 정지일 수도 있다.

### 9-1. 들고 나오는 것 — **단 하나**

**`exportSnapshot` JSON.** 끝이다.

I1 이 _"클라우드가 사라져도 이 파일 하나로 복구된다"_ 고 못 박았고, I7(단일 writer)·§4 의 행 단위 LWW 가 그걸 성립시킨다. **VM 이미지도, Caddy 설정도, systemd 유닛도 들고 나올 필요가 없다** — 전부 이 문서로 30분 안에 재구축된다.

### 9-2. 대피 절차

1. 최신 `exportSnapshot` JSON 을 **개발 PC 로** 회수 (§7-4 ①)
2. 데스크톱 Tauri 앱에서 **가져오기** → 로컬 SQLite 가 다시 정본이 된다
3. **이 시점에 앱은 완전히 동작한다.** 클라우드는 G1(폰에서 편집)만 제공하고, G3/I8 에 따라 볼트·파이썬·AI·Anki 는 원래부터 로컬이다 → **잃는 건 "폰에서 편집" 하나뿐**이다
4. 새 호스트를 고르고 §1 부터 다시. 서버는 Rust 단일 바이너리 + SQLite 파일이므로 **이식성이 최대**다

> **이 절이 짧은 게 설계가 잘된 증거다.** 탈출 비용이 "JSON 하나 + 재구축 30분"인 이유는 §9-3 이 호스트에 **락인되는 관리형 서비스를 안 골랐기 때문**이다(Workers+D1 을 택했다면 D1 스키마·바인딩·Workers 런타임 가정이 전부 이사 비용이었다). 무료 티어가 반토막나도 이 문서가 크게 안 흔들린 것도 같은 이유다.

### 9-3. 대안 호스트 (탈출 시 후보)

이 런북의 §4~§7 은 **거의 그대로 재사용된다** — 어떤 VPS 든 Ubuntu + Caddy + systemd 다. 바뀌는 건 §1~§3(가입·프로비저닝)뿐이다. 유료 최저가 VPS(월 수천원대 aarch64/x86 인스턴스)가 현실적 대안이고, **§0 의 교훈은 "무료의 진짜 가격은 예고 없는 변경"** 이라는 것이다.

---

## 10. 확인한 사실 / 미확인 사실

### 확인한 사실 (2026-07-19 기준, 출처 첨부)

| 사실                                                                       | 출처                                                                                                                        |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Ampere A1 Always Free 한도 = **2 OCPU / 12 GB / 1,500 OCPU-h / 9,000 GB-h** | [Oracle 공식](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)                  |
| 위 축소는 **2026-06-15 발효**, 공지 없이 문서만 갱신                       | [InfoQ](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/) · [Linuxiac](https://linuxiac.com/oracle-quietly-cuts-free-tier-ampere-a1-resources-in-half/) |
| 한도 초과 free-tier 인스턴스는 **실제로 종료됐다**                         | [InfoQ](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/)                                                  |
| Always Free 는 **"계정 수명 동안" 영구 무료** (기간 만료 없음)             | [Oracle 공식](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)                  |
| 블록스토리지 총 **200 GB**, 부트볼륨 최소 47 GB, 볼륨 백업 5개             | [Oracle 공식](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)                  |
| 아웃바운드 전송 **10 TB/월**                                               | [Oracle 공식](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)                  |
| 유휴 회수 = 7일간 CPU 95p<20% **및** 네트워크<20% **및** 메모리<20%(A1만)  | [Oracle 공식](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)                  |
| 회수 정책은 최소 2023년부터 현재까지 유효                                  | [Cloud Customer Connect](https://community.oracle.com/customerconnect/discussion/671904/reclamation-of-idle-compute-instances) |
| **신용카드 필수**, $1 승인, 업그레이드 전엔 미청구. 선불/가상/PIN 카드 불가 | [Oracle Free Tier FAQ](https://www.oracle.com/cloud/free/faq/)                                                              |
| **홈 리전은 가입 후 변경 불가**, Always Free 는 홈 리전에만 생성 가능      | [Oracle Free Tier FAQ](https://www.oracle.com/cloud/free/faq/) · [Oracle 공식](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| A1 **"Out of host capacity" 는 2026-07 현재도 지속**                       | [Ampere 커뮤니티](https://community.amperecomputing.com/t/how-to-get-around-the-out-of-capacity-error-on-the-always-free-tier-of-oci/3432) · [hitrov/oci-arm-host-capacity](https://github.com/hitrov/oci-arm-host-capacity) |
| 용량 대응 = AD 변경 / 재시도 / 자동화 스크립트 / **PAYG 업그레이드**       | [hitrov](https://hitrov.medium.com/resolving-oracle-cloud-out-of-capacity-issue-and-getting-free-vps-with-4-arm-cores-24gb-of-a3d7e6a027a8) · [Ampere 커뮤니티](https://community.amperecomputing.com/t/how-to-get-around-the-out-of-capacity-error-on-the-always-free-tier-of-oci/3432) |
| **OCI Ubuntu 이미지는 iptables 로 SSH 외 차단** — Security List 와 별개    | [Oracle 개발자 블로그](https://blogs.oracle.com/developers/enabling-network-traffic-to-ubuntu-images-in-oracle-cloud-infrastructure) |
| iptables 규칙은 REJECT **앞**에 삽입해야 하며 `netfilter-persistent save` 필요 | [Oracle 개발자 블로그](https://blogs.oracle.com/developers/enabling-network-traffic-to-ubuntu-images-in-oracle-cloud-infrastructure) · [syncbricks](https://syncbricks.com/fixing-port-80-and-443-not-accessible-in-oracle-cloud-ubuntu-nginx-guide/) |

### 미확인 사실 (추측으로 채우지 않음)

| 항목                                                          | 상태                                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **PAYG 계정이 4 OCPU / 24 GB 를 유지하는가**                  | ⚠ **미확인.** 지원 상담원 구두/메일 답변 보고만 있고 **공식 문서는 계정 유형을 구분하지 않는다**. 이걸 믿고 초과 프로비저닝하면 과금 위험 |
| 한국 리전(`ap-seoul-1`/`ap-chuncheon-1`)의 **현재 A1 가용성** | ⚠ **미확인.** 리전별 실시간 재고는 공개되지 않는다. §1-1 은 이 불확실성을 안고 내린 판단이다 |
| "새벽 시간대 재시도 성공률이 높다"                            | ⚠ **미확인** — 커뮤니티 경험칙. 공식 근거 없음                                             |
| 유휴 회수가 **정지인지 삭제인지**                             | ⚠ **미확인.** 문서는 "reclaimed" 라고만 적는다. §8-2 는 **삭제로 가정**하고 설계했다        |
| 회수 전 사전 통지 여부·유예 기간                              | ⚠ **미확인.** §0 의 한도 축소가 무통지였다는 점을 보면 기대하지 않는 게 안전하다            |
| 향후 한도 추가 축소 계획                                      | ⚠ **미확인** (당연히 공개되지 않는다). §9 가 이 리스크의 대응책이다                        |
| Windows 네이티브 → aarch64-linux 크로스컴파일의 현재 난이도    | ⚠ **미확인** (직접 검증 안 함). §6 은 이 불확실성 때문에 ⓐ/ⓑ 를 권한다                     |

---

## 부록 — P0/P1 매핑 요약

| 설계서 §6 항목               | 이 런북의 위치                    | 인프라로 해결되나                             |
| ---------------------------- | --------------------------------- | --------------------------------------------- |
| **P0-1** TLS 전 구간         | **§5** (Caddy) · 검증 §5-4 · §5-5 | ✅ 전부                                        |
| **P0-2** 토큰 URL 제거·수명  | §5-3(완화만) · **§6-3**           | ❌ **앱 작업**. 인프라는 Referrer 방어까지     |
| **P0-3** 수신 스키마 strict  | **§6-3**                          | ❌ **앱 작업**(C-2). 배포 전 바이너리에 있어야 |
| **P1-4** 기기 단위 주체      | §6-3 · §5-3 로그와 연동           | ❌ 앱 작업                                     |
| **P1-5** CSP                 | (§5-3 헤더로 추가 가능)           | 🔶 Caddy 헤더 또는 앱                          |
| **P1-6** `no-store` · CORS   | 앱                                | ❌ 앱 작업                                     |
| **P1-7** 요청 크기 상한·RL   | **§5-3** `request_body max_size`  | 🔶 1차 방어는 Caddy, RL 은 앱                  |
| **P2-8** 백업·복구 검증      | **§7-4** · §9-2                   | ✅                                             |
| **P2-9** 접근 로그           | **§5-3** (IP만) + P1-4 필요       | 🔶 절반                                        |

> **§6-3 을 다시 읽어라**: 인프라가 전부 서 있어도 **P0-2·P0-3 이 담긴 바이너리 전에는 공인 IP 를 붙이지 않는다.** 이 런북의 §1~§5 를 다 끝내고 §6 앞에서 멈추는 게 정상적인 진행이다.
