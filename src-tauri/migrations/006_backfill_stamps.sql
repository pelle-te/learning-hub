-- v6 — updated_at = 0 인 레거시 행을 동기화 대상으로 되살린다.
--
-- 003_sync.sql 이 `updated_at` 을 `DEFAULT 0` 으로 추가했다. 그 이전에 쓰인 행은 전부 0 이
-- 됐고, 아웃박스는 `updated_at > watermark` 로 수집하는데 워터마크 초기값이 0 이다.
-- `0 > 0` 은 거짓이므로 **그 행들은 영원히 수집되지 않는다.**
--
-- 조용해서 더 나쁘다: 앱은 "연결됨 · 최신 상태"라고 말하면서 레거시 데이터를 한 행도
-- 올리지 않는다. 실측으로 잡았다(2026-07-20, 첫 실기기 연결) — 로컬 settings 17행 중
-- 클라우드에 도착한 것이 1행이었고, 그 1행만 C-1 이후에 건드려져 스탬프가 있었다.
--
-- ⚠ **왜 상수 1 인가 — 시계를 쓰지 않는다.**
-- "마이그레이션 시점의 시각"이 직관적이지만 그러면 **기기마다 다른 값이 박힌다**(PC 는
-- 오늘, 폰은 다음 달). 같은 레거시 행이 기기별로 다른 스탬프를 갖게 되고, LWW 가 "나중에
-- 마이그레이션한 기기"를 이기게 만든다 — 실제로는 둘 다 같은 옛 데이터인데도. 상수 1 은
-- 결정적이라 어디서 돌든 같고, "가장 오래된 편집"이라는 의미도 정확하다(다른 기기의 실제
-- 편집이 있으면 그쪽이 이겨야 맞다).
--
-- ⚠ 이 파일은 sqlx 체크섬으로 불변이다. 고칠 일이 생기면 **새 버전을 추가**하라
--    (README.md · C-3 의 결론).

UPDATE settings    SET updated_at = 1 WHERE updated_at = 0;
UPDATE completions SET updated_at = 1 WHERE updated_at = 0;
UPDATE ds_map      SET updated_at = 1 WHERE updated_at = 0;
UPDATE records     SET updated_at = 1 WHERE updated_at = 0;
UPDATE summaries   SET updated_at = 1 WHERE updated_at = 0;
UPDATE week_alloc  SET updated_at = 1 WHERE updated_at = 0;
UPDATE docs        SET updated_at = 1 WHERE updated_at = 0;
