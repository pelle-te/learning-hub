/* ============================================================
   CloudCard — 클라우드 연결(C-5 온보딩).

   ## 왜 "등록 코드"인가

   비밀번호 로그인이 아니다. Workers 무료 플랜은 **요청당 CPU 10ms** 라 bcrypt·argon2 같은
   느린 KDF 를 못 쓴다(런북 §5-2). 그래서 PC 에서 1회용 코드를 발급받아 폰에 옮겨 치는 방식이
   됐고, 이 카드가 그 양쪽을 다 맡는다.

   ## ⚠ 여기 붙이는 값은 **개인 학습 기록 전부**로 가는 문이다

   설계서 §2-6 이 실측한 대로 이 앱의 데이터는 성적·일정·자유 서술의 조합이라
   _"학습 앱이니 별거 없다"는 판단은 틀렸다_. 그래서 화면이 하는 말이 정확해야 한다 —
   무엇이 올라가고(앱 데이터만) 무엇이 안 올라가는지(볼트·파이썬·AI·Anki) 명시한다.

   ⚠ 리프레시 토큰은 화면에 **절대 표시하지 않는다**. `MobileServerCard` 는 주소에 토큰이
   박혀 있어 '보기' 토글을 뒀지만, 저건 LAN 한정 읽기 전용이라 성격이 다르다. 이쪽은
   인터넷 너머 **쓰기 권한**이라 노출할 이유가 없다.

   브라우저(dev·트랙 A)에선 SQLite 가 없어 자격증명을 저장할 곳이 없다 → 카드를 렌더하지
   않는다(`WorkspaceCard`·`MobileServerCard` 와 같은 판단).
============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { isTauri } from '@/lib/tauri';
import { disconnectCloud, enrollDevice, readCloudConfig, type CloudConfig } from '@/lib/cloud/client';
import { syncOnce } from '@/lib/cloud/run';
import { useApp } from '@/store/useApp';
import { Button } from '@/components/ui';
import { ui } from '@/shell';
import ds from '@/styles/ds.module.css';

export default function CloudCard() {
  const [cfg, setCfg] = useState<CloudConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [url, setUrl] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void readCloudConfig().then((c) => {
      if (!alive) return;
      setCfg(c);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const connect = useCallback(async () => {
    if (!url.trim() || !code.trim()) return;
    setBusy(true);
    try {
      const next = await enrollDevice(url.trim(), code.trim(), 'PC');
      setCfg(next);
      setCode('');
      ui.toast('클라우드에 연결했어요 — 첫 동기화를 시작합니다.', 'ok', 5000);
      /* 연결 직후 한 번 돌린다. 5분 주기를 기다리게 하면 "연결했는데 아무 일도 안 난다"로
         보이고, 사용자는 실패로 읽는다. */
      const r = await syncOnce();
      if (r.state) useApp.getState().loadState(r.state);
      if (r.status === 'failed') ui.toast(`첫 동기화에 실패했어요 — ${r.error ?? ''}`, 'warn', 8000);
    } catch (e) {
      // 서버가 준 사유(코드 만료·틀린 주소)를 그대로 보여주는 게 가장 친절하다.
      ui.toast(String((e as Error)?.message || e), 'bad', 8000);
    } finally {
      setBusy(false);
    }
  }, [url, code]);

  const disconnect = useCallback(async () => {
    /* ⚠ 되돌리기 어려운 동작이라 확인을 받는다. 다만 **로컬 데이터는 지우지 않는다** —
       끊는 것은 이 기기의 자격증명뿐이고, 그 사실을 문구로 정확히 말한다. */
    if (!(await ui.confirm('이 기기의 클라우드 연결을 끊을까요? 로컬 데이터는 그대로 남습니다.'))) return;
    await disconnectCloud();
    setCfg(null);
    ui.toast('클라우드 연결을 끊었어요.', 'ok', 4000);
  }, []);

  const syncNow = useCallback(async () => {
    setBusy(true);
    try {
      const r = await syncOnce();
      if (r.state) useApp.getState().loadState(r.state);
      if (r.status === 'failed') ui.toast(`동기화 실패 — ${r.error ?? ''}`, 'bad', 8000);
      else ui.toast(r.pulled ? `${r.pulled}건을 받아왔어요.` : '최신 상태예요.', 'ok', 4000);
    } finally {
      setBusy(false);
    }
  }, []);

  if (!isTauri() || !loaded) return null;

  return (
    <div className={ds.card}>
      <h2>
        클라우드 동기화 <span className={`${ds.muted} ${ds.tiny}`}>— 여러 기기에서 같은 계획을 보고 편집합니다</span>
      </h2>

      <div className={ds.row}>
        <span className={`${ds.pill} ${cfg ? ds.good : ds.muted}`}>{cfg ? '연결됨' : '연결 안 됨'}</span>
        {cfg && <span className={`${ds.muted} ${ds.tiny}`}>{cfg.baseUrl}</span>}
      </div>

      {cfg ? (
        <>
          <div className={ds.foot}>
            계획·할일·완료·일정과 내 요약·독후감이 올라갑니다. <b>볼트 노트·파이썬 도구·AI·Anki 는 이 PC 에만</b>{' '}
            남아요(인터넷 없이도 그대로 동작합니다).
          </div>
          <div className={ds.row}>
            <Button sm variant="ghost" onClick={() => void syncNow()} disabled={busy}>
              🔄 지금 동기화
            </Button>
            <Button sm variant="ghost" onClick={() => void disconnect()} disabled={busy}>
              ⛔ 연결 끊기
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className={ds.foot}>
            서버 주소와 <b>등록 코드</b>를 넣으면 이 기기가 연결됩니다. 코드는 1회용이고 10분 뒤 만료돼요.
          </div>
          <div className={ds.row}>
            <input
              type="url"
              placeholder="https://…workers.dev"
              aria-label="클라우드 서버 주소"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div className={ds.row}>
            <input
              type="text"
              placeholder="등록 코드"
              aria-label="등록 코드"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <Button sm variant="primary" onClick={() => void connect()} disabled={busy || !url.trim() || !code.trim()}>
              연결
            </Button>
          </div>
          <div className={ds.foot}>⚠ 성적·일정·메모가 인터넷을 건너갑니다. 신뢰하는 서버 주소인지 확인하세요.</div>
        </>
      )}
    </div>
  );
}
