/* ============================================================
   VaultImport — 과목 세그먼트 인라인 '볼트에서 불러오기'(계획개편 §5-2).
   연동 탭 VaultPanel과 같은 lib(pickAndScanVault·chaptersFromVault·makeItem)·같은 쿼리 캐시(['vault'])를
   호출한다(코드 이동 아님 · 두 곳에서 같은 훅 호출). 여기선 '연결→과목 추가'만 — 해제/트리 상세는 연동 탭 소유.
   탭 이동 없이 과목 세그먼트에서 바로 볼트 과목을 학습 항목으로 넣는다(빈 상태 /integrations 유도 대체).
============================================================ */
import { useState } from 'react';
import { useQuery, useQueryClient, skipToken } from '@tanstack/react-query';
import { useApp } from '@/store/useApp';
import { ui } from '@/shell';
import { pickAndScanVault, chaptersFromVault, type VaultScan, type VaultSubject } from '@/lib/vault';
import { idbPut } from '@/lib/idb';
import { makeItem } from '@/lib/utils';
import { Button } from '@/components/ui';
import ds from '@/styles/ds.module.css';
import c from './Items.module.css';

export function VaultImport({ onClose }: { onClose?: () => void }) {
  const qc = useQueryClient();
  const mutate = useApp((s) => s.mutate);
  const items = useApp((s) => s.state.items);
  const scan = useQuery<VaultScan>({ queryKey: ['vault'], queryFn: skipToken }).data;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const doScan = async () => {
    setErr('');
    setBusy(true);
    try {
      const r = await pickAndScanVault();
      if (r) {
        qc.setQueryData(['vault'], r.scan);
        qc.setQueryData(['vaultHandle'], r.handle); // 연동 탭·Anki가 같은 폴더 재사용
        idbPut('vaultHandle', r.handle);
      }
    } catch (e) {
      setErr((e as Error).message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const addSubject = (s: VaultSubject) => {
    if (items.some((x) => x.name === s.name)) {
      ui.toast('이미 추가된 항목입니다.', 'warn');
      return;
    }
    const chapters = chaptersFromVault(s.chapters);
    mutate((st) => {
      st.items.push(makeItem(st.items.length, { source: '볼트', name: s.name, chapters }));
    });
    ui.toast(`"${s.name}" 추가됨 — 챕터 ${chapters.length}개. 주당 시간·마감을 조정하세요.`, 'ok');
  };

  return (
    <div className={ds.card} style={{ marginBottom: 14 }}>
      <div className={ds.row} style={{ alignItems: 'center' }}>
        <b style={{ flex: 1 }}>📁 볼트에서 불러오기</b>
        <Button sm variant="primary" disabled={busy} onClick={doScan}>
          {busy ? (
            <>
              <span className={ds.spin} /> 스캔 중…
            </>
          ) : scan ? (
            '🔄 다시 스캔'
          ) : (
            '볼트 폴더 연동'
          )}
        </Button>
        {onClose && (
          <Button sm variant="ghost" onClick={onClose} aria-label="불러오기 닫기">
            닫기
          </Button>
        )}
      </div>
      <div className={ds.foot}>
        전공 폴더를 고르면 과목→챕터를 읽어 바로 학습 항목으로 넣어요. 검증/Anki 상태 상세·연동 해제는 연동 탭에서.
        (Chrome/Edge)
      </div>
      {err && (
        <div className={ds.warnbox} role="alert" style={{ marginTop: 8 }}>
          {err}
        </div>
      )}
      {scan && (
        <div className={c.vaultList}>
          {scan.subjects.length === 0 ? (
            <div className={`${ds.muted} ${ds.tiny}`}>스캔된 과목이 없어요 — 폴더 구조를 확인하세요.</div>
          ) : (
            scan.subjects.map((s, si) => {
              const added = items.some((x) => x.name === s.name);
              return (
                <div key={si} className={c.vaultRow}>
                  <span className={c.vaultName}>{s.name}</span>
                  <span className={`${ds.tiny} ${ds.muted}`}>
                    노트 {s.notes} · 챕터 {s.chapters.length}
                  </span>
                  <Button sm variant={added ? 'ghost' : 'primary'} disabled={added} onClick={() => addSubject(s)}>
                    {added ? '추가됨' : '+ 학습항목'}
                  </Button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
