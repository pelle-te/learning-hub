fn main() {
    let db = std::env::var("APPDATA").unwrap() + r"\dev.jin.learninghub\learning-hub.db";
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let o = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&db)
            .read_only(true);
        let pool = sqlx::SqlitePool::connect_with(o).await.unwrap();
        for t in [
            "records",
            "completions",
            "week_alloc",
            "ds_map",
            "summaries",
            "docs",
            "settings",
            "tombstones",
        ] {
            let n: (i64,) = sqlx::query_as(&format!("SELECT COUNT(*) FROM {t}"))
                .fetch_one(&pool)
                .await
                .unwrap();
            println!("{t}: {}", n.0);
        }
        println!("--- updated_at 분포 ---");
        for t in ["settings", "ds_map", "docs"] {
            let r: Vec<(i64, i64)> = sqlx::query_as(&format!(
                "SELECT updated_at, COUNT(*) FROM {t} GROUP BY updated_at ORDER BY updated_at"
            ))
            .fetch_all(&pool)
            .await
            .unwrap();
            let brief: Vec<String> = r.iter().map(|(u, n)| format!("{u}x{n}")).collect();
            println!("{t}: {}", brief.join(", "));
        }
        let s: Vec<(String, String)> = sqlx::query_as("SELECT key, value FROM sync_state")
            .fetch_all(&pool)
            .await
            .unwrap();
        println!("--- sync_state ---");
        for (k, v) in s {
            println!(
                "{k} = {}",
                if k.contains("refresh") || k.contains("device") {
                    "(가림)".into()
                } else {
                    v
                }
            );
        }
    });
}
