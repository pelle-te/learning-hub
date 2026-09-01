/* ============================================================
   ToolsCard — **누를 자리가 없던 파이썬 도구 넷에 표면을 준다**(V079 · 2026-09-01 규약 축).

   ## 왜 생겼나

   `src-tauri/src/tools.rs` 의 `TOOLS` 는 다섯인데 프런트 호출부가 있는 것은
   **`ledger-build` 하나**(`Ledger.tsx` 의 「원장 재빌드」)였다. 나머지 넷
   (`vault-health`·`vault-stats`·`index-build`·`eval`)은 **누를 자리가 없었다** —
   `capabilities.tools` 를 읽는 두 소비처는 개수만 세고 이름을 쓰지 않는다.

   ⚠⚠ **이 저장소가 이번 달에 두 번 청구한 형태의 짝이다.** `U087`·`U091` 은 *생산자가 사라진
   표면*을 지웠다. 여기는 **정반대**다 — 생산자(부모의 `벌트DB.py`·`지시문평가.py`)는 전부
   살아 있고 커맨드도 살아 있는데 **소비처만 없었다.** 그래서 처방이 「지운다」가 아니라
   「누를 자리를 만든다」이고, 그 판정은 사용자가 했다(`/실행` 이 정할 일이 아니었다).

   ## 왜 여기인가

   ① 이 넷은 전부 **워크스페이스를 만지는 유지보수 작업**이고, 워크스페이스 경로를 정하는
   `WorkspaceCard` 가 바로 위에 있다 — 실패했을 때 사람이 다음으로 볼 곳이 곁에 있다.
   ② 매일 쓰는 것이 아니라 **가끔 손보는 것**이라 목적지 화면에 얹으면 그 화면의 단일 목적을
   흐린다(탭재설계 사상).
   ③ `Ledger.tsx` 의 「원장 재빌드」는 **그 화면이 그리는 데이터를 다시 만드는 것**이라 거기
   있는 것이 맞다 — 그래서 여기서 중복으로 싣지 않는다.

   ⚠ 브라우저(dev·트랙 A)엔 백엔드가 없으므로 **카드 자체를 렌더하지 않는다**(`WorkspaceCard`
   와 같은 규율). 그래서 시각 베이스라인이 안 움직인다.
============================================================ */
import { useState } from 'react';
import { runTool } from '@/lib/api';
import { isTauri } from '@/lib/tauri';
import { needsWorkspace, toolFailureCopy } from '@/lib/artifactState';
import { Button } from '@/components/ui';
import { toast } from '@/shell';

/** 이 카드가 태우는 도구 — `tools.rs` 의 `TOOLS` 중 **다른 화면이 안 쓰는 것들**.
 *  ⚠ 개수를 주석에 적지 마라(이 저장소가 반복해 물린 형태다) — 정본은 `tools.rs` 의 `TOOLS` 이고,
 *  「누를 자리 없는 도구가 다시 생겼는가」는 `test/contractRosters.test.ts` 가 잰다. */
const 도구들 = [
  { key: 'vault-health', label: '볼트 건강검진', 설명: '노트 상태·누락을 훑어 이상만 보고합니다.' },
  { key: 'vault-stats', label: '볼트 통계', 설명: '과목·챕터별 노트 수와 진행을 셉니다.' },
  { key: 'index-build', label: '인덱스 재빌드', 설명: '볼트 정본 인덱스를 다시 만듭니다(연동 현황의 원천).' },
  { key: 'eval', label: '지시문 평가', 설명: '파이프라인 지시문을 채점합니다.' },
] as const;

/* ⚠⚠ **컴포넌트 밖이다 — `try/finally` 가 React Compiler 를 바일아웃시킨다**(2026-09-01 실측:
   _"Todo: (BuildHIR::lowerStatement) Handle TryStatement with a finalizer"_). 컴파일러는
   **컴포넌트·훅만** 컴파일하므로 모듈 수준 함수로 내리면 그 파일의 바일아웃이 0 이 된다.
   ⛔ 기준선을 올려서 넘기지 않았다 — `compiler-ratchet.mjs` 가 «고칠 수 없으면 이유를 적고
   올려라» 라고 말하지만, 여기서는 **고칠 수 있었다**(구조가 바뀌지 않고 동작도 같다).
   ⚠ `finally` 는 그대로 필요하다: 실패해도 busy 를 반드시 풀어야 버튼이 영영 잠기지 않는다. */
async function 실행(key: string, label: string, setBusy: (v: string | null) => void): Promise<void> {
  setBusy(key);
  try {
    const r = await runTool(key);
    /* ⚠ 성공/실패 문구가 `Ledger.tsx` 의 「원장 재빌드」와 **같은 관용구**다 — 도구 실패는
       대개 워크스페이스 미설정이고, 그 사유를 버리면 사람이 자기 설정을 의심하는 루프에
       갇힌다(H23 이 그렇게 물렸다). 원문 앞부분을 함께 싣는다. */
    if (r.ok) toast(`${label} 을(를) 끝냈어요.`, 'ok');
    else toast((r.out || '').slice(0, 140) || `${needsWorkspace(`${label} 에 실패했어요`)}.`, 'bad');
  } catch (e) {
    toast(`${toolFailureCopy(e, `${label} 에 실패했어요`)}.`, 'bad');
  } finally {
    setBusy(null);
  }
}

export default function ToolsCard() {
  const [busy, setBusy] = useState<string | null>(null);

  if (!isTauri()) return null;

  return (
    <div className="ds-rule">
      <h2>
        볼트 유지보수 <span className="ds-tiny text-mut">— 워크스페이스의 파이썬 도구를 직접 돌립니다</span>
      </h2>
      <ul className="flex flex-col gap-2">
        {도구들.map((t) => (
          <li key={t.key} className="flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block">{t.label}</span>
              <span className="ds-tiny block text-mut">{t.설명}</span>
            </span>
            <Button
              onClick={() => void 실행(t.key, t.label, setBusy)}
              disabled={busy !== null}
              aria-label={`${t.label} 실행`}
              aria-busy={busy === t.key}
            >
              {busy === t.key ? '실행 중…' : '실행'}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
