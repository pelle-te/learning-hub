/* ============================================================
   VaultPanel — 옵시디언 볼트 현황(FS Access). Phase 5 · 서버/외부.
   폴더 선택 → 정본 _index.json(또는 .md) 스캔. 결과는 Query 캐시(['vault'])에 — persist X.
   과목/챕터를 '+학습항목'으로 넣는 건 앱상태 변경이라 store.mutate.
============================================================ */
import LiveRegion from '@/components/LiveRegion';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient, skipToken } from '@tanstack/react-query';
import { useApp } from '@/store/useApp';
import { actions, ui } from '@/shell';
import {
  pickAndScanVault,
  chaptersFromVault,
  queryVaultPermission,
  requestVaultPermission,
  type VaultScan,
  type VaultSubject,
  type VaultChapter,
} from '@/lib/vault';
import { isTauri } from '@/lib/tauri';
import { idbGet, idbPut, idbDel } from '@/lib/idb';
import { makeItem } from '@/lib/utils';
import { useLedger } from '@/store/queries';
import { Button } from '@/components/ui';

export function VaultPanel() {
  const qc = useQueryClient();
  const mutate = useApp((s) => s.mutate);
  const items = useApp((s) => s.state.items);
  // 구독형으로 읽어 연동/해제 시 패널이 즉시 반응(skipToken = fetch 없이 캐시만 구독).
  const scan = useQuery<VaultScan>({ queryKey: ['vault'], queryFn: skipToken }).data;
  const handle = useQuery<FileSystemDirectoryHandle>({ queryKey: ['vaultHandle'], queryFn: skipToken }).data;
  // 원장(W4) — 임포트 직후 "카드까지 갔다"를 물으려면 여기서 실제로 읽어야 한다.
  const led = useLedger();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  // 저장된 핸들이 있으나 권한이 만료돼(재시작 후 'prompt') 제스처 재요청이 필요한 상태.
  const [pending, setPending] = useState<FileSystemDirectoryHandle | null>(null);
  const initRef = useRef(false);

  /* 셸(3단계) — 볼트는 `<워크스페이스>/knowledge` 라 **묻지 않고 그냥 읽는다.**
     폴더 선택도, 권한 조회/요청도, IDB 핸들 영속도 여기선 존재하지 않는다.
     ⚠ W3(2026-07-31) — 그 스캔+감시는 **`app/VaultSync` 로 올라갔다.** 이 화면에만 있는 동안엔
     앱이 "볼트에 뭐가 있나"를 이 탭을 열기 전까지 묻지도 않았고, 그게 콜드 스타트가 빈 앱처럼
     보이던 이유였다. 여기 남은 것은 브라우저(dev·트랙 A)의 FSA 재연결뿐이다. */

  // 부팅 재연결(브라우저 전용) — IDB에 저장한 폴더 핸들을 되살린다. 권한이 아직 살아있으면
  // 조용히 재스캔, 아니면 '지난 볼트 다시 연결' 버튼으로 한 번의 제스처만 받아 재선택 없이 붙는다.
  useEffect(() => {
    if (isTauri()) return; // 셸은 위 이펙트가 담당
    if (initRef.current) return;
    initRef.current = true;
    if (qc.getQueryData(['vault'])) return; // 이번 세션에 이미 연동됨(쿼리 캐시 유지)
    let alive = true;
    (async () => {
      const saved = await idbGet<FileSystemDirectoryHandle>('vaultHandle');
      if (!alive || !saved) return;
      const perm = await queryVaultPermission(saved);
      if (!alive) return;
      if (perm === 'granted') {
        try {
          const r = await pickAndScanVault(saved);
          if (alive && r) {
            qc.setQueryData(['vault'], r.scan);
            qc.setQueryData(['vaultHandle'], r.handle);
          }
        } catch {
          if (alive) setPending(saved); // 스캔 실패 → 수동 재연결 유도
        }
      } else {
        setPending(saved);
      }
    })();
    return () => {
      alive = false;
    };
  }, [qc]);

  const doScan = async () => {
    setErr('');
    setBusy(true);
    try {
      const r = await pickAndScanVault();
      if (r) {
        qc.setQueryData(['vault'], r.scan);
        qc.setQueryData(['vaultHandle'], r.handle); // Anki 패널이 같은 폴더 재사용
        idbPut('vaultHandle', r.handle); // 다음 부팅에 재선택 없이 재연결
        setPending(null);
      }
    } catch (e) {
      setErr((e as Error).message || String(e));
    } finally {
      setBusy(false);
    }
  };

  // 저장된 핸들로 재연결 — 제스처 안에서 권한 요청 후 스캔(폴더 재선택 없음).
  const reconnect = async () => {
    if (!pending) return;
    setErr('');
    setBusy(true);
    try {
      const perm = await requestVaultPermission(pending);
      if (perm !== 'granted') {
        setErr('폴더 접근 권한이 필요해요 — 허용하거나, 폴더 연동으로 다시 선택하세요.');
        return;
      }
      const r = await pickAndScanVault(pending);
      if (r) {
        qc.setQueryData(['vault'], r.scan);
        qc.setQueryData(['vaultHandle'], r.handle);
        idbPut('vaultHandle', r.handle);
        setPending(null);
      }
    } catch (e) {
      setErr((e as Error).message || String(e));
    } finally {
      setBusy(false);
    }
  };

  // 연동 해제 — 스캔 결과·공유 폴더 핸들을 캐시·IDB에서 제거(Anki 패널이 재사용하던 핸들도 함께 풀림).
  const disconnect = () => {
    qc.removeQueries({ queryKey: ['vault'], exact: true });
    qc.removeQueries({ queryKey: ['vaultHandle'], exact: true });
    idbDel('vaultHandle');
    setOpen(new Set());
    setPending(null);
    setErr('');
    ui.toast('볼트 폴더 연동을 해제했어요.', 'info');
  };

  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  /* 임포트 규칙(W4 포함)은 `shell/actions.importVaultSubject` 가 소유한다 — 과목 탭의
     볼트 임포트와 **같은 함수**여야 한다(종전엔 28줄 사본 둘이었다 · H22). */
  const addSubject = (s: VaultSubject) =>
    actions.importVaultSubject(s, led.data, '학습 항목 탭에서 주당 시간·마감 조정하세요.');
  const addChapter = (s: VaultSubject, c: VaultChapter) => {
    const name = `${s.name} · ${c.name}`;
    if (items.some((x) => x.name === name)) {
      ui.toast('이미 추가됨', 'warn');
      return;
    }
    mutate((st) => {
      st.items.push(makeItem({ source: '볼트', name, weeklyHours: 2, chapters: chaptersFromVault([c]) }));
    });
    ui.toast(`"${name}" 추가됨`, 'ok');
  };

  return (
    <>
      <div className="ds-rule">
        <h2>옵시디언 볼트 현황</h2>
        <div className="ds-row">
          {/* 셸에선 폴더 연동·해제 버튼이 없다 — 볼트 위치를 앱이 알고, 변경은 감시가 알려 준다. */}
          {!isTauri() && (
            <Button sm variant="primary" disabled={busy} onClick={doScan}>
              {busy ? (
                <>
                  <span className="ds-spin" /> 스캔 중...
                </>
              ) : scan ? (
                '🔄 다시 스캔'
              ) : (
                '📁 볼트 폴더 연동'
              )}
            </Button>
          )}
          {!isTauri() && !scan && pending && (
            <Button
              sm
              variant="primary"
              disabled={busy}
              onClick={reconnect}
              title="지난번 연동한 폴더에 재선택 없이 다시 연결"
            >
              🔗 지난 볼트 다시 연결{pending.name ? ` (${pending.name})` : ''}
            </Button>
          )}
          {!isTauri() && scan && (
            <Button
              sm
              variant="ghost"
              danger
              disabled={busy}
              onClick={disconnect}
              title="연동 해제 — 스캔 결과와 폴더 연결을 제거"
            >
              ✕ 연동 해제
            </Button>
          )}
          <div style={{ flex: 3 }} />
        </div>
        <div className="ds-foot">
          {isTauri()
            ? '워크스페이스의 knowledge 폴더를 읽습니다 — 파일이 바뀌면 자동으로 갱신돼요. 항목 옆 ‘+스케줄’로 바로 학습 항목에 넣어요.'
            : "전공 폴더를 고르면 과목→챕터→노트 수와 검증/Anki 상태(YAML)를 읽습니다. 항목 옆 '+스케줄'로 바로 학습 항목에 넣어요. (Chrome/Edge)"}
        </div>
        {/* ⚠ 리전은 **상시 마운트**한다(H19) — 조건부로 넣으면 리전과 텍스트가 동시에 삽입돼 AT 에 따라 공지가 씹힌다. */}
        <LiveRegion message={err ?? ''} assertive />
        {err && (
          <div className="ds-warnbox" style={{ marginTop: 8 }}>
            {err}
          </div>
        )}
        {scan && (
          <div className="ds-tiny text-mut" style={{ marginTop: 6 }}>
            📂 {isTauri() ? '감시 중' : '연동됨'}: <b style={{ color: 'var(--ink)' }}>{handle?.name || 'knowledge'}</b>{' '}
            · 스캔 {scan.at} · 과목 {scan.subjects.length}개{scan.src ? ' · ' + scan.src : ''}
          </div>
        )}
      </div>

      {scan && (
        <div className="ds-rule">
          {scan.subjects.map((s, si) => {
            // 노트 0개면 0/0=NaN → 헤더·진행바가 'NaN%'가 된다. 0%로 가드.
            const vp = s.notes ? Math.round((s.verified / s.notes) * 100) : 0;
            const ep = s.notes ? Math.round((s.exported / s.notes) * 100) : 0;
            // Anki 미출력 = 노트는 있으나 아직 카드가 안 만들어진 것(볼트↔Anki 커버리지 갭). 파생 산술만.
            const uncovered = Math.max(0, s.notes - s.exported);
            const isOpen = open.has(si);
            return (
              <div key={si} className="mb-2.25 overflow-hidden rounded-md border border-line bg-panel">
                <div
                  className="flex cursor-pointer items-center gap-2 px-3.25 py-2.5 transition-[background] hover:bg-panel2"
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                  onClick={() => toggle(si)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggle(si);
                    }
                  }}
                >
                  <b style={{ flex: 1 }}>{s.name}</b>
                  <span className="ds-tiny text-mut">
                    노트 {s.notes} · 검증 {s.verified}({vp}%){s.wip ? ` · 진행중 ${s.wip}` : ''}
                    {s.legacy ? ` · 구버전 ${s.legacy}` : ''} · Anki {s.exported}({ep}%)
                    {uncovered > 0 ? ` · 🃏 미출력 ${uncovered}` : ''}
                  </span>
                  <Button
                    sm
                    onClick={(e) => {
                      e.stopPropagation();
                      void addSubject(s);
                    }}
                  >
                    +학습항목(챕터 포함)
                  </Button>
                </div>
                <div className="ds-bar" style={{ margin: '0 12px 6px' }}>
                  <i style={{ width: `${vp}%`, background: 'var(--acc)', boxShadow: '0 0 8px var(--glow)' }} />
                </div>
                {isOpen && (
                  <div className="pt-0.5 pr-3.25 pb-2.25 pl-7.5">
                    {s.chapters.length ? (
                      s.chapters.map((c, ci) => (
                        <div
                          key={ci}
                          className="flex items-center gap-2 border-b border-dashed border-line-soft py-1.25 text-md last:border-b-0"
                        >
                          <span className="flex-1">{c.name}</span>
                          <span className="ds-tiny text-mut">
                            {c.notes}노트 · 검증 {c.verified}
                            {c.wip ? ` · 진행중 ${c.wip}` : ''}
                            {c.legacy ? ` · 구버전 ${c.legacy}` : ''} · Anki {c.exported}
                          </span>
                          <Button sm variant="ghost" onClick={() => addChapter(s, c)}>
                            +단일
                          </Button>
                        </div>
                      ))
                    ) : (
                      <div className="ds-tiny text-mut">하위 챕터 없음</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
