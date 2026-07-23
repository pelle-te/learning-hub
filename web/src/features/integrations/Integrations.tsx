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
        { label: '워크스페이스', value: online ? '● 연결됨' : ping.isLoading ? '…' : '미설정F' },
      ],
    }),
    [vault, subjects, live, due, online, ping.isLoading],
  );

  return (
    <section className="h-full min-w-0" aria-label="연동 현황">
      <div className="grid h-full min-h-0 grid-cols-integrations max-wide:grid-cols-1 max-wide:overflow-y-auto">
        {/* 좌 — 가져오기 액션 패널(볼트·Anki) */}
        <div className="min-w-0 [scrollbar-width:thin] overflow-y-auto px-5.5 pt-5 pb-7">
          <VaultPanel />
          <div style={{ marginTop: 6 }}>
            <AnkiPanel />
          </div>
        </div>
        {/* 우 — 텔레메트리 조종석(백엔드·볼트·Anki 라이브 채널) */}
        <aside className="flex min-w-0 flex-col border-l border-line2 px-4.5 py-5 max-wide:min-h-70 max-wide:border-t max-wide:border-l-0 max-wide:border-line2">
          <TelemetryConsole vertical />
        </aside>
      </div>
    </section>
  );
}
