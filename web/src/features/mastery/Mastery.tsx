/* ============================================================
   Mastery — 탭: 🧠 숙달도 지도 (Phase 5 · 서버/외부 = TanStack Query)
   지식엔진.py 산출(_지식상태.json)을 소비 — 히트맵(A)·프런티어/갭(B)·캘리브레이션(E).
   데이터 원본 둘: 산출물 `knowledge`(자동) · 수동 새로고침. 셸은 둘 다 워크스페이스에서 읽고,
   브라우저는 후자가 FS Access 폴더 선택이다(4단계-I).
   둘 다 같은 ['knowledge'] Query 캐시로 모여 본문이 렌더(설계도 §1-B). 레거시 _knowState 수동배선 제거.

   월드클래스 재설계(데모 v6 사상) — HudFrame fill 가득.
   상단 시네마틱 히어로 밴드(전체 숙달 발광 링 + 상태 분포 + 로드) → 본문 2컬럼
   [발광 지식맵(시그니처) | 다음 행동(프런티어·약점·캘리브레이션)]. 살아있는 인터랙션(스포트라이트·오로라·카운트업).
============================================================ */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useKnowledge, usePing, KNOWLEDGE_KEY } from '@/store/queries';
import { useApp } from '@/store/useApp';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { useHeroPointer } from '@/hooks/interactions';
import { ui } from '@/shell';
import { fetchKnowledgeArtifact, loadKnowledgeStateFromVault } from '@/lib/knowledge';
import { classifyArtifact } from '@/lib/artifactState';
import { isFsAccessSupported, pickDirectory } from '@/lib/fsAccess';
import { isTauri } from '@/lib/tauri';
import { slimKnowState } from '@/lib/scheduler';
import { Button } from '@/components/ui';
import ds from '@/styles/ds.module.css';
import { M } from './classes';

import { OverallRing, Distribution, KnowledgeMap } from './KnowledgeMap';
import { Frontier, Sequencing, EngineHealth, Gaps, RootCauses, Calibration } from './NextActions';

const pct = (x?: number) => `${Math.round((x || 0) * 100)}%`;

function Setup() {
  // 카드 크롬은 offWrap(발광 패널)이 제공 — 본문은 투명 콘텐츠만(지식맵 패널과 같은 언어).
  return (
    <div className={`${M.offChild} ${M.stateBody}`}>
      <h3 className={M.stateH3}>아직 지식상태가 없어요</h3>
      <ol className={ds.foot} style={{ lineHeight: 1.9 }}>
        <li>
          볼트 인덱스 최신화: <code>python pipeline/_도구/벌트DB.py build</code>
        </li>
        <li>
          (선택) 러닝허브 데이터 먹이기: 설정 탭에서 <b>볼트 백업</b>(<code>러닝허브_백업.json</code>) → 엔진이
          CBMS·백지를 인제스트
        </li>
        <li>
          지식상태 빌드: <code>python pipeline/_도구/지식엔진.py build --export 러닝허브_백업.json</code>
        </li>
        <li>
          위 <b>📁 볼트에서 불러오기</b> 클릭 → 전공 폴더 선택
        </li>
      </ol>
      <div className={`${ds.foot} ${ds.muted}`}>
        엔진은 선수개념 그래프로 "지금 배울 준비된 것(ZPD)"과 "약점의 근본원인"을 진단합니다. 인출 관측(Anki/CBMS)이
        쌓일수록 추정이 날카로워집니다.
      </div>
    </div>
  );
}

export default function Mastery() {
  const { data: k, isLoading, isFetching, isError, error, refetch } = useKnowledge();
  const ping = usePing(); // 백엔드 사용 가능 여부(워크스페이스 유효성) — 오프라인(프록시 500 포함)과 진짜 서버 실패를 구분.
  const qc = useQueryClient();
  const setRuntimeCache = useApp((s) => s.setRuntimeCache);
  // 포인터 추적 스포트라이트 — 히어로 밴드·지식맵 패널이 커서를 따라 발광(틸트 없는 큰 보드).
  const { ref: heroRef, onMouseMove: heroMove, onMouseLeave: heroLeave } = useHeroPointer(0);
  const { ref: mapRef, onMouseMove: mapMove, onMouseLeave: mapLeave } = useHeroPointer(0);

  // 전체 유효숙달·노트·약점 리드아웃을 상단 바로(데모 v6 헤더).
  const weak = k?.states?.weak;
  usePageChromeEffect(
    () => ({
      readouts: !k
        ? []
        : [
            { label: '전체 숙달', value: pct(k.overall), accent: true },
            { label: '노트', value: k.n_notes ?? 0 },
            { label: '약점', value: weak ?? 0 },
          ],
    }),
    [k, weak],
  );

  // 볼트 폴더에서 수동 로드(백엔드가 없을 때) → 같은 ['knowledge'] 캐시에 주입 + write-through.
  // 큰 _지식상태.json 파싱은 Query 스피너가 아니라 이 async가 소유 → 자체 로딩상태로 '멈춘 듯'을 없앤다.
  const [vaultLoading, setVaultLoading] = useState(false);
  const loadFromVault = async () => {
    /* ⚠ **셸에선 폴더를 묻지 않는다**(4단계-I). 워크스페이스를 이미 알고, 같은 파일을
       `artifact_read('knowledge')` 가 읽어 준다 — 사용자에게 경로를 다시 물을 이유가 없다.
       (FSA 가 셸에서 깨진 게 아니다. 트랙 B 프로브로 재보니 `showDirectoryPicker` 는
        실제로 동작한다 — 3단계가 볼트 노트에서 없앤 마찰을 여기서도 없애는 것이다.) */
    setVaultLoading(true);
    try {
      if (isTauri()) {
        const loaded = await fetchKnowledgeArtifact();
        qc.setQueryData(KNOWLEDGE_KEY, loaded);
        setRuntimeCache('_knowState', slimKnowState(loaded));
        return;
      }
      if (!isFsAccessSupported()) {
        ui.toast('이 브라우저는 폴더 연결 미지원(Chrome/Edge). 러닝허브 앱으로 열면 자동 로드됩니다.', 'warn');
        return;
      }
      const handle = await pickDirectory();
      if (!handle) return; // 취소
      const loaded = await loadKnowledgeStateFromVault(handle);
      if (!loaded) {
        ui.toast('_지식상태.json을 못 찾았어요. 전공 폴더를 골랐는지, 지식엔진.py build를 돌렸는지 확인하세요.', 'bad');
        return;
      }
      qc.setQueryData(KNOWLEDGE_KEY, loaded);
      setRuntimeCache('_knowState', slimKnowState(loaded)); // 슬림 write-through(감사 ②#25 · queries.useKnowledge와 대칭)
    } catch (e) {
      // 셸 경로는 산출물 미생성이면 throw 한다 — 조용히 넘기면 버튼이 먹통처럼 보인다.
      ui.toast('지식상태를 불러오지 못했어요 — 지식엔진.py build 를 먼저 돌려주세요.', 'bad');
      void e;
    } finally {
      setVaultLoading(false);
    }
  };

  const loading = (isLoading || isFetching) && !k;

  // 쿼리 에러 분류 — '아직 데이터 없음'(산출물 미생성 404·산출물 부재 메시지·서버 미가동)은 정상적인
  // 무데이터 → 셋업 안내. 백엔드가 살아 있는데(ping 성공) 실패한 경우만 에러 패널로 —
  // 실패를 셋업 뒤에 숨기지 않되, 오프라인(dev/preview 프록시 500 포함)을 장애로 오판하지 않는다.
  const errMsg = isError ? (error instanceof Error ? error.message : String(error)) : '';
  // 산출물 상태 분류는 공용 SSOT(classifyArtifact) — reads·markets와 같은 규칙(오프라인/미생성/진짜에러 구분).
  const realError = classifyArtifact({ hasData: !!k, loading, query: { isError, error }, ping }) === 'error';

  return (
    <section className={M.wrap} aria-label="숙달도 지도">
      {/* ── 시네마틱 히어로 밴드 — 전체 숙달 발광 링 + 상태 분포 + 로드 ── */}
      <div
        ref={heroRef}
        onMouseMove={heroMove}
        onMouseLeave={heroLeave}
        className={`${M.hero} ${ds.spotHost} ${ds.glow}`}
      >
        <div className={ds.spotlight} aria-hidden="true" />
        <div className={ds.aura} aria-hidden="true" />
        <div className={M.heroLeft}>
          <span className={M.eyebrow}>지식 지도</span>
          <h2 className={M.headTitle}>🧠 숙달도 지도</h2>
          <span className={M.headMeta}>
            {k ? (
              <>
                생성 {k.generated || '—'} · 노트 {k.n_notes}개
              </>
            ) : (
              '선수개념 그래프로 지금 배울 것을 진단'
            )}
          </span>
        </div>
        {k && <OverallRing overall={k.overall || 0} />}
        {k && (
          <div className={M.heroDistWrap}>
            <span className={M.distLab}>지식 상태 분포</span>
            <Distribution k={k} />
          </div>
        )}
        <div className={M.heroAction}>
          {loading && (
            <span className={M.headMeta}>
              <span className={ds.spin} /> 로드 중
            </span>
          )}
          <Button sm variant="primary" onClick={loadFromVault} disabled={vaultLoading}>
            {vaultLoading ? (
              <>
                <span className={ds.spin} /> 읽는 중…
              </>
            ) : (
              <>📁 {isTauri() ? '볼트에서 새로고침' : `볼트에서 ${k ? '새로고침' : '지식상태 불러오기'}`}</>
            )}
          </Button>
        </div>
      </div>

      {k ? (
        <div className={M.cols}>
          {/* 좌 — 발광 지식맵(immersive 시그니처) */}
          <div
            ref={mapRef}
            onMouseMove={mapMove}
            onMouseLeave={mapLeave}
            className={`${M.mapCol} ${ds.spotHost} ${ds.glow}`}
          >
            <div className={ds.spotlight} aria-hidden="true" />
            <div className={ds.aura} aria-hidden="true" />
            <div className={M.mapScroll}>
              <KnowledgeMap k={k} />
            </div>
          </div>
          {/* 우 — 다음 행동(프런티어·약점·캘리브레이션) */}
          <div className={M.actionCol}>
            <Frontier k={k} />
            <Sequencing />
            <EngineHealth />
            <Gaps k={k} />
            <RootCauses k={k} />
            <Calibration k={k} />
          </div>
        </div>
      ) : loading ? (
        <div className={M.offWrap}>
          <div className={`${M.offChild} ${ds.muted}`}>
            <span className={ds.spin} /> 지식상태 로드 중...
          </div>
        </div>
      ) : realError ? (
        /* 진짜 실패(서버 응답 에러) — 셋업 안내로 위장하지 않고 에러를 드러내고 재시도를 제공. */
        <div className={M.offWrap}>
          <div className={`${M.offChild} ${M.errBody}`} role="alert">
            <span className={M.errGlyph} aria-hidden="true">
              ⚠
            </span>
            <h3 className={M.errH3}>지식상태를 불러오지 못했어요</h3>
            <div className={`${ds.foot} ${ds.muted}`}>{errMsg}</div>
            <Button sm variant="primary" onClick={() => refetch()}>
              다시 시도
            </Button>
          </div>
        </div>
      ) : (
        <div className={M.offWrap}>
          <Setup />
        </div>
      )}
    </section>
  );
}
