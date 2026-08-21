/* ============================================================
   VaultSync.tsx — 볼트를 **앱 전체가 아는 것**으로 만드는 부팅 훅(W2·W3 · 2026-07-31 · UI 없음).

   ## 왜 생겼나
   종전엔 `['vault']` 를 채우는 코드가 **연동 탭과 임포트 패널 안에만** 있었다. 즉
   `scanVaultViaShell()` 은 폴더 선택도 권한도 없는 **한 번의 Rust 호출**인데, 그 두 화면을 열기
   전까지 앱은 "볼트에 뭐가 있나"를 **묻지도 않았다.** 그래서 콜드 스타트 화면이 볼트가 이미
   풍부한데도(노트 604·과목 4) 빈 앱처럼 보였고(W3), 볼트 `reviewed:` 앵커도 흐를 길이 없었다(W2).

   구독을 화면에서 부팅으로 올리면 둘이 한꺼번에 풀린다 — 스캔 자체는 원래 1회 호출이었다.

   ⚠ 브라우저(dev·트랙 A)에선 아무것도 안 한다: FSA 는 사용자 제스처가 필요해 부팅에 못 부른다.
      그 경로의 재연결은 `VaultPanel` 이 계속 소유한다(IDB 핸들 + 권한 2단계).
============================================================ */
import { useEffect } from 'react';
import { useQuery, useQueryClient, skipToken } from '@tanstack/react-query';
import { isVaultUnset, scanVaultViaShell, VAULT_ERROR_KEY, type VaultScan } from '@/lib/vault';
import { isTauri, onVaultChanged } from '@/lib/tauri';
import { setVaultAnchors, vaultAnchorsFrom } from '@/lib/vaultAnchors';
import { useApp } from '@/store/useApp';

export default function VaultSync() {
  const qc = useQueryClient();
  const items = useApp((s) => s.state.items);
  const scan = useQuery<VaultScan>({ queryKey: ['vault'], queryFn: skipToken }).data;

  /* 셸: 부팅 1회 스캔 + 파일 감시. 브라우저엔 watch 가 원리적으로 없다(FSA). */
  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    let un: (() => void) | undefined;
    /* ⚠⚠ **스캔 실패를 사용자 표면으로 올린다**(U006 · 2026-08-21 ux 축). 종전엔 `lib/tauri` 가
       실패를 `null` 로 접었고, 그 자리 주석은 "사용자 표면은 감시 채널이 맡는다"고 적었지만
       그 채널(`capabilities.vaultWatchError`)을 세우는 곳은 **감시자뿐**이라 스캔 실패는
       콘솔에만 남았다 — 즉 볼트가 깨져도 앱은 "볼트 비어 있음"으로만 보였다.
       ⚠ 미설정(`isVaultUnset`)은 실패가 아니다 — 콜드 게이트가 이미 그 상태를 말한다. */
    const load = async () => {
      try {
        const s = await scanVaultViaShell();
        if (!alive) return;
        if (s) qc.setQueryData(['vault'], s);
        qc.setQueryData(VAULT_ERROR_KEY, null);
      } catch (e) {
        if (!alive) return;
        qc.setQueryData(VAULT_ERROR_KEY, isVaultUnset(e) ? null : e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    void onVaultChanged(() => void load()).then((u) => {
      if (alive) un = u;
      else u(); // 구독이 붙기 전에 언마운트됐다면 즉시 해제(누수 방지)
    });
    return () => {
      alive = false;
      un?.();
    };
  }, [qc]);

  /* 볼트 앵커 레지스트리 동기화 — **쓰는 곳은 여기 하나**(`vaultAnchors.ts` 머리주석의 계약).
     과목이 바뀌거나(임포트·삭제) 볼트가 바뀌면 다시 조인한다. 내용이 같으면 버전이 안 오르므로
     참조-캐시가 헛돌지 않는다. */
  useEffect(() => {
    setVaultAnchors(vaultAnchorsFrom(scan, items));
  }, [scan, items]);

  return null;
}
