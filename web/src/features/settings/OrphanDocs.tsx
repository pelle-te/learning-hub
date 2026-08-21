/**
 * 도달 불가 `docs` 행 리드아웃(D005 · 2026-08-21) — **보고만 하고 지우지 않는다.**
 *
 * 실 DB 에 51,793 B 가 «읽을 수도 지울 수도 없는데 D1·폰까지 밀린 채» 있었고(P10 W4 에서
 * 은퇴한 세입자 셋), 그 사실을 아는 화면이 하나도 없었다.
 *
 * ⚠ 앱이 스스로 지우지 않는 이유: 판정 근거가 «`DOC_KEYS` 에 없다» 뿐인데 그 목록은 세입자가
 * 오갈 때마다 바뀐다 — 자동 삭제를 달면 다음 리팩터가 사용자 저작물을 지운다.
 * ⚠ 회수가 삭제보다 먼저다. 내보내기가 `_docs` 로 이 표를 **전량** 담으므로(`backupPayload`)
 * 아래 확인 문구가 가리키는 백업이 실제로 이것을 구한다.
 * ⚠ 별도 파일인 것은 `Settings.tsx` 의 `max-lines` 래칫 때문이다(716) — 화면 하나가 진단
 * 리드아웃을 계속 흡수하면 그 파일이 계측 대시보드가 된다.
 */
import { useState } from 'react';
import { Button } from '@/components/ui';
import { confirmLossy, toast } from '@/shell';
import { docDelete, unknownDocKeys } from '@/lib/db/docs';

export default function OrphanDocs() {
  /* 목록은 부팅에 확정된다(`initDocs` 는 렌더보다 앞이다) — 효과로 뒤늦게 세우면 첫 렌더가
     비고, 그 깜빡임이 «없다» 로 읽힌다. */
  const [rows] = useState(unknownDocKeys);
  const [gone, setGone] = useState<string[]>([]);
  const live = rows.filter((r) => !gone.includes(r.key));

  const drop = async (key: string): Promise<void> => {
    const ok = await confirmLossy(
      `«${key}» 를 지웁니다. 되돌릴 수 없어요 — 먼저 내보내기로 백업했는지 확인하세요(백업 파일의 _docs 에 들어 있습니다).`,
      { title: '남은 데이터 지우기', okLabel: '지우기' },
    );
    if (!ok) return;
    if (await docDelete(key)) setGone((g) => [...g, key]);
    else toast('지우지 못했어요 — 삭제 표시를 못 남기면 다른 기기에서 되살아납니다.', 'bad');
  };

  if (!live.length) return null;
  const total = live.reduce((a, b) => a + b.bytes, 0);
  return (
    <div className="ds-tiny mt-2">
      <b>쓰이지 않는 저장 데이터</b>{' '}
      <span className="text-mut">
        · {live.length}건 {Math.round(total / 1024)}KB · 이 기기와 클라우드 양쪽
      </span>
      <div className="mt-1 flex flex-col gap-1">
        {live.map((r) => (
          <span key={r.key} className="flex items-center gap-2">
            <code>{r.key}</code>
            <span className="text-mut">{Math.round(r.bytes / 1024) || 1}KB</span>
            <Button sm variant="ghost" onClick={() => void drop(r.key)}>
              지우기
            </Button>
          </span>
        ))}
      </div>
    </div>
  );
}
