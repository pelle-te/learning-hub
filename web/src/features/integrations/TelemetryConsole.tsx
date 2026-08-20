/* ============================================================
   TelemetryConsole — 연동 텔레메트리(연동 시그니처). 백엔드·볼트·Anki 연결을
   라이브 채널 리드아웃으로(● ONLINE/IDLE/OFFLINE). 시스템 폴더 /api 연동의 "조종석".
   상태는 Query 캐시 구독(enabled:false로 fetch 없이 읽기) + usePing. 순수 표현에 가깝되 상태는 store/query에서.
============================================================ */
import { useEffect, useState } from 'react';
import { useQuery, skipToken } from '@tanstack/react-query';
import { bootWave } from '@/lib/perf';
import { quietSummary } from '@/lib/daySignals';
import { usePing } from '@/store/queries';
import { totalDue, totalCards, type AnkiLive, type AnkiFile } from '@/lib/anki';
import type { VaultScan } from '@/lib/vault';
import { Button } from '@/components/ui';
import { shellHotkeyRetry, shellVaultWatchRetry } from '@/lib/tauri';
import { toast } from '@/shell/toast';
import type { ReactNode } from 'react';

type Status = 'online' | 'idle' | 'offline' | 'probing';
const STATUS_LABEL: Record<Status, string> = {
  online: 'ONLINE',
  idle: 'IDLE',
  offline: 'OFFLINE',
  probing: '…',
};

// 상태별 정적 클래스 맵(동적 조립 금지 · §15 부칙) — 옛 `.online .dot`/`.online .chVal` 등 관계형 규칙을
// 자식에 직접 준다(규약 4). 채널 테두리/배경은 online 만 특별(acc), 값 색은 online→acc, 상태 색은 online→good·offline→bad.
const CH_WRAP: Record<Status, string> = {
  online: 'border-line-acc-hover bg-acc-soft',
  idle: 'border-line bg-ch-tint',
  offline: 'border-line bg-ch-tint',
  probing: 'border-line bg-ch-tint',
};
const DOT: Record<Status, string> = {
  online: 'bg-good shadow-dot-good pulse-online animate-[live-pulse_var(--tempo)_infinite] motion-reduce:animate-none',
  idle: 'bg-dot-idle',
  offline: 'bg-bad shadow-dot-bad',
  probing: 'bg-mut',
};
const VAL_COLOR: Record<Status, string> = {
  online: 'text-acc',
  idle: 'text-txt',
  offline: 'text-txt',
  probing: 'text-txt',
};
const STAT_COLOR: Record<Status, string> = {
  online: 'text-good',
  idle: 'text-mut',
  offline: 'text-bad',
  probing: 'text-mut',
};

function Channel({
  label,
  status,
  value,
  sub,
  vertical,
  action,
}: {
  label: string;
  status: Status;
  value: ReactNode;
  sub: string;
  vertical?: boolean;
  /** 실패했을 때 사용자가 **할 수 있는 일**(M-9). 없으면 안 그린다 — 관측만 있는 칸이 기본이다. */
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div
      className={`flex flex-col gap-1.25 rounded-md border px-3.5 py-3 ${CH_WRAP[status]} ${vertical ? 'flex-1 justify-center' : ''}`}
    >
      <span className="flex items-center gap-1.75">
        <span className={`size-2.25 flex-none rounded-full ${DOT[status]}`} />
        <span className="text-xs font-extrabold tracking-caps-sm text-txt">{label}</span>
        <span className={`ml-auto text-2xs font-extrabold tracking-caps-sm ${STAT_COLOR[status]}`}>
          {STATUS_LABEL[status]}
        </span>
      </span>
      <span className={`text-3xl leading-none font-extrabold tracking-tight tabular-nums ${VAL_COLOR[status]}`}>
        {value}
      </span>
      <span className="truncate text-2xs text-mut">{sub}</span>
      {/* ⚠ **관측에는 짝이 있어야 한다**(M-9) — 사유만 적고 처방이 "앱 재시작"이면 그건 관측이
          아니라 통보다. 두 채널 다 원인이 일시적인 경우가 흔해 *다시 걸기*가 맞는 행동이다. */}
      {action && (
        <Button sm className="mt-1 self-start" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

/** 채널 리드아웃 파생 — **표현만 있고 상태는 없다**(이 파일 머리주석의 "순수 표현에 가깝게").
 *  컴포넌트 본문에 두면 훅과 삼항 열댓 개가 한 함수에 섞여, 무엇이 구독이고 무엇이 계산인지가
 *  읽는 순서로만 구분된다. 값 계산을 통째로 여기 모으면 컴포넌트에는 *구독 + JSX* 만 남는다.
 *  ⚠ 반환값의 **이름과 값이 종전과 한 글자도 다르지 않다** — 렌더 트리가 안 변한다는 뜻이다.
 *
 *  · 전역 캡처 단축키(E20)는 셸에서만 존재하는 채널이다. 브라우저·dev 에선 필드가 아예 안 오므로
 *    칸을 세우지 않는다(없는 기능을 'IDLE' 로 그리면 "고장난 것"으로 읽힌다).
 *    ⚠ 실패 판정은 **사유의 존재**다(`hotkey === false` 가 아니다 — Rust 쪽과 같은 계약).
 *  · 볼트 **감시** 실패(H7 · 2026-08-01)도 값이 있을 때만 실패다(hotkey 와 같은 계약). 감시가
 *    죽으면 볼트를 고쳐도 화면이 안 바뀌는데 종전엔 그 사실이 Rust 로그에만 있었다.
 *  · `quietLine` 의 분모는 14 가 아니라 **관측된 날**이다 — 앱을 안 연 날은 조용했는지 알 수 없고,
 *    그걸 조용한 날로 세면 "안 썼다"가 "평온했다"로 둔갑한다. 관측이 0이면 아예 말하지 않는다.
 *  · `waveLine`(W16)은 **부팅 웨이브를 읽는 유일한 자리**다. 계량만 하고 소비처가 없으면 그게 곧
 *    `visits.ts` 가 물린 _"쌓이고 있다는 믿음만 쌓인다"_ 라, 마크를 넣은 커밋이 읽는 곳도 함께 낸다.
 *    ⚠ 값이 없으면 **줄 자체가 없다**(0 으로 그리지 않는다 — 값 부재와 값 0 은 다른 사실이다). */
function readouts(
  ping: ReturnType<typeof usePing>,
  vault: VaultScan | undefined,
  live: AnkiLive | undefined,
  file: AnkiFile | undefined,
  quiet: { observed: number; quiet: number } | null,
) {
  const hotkeyErr = ping.data?.hotkeyError ?? null;
  const wave = bootWave();
  return {
    serve: (ping.isLoading ? 'probing' : ping.isSuccess && ping.data?.ok ? 'online' : 'offline') as Status,
    hotkeyErr,
    hotkeyShown: ping.data?.hotkey !== undefined || !!hotkeyErr,
    vaultWatchErr: ping.data?.vaultWatchError ?? null,
    vaultNotes: vault ? vault.subjects.reduce((t, x) => t + x.notes, 0) : 0,
    due: live ? totalDue(live.decks) : 0,
    cards: file ? totalCards(file.decks) : 0,
    quietLine: quiet && quiet.observed > 0 ? `최근 ${quiet.observed}일 관측 중 조용한 날 ${quiet.quiet}일` : null,
    waveLine:
      wave.total != null
        ? `부팅 ${wave.total}ms(엔트리→App ${wave.entryToApp ?? '?'} · App→첫 화면 ${wave.appToData ?? '?'})`
        : null,
  };
}

export default function TelemetryConsole({ vertical }: { vertical?: boolean }) {
  const ping = usePing();
  /* ── E23 소비처 — **쓰기만 하는 계측은 계측이 아니다** ──────────────────
     `visits.ts` 가 도입 나흘 뒤 감사에서 "읽는 곳이 0"으로 잡혔다(H23). 그동안 로드맵 다섯
     항목이 그 데이터를 기다렸고, 사람이 값을 볼 수 없으니 "쌓이고 있다"는 믿음만 쌓였다.
     그래서 원장을 만든 커밋이 소비처도 함께 낸다 — 이 한 줄이 '정적(quiet)의 설계'의 착수
     게이트다(조용한 날이 드물면 금도금, 잦으면 매일 0의 벽을 치우는 것). */
  const [quiet, setQuiet] = useState<{ observed: number; quiet: number } | null>(null);
  useEffect(() => {
    void quietSummary().then(setQuiet);
  }, []);
  // skipToken → fetch 없이(쿼리 비활성) 같은 캐시 키만 구독(패널이 setQueryData하면 콘솔도 갱신).
  //  enabled:false와 달리 queryFn 누락 경고를 내지 않음(읽기전용 캐시 구독의 정석).
  const vault = useQuery<VaultScan>({ queryKey: ['vault'], queryFn: skipToken }).data;
  const live = useQuery<AnkiLive>({ queryKey: ['ankiLive'], queryFn: skipToken }).data;
  const file = useQuery<AnkiFile>({ queryKey: ['ankiFile'], queryFn: skipToken }).data;

  const { serve, hotkeyErr, hotkeyShown, vaultWatchErr, vaultNotes, due, cards, quietLine, waveLine } = readouts(
    ping,
    vault,
    live,
    file,
    quiet,
  );

  return (
    <div className={`ds-board${vertical ? ' mb-0! flex h-full flex-col' : ''}`}>
      <div className="mb-3.5 flex items-baseline justify-between">
        <span className="ds-caps">연동 텔레메트리 — TELEMETRY</span>
        {!vertical && <span className="text-2xs text-mut">시스템 폴더 /api · 볼트 · Anki 조종석</span>}
      </div>
      {quietLine && <p className="mt-0 mb-3 text-2xs text-mut">{quietLine}</p>}
      {waveLine && <p className="mt-0 mb-3 text-2xs text-mut tabular-nums">{waveLine}</p>}
      <div
        className={vertical ? 'flex min-h-0 flex-1 flex-col gap-3' : 'grid grid-cols-3 gap-2.5 max-mobile:grid-cols-1'}
      >
        <Channel
          label="SERVE.JS"
          status={serve}
          vertical={vertical}
          value={serve === 'online' ? <>{ping.data?.tools.length ?? 0}</> : '—'}
          sub={
            serve === 'online'
              ? `도구 · ${ping.data?.work || '/api'}`
              : serve === 'probing'
                ? '연결 확인 중'
                : '워크스페이스 설정 필요(설정 탭)'
          }
        />
        <Channel
          label="VAULT"
          status={vault ? 'online' : 'idle'}
          vertical={vertical}
          value={vault ? vault.subjects.length : '—'}
          sub={vault ? `과목 · 노트 ${vaultNotes} · ${vault.at}` : '볼트 폴더 스캔 대기'}
        />
        <Channel
          label="ANKI"
          status={live ? 'online' : 'idle'}
          vertical={vertical}
          value={live ? due : file ? cards : '—'}
          sub={
            live
              ? `오늘 due · 덱 ${live.decks.length}`
              : file
                ? `카드(파일) · 덱 ${file.decks.length}`
                : 'AnkiConnect 대기'
          }
        />
        {/* ⚠ 전역 캡처 단축키(E20) — **등록 실패가 조용히 죽지 않게 하는 표면**이다. 전역 조합은
            OS 전체에서 한 앱만 가질 수 있어 다른 앱이 선점하면 등록이 실패하는데, 그걸 삼키면
            사용자는 키가 안 먹는 이유를 알 방법이 0 이다(2026-07-25 감사가 잡은 '죽은 분기'와
            같은 형태). 채널로 세워 두면 새 표면 없이 상시 관측이 붙는다.
            ⚠ **사유가 있을 때만 실패**로 그린다 — `hotkey === false` 만 보고 경고하면 브라우저·dev
            에서 상시 경고가 되고, 상시 경고는 곧 무시된다(Rust `hotkey.rs` 와 같은 계약). */}
        {hotkeyShown && (
          <Channel
            label="HOTKEY"
            status={hotkeyErr ? 'offline' : ping.data?.hotkey ? 'online' : 'idle'}
            vertical={vertical}
            value={ping.data?.hotkey ? '⌘⇧␣' : '—'}
            sub={hotkeyErr ? `등록 실패 — 다른 앱이 선점했을 수 있어요: ${hotkeyErr}` : '전역 캡처 · 앱 밖에서도 열림'}
            action={
              hotkeyErr
                ? {
                    label: '다시 등록',
                    onClick: () => {
                      void shellHotkeyRetry().then(
                        () => {
                          toast('전역 단축키를 다시 등록했어요.', 'ok');
                          void ping.refetch();
                        },
                        (e: unknown) =>
                          toast(`아직 선점돼 있어요 — ${e instanceof Error ? e.message : String(e)}`, 'bad'),
                      );
                    },
                  }
                : undefined
            }
          />
        )}
        {/* ⚠ 볼트 감시(H7) — 위 HOTKEY 와 **같은 형태**다: 사유가 있을 때만 칸을 세우고 실패로 그린다.
            감시가 죽었을 때의 증상("볼트를 고쳐도 화면이 안 바뀐다")은 "볼트가 비었다"와 화면상
            구분되지 않아서, 관측 채널이 없으면 사용자가 원인에 도달할 방법이 0 이다. */}
        {vaultWatchErr && (
          <Channel
            label="VAULT-WATCH"
            status="offline"
            vertical={vertical}
            value="—"
            sub={`자동 갱신이 멈췄어요: ${vaultWatchErr}`}
            action={{
              label: '감시 다시 걸기',
              onClick: () => {
                /* ⚠ 성공을 단언하지 않는다 — 감시는 스레드에서 서고 사유가 나중에 앉는다.
                   다음 `ping` 에서 이 칸이 사라지는 것이 성공의 증거다(`lib/tauri` 주석). */
                void shellVaultWatchRetry().then(
                  () => {
                    toast('볼트 감시를 다시 걸었어요 — 잠시 후 상태가 갱신됩니다.', 'info');
                    void ping.refetch();
                  },
                  (e: unknown) =>
                    toast(`감시를 다시 걸지 못했어요 — ${e instanceof Error ? e.message : String(e)}`, 'bad'),
                );
              },
            }}
          />
        )}
      </div>
    </div>
  );
}
