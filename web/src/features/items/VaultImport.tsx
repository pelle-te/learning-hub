/* ============================================================
   VaultImport — 과목 세그먼트 인라인 '볼트/Anki에서 불러오기'(계획개편 §5-2).
   연동 탭 VaultPanel·AnkiPanel과 같은 lib(pickAndScanVault·pickAndScanAnki·chaptersFromVault·makeItem)·
   같은 쿼리 캐시(['vault']·['ankiFile']·['vaultHandle'])를 호출한다(코드 이동 아님 · 두 곳에서 같은 훅).
   여기선 '연결→항목 추가'만 — 해제/실시간 due/트리 상세는 연동 탭 소유. 탭 이동 없이 과목을 넣는다.
============================================================ */
import LiveRegion from '@/components/LiveRegion';
import { useState } from 'react';
import { useQuery, useQueryClient, skipToken } from '@tanstack/react-query';
import { useApp } from '@/store/useApp';
import { importVaultSubject, toast } from '@/shell';
import { pickAndScanVault, type VaultScan, type VaultSubject } from '@/lib/vault';
import { isTauri } from '@/lib/tauri';
import { pickAndScanAnki, type AnkiFile } from '@/lib/anki';
import { idbPut } from '@/lib/idb';
import { makeItem, jsq } from '@/lib/utils';
import { useLedger } from '@/store/queries';
import { Button } from '@/components/ui';
import { Icon } from '@/components/Icon';

// Items.module.css → Tailwind 이식(C-7) 잔여 3종. 볼트/Anki 스캔 결과의 컴팩트 행.
const VAULT_LIST = 'mt-2.5 flex max-h-[var(--vault-list-vh)] flex-col gap-1.5 overflow-y-auto';
const VAULT_ROW = 'flex items-center gap-2.5 rounded-md bg-panel2 px-2.5 py-1.75 shadow-inset-line2';
const VAULT_NAME = 'min-w-0 flex-1 truncate text-md font-bold';

export function VaultImport({ onClose }: { onClose?: () => void }) {
  const qc = useQueryClient();
  const mutate = useApp((s) => s.mutate);
  const items = useApp((s) => s.state.items);
  const scan = useQuery<VaultScan>({ queryKey: ['vault'], queryFn: skipToken }).data;
  const anki = useQuery<AnkiFile>({ queryKey: ['ankiFile'], queryFn: skipToken }).data;
  // 원장(W4) — 임포트 직후 "카드까지 갔다"를 물으려면 여기서 실제로 읽어야 한다(구독만으론 비어 있다).
  const led = useLedger();
  const [busy, setBusy] = useState<'' | 'vault' | 'anki'>('');
  const [err, setErr] = useState('');

  /* ⚠ 셸의 볼트 스캔은 **`app/VaultSync` 가 부팅에 한다**(W3 · 2026-07-31). 종전엔 여기와
     연동 탭에 각자 있었고, 그래서 두 화면 중 하나를 열기 전까지 `['vault']` 가 비어 있었다. */

  /* 셸(3단계)에선 볼트가 `<워크스페이스>/knowledge` 라 폴더를 묻지 않는다. 부팅에 이미 읽혀
     있고 감시가 갱신하므로 이 버튼 자체가 필요 없다 — 아래 렌더에서 숨긴다.
     여기 남은 경로는 브라우저(dev·트랙 A)용이다. */
  const doScanVault = async () => {
    setErr('');
    setBusy('vault');
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
      setBusy('');
    }
  };
  const doScanAnki = async () => {
    setErr('');
    setBusy('anki');
    try {
      const handle = qc.getQueryData<FileSystemDirectoryHandle>(['vaultHandle']);
      const r = await pickAndScanAnki(handle);
      if (r) {
        qc.setQueryData(['ankiFile'], r.scan);
        qc.setQueryData(['vaultHandle'], r.handle);
        idbPut('vaultHandle', r.handle);
      }
    } catch (e) {
      setErr((e as Error).message || String(e));
    } finally {
      setBusy('');
    }
  };

  /* 임포트 규칙(W4 포함)은 `shell/importVaultSubject` 가 소유한다 — 연동 탭의
     볼트 패널과 **같은 함수**여야 한다(종전엔 28줄 사본 둘이었다 · H22). */
  const addSubject = (s: VaultSubject) => importVaultSubject(s, led.data, '주당 시간·마감을 조정하세요.');
  const addAnki = (name: string, mins: number) => {
    const nm = 'Anki: ' + name;
    if (items.some((x) => x.name === nm)) {
      toast('이미 추가됨', 'warn');
      return;
    }
    mutate((st) => {
      st.items.push(makeItem({ source: 'Anki', name: nm, mode: 'daily', dailyMin: mins }));
    });
    toast(`"${nm}" 매일 ${mins}분 복습으로 추가됨`, 'ok');
  };

  return (
    <div className="ds-rule" style={{ marginBottom: 14 }}>
      <div className="ds-row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ flex: 1 }}>
          <Icon name="folder" /> 볼트 / Anki에서 불러오기
        </b>
        {!isTauri() && (
          <Button sm variant="primary" disabled={!!busy} onClick={doScanVault}>
            {busy === 'vault' ? (
              <>
                <span className="ds-spin" /> 스캔 중…
              </>
            ) : scan ? (
              <>
                <Icon name="refresh" /> 볼트 다시 스캔
              </>
            ) : (
              '볼트 폴더 연동'
            )}
          </Button>
        )}
        <Button sm disabled={!!busy} onClick={doScanAnki}>
          {busy === 'anki' ? (
            <>
              <span className="ds-spin" /> 스캔 중…
            </>
          ) : (
            <>
              <Icon name="cards" /> Anki 카드 스캔
            </>
          )}
        </Button>
        {onClose && (
          <Button sm variant="ghost" onClick={onClose} aria-label="불러오기 닫기">
            닫기
          </Button>
        )}
      </div>
      <div className="ds-foot">
        볼트=전공 폴더의 과목→챕터. Anki=덱을 '매일 복습' 항목으로. 검증/실시간 due 상세·연동 해제는 연동 탭에서.
        (Chrome/Edge)
      </div>
      {/* ⚠ 리전은 **상시 마운트**한다(H19) — 조건부로 넣으면 리전과 텍스트가 동시에 삽입돼 AT 에 따라 공지가 씹힌다. */}
      <LiveRegion message={err ?? ''} assertive />
      {err && (
        <div className="ds-warnbox" style={{ marginTop: 8 }}>
          {err}
        </div>
      )}
      {scan && (
        <div className={VAULT_LIST}>
          {scan.subjects.length === 0 ? (
            <div className="ds-tiny text-mut">스캔된 과목이 없어요 — 폴더 구조를 확인하세요.</div>
          ) : (
            scan.subjects.map((s, si) => {
              const added = items.some((x) => x.name === s.name);
              return (
                <div key={si} className={VAULT_ROW}>
                  <span className={VAULT_NAME}>{s.name}</span>
                  <span className="ds-tiny text-mut">
                    노트 {s.notes} · 챕터 {s.chapters.length}
                  </span>
                  <Button sm variant={added ? 'ghost' : 'primary'} disabled={added} onClick={() => void addSubject(s)}>
                    {added ? '추가됨' : '+ 학습항목'}
                  </Button>
                </div>
              );
            })
          )}
        </div>
      )}
      {anki && anki.decks.length > 0 && (
        <div className={VAULT_LIST}>
          {anki.decks.map((d) => {
            const nm = 'Anki: ' + jsq(d.file);
            const added = items.some((x) => x.name === nm);
            return (
              <div key={d.file} className={VAULT_ROW}>
                <span className={VAULT_NAME}>
                  <Icon name="cards" /> {d.file}
                </span>
                <span className="ds-tiny text-mut">{d.cards}장</span>
                <Button
                  sm
                  variant={added ? 'ghost' : 'primary'}
                  disabled={added}
                  onClick={() => addAnki(jsq(d.file), Math.max(15, Math.round(d.cards * 0.5)))}
                >
                  {added ? '추가됨' : '+ 매일복습'}
                </Button>
              </div>
            );
          })}
        </div>
      )}
      {anki && anki.decks.length === 0 && (
        <div className="ds-tiny text-mut" style={{ marginTop: 6 }}>
          스캔된 Anki 덱이 없어요 — 정본 인덱스나 anki/*.txt 폴더를 확인하세요.
        </div>
      )}
    </div>
  );
}
