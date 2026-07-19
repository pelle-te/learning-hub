/* ============================================================
   MobileServerCard — LAN 읽기 전용 모바일 뷰 서버 토글(플랫폼 개편 5단계-A).

   왜 토글인가: 4단계-G 가 `serve.js` 를 지우며 **앱이 여는 포트를 0** 으로 만들었고 그걸
   성과로 기록했다(HTTP 공격면 소멸). 5단계는 "폰에서 본다"를 위해 그 결정을 되돌려야 하는데,
   **되돌리는 범위를 사용자가 정하게** 하는 것이 이 카드다 — 켜는 동안에만 포트가 열린다.
   기본값을 ON 으로 두면 4-G 가 없앤 공격면을 사용자 동의 없이 되살리는 것이 된다(설계 §5-0-5).

   ⚠ 주소에 **토큰이 박혀 있다**. 화면 공유·스크린샷으로 새어 나가면 같은 LAN 의 누구나
   읽을 수 있으므로 기본은 가린 채 두고 '보기'를 눌러야 드러난다. 서버를 껐다 켜면 토큰이
   새로 생성돼 옛 주소는 자동으로 무효가 된다.

   브라우저(dev·트랙 A)에선 포트 개념이 없으므로 **카드 자체를 렌더하지 않는다**(WorkspaceCard 와 같은 판단).
============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { isTauri, mobileServerStart, mobileServerStatus, mobileServerStop, type MobileServerInfo } from '@/lib/tauri';
import { Button } from '@/components/ui';
import { ui } from '@/shell';
import ds from '@/styles/ds.module.css';
import css from './MobileServerCard.module.css';

export default function MobileServerCard() {
  const [info, setInfo] = useState<MobileServerInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    let alive = true;
    void mobileServerStatus().then((s) => alive && setInfo(s));
    return () => {
      alive = false;
    };
  }, []);

  const toggle = useCallback(async () => {
    if (!info) return;
    setBusy(true);
    try {
      const next = info.running ? await mobileServerStop() : await mobileServerStart();
      setInfo(next);
      // 끌 때는 토큰이 무효가 되므로 드러난 주소도 함께 감춘다.
      if (!next.running) setReveal(false);
      ui.toast(
        next.running ? '모바일 뷰를 켰어요 — 같은 와이파이의 폰에서 주소로 접속하세요.' : '모바일 뷰를 껐어요.',
        'ok',
        5000,
      );
    } catch (e) {
      // 포트 점유 등 바인딩 실패를 Rust 가 사유로 담아 준다 — 그대로 보여주는 게 가장 친절하다.
      ui.toast(String((e as Error)?.message || e), 'bad', 8000);
    } finally {
      setBusy(false);
    }
  }, [info]);

  const copy = useCallback(async () => {
    if (!info?.url) return;
    try {
      await navigator.clipboard.writeText(info.url);
      ui.toast('주소를 복사했어요.', 'ok', 3000);
    } catch {
      ui.toast('복사에 실패했어요 — 주소를 직접 입력해 주세요.', 'bad', 5000);
    }
  }, [info]);

  if (!isTauri() || !info) return null;

  const { running, url, lan_ip: lanIp, port } = info;
  return (
    <div className={ds.card}>
      <h2>
        모바일에서 보기{' '}
        <span className={`${ds.muted} ${ds.tiny}`}>— 같은 와이파이의 폰에서 읽기 전용으로 접속합니다</span>
      </h2>
      <div className={ds.row}>
        <span className={`${ds.pill} ${running ? ds.good : ds.muted}`}>{running ? `켜짐 · 포트 ${port}` : '꺼짐'}</span>
        {running && !lanIp && <span className={`${ds.muted} ${ds.tiny}`}>LAN 주소를 찾지 못했어요</span>}
      </div>

      {running && url && (
        <>
          <div className={ds.row}>
            <span className={css.addr}>{reveal ? url : url.replace(/t=[0-9a-f]+/, 't=••••••••')}</span>
          </div>
          <div className={ds.row}>
            <Button sm variant="ghost" onClick={() => setReveal((v) => !v)}>
              {reveal ? '🙈 가리기' : '👁 보기'}
            </Button>
            <Button sm variant="ghost" onClick={() => void copy()}>
              📋 주소 복사
            </Button>
          </div>
          <div className={ds.foot}>
            주소에 접속 열쇠가 들어 있어요 — 화면 공유·스크린샷에 주의하세요. 껐다 켜면 열쇠가 새로 만들어져 이전 주소는
            못 씁니다.
          </div>
        </>
      )}

      {running && !lanIp && (
        <div className={ds.foot}>
          이 PC 의 네트워크 주소를 찾지 못해 <b>이 컴퓨터에서만</b> 열리는 주소예요(와이파이·랜선 연결 확인). 연결한 뒤
          껐다 켜면 폰에서 쓸 주소가 나옵니다.
        </div>
      )}

      {!running && (
        <div className={ds.foot}>
          꺼져 있는 동안 이 앱은 어떤 포트도 열지 않아요. 켜는 동안에만 같은 네트워크에서 접근할 수 있습니다.
        </div>
      )}

      <div className={ds.row}>
        <Button sm variant={running ? 'ghost' : 'primary'} onClick={() => void toggle()} disabled={busy}>
          {running ? '⏹ 끄기' : '▶ 켜기'}
        </Button>
      </div>
    </div>
  );
}
