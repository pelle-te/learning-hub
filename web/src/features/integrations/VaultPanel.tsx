/* ============================================================
   VaultPanel — 옵시디언 볼트 현황(FS Access). Phase 5 · 서버/외부.
   폴더 선택 → 정본 _index.json(또는 .md) 스캔. 결과는 Query 캐시(['vault'])에 — persist X.
   과목/챕터를 '+학습항목'으로 넣는 건 앱상태 변경이라 store.mutate.
============================================================ */
import { useState } from 'react';
import { useQuery, useQueryClient, skipToken } from '@tanstack/react-query';
import { useApp } from '@/store/useApp';
import { ui } from '@/shell';
import { pickAndScanVault, chaptersFromVault, type VaultScan, type VaultSubject, type VaultChapter } from '@/lib/vault';
import { makeItem } from '@/lib/utils';
import { Button } from '@/components/ui';
import ds from '@/styles/ds.module.css';
import g from './Integrations.module.css';

export function VaultPanel() {
  const qc = useQueryClient();
  const mutate = useApp((s) => s.mutate);
  const items = useApp((s) => s.state.items);
  // 구독형으로 읽어 연동/해제 시 패널이 즉시 반응(skipToken = fetch 없이 캐시만 구독).
  const scan = useQuery<VaultScan>({ queryKey: ['vault'], queryFn: skipToken }).data;
  const handle = useQuery<FileSystemDirectoryHandle>({ queryKey: ['vaultHandle'], queryFn: skipToken }).data;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<Set<number>>(() => new Set());

  const doScan = async () => {
    setErr('');
    setBusy(true);
    try {
      const r = await pickAndScanVault();
      if (r) {
        qc.setQueryData(['vault'], r.scan);
        qc.setQueryData(['vaultHandle'], r.handle); // Anki 패널이 같은 폴더 재사용
      }
    } catch (e) {
      setErr((e as Error).message || String(e));
    } finally {
      setBusy(false);
    }
  };

  // 연동 해제 — 스캔 결과·공유 폴더 핸들을 캐시에서 제거(Anki 패널이 재사용하던 핸들도 함께 풀림).
  const disconnect = () => {
    qc.removeQueries({ queryKey: ['vault'], exact: true });
    qc.removeQueries({ queryKey: ['vaultHandle'], exact: true });
    setOpen(new Set());
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

  const addSubject = (s: VaultSubject) => {
    if (items.some((x) => x.name === s.name)) {
      ui.toast('이미 추가된 항목입니다.', 'warn');
      return;
    }
    const chapters = chaptersFromVault(s.chapters);
    mutate((st) => {
      st.items.push(makeItem(st.items.length, { source: '볼트', name: s.name, chapters }));
    });
    ui.toast(`"${s.name}" 추가됨 — 챕터 ${chapters.length}개. 학습 항목 탭에서 주당 시간·마감 조정하세요.`, 'ok');
  };
  const addChapter = (s: VaultSubject, c: VaultChapter) => {
    const name = `${s.name} · ${c.name}`;
    if (items.some((x) => x.name === name)) {
      ui.toast('이미 추가됨', 'warn');
      return;
    }
    mutate((st) => {
      st.items.push(
        makeItem(st.items.length, { source: '볼트', name, weeklyHours: 2, chapters: chaptersFromVault([c]) }),
      );
    });
    ui.toast(`"${name}" 추가됨`, 'ok');
  };

  return (
    <>
      <div className={ds.card}>
        <h2>옵시디언 볼트 현황</h2>
        <div className={ds.row}>
          <Button sm variant="primary" disabled={busy} onClick={doScan}>
            {busy ? (
              <>
                <span className={ds.spin} /> 스캔 중...
              </>
            ) : scan ? (
              '🔄 다시 스캔'
            ) : (
              '📁 볼트 폴더 연동'
            )}
          </Button>
          {scan && (
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
        <div className={ds.foot}>
          전공 폴더를 고르면 과목→챕터→노트 수와 검증/Anki 상태(YAML)를 읽습니다. 항목 옆 '+스케줄'로 바로 학습 항목에
          넣어요. (Chrome/Edge)
        </div>
        {err && (
          <div className={ds.warnbox} style={{ marginTop: 8 }}>
            {err}
          </div>
        )}
        {scan && (
          <div className={`${ds.muted} ${ds.tiny}`} style={{ marginTop: 6 }}>
            📂 연동됨: <b style={{ color: 'var(--ink)' }}>{handle?.name || '볼트 폴더'}</b> · 스캔 {scan.at} · 과목{' '}
            {scan.subjects.length}개{scan.src ? ' · ' + scan.src : ''}
          </div>
        )}
      </div>

      {scan && (
        <div className={`${ds.card} ${g.tree}`}>
          {scan.subjects.map((s, si) => {
            const vp = Math.round((s.verified / s.notes) * 100);
            const ep = Math.round((s.exported / s.notes) * 100);
            const isOpen = open.has(si);
            return (
              <div key={si} className={g.sub}>
                <div
                  className={g.sh}
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
                  <span className={`${ds.tiny} ${ds.muted}`}>
                    노트 {s.notes} · 검증 {s.verified}({vp}%){s.wip ? ` · 진행중 ${s.wip}` : ''}
                    {s.legacy ? ` · 구버전 ${s.legacy}` : ''} · Anki {s.exported}({ep}%)
                  </span>
                  <Button
                    sm
                    onClick={(e) => {
                      e.stopPropagation();
                      addSubject(s);
                    }}
                  >
                    +학습항목(챕터 포함)
                  </Button>
                </div>
                <div className={ds.bar} style={{ margin: '0 12px 6px' }}>
                  <i style={{ width: `${vp}%`, background: 'var(--acc)', boxShadow: '0 0 8px var(--glow)' }} />
                </div>
                {isOpen && (
                  <div className={g.chs}>
                    {s.chapters.length ? (
                      s.chapters.map((c, ci) => (
                        <div key={ci} className={g.ch}>
                          <span className={g.nm}>{c.name}</span>
                          <span className={`${ds.tiny} ${ds.muted}`}>
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
                      <div className={`${ds.muted} ${ds.tiny}`}>하위 챕터 없음</div>
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
