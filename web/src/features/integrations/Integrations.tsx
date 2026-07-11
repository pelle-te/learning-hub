/* ============================================================
   Integrations — 탭: 🔗 연동 현황 (Phase 5 · 서버/외부)
   외부 자료를 읽는 두 읽기전용 패널(볼트·Anki)을 한 탭에 합친다(레거시 ui-integrations 동형).
   각 패널이 자기 FS Access/AnkiConnect 호출과 Query 캐시를 소유.
============================================================ */
import { useQuery, skipToken } from '@tanstack/react-query';
import { usePing } from '@/store/queries';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { totalDue, type AnkiLive } from '@/lib/anki';
import type { VaultScan } from '@/lib/vault';
import TelemetryConsole from './TelemetryConsole';
import { VaultPanel } from './VaultPanel';
import { AnkiPanel } from './AnkiPanel';
import i from './Integrations.module.css';

export default function Integrations() {
  // 상단 바 리드아웃 — TelemetryConsole과 같은 캐시(skipToken=fetch 없이 구독) + usePing로 연결 요약만.
  const ping = usePing();
  const vault = useQuery<VaultScan>({ queryKey: ['vault'], queryFn: skipToken }).data;
  const live = useQuery<AnkiLive>({ queryKey: ['ankiLive'], queryFn: skipToken }).data;
  const online = ping.isSuccess && !!ping.data?.ok;
  const subjects = vault?.subjects.length ?? 0;
  const due = live ? totalDue(live.decks) : 0;

  usePageChromeEffect(
    () => ({
      readouts: [
        { label: '볼트', value: vault ? `${subjects}과목` : '—', accent: true },
        { label: 'Anki due', value: live ? due : '—' },
        { label: 'serve.js', value: online ? '● ON' : ping.isLoading ? '…' : 'OFF' },
      ],
    }),
    [vault, subjects, live, due, online, ping.isLoading],
  );

  return (
    <section className={i.wrap} aria-label="연동 현황">
      <div className={i.cols}>
        {/* 좌 — 가져오기 액션 패널(볼트·Anki) */}
        <div className={i.actions}>
          <VaultPanel />
          <div style={{ marginTop: 6 }}>
            <AnkiPanel />
          </div>
        </div>
        {/* 우 — 텔레메트리 조종석(serve.js·볼트·Anki 라이브 채널) */}
        <aside className={i.console}>
          <TelemetryConsole vertical />
        </aside>
      </div>
    </section>
  );
}
