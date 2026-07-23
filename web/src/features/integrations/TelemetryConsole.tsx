/* ============================================================
   TelemetryConsole — 연동 텔레메트리(연동 시그니처). 백엔드·볼트·Anki 연결을
   라이브 채널 리드아웃으로(● ONLINE/IDLE/OFFLINE). 시스템 폴더 /api 연동의 "조종석".
   상태는 Query 캐시 구독(enabled:false로 fetch 없이 읽기) + usePing. 순수 표현에 가깝되 상태는 store/query에서.
============================================================ */
import { useQuery, skipToken } from '@tanstack/react-query';
import { usePing } from '@/store/queries';
import { totalDue, totalCards, type AnkiLive, type AnkiFile } from '@/lib/anki';
import type { VaultScan } from '@/lib/vault';
import type { ReactNode } from 'react';
import ds from '@/styles/ds.module.css';

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
  online: 'bg-good shadow-dot-good animate-[tc-pulse_1.8s_infinite] motion-reduce:animate-none',
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
}: {
  label: string;
  status: Status;
  value: ReactNode;
  sub: string;
  vertical?: boolean;
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
    </div>
  );
}

export default function TelemetryConsole({ vertical }: { vertical?: boolean }) {
  const ping = usePing();
  // skipToken → fetch 없이(쿼리 비활성) 같은 캐시 키만 구독(패널이 setQueryData하면 콘솔도 갱신).
  //  enabled:false와 달리 queryFn 누락 경고를 내지 않음(읽기전용 캐시 구독의 정석).
  const vault = useQuery<VaultScan>({ queryKey: ['vault'], queryFn: skipToken }).data;
  const live = useQuery<AnkiLive>({ queryKey: ['ankiLive'], queryFn: skipToken }).data;
  const file = useQuery<AnkiFile>({ queryKey: ['ankiFile'], queryFn: skipToken }).data;

  const serve: Status = ping.isLoading ? 'probing' : ping.isSuccess && ping.data?.ok ? 'online' : 'offline';
  const vaultNotes = vault ? vault.subjects.reduce((t, x) => t + x.notes, 0) : 0;
  const due = live ? totalDue(live.decks) : 0;
  const cards = file ? totalCards(file.decks) : 0;

  return (
    <div className={`${ds.board}${vertical ? ' mb-0! flex h-full flex-col' : ''}`}>
      <div className="mb-3.5 flex items-baseline justify-between">
        <span className="text-xs font-extrabold tracking-caps text-mut uppercase">연동 텔레메트리 — TELEMETRY</span>
        {!vertical && <span className="text-2xs text-mut opacity-80">시스템 폴더 /api · 볼트 · Anki 조종석</span>}
      </div>
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
      </div>
    </div>
  );
}
