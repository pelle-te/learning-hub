/* ============================================================
   CloudCard — 클라우드 연결(C-5 온보딩).

   ## 왜 "등록 코드"인가

   비밀번호 로그인이 아니다. Workers 무료 플랜은 **요청당 CPU 10ms** 라 bcrypt·argon2 같은
   느린 KDF 를 못 쓴다(런북 §5-2). 그래서 1회용 등록 코드 방식이 됐다.

   ⚠ **이 카드는 코드를 발급하지 않는다 — 제출(claim)만 한다.** 발급은 관리 비밀(`HUB_ADMIN_KEY`)로
   보호되는 `POST /api/enroll/new` 이고, 그 비밀을 앱에 심으면 유출면이 되므로 **관리자의 수동 curl**
   이다(런북 §5-2 절차). 여기·폰 `Connect` 는 그 코드를 받아 이 기기를 붙이는 쪽이다.

   ## ⚠ 여기 붙이는 값은 **개인 학습 기록 전부**로 가는 문이다

   설계서 §2-6 이 실측한 대로 이 앱의 데이터는 성적·일정·자유 서술의 조합이라
   _"학습 앱이니 별거 없다"는 판단은 틀렸다_. 그래서 화면이 하는 말이 정확해야 한다 —
   무엇이 올라가고(앱 데이터만) 무엇이 안 올라가는지(볼트·파이썬·AI·Anki) 명시한다.

   ⚠ 리프레시 토큰은 화면에 **절대 표시하지 않는다**. 이건 인터넷 너머 **쓰기 권한**이라
   노출할 이유가 없다(옛 LAN 뷰 서버는 URL 에 PSK 를 실어 '보기' 토글이 있었지만, 그 서버는
   은퇴했다 — 클라우드전환-설계 §9-1).

   브라우저(dev·트랙 A)에선 SQLite 가 없어 자격증명을 저장할 곳이 없다 → 카드를 렌더하지
   않는다(`WorkspaceCard` 와 같은 판단).
============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { isTauri } from '@/lib/tauri';
import {
  disconnectCloud,
  enrollDevice,
  listDevices,
  readCloudConfig,
  revokeDevice,
  type CloudConfig,
  type CloudDevice,
} from '@/lib/cloud/client';
import { collectOutbox, batchSize } from '@/lib/cloud/outbox';
import { runSync, lastSync } from '@/store/syncController';
import { Button } from '@/components/ui';
import { ui } from '@/shell';
import { Icon } from '@/components/Icon';
import { agoLabel } from '@/lib/utils';

/* ⚠ 상대 시각 사본을 지웠다(H16 · 2026-08-01) — 여기 있던 `relTime` 은 사다리가 **시간에서
   끊겨** 있어서(어제·N일 전이 없다) 같은 `syncedAt` 을 레일은 "어제", 이 카드는 "36시간 전"이라
   말했다. 같은 사실을 두 문장으로 말하는 화면은 둘 중 하나가 틀렸다고 읽힌다.
   렌더 시점이 아니라 **상태 갱신 시점**의 스냅샷이다(아래 `statusAt`). */

export default function CloudCard() {
  const [cfg, setCfg] = useState<CloudConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [url, setUrl] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<{ self: string; devices: CloudDevice[] } | null>(null);
  /* 관측성(설계서 §14 발전 #4) — 조용한 `blocked`(한도 소진·폐기)나 밀린 아웃박스를 사용자가
     알아차릴 수단. `pending` 은 아직 안 올라간 건수, `syncedAt` 은 마지막 동기화 시각. */
  const [pending, setPending] = useState<number | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  /* ⚠ 라벨의 **기준 시각도 상태다**(H16). `agoLabel(syncedAt, Date.now())` 을 렌더에서 부르면
     `react-hooks/purity` 가 막는다 — 그리고 그 규칙이 옳다: 렌더마다 값이 달라지는 문장은
     리렌더 시점에 따라 "방금"과 "3분 전"을 오간다. 상태 갱신 시점에 함께 찍는다(원래도 그
     시점의 스냅샷이라는 뜻이었고, 옛 `relTime` 은 `Date.now()` 를 함수 안에 숨겨 이 규칙의
     눈을 피하고 있었을 뿐이다). */
  const [statusAt, setStatusAt] = useState<number>(0);

  const refreshStatus = useCallback(async () => {
    const b = await collectOutbox(); // ⚠ 스캔 1회(펜스 스탬프를 하나 소모하지만 단조라 무해)
    setPending(b ? batchSize(b) : null);
    setSyncedAt(lastSync()?.at ?? null);
    setStatusAt(Date.now());
  }, []);

  useEffect(() => {
    let alive = true;
    void readCloudConfig().then((c) => {
      if (!alive) return;
      setCfg(c);
      setLoaded(true);
      if (c) void refreshStatus();
    });
    return () => {
      alive = false;
    };
  }, [refreshStatus]);

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
      const r = await runSync(); // 병합 결과 메모리 반영은 runSync 가 한다(컨트롤러 계약).
      if (r.status === 'failed') ui.toast(`첫 동기화에 실패했어요 — ${r.error ?? ''}`, 'warn', 8000);
      void refreshStatus();
    } catch (e) {
      // 서버가 준 사유(코드 만료·틀린 주소)를 그대로 보여주는 게 가장 친절하다.
      ui.toast(String((e as Error)?.message || e), 'bad', 8000);
    } finally {
      setBusy(false);
    }
  }, [url, code, refreshStatus]);

  const disconnect = useCallback(async () => {
    /* ⚠ 되돌리기 어려운 동작이라 확인을 받는다. 다만 **로컬 데이터는 지우지 않는다** —
       끊는 것은 이 기기의 자격증명뿐이고, 그 사실을 문구로 정확히 말한다. */
    if (!(await ui.confirm('이 기기의 클라우드 연결을 끊을까요? 로컬 데이터는 그대로 남습니다.'))) return;
    const { serverRevoked } = await disconnectCloud();
    setCfg(null);
    setDevices(null);
    /* ⚠ 서버 폐기 실패를 **삼키지 않는다.** 로컬만 지워지고 서버엔 기기가 살아 있으면
       사용자는 "끊었다"고 믿는데 리프레시 토큰은 여전히 유효하다 — 정확히 반대로 알려 준다. */
    if (serverRevoked) ui.toast('클라우드 연결을 끊고 서버에서도 이 기기를 폐기했어요.', 'ok', 5000);
    else ui.toast('이 기기에서는 끊었지만 서버 폐기에 실패했어요 — 다른 기기에서 폐기하세요.', 'warn', 10000);
  }, []);

  /* ── 기기 관리 ──────────────────────────────────────────────
     ⚠ 이 목록이 **폰 분실 시 유일한 대응 수단**이다. C-4 는 `revoked_at` 을 만들어 놓고
     쓰는 경로를 안 만들어서, 폐기하려면 D1 에 손으로 SQL 을 쳐야 했다(2026-07-20 감사). */
  const loadDevices = useCallback(async () => {
    if (!cfg) return;
    setBusy(true);
    try {
      setDevices(await listDevices(cfg));
    } catch (e) {
      ui.toast(String((e as Error)?.message || e), 'bad', 6000);
    } finally {
      setBusy(false);
    }
  }, [cfg]);

  const revoke = useCallback(
    async (d: CloudDevice) => {
      if (!cfg) return;
      /* ⚠ 되돌릴 수 없다 — 재등록하려면 등록 코드를 새로 발급해야 한다. 그 사실을 확인 문구가
         말한다(되돌리기 어려운 동작은 확인을 받는다는 이 앱의 규약). */
      if (!(await ui.confirm(`'${d.name}' 을(를) 폐기할까요? 되돌릴 수 없고, 다시 쓰려면 등록 코드가 필요합니다.`)))
        return;
      setBusy(true);
      try {
        await revokeDevice(cfg, d.id);
        ui.toast(`'${d.name}' 을(를) 폐기했어요.`, 'ok', 5000);
        setDevices(await listDevices(cfg));
      } catch (e) {
        ui.toast(String((e as Error)?.message || e), 'bad', 6000);
      } finally {
        setBusy(false);
      }
    },
    [cfg],
  );

  const syncNow = useCallback(async () => {
    setBusy(true);
    try {
      const r = await runSync(); // 병합 결과 메모리 반영은 runSync 가 한다(컨트롤러 계약).
      if (r.status === 'failed') ui.toast(`동기화 실패 — ${r.error ?? ''}`, 'bad', 8000);
      else ui.toast(r.pulled ? `${r.pulled}건을 받아왔어요.` : '최신 상태예요.', 'ok', 4000);
      void refreshStatus();
    } finally {
      setBusy(false);
    }
  }, [refreshStatus]);

  if (!isTauri() || !loaded) return null;

  return (
    <div className="ds-rule">
      <h2>
        클라우드 동기화 <span className="ds-tiny text-mut">— 여러 기기에서 같은 계획을 보고 편집합니다</span>
      </h2>

      <div className="ds-row">
        <span className={`ds-pill ${cfg ? 'ds-good' : 'text-mut'}`}>{cfg ? '연결됨' : '연결 안 됨'}</span>
        {cfg && <span className="ds-tiny text-mut">{cfg.baseUrl}</span>}
      </div>

      {cfg ? (
        <>
          <div className="ds-foot">
            계획·할일·완료·일정과 내 요약·독후감이 올라갑니다. <b>볼트 노트·파이썬 도구·AI·Anki 는 이 PC 에만</b>{' '}
            남아요(인터넷 없이도 그대로 동작합니다).
          </div>
          <div className="ds-row">
            <Button sm variant="ghost" onClick={() => void syncNow()} disabled={busy}>
              <Icon name="refresh" /> 지금 동기화
            </Button>
            <Button sm variant="ghost" onClick={() => void loadDevices()} disabled={busy}>
              <Icon name="plug" /> 연결된 기기
            </Button>
            <Button sm variant="ghost" onClick={() => void disconnect()} disabled={busy}>
              <Icon name="alert" /> 연결 끊기
            </Button>
          </div>

          {/* 관측성 readout(§14 발전 #4) — 마지막 동기화 시각 + 아직 안 올라간 건수. */}
          <div className="ds-foot ds-tiny">
            {syncedAt ? `마지막 동기화 ${agoLabel(syncedAt, statusAt)}` : '아직 동기화 전'}
            {pending != null && (pending > 0 ? ` · 올릴 것 ${pending}건 대기` : ' · 최신 상태(대기 없음)')}
          </div>

          {/* ⚠ 기기 목록 = **분실 대응 수단**. 폰을 잃으면 여기서 그 기기만 끊는다. */}
          {devices && (
            <>
              <div className="ds-foot">
                기기를 잃어버렸다면 여기서 <b>폐기</b>하세요 — 그 기기의 접근이 즉시 끊깁니다. 되돌릴 수 없고, 다시
                쓰려면 등록 코드가 필요해요.
              </div>
              {devices.devices.map((d) => (
                <div key={d.id} className="ds-row">
                  <span className={`ds-pill ${d.revokedAt ? 'text-mut' : 'ds-good'}`}>
                    {d.revokedAt ? '폐기됨' : '활성'}
                  </span>
                  <span>
                    {d.name}
                    {d.id === devices.self && <span className="ds-tiny text-mut"> (이 기기)</span>}
                  </span>
                  <span className="ds-tiny text-mut">마지막 접속 {new Date(d.lastSeenAt * 1000).toLocaleString()}</span>
                  {!d.revokedAt && d.id !== devices.self && (
                    <Button sm variant="ghost" onClick={() => void revoke(d)} disabled={busy}>
                      폐기
                    </Button>
                  )}
                </div>
              ))}
            </>
          )}
        </>
      ) : (
        <>
          <div className="ds-foot">
            서버 주소와 <b>등록 코드</b>를 넣으면 이 기기가 연결됩니다. 코드는 1회용이고 10분 뒤 만료돼요.
          </div>
          <div className="ds-row">
            <input
              type="url"
              placeholder="https://…workers.dev"
              aria-label="클라우드 서버 주소"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div className="ds-row">
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
          <div className="ds-foot">
            <Icon name="alert" /> 성적·일정·메모가 인터넷을 건너갑니다. 신뢰하는 서버 주소인지 확인하세요.
          </div>
        </>
      )}
    </div>
  );
}
