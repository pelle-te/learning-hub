/* 블록 4단계 흐름(학습방법론 2절) — [이름, 시작%, 끝%, 핵심행동]. */
export interface BlockStage {
  name: string;
  start: number;
  end: number;
  action: string;
}

export const BLOCK_STAGES: BlockStage[] = [
  { name: '① 개념 정찰', start: 0, end: 15, action: '정독 아닌 정찰 — 핵심 정의·"왜 이걸 해석하나"로 큰 그림만' },
  {
    name: '② 예제·풀이',
    start: 15,
    end: 78,
    action: '블록의 본체. 스스로 먼저 → 막히면 70% 룰(단계적 힌트). 막힌 좌표 메모',
  },
  { name: '③ 핵심 스케치', start: 78, end: 85, action: '선택 — 까다로운 1~2개만 책 덮고 이중부호화 스케치' },
  { name: '④ 3문장 요약', start: 85, end: 100, action: '보지 않고 내 언어로 3줄(What&Why / How / Result&Meaning)' },
];

/** 학습 5원리 칩 — [이름, 한 줄]. */
export const PRINCIPLES: [string, string][] = [
  ['능동 인출', '덮고 떠올린다'],
  ['분산', '시간을 벌려 다시 만난다'],
  ['인터리빙', '유형을 섞어 푼다'],
  ['이중부호화', '그림+수식 동시에'],
  ['메타인지', '어디서 왜 막히는지 안다'],
];
