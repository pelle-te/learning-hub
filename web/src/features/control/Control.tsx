/* ============================================================
   Control(탐구 수집) — 탭: 🔭 탐구 수집. (옛 시스템 제어판 OPS 콘솔 폐기 → 탐구 단일 목적)
   "교재 밖에서 새로 알아보는 학습"을 검색엔진처럼: 큰 검색바로 주제 수집 → serve.js의
   탐구_수집.py가 전공/_탐구/에 원자 노트 초안 생성. 최근 수집 기록 + 옵시디언 바로가기.
   serve.js 연결은 usePing(Query) — 오프라인이면 우아한 안내.
============================================================ */
import { useState } from 'react';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { usePing } from '@/store/queries';
import { runTool, type RunResult } from '@/lib/api';
import { ui } from '@/shell';
import ds from '@/styles/ds.module.css';
import cm from './Control.module.css';

interface HistEntry {
  topic: string;
  scope?: string;
  at: string;
  ok: boolean;
}
const HKEY = 'lh:research-history';
function loadHistory(): HistEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(HKEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function saveHistory(h: HistEntry[]) {
  try {
    localStorage.setItem(HKEY, JSON.stringify(h.slice(0, 10)));
  } catch {
    /* localStorage 불가 — 무시 */
  }
}
/** 옵시디언 바로가기 — 전공/_탐구 폴더에서 주제 검색(마지막 연 볼트 기준). */
function obsidianLink(topic: string): string {
  return `obsidian://search?query=${encodeURIComponent('path:_탐구 ' + topic)}`;
}
function fmtWhen(at: string): string {
  const d = new Date(at);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function Control() {
  const { data: ping, isLoading } = usePing();
  const online = !!ping?.ok;
  const offline = !isLoading && !online;
  const [topic, setTopic] = useState('');
  const [scope, setScope] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [history, setHistory] = useState<HistEntry[]>(() => loadHistory());
  usePageChromeEffect(
    () => ({
      readouts: [
        { label: '수집 기록', value: history.length, accent: true },
        { label: 'serve.js', value: online ? '● ON' : offline ? 'OFF' : '…' },
      ],
    }),
    [history.length, online, offline],
  );

  const collect = async (t: string, sc: string) => {
    const tq = t.trim();
    if (!tq) {
      ui.toast('탐구할 주제를 입력하세요.', 'warn');
      return;
    }
    // 버튼은 offline이면 disabled지만 Enter 키는 그 게이트를 우회한다 — collect에서 단일 가드.
    if (offline) {
      ui.toast('serve.js가 꺼져 있어요 — node serve.js로 켜면 수집할 수 있어요.', 'warn');
      return;
    }
    if (busy) return;
    setBusy(true);
    setResult(null);
    let res: RunResult;
    try {
      res = await runTool('research', { topic: tq, scope: sc.trim() });
    } catch (e) {
      res = { ok: false, out: '요청 실패: ' + ((e as Error).message || e), code: -1 };
    }
    setResult(res);
    setBusy(false);
    const next = [
      { topic: tq, scope: sc.trim() || undefined, at: new Date().toISOString(), ok: res.ok },
      ...history.filter((h) => h.topic !== tq),
    ].slice(0, 10);
    setHistory(next);
    saveHistory(next);
    ui.toast(`탐구 수집 ${res.ok ? '완료 — 옵시디언에서 확인' : '실패 — 출력 확인'}`, res.ok ? 'ok' : 'bad');
  };

  return (
    <section className={cm.wrap} aria-label="탐구 수집">
      {/* 검색 히어로 — 검색엔진 느낌. */}
      <div className={cm.hero}>
        <div className={cm.heroEyebrow}>🔭 탐구 수집</div>
        {/* h2 — TopBar 워드마크가 페이지 영속 h1이라 본문 최상위는 h2(전 탭 일관). 시각 스타일은 CSS 유지. */}
        <h2 className={cm.heroTitle}>무엇을 새로 알아볼까요?</h2>
        <div className={`${cm.searchBar}${busy ? ' ' + cm.searchBusy : ''}`}>
          <span className={cm.searchIcon} aria-hidden="true">
            ⌕
          </span>
          <input
            className={cm.searchInput}
            placeholder="주제 — 예: 반도체 공급망 동향, 트랜스포머 어텐션 직관"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') collect(topic, scope);
            }}
            disabled={busy}
            aria-label="탐구 주제"
          />
          <input
            className={cm.searchScope}
            placeholder="범위(선택)"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') collect(topic, scope);
            }}
            disabled={busy}
            aria-label="범위"
          />
          <button
            className={cm.searchGo}
            type="button"
            onClick={() => collect(topic, scope)}
            disabled={busy || offline}
          >
            {busy ? (
              <>
                <span className={ds.spin} /> 수집 중
              </>
            ) : (
              '수집 시작'
            )}
          </button>
        </div>
        <div className={cm.heroHint}>
          웹에서 새로 조사해 <code>전공/_탐구/</code>에 원자 노트 초안을 만듭니다.
          {offline ? (
            <b className={cm.offHint}>
              {' '}
              ⚠ serve.js가 꺼져 있어요 — <code>node serve.js</code>로 켜면 수집할 수 있어요.
            </b>
          ) : (
            ' 몇 분~수십 분 걸리며, 탭을 떠나도 서버에서 계속 돌아요.'
          )}
        </div>
      </div>

      {/* 진행/결과 */}
      {busy && (
        <div className={cm.collecting}>
          <span className={ds.spin} /> “{topic}” 웹에서 수집·정리 중…
        </div>
      )}
      {result && (
        <details className={cm.resultCard} open={!result.ok}>
          <summary>{result.ok ? '✓ 수집 완료 — 출력 보기' : '⚠ 실패 — 출력'}</summary>
          <pre className={cm.pre}>{result.out || '(출력 없음)'}</pre>
        </details>
      )}

      {/* 최근 수집 기록 */}
      <div className={cm.recent}>
        <div className={cm.recentHead}>최근 수집 기록</div>
        {history.length ? (
          <div className={cm.recList}>
            {history.map((h) => (
              <div key={h.topic + h.at} className={cm.recItem}>
                <span className={cm.recDot} data-ok={h.ok ? '1' : '0'} aria-hidden="true" />
                <span className={cm.recTopic}>{h.topic}</span>
                <span className={cm.recMeta}>
                  {h.scope ? h.scope + ' · ' : ''}
                  {fmtWhen(h.at)}
                  {h.ok ? '' : ' · 실패'}
                </span>
                <a className={cm.recOpen} href={obsidianLink(h.topic)} title="옵시디언 _탐구 폴더에서 이 주제 열기">
                  옵시디언 ↗
                </a>
                <button
                  type="button"
                  className={cm.recAgain}
                  onClick={() => {
                    setTopic(h.topic);
                    setScope(h.scope || '');
                    collect(h.topic, h.scope || '');
                  }}
                  disabled={busy}
                >
                  다시
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className={cm.recEmpty}>아직 수집 기록이 없어요. 위에서 주제를 넣어 첫 탐구를 시작해 보세요.</div>
        )}
      </div>
    </section>
  );
}
