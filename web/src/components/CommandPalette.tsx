import { useEffect, useMemo, useState } from 'react';
import { Command } from 'cmdk';
import { useNavigate } from 'react-router-dom';
import {
  paletteCommands,
  recordRecent,
  captureSubjects,
  runQuickCapture,
  semanticPalette,
  contentSearch,
  type ContentHit,
} from '@/shell';
import { parseCapture, type CaptureResult } from '@/lib/quickCapture';
import type { SemHit, SemKind } from '@/lib/semantic';
import styles from './CommandPalette.module.css';

const SEM_ICON: Record<SemKind, string> = { chapter: '📚', summary: '📝', book: '📖', backlog: '📥' };
const CONTENT_ICON: Record<ContentHit['kind'], string> = { subject: '📗', chapter: '📚', book: '📖' };

const TYPE_LABEL: Record<NonNullable<CaptureResult['sessionType']>, string> = {
  anki: 'Anki',
  new: '새 학습',
  rev: '복습',
  blank: '백지',
  mock: '모의',
};

/** 파싱 결과가 '캡처할 가치'가 있는지 — 제목만 남으면(날짜·시간·유형·과목 무) 일반 검색으로 둔다. */
function meaningful(c: CaptureResult | null): c is CaptureResult {
  return !!c && !!(c.dateISO || c.minute != null || c.sessionType || c.subject || c.chapter);
}

/** 파싱 결과를 한 줄 칩 요약으로(팔레트 힌트·확인 토스트 공용). */
function summarize(c: CaptureResult): string {
  const parts: string[] = [];
  if (c.dateLabel) parts.push(c.dateLabel + (c.dateISO ? ` (${c.dateISO.slice(5)})` : ''));
  if (c.timeLabel) parts.push(c.timeLabel);
  if (c.subject) parts.push(c.subject);
  if (c.chapter) parts.push(c.chapter);
  if (c.sessionType) parts.push(TYPE_LABEL[c.sessionType]);
  return parts.join(' · ');
}

/* CommandPalette — cmdk 기반 ⌘K 팔레트(손코딩 ui-command.js 대체, 설계도 §3).
   명령 목록은 네이티브 shell/palette(탭+액션)에서. 이동은 React Router, 액션은 shell/actions를 호출.
   open/onOpenChange는 부모(App)가 소유 — 전역 단축키도 거기서. */
export default function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  // 열릴 때만 계산(최근 명령 LRU가 외부에서 바뀌므로 재오픈 시 최신 순서 반영). 닫히면 빈 목록.
  const cmds = useMemo(() => (open ? paletteCommands() : []), [open]);
  // 과목 스냅샷(파서 입력) — 열릴 때만. store 접근은 shell(captureSubjects)에 위임(components→store 금지).
  const subjects = useMemo(() => (open ? captureSubjects() : []), [open]);

  // 닫힐 때 입력 초기화(이벤트 핸들러에서 — effect 내 setState 회피). 캡처 실행/Esc 모두 이 경로로.
  const close = () => {
    setSearch('');
    onOpenChange(false);
  };

  // 자연어 빠른 캡처 — 입력을 파싱해 날짜·시간·과목·유형을 뽑는다(예: "내일 오후 3시 알고리즘 2챕터 복습").
  // 순수 lib(quickCapture)라 여기선 결과만 미리보고, 선택 시 shell 액션으로 기록 프리필에 넘긴다.
  const cap = useMemo(
    () =>
      open && search.trim()
        ? parseCapture(
            search,
            new Date(),
            subjects.map((s) => s.name),
          )
        : null,
    [open, search, subjects],
  );
  const showCapture = meaningful(cap);

  // E-6: 오프라인 통합 검색 — 메모리 내 학습 항목·독서를 부분문자열로(Ollama 불필요, 항상 동작).
  const content = useMemo(() => (open && search.trim() ? contentSearch(search) : []), [open, search]);

  // 의미 검색(로컬 임베딩) — 350ms 디바운스, 늦은 응답은 버림. Ollama 불가면 조용히 빈 목록.
  // 짧은 질의는 렌더에서 걸러낸다(이펙트 내 동기 setState 회피 — 상태는 마지막 결과만 유지).
  const [semHits, setSemHits] = useState<SemHit[]>([]);
  useEffect(() => {
    if (!open) return;
    const q = search.trim();
    if (q.length < 2) return;
    let stale = false;
    const t = setTimeout(() => {
      semanticPalette(q)
        .then((hits) => {
          if (!stale) setSemHits(hits);
        })
        .catch(() => {});
    }, 350);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [open, search]);
  const shownSem = search.trim().length >= 2 ? semHits : [];

  const runCapture = () => {
    if (!cap) return;
    runQuickCapture(cap, summarize(cap));
    navigate('/journal', { viewTransition: true });
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(v) => (v ? onOpenChange(true) : close())}
      label="명령 팔레트"
      className={styles.dialog}
      overlayClassName={styles.overlay}
      contentClassName={styles.content}
    >
      <Command.Input
        value={search}
        onValueChange={setSearch}
        className={styles.input}
        placeholder="명령·탭 검색, 또는 빠른 캡처 (예: 내일 오후 3시 알고리즘 복습)"
        autoFocus
      />
      <Command.List className={styles.list}>
        <Command.Empty className={styles.empty}>일치하는 명령이 없어요</Command.Empty>
        {showCapture && cap && (
          <Command.Item
            key="quick-capture"
            forceMount
            value={'quick-capture ' + search}
            className={`${styles.item} ${styles.capture}`}
            onSelect={() => {
              try {
                runCapture();
              } catch (e) {
                console.error(e);
              }
              close();
            }}
          >
            <span className={styles.label}>📌 빠른 캡처 — 기록에 남기기</span>
            <span className={styles.hint}>{summarize(cap)}</span>
          </Command.Item>
        )}
        {/* E-6 오프라인 통합 검색 — 학습 항목·독서 부분문자열(forceMount: 자체 매칭이 기준). */}
        {content.length > 0 && (
          <Command.Group heading="빠른 검색 — 학습 항목·독서" className={styles.semGroup} forceMount>
            {content.map((h) => (
              <Command.Item
                key={h.id}
                forceMount
                value={'content ' + h.id + ' ' + search}
                className={styles.item}
                onSelect={() => {
                  close();
                  navigate(h.to, { viewTransition: true });
                }}
              >
                <span className={styles.label}>
                  {CONTENT_ICON[h.kind]} {h.label}
                </span>
                <span className={styles.hint}>{h.kind === 'book' ? '읽을거리' : '학습 항목'}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {/* 의미 검색 결과 — cmdk 부분문자열 필터를 우회(forceMount): 임베딩 유사도가 매칭 기준. */}
        {shownSem.length > 0 && (
          <Command.Group heading="의미 검색 — 내 학습 자산" className={styles.semGroup} forceMount>
            {shownSem.map((h) => (
              <Command.Item
                key={'sem:' + h.id}
                forceMount
                value={'semantic ' + h.id + ' ' + search}
                className={styles.item}
                onSelect={() => {
                  close();
                  navigate(h.to, { viewTransition: true });
                }}
              >
                <span className={styles.label}>
                  {SEM_ICON[h.kind]} {h.label}
                </span>
                <span className={styles.hint}>{Math.round(h.sim * 100)}% 유사</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {cmds.map((c) => (
          <Command.Item
            key={c.id}
            value={c.label + ' ' + c.hint}
            className={styles.item}
            onSelect={() => {
              close();
              recordRecent(c.id); // 최근 명령 LRU — 다음 ⌘K에서 위로.
              try {
                if (c.kind === 'tab') navigate('/' + c.key, { viewTransition: true });
                else {
                  c.run();
                  // 액션이 특정 탭에서 이어지는 경우(집중 시작·기록 프리필) 실행 후 이동.
                  if (c.to) navigate(c.to, { viewTransition: true });
                }
              } catch (e) {
                console.error(e);
              }
            }}
          >
            <span className={styles.label}>{c.label}</span>
            <span className={styles.hint}>{c.hint}</span>
          </Command.Item>
        ))}
      </Command.List>
      <div className={styles.foot}>
        <span>
          <b>↑↓</b> 이동 · <b>Enter</b> 실행 · <b>Esc</b> 닫기
        </span>
        <span className={styles.brand}>⌘K</span>
      </div>
    </Command.Dialog>
  );
}
