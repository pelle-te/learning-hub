/* ============================================================
   ReaderVocab — 지문 리더 + 어휘 팝오버(자기완결 상호작용).

   ArticlePractice(727줄·복잡도 50)에서 **책임 이전**으로 떼어냈다(FlowRail 과 같은 사상). 텍스트
   선택 감지·팝오버 위치 계산·Esc/바깥클릭 닫기·포커스 이동·비동기 뜻 조회(레이스 가드)를 **이
   컴포넌트가 소유**한다. 부모는 데이터/능력만 넘긴다 — `vocab` 상태 8필드는 부모 지역변수를 하나도
   참조하지 않으므로, 인터페이스는 **3 props**(lang·text·online)로 끝난다(prop-drilling 아님).
============================================================ */
import { useEffect, useRef, useState } from 'react';
import { lookupVocab, type VocabResult } from '@/lib/api';

interface VocabState {
  x: number;
  y: number;
  flip: boolean; // 뷰포트 하단 근처면 단어 위로 뒤집어 띄운다(리더 바닥에서 잘림 방지).
  word: string;
  loading: boolean;
  result: VocabResult | null;
  error: string | null;
}

export function ReaderVocab({ lang, text, online }: { lang: 'ko' | 'en'; text: string; online: boolean }) {
  // Ollama 어휘(선택한 단어 뜻) — 리더 위 팝오버.
  const [vocab, setVocab] = useState<VocabState | null>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const vocabPopRef = useRef<HTMLDivElement>(null);

  const onReaderSelect = (): void => {
    const s = window.getSelection();
    const sText = s?.toString().trim() ?? '';
    const host = readerRef.current;
    if (!s || !sText || sText.length > 60 || sText.includes('\n') || !host || s.rangeCount === 0) {
      return;
    }
    const rect = s.getRangeAt(0).getBoundingClientRect();
    const box = host.getBoundingClientRect();
    if (!rect.width) return;
    // 팝오버는 translateX(-50%)라 문단 좌우 끝 단어에서 리더 밖으로 잘렸다 — x를 클램프.
    const rawX = rect.left - box.left + rect.width / 2;
    const x = Math.max(100, Math.min(rawX, Math.max(100, box.width - 100)));
    // 뷰포트 하단 근처(아래 공간 부족)면 위로 뒤집어 단어 위에 띄운다 — 리더 바닥에서 잘리던 문제.
    const flip = rect.bottom + 220 > window.innerHeight;
    setVocab({
      x,
      y: flip ? rect.top - box.top - 6 : rect.bottom - box.top + 6,
      flip,
      word: sText,
      loading: false,
      result: null,
      error: null,
    });
  };

  /* ⚠⚠ **키보드 진입점(H12 · 2026-07-26 감사).**

     이 기능은 Esc·포커스 복원·`role=dialog`·레이스 가드까지 다 갖췄는데 **여는 문이 마우스
     전용**(`onPointerUp`)이라 전체가 키보드로 도달 불가였다(WCAG 2.1.1 A). 잘 만든 방과
     잠긴 문의 조합이라 리뷰에서 눈에 안 띈다 — 안쪽만 보면 완성돼 있기 때문이다.

     `selectionchange` 로 "리더 안에 유효한 선택이 있는가"를 추적해 **명시 버튼**을 켠다.
     보조기술·캐럿 브라우징(F7)·터치 선택 전부 이 한 경로로 들어온다. 버튼을 항상 켜 두고
     빈 선택에 무반응으로 두지 않는 이유: 그건 "눌렀는데 아무 일도 안 일어남"이라 고장과
     구분되지 않는다. */
  const [canLookup, setCanLookup] = useState(false);
  useEffect(() => {
    const onSel = (): void => {
      const s = window.getSelection();
      const t = s?.toString().trim() ?? '';
      const host = readerRef.current;
      const inside = !!(s && s.rangeCount > 0 && host && host.contains(s.anchorNode));
      setCanLookup(!!t && t.length <= 60 && !t.includes('\n') && inside);
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  // 팝오버 닫기 — Esc + 바깥 클릭(기존엔 ✕ 또는 지문 전환뿐이었다).
  useEffect(() => {
    if (!vocab) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setVocab(null);
    };
    const onDown = (e: PointerEvent): void => {
      if (vocabPopRef.current && !vocabPopRef.current.contains(e.target as Node)) setVocab(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [vocab]);

  // 팝오버가 새로 열리면(단어 선택) role=dialog로 포커스 이동 — 기존엔 포커스를 받지 못했다(a11y).
  // word가 바뀔 때만 발화 → loading·result 갱신 시 포커스를 훔치지 않는다. preventScroll로 리더 점프 방지.
  useEffect(() => {
    if (!vocab?.word) return;
    const prev = document.activeElement as HTMLElement | null;
    vocabPopRef.current?.focus({ preventScroll: true });
    return () => {
      /* 닫히면(Esc·바깥클릭·전환) 포커스가 팝오버 제거로 body 에 유실된다 — 직전 포커스를 복원해
         키보드 사용자가 리더 맥락을 잃지 않게 한다(a11y). 단어만 바뀐 경우엔 포커스가 팝오버에 남아
         body 가 아니므로 복원하지 않는다(다음 발화가 새 팝오버로 옮긴다). */
      if (prev && prev !== document.body && document.activeElement === document.body) {
        prev.focus({ preventScroll: true });
      }
    };
  }, [vocab?.word]);

  const doVocab = async (): Promise<void> => {
    if (!vocab) return;
    const reqWord = vocab.word; // 응답 도착 시 다른 단어가 선택돼 있으면 버린다(레이스 가드)
    setVocab({ ...vocab, loading: true, error: null });
    try {
      // ⚠ lookupVocab(api.ts)은 아직 signal을 받지 않아 fetch 자체는 취소하지 못한다(진짜 abort는
      //   api.ts에 signal 배선 필요) — 여기선 UI가 무한 스피너에 갇히지 않도록 15s 타임아웃만 건다.
      const res = await Promise.race([
        lookupVocab(reqWord, text.slice(0, 600), lang),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('시간 초과')), 15000)),
      ]);
      setVocab((v) =>
        v && v.word === reqWord
          ? { ...v, loading: false, result: res.vocab ?? null, error: res.ok ? null : (res.error ?? '실패') }
          : v,
      );
    } catch (e) {
      setVocab((v) =>
        v && v.word === reqWord ? { ...v, loading: false, error: (e as Error).message || '조회 실패' } : v,
      );
    }
  };

  return (
    <div
      className="relative text-lg leading-[1.75] text-txt"
      ref={readerRef}
      onPointerUp={onReaderSelect}
      /* ⚠ 여기에 `onKeyUp` 을 달지 않는다 — 정적 요소를 상호작용 요소로 만들면(jsx-a11y
         `no-static-element-interactions`) 롤·탭 순서까지 흉내내야 하고, 무엇보다 **불필요하다**:
         위 `selectionchange` 는 입력 수단을 가리지 않아 캐럿 브라우징(F7)·Shift+화살표·보조기술
         선택에서 모두 발화한다. 진입점은 아래 버튼 하나로 충분하다. */
    >
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          className="border-line! bg-transparent! px-2! py-1! text-sm! text-mut! enabled:hover:text-txt!"
          onClick={onReaderSelect}
          disabled={!canLookup}
        >
          {/* ⚠ 문구가 팝오버 안의 '뜻 보기'(AI 조회)와 겹치지 않아야 한다 — 둘은 다른 일이다.
              이건 **팝오버를 여는** 버튼이고, 저건 열린 팝오버에서 조회를 시작하는 버튼이다. */}
          선택한 단어 찾기
        </button>
      </div>
      {text.split(/\n\n+/).map((p, i) => (
        <p key={i} className="mt-0 mb-3.5 leading-[1.75]">
          {p}
        </p>
      ))}
      {vocab && (
        <div
          className="absolute z-[var(--z-dropdown)] -translate-x-1/2 rounded-base border border-line bg-panel px-3 py-2.5 text-md leading-[1.5] shadow-pop outline-none data-[flip=true]:-translate-y-full"
          style={{ left: vocab.x, top: vocab.y }}
          role="dialog"
          aria-label="어휘 뜻"
          lang="ko"
          tabIndex={-1}
          data-flip={vocab.flip}
          ref={vocabPopRef}
        >
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <b className="text-base14 text-acc">{vocab.word}</b>
            <button
              className="border-none! bg-transparent! p-0.5! text-sm! leading-[normal]! text-mut!"
              type="button"
              onClick={() => setVocab(null)}
              aria-label="닫기"
            >
              ✕
            </button>
          </div>
          {lang === 'ko' ? (
            // 한국어 단어는 로컬 8B가 뜻을 부정확하게 내므로 국어사전 링크로(정확·즉시).
            <a
              className="block rounded-sm bg-acc-soft p-2 text-center text-md font-extrabold hover:brightness-105"
              href={`https://ko.dict.naver.com/#/search?query=${encodeURIComponent(vocab.word)}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              📖 국어사전에서 보기 ↗
            </a>
          ) : vocab.loading ? (
            <div className="text-txt" role="status">
              <span className="ds-spin" /> 뜻 찾는 중…
            </div>
          ) : vocab.error ? (
            <div className="text-txt" role="alert">
              {vocab.error}
            </div>
          ) : vocab.result ? (
            <div className="text-txt" role="status">
              {vocab.result.pos && (
                <span className="mb-1 inline-block rounded-sm border border-line px-1.25 text-2xs font-extrabold text-mut">
                  {vocab.result.pos}
                </span>
              )}
              <div className="font-semibold">{vocab.result.meaning}</div>
              {vocab.result.synonyms?.length ? (
                <div className="mt-1 text-sm leading-[1.5] text-mut">유의어: {vocab.result.synonyms.join(', ')}</div>
              ) : null}
              {vocab.result.example && (
                <div className="mt-1.5 border-t border-line2 pt-1.5 text-sm leading-[1.5] text-txt italic">
                  “{vocab.result.example}”
                  {vocab.result.example_ko ? (
                    <div className="mt-0.5 text-mut not-italic">{vocab.result.example_ko}</div>
                  ) : null}
                </div>
              )}
              <a
                className="mt-1.5 inline-block text-xs leading-[1.5] font-bold text-mut! hover:text-acc!"
                href={`https://en.dict.naver.com/#/search?query=${encodeURIComponent(vocab.word)}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                영어사전 ↗
              </a>
            </div>
          ) : (
            <button
              className="w-full border-none! bg-acc-soft! p-1.75! text-md! font-extrabold! text-acc! hover:brightness-105 disabled:opacity-60!"
              type="button"
              onClick={doVocab}
              disabled={!online}
            >
              {online ? '🔍 뜻 보기' : '워크스페이스 미설정'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
