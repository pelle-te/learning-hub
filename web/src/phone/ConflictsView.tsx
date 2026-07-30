/* ============================================================
   phone/ConflictsView — **폰에서도 진 편집을 보고 되살린다**(H20 · 2026-07-30 `/감사 근본`).

   ## 무엇이 결함이었나

   충돌 그림자는 폰에서도 **정상적으로 적재된다** — `runSync` 가 `useConflicts.add()` 를 부르는
   경로는 기기와 무관하기 때문이다. 그런데 그걸 **읽는 화면이 데스크톱에만** 있었다
   (`features/settings/ConflictsNotice`). 즉 폰에서 편집이 덮이면 그 사실이 폰 안에서는
   영원히 관측 불가였고, 사용자는 PC 를 열어야만 알 수 있었다.

   그건 이 기능의 전제를 뒤집는다: 충돌은 **여러 기기를 쓰기 때문에** 생기는데, 그중 한 기기가
   그 사실을 못 본다면 "조용한 손실을 UI 로 메운다"는 §150 의 보완이 절반만 성립한다.
   그리고 하필 폰이 더 자주 지는 쪽이다(짧게 켜고 끄므로 마지막 저장이 PC 일 확률이 높다).

   ## 화면은 따로, 규칙은 lib

   라벨·미리보기·시각 표기·확인 문구는 `lib/conflictView` 가 소유하고 여기서는 배치만 한다
   (설계서 §13-0). 되살리기 자체는 `store/syncController.restoreConflict` — 검증된 병합 기계를
   합성 배치로 재사용하는 그 경로가 테이블 무관 안전성의 근거다.

   ## ⚠ 확인이 2단계 인라인인 이유

   폰에는 `ModalHost` 가 없다(`shell/modal` 은 데스크톱 셸의 것이다). 그렇다고 파괴적 동작을
   한 번의 탭에 두면 안 된다 — 되살리기는 **지금 값을 덮고 다른 기기에도 전파**한다. 그래서
   버튼이 스스로 두 단계가 된다(누르면 "정말 되살릴까요?"로 바뀌고, 다른 곳을 건드리면 원복).
   모달 호스트를 폰에 새로 들이는 것보다 표면이 적고, 확인의 성질은 그대로다.
============================================================ */
import { useState } from 'react';
import { RESTORE_CONFIRM, previewOf, tableLabel, whenLabel } from '@/lib/conflictView';
import { restoreConflict } from '@/store/syncController';
import { shadowId, useConflicts } from '@/store/useConflicts';
import type { ConflictShadow } from '@/lib/cloud/conflicts';

const BTN = 'min-h-11 rounded-md px-3 text-xs font-semibold';

function Row({ c }: { c: ConflictShadow }): React.JSX.Element {
  const dismiss = useConflicts((s) => s.dismiss);
  const [arm, setArm] = useState(false);
  const [busy, setBusy] = useState(false);

  const restore = async (): Promise<void> => {
    setBusy(true);
    try {
      await restoreConflict(c);
    } finally {
      setBusy(false);
      setArm(false);
    }
  };

  return (
    <li className="flex flex-col gap-1 border-l-2 border-l-warn bg-panel2 py-2 pr-2 pl-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-txt">{tableLabel(c.tbl)}</span>
        <span className="text-2xs text-mut tabular-nums">{whenLabel(c.detectedAt)}</span>
      </div>
      <div className="text-2xs text-mut">
        내 값 <code className="font-mono text-2xs text-txt">{previewOf(c.localData, 60)}</code>
      </div>
      <div className="text-2xs text-mut">
        덮은 값 <code className="font-mono text-2xs">{previewOf(c.remoteData, 60)}</code>
      </div>
      {/* 2단계: 첫 탭은 **약속을 보여 주고**, 두 번째 탭이 실행한다(위 머리주석). */}
      {arm ? <p className="text-2xs text-warn">{RESTORE_CONFIRM}</p> : null}
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => (arm ? void restore() : setArm(true))}
          className={`${BTN} bg-tint-warn text-warn enabled:hover:brightness-110`}
        >
          {arm ? '정말 되살리기' : '되살리기'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => (arm ? setArm(false) : dismiss(shadowId(c)))}
          className={`${BTN} text-mut enabled:hover:text-txt`}
        >
          {arm ? '취소' : '확인'}
        </button>
      </div>
    </li>
  );
}

export default function ConflictsView(): React.JSX.Element | null {
  const shadows = useConflicts((s) => s.shadows);
  const dismissAll = useConflicts((s) => s.dismissAll);
  if (!shadows.length) return null;

  return (
    <section aria-label="동기화 충돌" className="border-b border-line px-3 pb-3">
      <h2 className="pt-2 text-xs font-bold text-warn">
        동기화 충돌 {shadows.length}건 — 다른 기기 편집에 덮인 내 편집
      </h2>
      <p className="mt-0.5 text-2xs text-mut">
        같은 항목을 두 기기에서 고쳐 늦게 저장된 쪽이 이겼어요. 아래는 <b>덮이기 전 이 기기의 값</b>입니다.
      </p>
      <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
        {shadows.map((c) => (
          <Row key={shadowId(c)} c={c} />
        ))}
      </ul>
      <button type="button" onClick={dismissAll} className={`${BTN} mt-2 text-mut enabled:hover:text-txt`}>
        전부 확인
      </button>
    </section>
  );
}
