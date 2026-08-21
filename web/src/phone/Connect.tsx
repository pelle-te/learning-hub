/* ============================================================
   phone/Connect.tsx — 폰을 클라우드에 붙이는 화면(C-6).

   ⚠ **서버 주소를 손으로 받지 않는다.** 폰 앱은 Workers 의 정적 자산으로 **API 와 같은
   오리진에서** 서빙되므로(C-6b) `location.origin` 이 곧 서버다. 입력칸을 두면 사용자가
   틀릴 수 있는 축이 하나 늘 뿐이고, 더 나쁘게는 **오타난 주소로 등록 코드를 보내게 된다** —
   등록 코드는 짧은 수명의 비밀이라 남의 서버에 보내면 그대로 유출이다.

   등록 코드는 **관리자가 발급**한다(관리 비밀 `HUB_ADMIN_KEY` 로 보호되는 수동 curl · 런북 §5-2).
   앱 안엔 발급 버튼이 없다 — 그 비밀을 번들에 심지 않기 위해서다.
============================================================ */
import { useState } from 'react';
import LiveRegion from '@/components/LiveRegion';
import { enrollDevice } from '@/lib/cloud/client';

export default function Connect({ onDone }: { onDone: () => void }): React.JSX.Element {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await enrollDevice(location.origin, code.trim(), '폰');
      onDone();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-xl font-title text-txt">러닝허브</h1>
        <p className="mt-2 text-sm text-mut">발급받은 1회용 등록 코드를 입력하세요(서버 관리자가 발급).</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label htmlFor="code" className="text-xs text-mut">
          등록 코드
        </label>
        <input
          id="code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="one-time-code"
          inputMode="text"
          className="rounded-md border border-line bg-panel px-3 py-3 text-base text-txt"
          placeholder="예: A1B2-C3D4"
        />
        {/* ⚠ 리전은 **상시 마운트**한다(H19) — 조건부로 넣으면 리전과 텍스트가 동시에 삽입돼 AT 에 따라 공지가 씹힌다(`SyncLedger` 와 같은 관용구: 보이는 줄은 조건부, 알리는 일만 갈라낸다). */}
        <LiveRegion message={err ?? ''} assertive />
        {err ? <p className="text-xs text-bad">{err}</p> : null}
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="rounded-md bg-acc px-3 py-3 text-base font-medium text-on-acc disabled:opacity-40"
        >
          {busy ? '연결 중…' : '연결'}
        </button>
      </form>
    </main>
  );
}
