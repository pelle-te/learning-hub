/* ============================================================
   Integrations — 탭: 🔗 연동 현황 (Phase 5 · 서버/외부)
   외부 자료를 읽는 두 읽기전용 패널(볼트·Anki)을 한 탭에 합친다(레거시 ui-integrations 동형).
   각 패널이 자기 FS Access/AnkiConnect 호출과 Query 캐시를 소유.
============================================================ */
import TelemetryConsole from './TelemetryConsole';
import { VaultPanel } from './VaultPanel';
import { AnkiPanel } from './AnkiPanel';
import i from './Integrations.module.css';

export default function Integrations() {
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
