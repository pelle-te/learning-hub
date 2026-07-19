
            CREATE INDEX idx_settings_updated    ON settings    (updated_at);
            CREATE INDEX idx_completions_updated ON completions (updated_at);
            CREATE INDEX idx_ds_map_updated      ON ds_map      (updated_at);
            CREATE INDEX idx_records_updated     ON records     (updated_at);
            CREATE INDEX idx_summaries_updated   ON summaries   (updated_at);
            CREATE INDEX idx_week_alloc_updated  ON week_alloc  (updated_at);
            CREATE INDEX idx_docs_updated        ON docs        (updated_at);

            -- 기기 로컬 동기화 상태. 지금 쓰는 키는 'watermark' 하나(= 여기까지 밀어올렸다).
            CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        