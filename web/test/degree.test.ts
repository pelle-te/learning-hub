/* ============================================================
   degree.test.ts — 졸업 집계(lib/degree) 순수 회귀(Vitest).
   학점/GPA/요건 충족/재수강 후보를 state.degree만으로 파생 — DegreeReq·Degree 공유 출처.
============================================================ */
import { describe, expect, it } from 'vitest';
import {
  degreeStats,
  progressPct,
  requirementRows,
  retakeCandidates,
  categoryReq,
  semesterGpa,
  semesterStat,
  semesterStatus,
  gpaForecast,
} from '@/lib/degree';
import { migrateSemesterStatus } from '@/lib/persistence';
import type { Degree } from '@/lib/types';

/** 이 파일의 「오늘」 — 학기 상태가 **날짜 파생**이라 모든 호출에 명시한다(기본값 없음이 계약). */
const DS = '2026-06-15';

/* ⚠⚠ **픽스처가 한 학기 → 세 학기로 갈렸다**(2026-08-31 · 상태가 과목에서 학기로 올라갔다).
   종전엔 학기 하나 안에 완료 4 · 수강중 1 · 예정 1 이 섞여 있었는데, **그 상태가 이제 불가능**하다
   — 학기는 한 상태다(`lib/degree.ts` 의 그 절). 그래서 같은 과목들을 상태별 학기로 나눠 담았다.
   ⭐ **집계값은 한 자리도 안 바뀐다**: 이수 11(3+3+3+2) · gradedCr 9(P 제외) · 점수합 21 ·
   수강중 3 · 예정 3. 그게 이 재구성이 «테스트를 새로 쓴 것»이 아니라 «같은 것을 새 모델로 적은
   것»이라는 증거다. 날짜 대신 `status` 폴백을 쓰는 이유는 그 축(폴백)도 함께 덮기 위해서다 —
   날짜 축은 아래 `semesterStatus` describe 가 따로 판다. */
function deg(over?: Partial<Degree>): Degree {
  return {
    targetTotal: 130,
    reqMajorReq: 60,
    reqMajorSel: 30,
    reqLiberal: 30,
    semesters: [
      {
        id: 's1',
        name: '2026-1학기',
        status: '완료',
        courses: [
          { id: 'c1', name: '미적분학', credits: 3, category: '전공필수', grade: 'A+' }, // 4.5
          { id: 'c2', name: '반도체', credits: 3, category: '전공필수', grade: 'F' }, // 0 · 재수강 필수
          { id: 'c3', name: '통신', credits: 3, category: '전공선택', grade: 'C+' }, // 2.5 · 재수강 후보
          { id: 'c4', name: '이수과목', credits: 2, category: '교양', grade: 'P' }, // GPA 제외
        ],
      },
      {
        id: 's2',
        name: '2026-2학기',
        status: '수강중',
        courses: [{ id: 'c5', name: '수강중과목', credits: 3, category: '전공선택', grade: '' }],
      },
      {
        id: 's3',
        name: '2027-1학기',
        status: '예정',
        courses: [{ id: 'c6', name: '예정과목', credits: 3, category: '교양', grade: '' }],
      },
    ],
    ...over,
  };
}

describe('degreeStats', () => {
  it('상태별 학점 집계 — 완료/수강중/예정', () => {
    const s = degreeStats(deg(), DS);
    expect(s.earned).toBe(3 + 3 + 3 + 2); // 완료 4과목 = 11
    expect(s.inprog).toBe(3);
    expect(s.planned).toBe(3);
  });

  it('카테고리별 이수 학점(완료만)', () => {
    const s = degreeStats(deg(), DS);
    expect(s.byCat['전공필수']).toBe(6); // 미적분3 + 반도체3(F도 완료로 집계)
    expect(s.byCat['전공선택']).toBe(3); // 통신3(수강중은 제외)
    expect(s.byCat['교양']).toBe(2);
  });

  it('GPA는 점수 있는 성적만 가중평균(P·미입력 제외)', () => {
    const s = degreeStats(deg(), DS);
    // (4.5*3 + 0*3 + 2.5*3) / (3+3+3) = 21/9 ≈ 2.333
    expect(s.gradedCr).toBe(9); // P(2학점)는 제외
    expect(s.gpa).toBeCloseTo(21 / 9, 5);
  });

  it('성적 과목이 하나도 없으면 gpa=null', () => {
    const s = degreeStats(deg({ semesters: [{ id: 'x', name: 'x', courses: [] }] }), DS);
    expect(s.gpa).toBeNull();
  });
});

describe('categoryReq', () => {
  it('카테고리별 요건 학점 매핑, 기타=0', () => {
    const d = deg();
    expect(categoryReq(d, '전공필수')).toBe(60);
    expect(categoryReq(d, '전공선택')).toBe(30);
    expect(categoryReq(d, '교양')).toBe(30);
    expect(categoryReq(d, '기타')).toBe(0);
  });
});

describe('requirementRows', () => {
  it('요건 대비 이수·남은·충족 여부', () => {
    const rows = requirementRows(deg(), DS);
    const req = rows.find((r) => r.cat === '전공필수')!;
    expect(req.req).toBe(60);
    expect(req.have).toBe(6);
    expect(req.gap).toBe(54);
    expect(req.met).toBe(false);
    // 기타는 요건 없음 → 항상 충족.
    const etc = rows.find((r) => r.cat === '기타')!;
    expect(etc.req).toBe(0);
    expect(etc.met).toBe(true);
  });

  it('요건 이상 이수하면 met=true·gap=0', () => {
    const rows = requirementRows(deg({ reqMajorReq: 5 }), DS); // ⚠ `, DS` 누락(같은 파일 :105 의 관용구)
    const req = rows.find((r) => r.cat === '전공필수')!;
    expect(req.have).toBe(6);
    expect(req.met).toBe(true);
    expect(req.gap).toBe(0);
    expect(req.pct).toBe(100);
  });
});

describe('retakeCandidates', () => {
  it('C+ 이하 이수 과목만, F는 필수·나쁜 성적 우선', () => {
    const r = retakeCandidates(deg(), DS);
    expect(r.map((x) => x.name)).toEqual(['반도체', '통신']); // F(0) 먼저, C+(2.5) 다음
    expect(r[0]!.mandatory).toBe(true); // F
    expect(r[1]!.mandatory).toBe(false); // C+
    // A+·P·수강중·예정은 제외.
    expect(r.some((x) => x.name === '미적분학')).toBe(false);
  });

  it('모두 C+ 초과면 빈 배열', () => {
    const clean = deg({
      semesters: [
        {
          id: 's',
          name: 's',
          courses: [{ id: 'a', name: 'A', credits: 3, category: '교양', status: '완료', grade: 'B+' }],
        },
      ],
    });
    expect(retakeCandidates(clean, DS)).toEqual([]);
  });
});

describe('semesterGpa', () => {
  it('완료·점수 있는 성적만 가중평균(P·수강중·예정 제외)', () => {
    const sem = deg().semesters[0]!;
    // (4.5*3 + 0*3 + 2.5*3) / 9 — P(2학점)·수강중·예정 제외, 전체 GPA와 동일 규칙.
    expect(semesterGpa(sem, DS)).toBeCloseTo(21 / 9, 5);
  });

  it('성적 매겨진 완료 과목이 없으면 null(성적 없는 학기)', () => {
    expect(semesterGpa({ id: 'x', name: 'x', courses: [] }, DS)).toBeNull();
    // 이수(P)만 있는 학기도 gradedCr=0 → null.
    expect(
      semesterGpa(
        {
          id: 'y',
          name: 'y',
          courses: [{ id: 'a', name: 'A', credits: 2, category: '교양', status: '완료', grade: 'P' }],
        },
        DS,
      ),
    ).toBeNull();
    // 수강중만 있는 학기도 null.
    expect(
      semesterGpa(
        {
          id: 'z',
          name: 'z',
          courses: [{ id: 'b', name: 'B', credits: 3, category: '교양', status: '수강중', grade: '' }],
        },
        DS,
      ),
    ).toBeNull();
  });

  it('학기 GPA는 전체 GPA와 독립(학기별 추세 신호)', () => {
    const a = semesterGpa(
      {
        id: 'a',
        name: 'a',
        courses: [{ id: 'c1', name: 'X', credits: 3, category: '교양', status: '완료', grade: 'A+' }],
      },
      DS,
    );
    const b = semesterGpa(
      {
        id: 'b',
        name: 'b',
        courses: [{ id: 'c2', name: 'Y', credits: 3, category: '교양', status: '완료', grade: 'B0' }],
      },
      DS,
    );
    expect(a).toBeCloseTo(4.5, 5);
    expect(b).toBeCloseTo(3.0, 5);
  });
});

describe('semesterStat', () => {
  /* ⚠⚠ **이 케이스가 새 모델의 정의를 잠근다**: 학기는 한 상태이므로 `done`·`inprog`·`planned`
     중 **정확히 하나만** 찬다. 종전엔 셋이 동시에 찼고(한 학기 안 혼재) 그래서 `phase` 를
     집계에서 역추론해야 했다 — 그 역추론이 «완료+예정이 섞인 학기가 future 로 떨어지는» 결함의
     출처였다. 이제 상태가 곧 국면이다. */
  it('학기 하나는 한 칸만 채운다 — 완료 학기', () => {
    const st = semesterStat(deg().semesters[0]!, DS);
    expect(st.tot).toBe(11); // 3+3+3+2
    expect(st.done).toBe(11);
    expect(st.inprog).toBe(0);
    expect(st.planned).toBe(0);
    expect(st.inprogCount).toBe(0);
    expect(st.phase).toBe('done');
    expect(st.pct).toBe(100); // 학기가 끝났으면 100 — 「몇 % 진행」은 주차가 답한다
  });

  it('수강중 학기는 inprog 만 찬다', () => {
    const st = semesterStat(deg().semesters[1]!, DS);
    expect(st.tot).toBe(3);
    expect(st.inprog).toBe(3);
    expect(st.done).toBe(0);
    expect(st.inprogCount).toBe(1);
    expect(st.phase).toBe('current');
    expect(st.pct).toBe(0);
  });

  it('phase 는 학기 상태를 그대로 옮긴다', () => {
    expect(semesterStat({ id: 'd', name: 'd', status: '완료', courses: [] }, DS).phase).toBe('done');
    expect(semesterStat({ id: 'f', name: 'f', status: '예정', courses: [] }, DS).phase).toBe('future');
  });

  /* ⭐ 철회 — 상태 축과 **직교**다. 학점·GPA 어디에도 안 들지만 과목은 남는다. */
  it('철회한 과목은 학점에 안 들지만 기록은 남는다', () => {
    const sem = {
      id: 'x',
      name: 'x',
      status: '완료',
      courses: [
        { id: 'a', name: '들은 것', credits: 3, category: '교양', grade: 'A0' },
        { id: 'b', name: '철회한 것', credits: 3, category: '교양', grade: '', dropped: true },
      ],
    };
    expect(semesterStat(sem, DS).tot).toBe(3); // 철회분 3 제외
    expect(semesterGpa(sem, DS)).toBeCloseTo(4.0, 5); // 철회분이 GPA 를 안 깎는다
    expect(sem.courses).toHaveLength(2); // ⚠ 지운 게 아니다
  });
});

describe('semesterStatus — 날짜가 정본이고, 나머지는 폴백이다', () => {
  const 과목 = [{ id: 'a', name: 'A', credits: 3, category: '교양', grade: '' }];

  it('① 날짜가 있으면 날짜가 답한다 — 그리고 status 를 이긴다', () => {
    const 지남 = { id: '1', name: '1', startDs: '2026-03-02', endDs: '2026-06-14', courses: 과목 };
    const 중 = { id: '2', name: '2', startDs: '2026-06-01', endDs: '2026-08-30', courses: 과목 };
    const 앞 = { id: '3', name: '3', startDs: '2026-09-01', courses: 과목 };
    expect(semesterStatus(지남, DS)).toBe('완료');
    expect(semesterStatus(중, DS)).toBe('수강중');
    expect(semesterStatus(앞, DS)).toBe('예정');
    // ⭐ 어긋난 status 가 있어도 날짜가 이긴다 — 그래야 「정본이 둘」이 다시 안 생긴다.
    expect(semesterStatus({ ...지남, status: '수강중' }, DS)).toBe('완료');
  });

  it('② 날짜가 없으면 옮겨 담은 status 가 답한다 — 종강일이 없는 학기는 계속 수강중이다', () => {
    expect(semesterStatus({ id: 'x', name: 'x', status: '완료', courses: 과목 }, DS)).toBe('완료');
    expect(semesterStatus({ id: 'y', name: 'y', startDs: '2026-06-01', courses: 과목 }, DS)).toBe('수강중');
  });

  it('③ 날짜도 status 도 없으면 성적 유무가 답한다', () => {
    const 성적있음 = [{ id: 'a', name: 'A', credits: 3, category: '교양', grade: 'B0' }];
    expect(semesterStatus({ id: 'p', name: 'p', courses: 성적있음 }, DS)).toBe('완료');
    expect(semesterStatus({ id: 'q', name: 'q', courses: 과목 }, DS)).toBe('예정');
    expect(semesterStatus({ id: 'r', name: 'r', courses: [] }, DS)).toBe('예정'); // 빈 학기
  });
});

describe('gpaForecast', () => {
  /* 픽스처: 이수 11(3+3+3+2) · gradedCr 9(P 2 제외) · curPts 21 · 입력해 둔 앞으로 6(수강중3+예정3)
     · targetTotal 130 → **졸업까지 남은 119**. 분모는 max(119, 6) = 119 다(입력을 덜 했다고
     목표가 불가능해지지 않는다 — `lib/degree.gpaForecast` 머리주석). */
  it('분모는 졸업까지 남은 학점이다 — 입력해 둔 학점이 아니라', () => {
    const f = gpaForecast(deg(), 3.5, DS);
    expect(f.gapCr).toBe(119);
    expect(f.plannedCr).toBe(6);
    expect(f.futureCr).toBe(119);
    expect(f.neededAvg).toBeCloseTo((3.5 * (9 + 119) - 21) / 119, 5); // 3.588…
    expect(f.feasible).toBe(true);
    expect(f.alreadyMet).toBe(false);
  });

  /* ⚠⚠ 회귀 — **이 케이스가 사용자 신고 그 자체다**(2026-08-31).
     옛 분모(입력해 둔 18)로는 필요평점 5.86 → "만점으로도 도달 어려움" 이라 **달성 가능한 목표를
     불가능하다고 보고**했다. 화면 네 줄 위 게이지는 같은 순간 「남은 43」을 띄우고 있었다. */
  it('입력을 덜 해도 목표를 불가능하다고 말하지 않는다(신고 재현: 85/128 · 앞으로 18 · 3.0→3.5)', () => {
    const 신고 = deg({
      targetTotal: 128,
      semesters: [
        {
          id: 'done',
          name: '이수 완료',
          // 85학점 · 전량 B0(3.0) → gradedCr 85 · curPts 255 · gpa 3.0
          courses: [{ id: 'a', name: '이수분', credits: 85, category: '전공필수', status: '완료', grade: 'B0' }],
        },
        {
          id: 'next',
          name: '다음',
          courses: [{ id: 'b', name: '예정분', credits: 18, category: '전공선택', status: '예정' }],
        },
      ],
    });
    const f = gpaForecast(신고, 3.5, DS);
    expect(f.gapCr).toBe(43); // 게이지의 「남은 학점」과 **같은 수**여야 한다
    expect(f.plannedCr).toBe(18);
    expect(f.futureCr).toBe(43);
    expect(f.neededAvg).toBeCloseTo((3.5 * 128 - 255) / 43, 5); // 4.488…
    expect(f.feasible).toBe(true); // 옛 계산은 5.86 으로 false 였다
  });

  it('졸업요건을 넘겨 입력했으면 그 초과분이 분모다(둘 중 큰 쪽)', () => {
    const 초과 = deg({
      targetTotal: 10,
      semesters: [
        {
          id: 's-done',
          name: '지난',
          status: '완료',
          courses: [{ id: 'a', name: 'A', credits: 6, category: '교양', grade: 'B0' }],
        },
        {
          id: 's-next',
          name: '다음',
          status: '예정',
          courses: [{ id: 'b', name: 'B', credits: 20, category: '교양' }],
        },
      ],
    });
    const f = gpaForecast(초과, 3.0, DS);
    expect(f.gapCr).toBe(4); // 10 − 6
    expect(f.plannedCr).toBe(20);
    expect(f.futureCr).toBe(20);
  });

  it('달성 불가한 목표는 feasible false', () => {
    // 이수 11/130 · gradedCr 9 · curPts 21 · 분모 119 → 4.5 초과가 되려면 목표가 매우 높아야 한다.
    const f = gpaForecast(deg(), 4.5, DS);
    expect(f.neededAvg).toBeCloseTo((4.5 * (9 + 119) - 21) / 119, 5); // 4.66…
    expect(f.feasible).toBe(false);
  });

  it('이미 목표 이상이면 alreadyMet true', () => {
    const f = gpaForecast(deg(), 2.0, DS); // 현재 2.333 ≥ 2.0
    expect(f.alreadyMet).toBe(true);
  });

  it('졸업요건을 다 채웠고 남은 입력도 없으면 neededAvg=null(더 못 바꿈)', () => {
    const allDone = deg({
      targetTotal: 3, // 이수 3 = 요건 3 → 남은 0
      semesters: [
        {
          id: 's',
          name: 's',
          courses: [{ id: 'a', name: 'A', credits: 3, category: '교양', status: '완료', grade: 'A0' }],
        },
      ],
    });
    const f = gpaForecast(allDone, 4.0, DS);
    expect(f.gapCr).toBe(0);
    expect(f.plannedCr).toBe(0);
    expect(f.futureCr).toBe(0);
    expect(f.neededAvg).toBeNull();
  });
});

/* 세 화면(상단 리드아웃·요건 탭·학기 로드맵)이 각자 인라인으로 계산하다 둘만 클램프가 없어,
   초과이수에서 한쪽은 108% 다른 쪽은 100% 를 말했다. 정의를 하나로 모은 자리. */
describe('progressPct — 졸업 진행률의 단일 정의', () => {
  // 공용 픽스처의 이수(완료) 학점은 11 — 목표만 갈아 끼워 세 경우를 만든다.
  it('초과이수를 자르지 않는다 — 자르면 "얼마나 넘겼나"가 사라진다', () => {
    expect(progressPct(deg({ targetTotal: 10 }), DS)).toBe(110);
  });

  it('평범한 경우', () => {
    expect(progressPct(deg({ targetTotal: 22 }), DS)).toBe(50);
  });

  it('목표가 0이면 0 — 0으로 나누지 않는다', () => {
    expect(progressPct(deg({ targetTotal: 0 }), DS)).toBe(0);
  });
});

/* ============================================================
   ⭐⭐ 마이그레이션 — **옛 과목 상태가 학기로 옮겨지며 학점을 잃지 않는다**

   이 개편의 유일한 데이터 위험이 여기 있었다: 성적을 **안 넣고 「완료」로만 찍어 둔 학기**가
   흔한데(사용자 신고 케이스가 정확히 그랬다 — 「이수 완료」 학기에 85학점), 파생 규칙 ③
   (성적이 다 있으면 완료)만으로는 그 학기가 «예정» 이 되어 **이수 학점이 통째로 증발한다.**
============================================================ */
describe('migrateSemesterStatus — 무손실', () => {
  const 옛저장 = () => ({
    degree: {
      semesters: [
        {
          id: 'old',
          name: '이수 완료',
          // ⚠ 성적이 **하나도 없다** — 사용자가 상태만 찍어 둔 흔한 형태
          courses: [
            { id: 'a', name: 'A', credits: 60, category: '전공필수', status: '완료' },
            { id: 'b', name: 'B', credits: 25, category: '교양', status: '완료' },
          ],
        },
        {
          id: 'now',
          name: '이번',
          courses: [{ id: 'c', name: 'C', credits: 18, category: '전공선택', status: '수강중' }],
        },
      ],
    },
  });

  it('성적 없이 「완료」로만 찍힌 85학점이 살아남는다 — 이게 없으면 통째로 증발한다', () => {
    const s = 옛저장() as unknown as Record<string, unknown>;
    migrateSemesterStatus(s);
    const d = (s.degree as Degree & { semesters: { status?: string }[] }).semesters;
    expect(d[0]!.status).toBe('완료');
    expect(d[1]!.status).toBe('수강중');
    // 마이그레이션 **뒤** 집계가 옛 모델과 같은 답을 낸다.
    const stats = degreeStats(s.degree as Degree, DS);
    expect(stats.earned).toBe(85);
    expect(stats.inprog).toBe(18);
  });

  /* ⚠⚠ **이 케이스가 이 개편에서 가장 중요하다.**
     처음 구현은 롤업을 마이그레이션에만 뒀는데, 셸·폰의 정본은 SQLite 이고 `db/boot.ts` 는
     `rowsToState()` 로 DB JSON 에서 곧장 상태를 만든다 — **그 경로에 `migrate()` 호출이 0건**이다.
     즉 마이그레이션만 믿었으면 **기존 셸 사용자 전원의 이수 학점이 사라졌을 것**이다.
     그래서 판정을 `semesterStatus` ③ 으로 내렸고, 이 케이스가 그것을 잠근다. */
  it('⭐ 마이그레이션을 **안 돌려도** 학점이 살아 있다 — 저장 경로가 셋이라 읽는 자리가 답해야 한다', () => {
    const s = 옛저장(); // 롤업을 일부러 안 돌린 날것
    const stats = degreeStats(s.degree as Degree, DS);
    expect(stats.earned).toBe(85);
    expect(stats.inprog).toBe(18);
  });

  it('마이그레이션은 정규화일 뿐 — 돌리든 안 돌리든 집계가 같다', () => {
    const 안돌림 = degreeStats(옛저장().degree as Degree, DS);
    const s = 옛저장() as unknown as Record<string, unknown>;
    migrateSemesterStatus(s);
    expect(degreeStats(s.degree as Degree, DS)).toEqual(안돌림);
  });

  it('멱등이다 — 매 로드마다 돌아도 값이 안 바뀐다', () => {
    const s = 옛저장() as unknown as Record<string, unknown>;
    migrateSemesterStatus(s);
    const 첫판 = JSON.stringify(s);
    migrateSemesterStatus(s);
    expect(JSON.stringify(s)).toBe(첫판);
  });

  it('⛔ 날짜가 있는 학기는 건드리지 않는다 — 날짜가 정본이므로 심으면 낡은 값이 된다', () => {
    const s = {
      degree: {
        semesters: [
          {
            id: 'dated',
            name: '날짜 있음',
            startDs: '2026-03-02',
            endDs: '2026-06-14',
            courses: [{ id: 'a', name: 'A', credits: 3, category: '교양', status: '수강중' }],
          },
        ],
      },
    } as unknown as Record<string, unknown>;
    migrateSemesterStatus(s);
    expect((s.degree as { semesters: { status?: string }[] }).semesters[0]!.status).toBeUndefined();
  });

  it('사람이 정한 status 를 덮지 않는다', () => {
    const s = {
      degree: {
        semesters: [
          {
            id: 'x',
            name: 'x',
            status: '예정',
            courses: [{ id: 'a', name: 'A', credits: 3, category: '교양', status: '완료' }],
          },
        ],
      },
    } as unknown as Record<string, unknown>;
    migrateSemesterStatus(s);
    expect((s.degree as { semesters: { status?: string }[] }).semesters[0]!.status).toBe('예정');
  });

  it('⚠ 옛 `c.status` 를 지우지 않는다 — 지우면 되돌릴 근거가 사라진다(강등 ≠ 제거)', () => {
    const s = 옛저장() as unknown as Record<string, unknown>;
    migrateSemesterStatus(s);
    const c = (s.degree as { semesters: { courses: { status?: string }[] }[] }).semesters[0]!.courses[0]!;
    expect(c.status).toBe('완료');
  });
});
