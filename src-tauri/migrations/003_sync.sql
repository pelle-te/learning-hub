
            ALTER TABLE settings    ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE completions ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE ds_map      ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE records     ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE summaries   ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE week_alloc  ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE docs        ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

            -- 기본키 열 수가 테이블마다 1~2개라 k1·k2 로 편다(k2='' = 단일키).
            -- 공백으로 이어붙인 합성 키를 쓰지 않는 이유: 값에 공백이 들어가면
            -- 서로 다른 행이 같은 키로 뭉갠다(id·ds 는 우리가 만드는 값이 아니다).
            CREATE TABLE tombstones (
                tbl TEXT NOT NULL,
                k1 TEXT NOT NULL,
                k2 TEXT NOT NULL DEFAULT '',
                deleted_at INTEGER NOT NULL,
                PRIMARY KEY (tbl, k1, k2)
            );
            -- 동기화는 '마지막 동기화 이후 지워진 것'을 묻는다 — 그 질의를 위한 인덱스.
            CREATE INDEX idx_tombstones_deleted ON tombstones (deleted_at);
        