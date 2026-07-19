/* ============================================================
   WorkspaceCard — 워크스페이스 폴더 설정(플랫폼 개편 1단계).

   왜 이게 생겼나: 옛 `serve.js` 는 워크스페이스를 **실행 위치에서 추론**했다(`path.dirname(__dirname)`).
   그 추론은 설치 경로에 놓이는 배포본에서 깨진다 → 경로를 설정값으로 승격한 것이 이 카드다.
   Tauri 셸은 앱을 설치 경로에 놓으므로 그 추론이 깨진다 → 경로를 설정값으로 승격한다.
   파이썬 도구 11종과 아티팩트 6종 경로가 전부 이 값 기준이라, 틀리면 도구들이 **조용히 빈 결과**를
   낸다(진단이 가장 어려운 실패) — 그래서 Rust 쪽이 knowledge/·pipeline/ 표지를 검사해 거부한다.

   브라우저(dev·트랙 A)에선 경로 개념이 없으므로 **카드 자체를 렌더하지 않는다**.
============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { isTauri, pickWorkspace, workspaceStatus, type WorkspaceStatus } from '@/lib/tauri';
import { Button } from '@/components/ui';
import { ui } from '@/shell';
import ds from '@/styles/ds.module.css';

export default function WorkspaceCard() {
  const [status, setStatus] = useState<WorkspaceStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void workspaceStatus().then((s) => alive && setStatus(s));
    return () => {
      alive = false;
    };
  }, []);

  const pick = useCallback(async () => {
    setBusy(true);
    try {
      const next = await pickWorkspace();
      if (next) {
        setStatus(next);
        ui.toast('워크스페이스 폴더를 저장했어요 — 다음 실행부터 적용됩니다.', 'ok', 6000);
      }
    } catch (e) {
      // Rust가 사유를 담아 거부한다(표지 폴더 없음 등) — 그대로 보여주는 게 가장 친절하다.
      ui.toast(String((e as Error)?.message || e), 'bad', 8000);
    } finally {
      setBusy(false);
    }
  }, []);

  if (!isTauri() || !status) return null;

  const bad = !status.valid;
  return (
    <div className={`${ds.card} ${ds.glow}`}>
      <h2>
        워크스페이스 폴더{' '}
        <span className={`${ds.muted} ${ds.tiny}`}>— 파이썬 도구·산출물이 이 폴더 기준으로 돕니다</span>
      </h2>
      <div className={`${ds.row}`}>
        <span className={`${ds.pill} ${bad ? ds.warn : ds.good}`}>
          {bad ? '확인 필요' : status.inferred ? '자동 추론됨' : '설정됨'}
        </span>
        <span className={`${ds.muted} ${ds.tiny}`}>{status.path || '경로 없음'}</span>
      </div>
      {bad && (
        <div className={ds.foot}>
          폴더를 찾을 수 없어요(이동·이름 변경·외장 드라이브 분리). 폴더를 다시 지정하면 도구가 복구됩니다.
        </div>
      )}
      {status.inferred && !bad && (
        <div className={ds.foot}>실행 위치에서 자동으로 찾은 경로예요. 맞다면 그대로 두고, 다르면 직접 지정하세요.</div>
      )}
      <div className={ds.row}>
        <Button sm variant={bad ? 'primary' : 'ghost'} onClick={() => void pick()} disabled={busy}>
          📁 폴더 지정
        </Button>
      </div>
    </div>
  );
}
