import { useEffect, useRef, useState } from 'react';
import { actions, io, Icon } from '@/shell';
import { useApp } from '@/store/useApp';
import { usePageChrome } from '@/store/usePageChrome';
import FocusChip from './FocusChip';
import s from './TopBar.module.css';

/* TopBar — 에디토리얼 헤더(설계도 §1-2). 현 Header(.top) 대체.
   워드마크 + 컨텍스트 서브 + 우측 액션 칩(⌘K·테마·⋯ 데이터 메뉴). 설정 진입은 레일 하단 ⚙가 담당.
   데이터 액션은 네이티브 shell/actions 호출(테마·내보내기·가져오기·되돌리기·초기화).
   ⋯ 메뉴는 바깥 클릭/Esc로 닫힘. ⌘K는 팔레트 열기(전역 단축키는 CommandPalette가 소유). */
const THEME_ICON: Record<string, string> = { light: 'sun', dark: 'moon' };
const THEME_NEXT: Record<string, string> = { light: '다크', dark: '라이트' };
const THEME_NAME: Record<string, string> = { light: '라이트', dark: '다크' };

export default function TopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const theme = useApp((s) => s.state.theme) || 'dark';
  const readouts = usePageChrome((s) => s.readouts);
  const action = usePageChrome((s) => s.action);
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
    <header className={s.bar}>
      <h1 className={s.wordmark}>
        <span>러닝</span>
        <span className={s.accent}>허브</span>
      </h1>
      <span className={s.sub}>오늘 할 일에 집중해요 — 계획·복습·일정은 자동으로</span>
      <span className={s.grow} />
      {/* 전역 집중 세션 칩 — 어느 탭에서든 진행 중 세션이 보인다(클릭 → 오늘). */}
      <FocusChip />
      {readouts.length > 0 && (
        <div className={s.readouts}>
          {readouts.map((r, i) => (
            <div key={i} className={`${s.readout}${r.accent ? ' ' + s.racc : ''}`}>
              <span className={s.rl}>{r.label}</span>
              <span className={s.rv}>{r.value}</span>
            </div>
          ))}
        </div>
      )}
      <div className={s.actions}>
        {action && (
          <button className={`${s.btn} ${s.fill}`} onClick={action.onClick}>
            {action.label}
          </button>
        )}
        <button className={s.btn} onClick={onOpenPalette} title="명령 팔레트 (Ctrl/⌘+K)" aria-label="명령 팔레트 열기">
          ⌘K
        </button>
        <button
          className={`${s.btn} ${s.icon}`}
          onClick={() => actions.toggleTheme()}
          title={`테마: ${THEME_NAME[theme]} — 클릭하면 ${THEME_NEXT[theme]}로`}
          aria-label={`테마 전환 (현재 ${THEME_NAME[theme]})`}
        >
          <Icon name={THEME_ICON[theme]} />
        </button>
        <div className={s.menuwrap} ref={wrapRef}>
          <button
            className={`${s.btn} ${s.icon}`}
            aria-haspopup="true"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((v) => !v)}
            title="데이터·백업 메뉴"
            aria-label="데이터·백업 메뉴"
          >
            ⋯
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
    </header>
  );
}
