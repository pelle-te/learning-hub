/*! 일회성 복구 — 트랙 B 가 깎아 놓은 `docs` 스탬프를 되살린다.

## 무슨 일이 있었나

`web/e2e-shell/shell.spec.ts` 의 `4단계-J` 가 실물 DB 에 이렇게 썼다(뒷정리도 같은 모양):

```sql
INSERT OR REPLACE INTO docs (key, value) VALUES ($1, $2)   -- updated_at 이 없다 → DEFAULT 0
```

앱의 진짜 쓰기 경로(`web/src/lib/db/docs.ts:51`)는 `updated_at` 을 3번째 인자로 제대로 찍는다.
즉 **앱은 정상이고 검증 하네스가 데이터를 망가뜨렸다.** 그 결과 사용자의 독후감(`lh:reads`)이
`updated_at = 0` 이 되었고, 아웃박스는 `updated_at > watermark` 로 수집하므로 (워터마크가 이미
0 보다 크다) **영원히 클라우드로 안 올라간다.** 앱은 그동안 "연결됨 · 최신 상태"라고 말한다.

## ⚠ v6 백필로는 안 고쳐진다

`006_backfill_stamps.sql` 은 0 스탬프를 **상수 1** 로 올린다. 그건 워터마크가 0 인
*첫 동기화 전* 기기에서만 유효하다 — 이미 한 번이라도 동기화한 기기에서는 `1 > watermark` 가
거짓이라 그 행은 여전히 안 올라간다. 그래서 여기서는 **워터마크보다 큰 값**을 쓴다.

## 안전성

- `value` 는 한 글자도 건드리지 않는다. 바뀌는 것은 `updated_at` 뿐이다.
- `WHERE updated_at = 0` 이라 멀쩡한 행은 손대지 않는다(멱등).
- **앱을 끄고 실행할 것.** 켜져 있으면 앱의 다음 저장이 이 값을 덮을 수 있다.

실행: `cargo run --example repair_stamp --manifest-path src-tauri/Cargo.toml`
*/
fn main() {
    let db =
        std::env::var("APPDATA").expect("APPDATA 없음") + r"\dev.jin.learninghub\learning-hub.db";
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let opts = sqlx::sqlite::SqliteConnectOptions::new().filename(&db);
        let pool = sqlx::SqlitePool::connect_with(opts)
            .await
            .expect("DB 열기 실패 — 앱이 켜져 있지 않은지 확인하세요");

        let (wm,): (i64,) =
            sqlx::query_as("SELECT CAST(value AS INTEGER) FROM sync_state WHERE key='watermark'")
                .fetch_one(&pool)
                .await
                .unwrap_or((0,));
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        // 워터마크보다 커야 아웃박스가 집어 간다(위 ⚠ 참조).
        let stamp = now.max(wm + 1);

        let before: Vec<(String, i64)> =
            sqlx::query_as("SELECT key, updated_at FROM docs ORDER BY key")
                .fetch_all(&pool)
                .await
                .unwrap();
        println!("복구 전 docs: {before:?}");

        let r = sqlx::query("UPDATE docs SET updated_at = ?1 WHERE updated_at = 0")
            .bind(stamp)
            .execute(&pool)
            .await
            .expect("복구 UPDATE 실패");
        println!(
            "워터마크={wm} · 새 스탬프={stamp} · 고친 행={}",
            r.rows_affected()
        );

        let after: Vec<(String, i64)> =
            sqlx::query_as("SELECT key, updated_at FROM docs ORDER BY key")
                .fetch_all(&pool)
                .await
                .unwrap();
        println!("복구 후 docs: {after:?}");
        pool.close().await;
    });
}
