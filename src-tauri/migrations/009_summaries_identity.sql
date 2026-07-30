-- v9(C-3 · 2026-07-30 `/감사 근본`) — **동기화 행 키를 위치에서 정체성으로.**
--
-- ## 무엇이 틀렸나
--
-- `summaries` 의 기본키가 `(sid, ord)` 였고 `ord` 는 **배열 인덱스**다(`rows.ts` 의
-- `list.forEach((v, ord) => …)`). 즉 동기화의 행 정체성이 "이 과목 요약 목록의 몇 번째"였다.
-- 행 단위 LWW 는 **같은 키를 같은 것으로 본다** — 그래서 두 가지가 조용히 깨졌다:
--
-- · **동시 추가 = 소실.** 기기 A 와 B 가 오프라인에서 같은 과목에 요약을 하나씩 추가하면 둘 다
--   `(sid, 0)` 을 쓴다. LWW 가 하나를 고르고 **다른 하나는 툼스톤도 흔적도 없이 사라진다.**
--   되살릴 근거가 어디에도 남지 않는다(충돌 그림자조차 "같은 행의 두 값"으로 본다).
-- · **삭제+편집 = 없던 상태.** A 가 첫 요약을 지우면 뒤 요소가 한 칸씩 당겨져 0,1 이 재기입되고
--   `(sid,'2')` 툼스톤이 남는다. 그 사이 B 가 세 번째 요약을 편집했다면(더 큰 스탬프) 부활
--   가드(`deleted_at >= updated_at`)를 통과해 **어느 기기에도 없던 목록**이 만들어진다.
--
-- 결정적으로, **안정 id 는 이미 있었다** — `methodology.ts` 의 `addSummary` 가 `id: rid()` 를
-- 넣는다. 앱은 정체성을 알고 있었고 동기화 계층만 위치를 쓰고 있었다.
--
-- ## 왜 표를 다시 만드는가
--
-- SQLite 는 기본키를 `ALTER` 로 바꿀 수 없다 → 새 표 + 복사 + 교체가 유일한 경로다.
--
-- ⚠ `ord` 는 **버리지 않고 데이터 열로 강등**한다. 요약의 표시 순서가 그 값이고
--   (`rowsToState` 가 `ord` 로 정렬한다) 순서는 여전히 사용자에게 보이는 정보다.
--   달라지는 것은 "순서가 정체성인가"뿐이다 — 아니다.
--
-- ⚠ 기존 행의 id 는 **JSON 본문에서 꺼낸다**(`json_extract(value,'$.id')`). 이게 이 파일에서
--   가장 중요한 한 줄이다: 여기서 `CAST(ord AS TEXT)` 로만 채우면, 다음 부팅에 앱이
--   `stateToRows` 로 만드는 키(=진짜 id)와 어긋나 **전 요약이 "삭제 + 신규 삽입"으로 diff 되어
--   툼스톤이 대량 발생**한다(이 저장소는 툼스톤을 회수하지 않는다 — `contract.ts`). id 가 없는
--   레거시 행만 순번으로 폴백한다.
--
-- ⚠ D1 에도 같은 DDL 이 간다(`server/wrangler.jsonc` 의 `migrations_dir` 이 이 폴더를 가리킨다).
--   `json_extract` 는 D1·번들 SQLite 양쪽에서 쓸 수 있다(JSON1). 원격 적용은 수동이다 —
--   `cd server && npm run migrate:remote` (런북 §5). **적용 전까지 서버는 옛 열 구성이라
--   push 가 400 을 받는다** → 배포 순서는 "D1 마이그레이션 먼저, 그 다음 앱".
--
-- ⚠⚠ 이 파일은 적용된 뒤 **한 글자도 바뀌면 안 된다**(sqlx SHA-384 체크섬 · `db.rs` 머리주석).
--   핀은 같은 커밋에서 `web/test/dbMigrations.test.ts` 에 추가한다.
CREATE TABLE summaries_v9 (
    sid TEXT NOT NULL,
    -- 요약 자체의 안정 id(`rid()`). 레거시 행은 옛 순번 문자열.
    id TEXT NOT NULL,
    -- 표시 순서 — 이제 **데이터**다(정체성이 아니다).
    ord INTEGER NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (sid, id)
);

INSERT INTO summaries_v9 (sid, id, ord, value, updated_at)
SELECT sid,
       COALESCE(json_extract(value, '$.id'), CAST(ord AS TEXT)),
       ord,
       value,
       updated_at
FROM summaries;

DROP TABLE summaries;

ALTER TABLE summaries_v9 RENAME TO summaries;

-- 아웃박스 수집이 쓰는 인덱스 — 표를 다시 만들었으므로 함께 다시 만든다(004 와 같은 이름).
CREATE INDEX idx_summaries_updated ON summaries (updated_at);
