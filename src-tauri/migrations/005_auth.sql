
            -- C-4 인증(P0-2 토큰 수명·회전 + P1-4 기기 단위 주체).
            --
            -- ⚠ 이 두 테이블은 **서버(D1) 전용**이다. 마이그레이션 폴더가 로컬 SQLite 와
            -- 공유라 데스크톱 DB 에도 생기지만 비어 있는 채로 남는다. 스키마를 갈래내지
            -- 않는 쪽을 택한 것이고(런북 §3-2 가 meta·runtime_cache 에 대해 내린 판정과
            -- 같은 사상), 사본 두 벌보다 잉여 테이블 두 개가 싸다.
            --
            -- ⚠ **비밀은 원문으로 저장하지 않는다.** 리프레시 토큰·등록 코드는 SHA-256
            -- 해시만 넣는다 — DB 가 유출돼도 그것만으로 남의 기기를 사칭할 수 없게.

            -- 등록된 기기. 폐기(revoke)가 가능해야 하는 것이 이 테이블의 존재 이유다:
            -- 설계서 P1-4 가 "폰을 잃었을 때 모든 기기를 끊는 것 외에 방법이 없다"를 결함으로
            -- 지목했고, 기기 레코드가 있어야 한 대만 끊을 수 있다.
            CREATE TABLE devices (
                id            TEXT PRIMARY KEY,
                name          TEXT NOT NULL,
                refresh_hash  TEXT NOT NULL,
                created_at    INTEGER NOT NULL,
                last_seen_at  INTEGER NOT NULL,
                revoked_at    INTEGER
            );
            CREATE INDEX idx_devices_revoked ON devices (revoked_at);

            -- PC 가 발급하는 1회용 등록 코드. 폰이 이걸 제출하면 기기 레코드가 생긴다.
            -- 비밀번호 로그인을 쓰지 않는 이유는 CPU 10ms 벽이다 — bcrypt/argon2 는
            -- 의도적으로 느린 KDF 라 예산을 넘긴다(런북 §5-2).
            CREATE TABLE enroll_codes (
                code_hash   TEXT PRIMARY KEY,
                created_at  INTEGER NOT NULL,
                expires_at  INTEGER NOT NULL,
                used_at     INTEGER
            );
            CREATE INDEX idx_enroll_expires ON enroll_codes (expires_at);
