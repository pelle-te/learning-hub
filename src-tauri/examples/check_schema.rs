fn main() {
    let db = std::env::var("APPDATA").unwrap() + "\\dev.jin.learninghub\\learning-hub.db";
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let o = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&db)
            .read_only(true);
        let pool = sqlx::SqlitePool::connect_with(o).await.unwrap();
        let t: Vec<(String,)> =
            sqlx::query_as("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                .fetch_all(&pool)
                .await
                .unwrap();
        println!(
            "테이블: {:?}",
            t.iter().map(|x| x.0.as_str()).collect::<Vec<_>>()
        );
        let c: Vec<(i64, String, String, i64, Option<String>, i64)> =
            sqlx::query_as("PRAGMA table_info(settings)")
                .fetch_all(&pool)
                .await
                .unwrap();
        println!(
            "settings 열: {:?}",
            c.iter().map(|x| x.1.as_str()).collect::<Vec<_>>()
        );
    });
}
