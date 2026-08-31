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
import { WORKSPACE_UNSET_SHORT } from '@/lib/artifactState';
import TelemetryConsole from './TelemetryConsole';
import { VaultPanel } from './VaultPanel';
import { AnkiPanel } from './AnkiPanel';
import CoveragePanel from './CoveragePanel';

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
      /* W22/H3 — `primary` 는 **필수 키**다(`store/usePageChrome.ts` 머리주석). 이 화면은 렌즈라
         44px 앵커를 세우지 않는다 — 잊은 것이 아니라 없다고 정한 것이다. */
      primary: null,
      readouts: [
        { label: '볼트', value: vault ? `${subjects}과목` : '—', accent: true },
        { label: 'Anki due', value: live ? due : '—' },
        /* ⛔ 「지식 조인」 리드아웃이 여기 있었다 — 2026-08-31 에 걷었다(U044). 그 수의 생산자가
           은퇴해 영구히 `—` 인데, 리드아웃의 `—` 는 «아직 안 왔다» 로 읽힌다. */
        { label: '워크스페이스', value: online ? '● 연결됨' : ping.isLoading ? '…' : WORKSPACE_UNSET_SHORT },
      ],
    }),
    [vault, subjects, live, due, online, ping.isLoading],
  );

  return (
    <section className="h-full min-w-0" aria-label="연동 현황">
      <div className="grid h-full min-h-0 grid-cols-integrations max-wide:grid-cols-1 max-wide:overflow-y-auto">
        {/* 좌 — 가져오기 액션 패널(볼트·Anki) */}
        <div className="min-w-0 [scrollbar-width:thin] overflow-y-auto px-5.5 pt-5 pb-7">
          {/* ⛔⛔ **지식엔진 조인 줄이 여기 있었다 — 2026-08-31 에 걷었다**(U044 · 사용자 판정).
              그 산출물의 **생산자가 부모에서 삭제**됐고(2026-08-29) `fetchKnowledgeArtifact` 는 이제
              무조건 throw 한다. 그런데 이 줄은 그 사실을 모른 채 *"볼트를 **재빌드하면** 연결됩니다"*
              라고 말했다 — **따를 수 있는 형태의 거짓**이라 사용자는 안내 탭이 시키는 명령을 치고
              (그 파일도 없다 · U045) 다시 와서 같은 문장을 본다. 자기 설정을 의심하는 루프가
              닫히지 않는 형태다.
              ⚠ 「아직」으로 고치지 않고 **지운 이유**: 이 제품의 자는 「한눈에」이고(오버레이 §0-A),
              영영 안 올 값을 위한 자리를 남기는 것은 그 자에 대해 손해다. 죽은 카드를 남기면
              화면이 계속 거짓말한다.
              복구: `git show HEAD:web/src/features/integrations/Integrations.tsx` */}
          <VaultPanel />
          <div style={{ marginTop: 6 }}>
            <AnkiPanel />
          </div>
          {/* N-6(W8) — 카드 커버리지. Anki 연결을 쥔 호스트 바로 아래가 자리다(조회가 그 연결을 탄다). */}
          <div style={{ marginTop: 6 }}>
            <CoveragePanel />
          </div>
          {/* N-7(W8) — ics 구독 피드. **밖으로 나가는 유일한 읽기 통로**라 연동 현황이 그 집이다. */}
          <div style={{ marginTop: 6 }}>
            {/* ⚠ 여기 `IcsFeedPanel`(살아 있는 ics 구독 피드)이 있었다 — 은퇴했다(I050 · 2026-08-22).
                근거: 유일한 **무인증 공개 GET** 표면이었고, 그 피드가 나르던 `week_alloc` 이 실물에서
                0행이라 지금 발행되는 것은 **빈 캘린더**다. 남은 길은 1회 내보내기(`files.rs`). */}
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
