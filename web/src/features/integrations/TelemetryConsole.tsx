/* ============================================================
   TelemetryConsole — 연동 텔레메트리(연동 시그니처). serve.js·볼트·Anki 연결을
   라이브 채널 리드아웃으로(● ONLINE/IDLE/OFFLINE). 시스템 폴더 /api 연동의 "조종석".
   상태는 Query 캐시 구독(enabled:false로 fetch 없이 읽기) + usePing. 순수 표현에 가깝되 상태는 store/query에서.
============================================================ */
import { useQuery } from '@tanstack/react-query';
import { usePing } from '@/store/queries';
import { totalDue, type AnkiLive, type AnkiFile } from '@/lib/anki';
import type { VaultScan } from '@/lib/vault';
import type { ReactNode } from 'react';
import s from './TelemetryConsole.module.css';

type Status = 'online' | 'idle' | 'offline' | 'probing';
const STATUS_LABEL: Record<Status, string> = {
  online: 'ONLINE',
  idle: 'IDLE',
  offline: 'SIGNAL LOST',
  probing: '…',
};

function Channel({ label, status, value, sub }: { label: string; status: Status; value: ReactNode; sub: string }) {
  return (
    <div className={`${s.ch} ${s[status]}`}>
      <span className={s.chHead}>
        <span className={s.dot} />
        <span className={s.chName}>{label}</span>
        <span className={s.chStat}>{STATUS_LABEL[status]}</span>
      </span>
      <span className={s.chVal}>{value}</span>
      <span className={s.chSub}>{sub}</span>
    </div>
  );
}

export default function TelemetryConsole() {
  const ping = usePing();
  // enabled:false → fetch 없이 같은 캐시 키를 구독(패널이 setQueryData하면 콘솔도 갱신).
  const vault = useQuery<VaultScan>({ queryKey: ['vault'], enabled: false }).data;
  const live = useQuery<AnkiLive>({ queryKey: ['ankiLive'], enabled: false }).data;
  const file = useQuery<AnkiFile>({ queryKey: ['ankiFile'], enabled: false }).data;

  const serve: Status = ping.isLoading ? 'probing' : ping.isSuccess && ping.data?.ok ? 'online' : 'offline';
  const vaultNotes = vault ? vault.subjects.reduce((t, x) => t + x.notes, 0) : 0;
  const due = live ? totalDue(live.decks) : 0;
  const cards = file ? file.decks.reduce((t, d) => t + d.cards, 0) : 0;

  return (
    <div className={s.board}>
      <div className={s.head}>
        <span className={s.title}>연동 텔레메트리 — TELEMETRY</span>
        <span className={s.hint}>시스템 폴더 /api · 볼트 · Anki 조종석</span>
      </div>
      <div className={s.channels}>
        <Channel
          label="SERVE.JS"
          status={serve}
          value={serve === 'online' ? <>{ping.data?.tools.length ?? 0}</> : '—'}
          sub={
            serve === 'online'
              ? `도구 · ${ping.data?.work || '/api'}`
              : serve === 'probing'
                ? '연결 확인 중'
                : 'node serve.js 필요(localhost:8000)'
          }
        />
        <Channel
          label="VAULT"
          status={vault ? 'online' : 'idle'}
          value={vault ? vault.subjects.length : '—'}
          sub={vault ? `과목 · 노트 ${vaultNotes} · ${vault.at}` : '볼트 폴더 스캔 대기'}
        />
        <Channel
          label="ANKI"
          status={live ? 'online' : 'idle'}
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
