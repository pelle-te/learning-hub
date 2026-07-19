
            -- 행 슬라이스 중 '실제로 존재했던' 것들. 비어 있음과 없음을 구분하려면 필요하다
            -- (completions:{} 는 행을 0개 만든다 → 이게 없으면 undefined 로 되살아난다).
            CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

            -- 내보내기에 **포함**되는 스칼라·마커·유계 문서(items·routine·degree·weekly).
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

            -- 로컬 저장은 하되 내보내기에서 **빠지는** 층(RUNTIME_CACHE_KEYS).
            -- persistence.ts 의 2계층 스코프를 테이블 경계로 직역한 것.
            CREATE TABLE runtime_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL);

            -- completions[ds][sid|type] — 2단 중첩이라 전용 테이블.
            CREATE TABLE completions (
                ds TEXT NOT NULL, k TEXT NOT NULL, value TEXT NOT NULL,
                PRIMARY KEY (ds, k)
            );

            -- 날짜 키 맵(dayOverrides·dayPlans·rituals) — slice 로 구분.
            CREATE TABLE ds_map (
                slice TEXT NOT NULL, ds TEXT NOT NULL, value TEXT NOT NULL,
                PRIMARY KEY (slice, ds)
            );

            -- id 배열 슬라이스(cbms·backlog·blankResults·retentionLog·events·tasks).
            -- ord 는 순서가 의미를 갖는 슬라이스(로그·정렬) 때문에 필수.
            CREATE TABLE records (
                slice TEXT NOT NULL, id TEXT NOT NULL, ord INTEGER NOT NULL, value TEXT NOT NULL,
                PRIMARY KEY (slice, id)
            );
            CREATE INDEX idx_records_slice_ord ON records (slice, ord);

            CREATE TABLE summaries (
                sid TEXT NOT NULL, ord INTEGER NOT NULL, value TEXT NOT NULL,
                PRIMARY KEY (sid, ord)
            );

            CREATE TABLE week_alloc (
                wk TEXT NOT NULL, sid TEXT NOT NULL, value TEXT NOT NULL,
                PRIMARY KEY (wk, sid)
            );
        