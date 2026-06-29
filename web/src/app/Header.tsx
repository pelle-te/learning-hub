import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { actions, io, Icon } from '@/shell';
import { useApp } from '@/store/useApp';

/** 현재 테마 → 토글 버튼 아이콘(라이트=해, 다크=달, 세피아=책). 다음 전환 대상을 함께 안내. */
const THEME_ICON: Record<string, string> = { light: 'sun', dark: 'moon', sepia: 'book' };
const THEME_NEXT: Record<string, string> = { light: '다크', dark: '세피아', sepia: '라이트' };
const THEME_NAME: Record<string, string> = { light: '라이트', dark: '다크', sepia: '세피아' };

/* Header — .top 헤더. 데이터 액션은 네이티브 shell/actions를 호출(테마·내보내기·가져오기·되돌리기·초기화).
   ⋯ 메뉴는 바깥 클릭/Esc로 닫힘. ⌘K는 팔레트 열기(전역 단축키는 CommandPalette가 소유). */
export default function Header({ onOpenPalette }: { onOpenPalette: () => void }) {
  const navigate = useNavigate();
  const theme = useApp((s) => s.state.theme) || 'light';
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
      <span className="sub">오늘 할 일에 집중해요 — 계획·복습·일정은 자동으로</span>
      <span style={{ flex: 1 }} />
      <button className="sm ghost" onClick={onOpenPalette} title="명령 팔레트 (Ctrl/⌘+K)" aria-label="명령 팔레트 열기">
        ⌘K
      </button>
      <button className="sm ghost" onClick={() => navigate('/settings')} title="설정" aria-label="설정 열기">
        <Icon name="gear" />
      </button>
      <button
        className="sm ghost"
        onClick={() => actions.toggleTheme()}
        title={`테마: ${THEME_NAME[theme]} — 클릭하면 ${THEME_NEXT[theme]}로`}
        aria-label={`테마 전환 (현재 ${THEME_NAME[theme]})`}
      >
        <Icon name={THEME_ICON[theme]} />
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
                io.exportICS();
              }}
              title="일회성 스냅샷"
            >
              <Icon name="calendar" /> 캘린더(.ics) 내보내기
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                io.exportJSON();
              }}
            >
              <Icon name="download" /> 데이터 내보내기(백업)
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                impRef.current?.click();
              }}
            >
              <Icon name="upload" /> 데이터 가져오기
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
              <Icon name="undo" /> 되돌리기
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
              <Icon name="trash" /> 전체 초기화…
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
