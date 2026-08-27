//! boot.rs — **네이티브 기동 시각**을 프런트에 준다 (P035 · 2026-08-27 성능 축).
//!
//! ## 왜 생겼나 — 「부팅 웨이브」가 부팅의 42% 였다
//!
//! `web/src/lib/perf.ts` 가 마크 셋(`entry`·`app`·`first-data`)을 **부팅 웨이브**라 이름 붙이고
//! 연동 탭의 텔레메트리 콘솔이 그 값을 사용자에게 보여 준다. 그런데 셋 다
//! `performance.timeOrigin` **안쪽**이고, 그 원점은 **WebView2 문서가 시작된 뒤**다.
//!
//! 실 셸 3회 실측(격리 빈 DB · OS 캐시 웜):
//!
//! | 구간 | 중앙 | 계량에 잡히나 |
//! |---|---|---|
//! | spawn → `timeOrigin` | **508 ms** | ❌ 웹 층 밖 |
//! | `timeOrigin` → `entry` | 71 ms | ❌ |
//! | `entry` → `app` | 196 ms | ✅ |
//! | `app` → `first-data` | 42 ms | ✅ |
//! | **총 spawn → first-data** | **881 ms** | **42% 만** |
//!
//! 즉 네이티브 기동이 500 ms 느려져도 그 리드아웃은 한 자릿수도 안 움직인다 — 계량이
//! *"부팅이 느려졌다"* 를 관측하지 못하면서 그렇게 읽히는 이름을 갖고 있었다. 번들 예산
//! 여섯 축도 전부 `timeOrigin` 안쪽이라 **체감의 58% 를 아무 게이트도 안 봤다.**
//!
//! ## 계약
//!
//! `stamp()` 를 `run()` 의 **첫 줄**에서 부른다(플러그인·창보다 먼저 — 재려는 것이 그 전부다).
//! 커맨드는 그 시각을 **Unix epoch ms** 로 준다: 프런트의 `performance.timeOrigin` 이 같은
//! 기준이라 뺄셈이 바로 성립한다(단조 시계로 주면 두 축을 못 잇는다).
//!
//! ⚠ 프로세스 시작보다 **이른** 시각은 잴 수 없다 — OS 가 exe 를 로드하는 구간은 여전히 밖이다.
//! 그래서 이 값의 이름은 「부팅 전체」가 아니라 **`nativeToOrigin`** 이다.

use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

static START_MS: OnceLock<f64> = OnceLock::new();

/// 프로세스 기동 시각을 한 번만 기록한다. `run()` 의 첫 줄이 자리다.
pub fn stamp() {
    let _ = START_MS.set(now_ms());
}

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

/// 기동 시각(Unix epoch ms). ⚠ **없으면 `None` 이다 — 0 으로 대신하지 않는다**(값 부재와 값 0 을
/// 안 섞는 것이 `perf.ts` 의 규율이고, 여기서 0 을 주면 프런트가 1970년을 원점으로 계산한다).
#[tauri::command]
pub fn boot_process_start_ms() -> Option<f64> {
    START_MS.get().copied()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stamp_한_번만_기록된다() {
        // ⚠ 이 테스트는 `stamp()` 가 **멱등**임을 잠근다 — `run()` 이 두 번 불릴 수 있는 경로
        //   (single-instance 재기동)에서 두 번째 값이 첫 기동을 덮으면 계량이 0 에 수렴한다.
        stamp();
        let first = boot_process_start_ms().expect("stamp 뒤엔 값이 있어야 한다");
        stamp();
        assert_eq!(
            boot_process_start_ms(),
            Some(first),
            "두 번째 stamp 가 첫 기동을 덮었다"
        );
    }

    #[test]
    fn epoch_ms_라서_웹_timeorigin_과_같은_축이다() {
        stamp();
        let v = boot_process_start_ms().unwrap();
        // 2020-01-01(1577836800000) 이후 · 2100년(4102444800000) 이전 — 단조 시계면 이 범위 밖이다.
        assert!(
            v > 1_577_836_800_000.0,
            "epoch ms 가 아니다(단조 시계를 준 것 같다): {v}"
        );
        assert!(v < 4_102_444_800_000.0, "epoch ms 범위를 벗어났다: {v}");
    }
}
