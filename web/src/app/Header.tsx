import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { actions } from '@/shell';

/* Header — .top 헤더. 데이터 액션은 네이티브 shell/actions를 호출(테마·내보내기·가져오기·되돌리기·초기화).
   ⋯ 메뉴는 바깥 클릭/Esc로 닫힘. ⌘K는 팔레트 열기(전역 단축키는 CommandPalette가 소유). */
export default function Header({ onOpenPalette }: { onOpenPalette: () => void }) {
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const impRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [moreOpen]);

  const close = () => setMoreOpen(false);

  return (
    <div className="top">
      <h1>📚 러닝 허브</h1>
      <span className="sub">졸업까지 한눈에 · 볼트/Anki 현황을 스케줄로 · 일과 빈 시간 자동 계산</span>
      <span style={{ flex: 1 }} />
      <button className="sm ghost" onClick={onOpenPalette} title="명령 팔레트 (Ctrl/⌘+K)" aria-label="명령 팔레트 열기">
        ⌘K
      </button>
      <button className="sm ghost" onClick={() => navigate('/settings')} title="설정" aria-label="설정 열기">
        ⚙
      </button>
      <button
        className="sm ghost"
        onClick={() => actions.toggleTheme()}
        title="테마 전환(다크 → 라이트 → 세피아)"
        aria-label="테마 전환"
      >
        🌗
      </button>
      <div className="menuwrap" ref={wrapRef}>
        <button
          className="sm ghost"
          aria-haspopup="true"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
          title="데이터·백업 메뉴"
        >
          ⋯ 메뉴
        </button>
        {moreOpen && (
          <div className="menu" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                actions.exportICS();
              }}
              title="일회성 스냅샷"
            >
              📅 캘린더(.ics) 내보내기
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                actions.exportJSON();
              }}
            >
              💾 데이터 내보내기(백업)
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                impRef.current?.click();
              }}
            >
              📂 데이터 가져오기
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                actions.undoLast();
              }}
              title="초기화/가져오기 직전으로 되돌리기"
            >
              ↩ 되돌리기
            </button>
            <div className="menu-sep" role="separator" />
            <button
              type="button"
              role="menuitem"
              className="menu-danger"
              onClick={() => {
                close();
                actions.resetAll();
              }}
            >
              🗑 전체 초기화…
            </button>
          </div>
        )}
      </div>
      {/* importJSON(input)이 id="imp"의 .files를 읽는다 — 팔레트의 '가져오기'도 이 입력을 클릭. */}
      <input
        type="file"
        id="imp"
        ref={impRef}
        accept="application/json"
        style={{ display: 'none' }}
        onChange={(e) => actions.importJSON(e.currentTarget)}
      />
    </div>
  );
}
