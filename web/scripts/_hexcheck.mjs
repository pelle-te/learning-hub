/* ── ⑨ TS 문자열 속 **생 hex** — 색은 저장값이 아니다(V032 · 2026-08-22 코드 축 실행) ──────

   ## 무엇이 비어 있었나

   절대규칙 #3 은 *"색 = 파생물(저장값 아님) · 임의 하드코딩 금지"* 이고, CSS 쪽은 stylelint 가
   생 hex 를 막는다. 그런데 **TS 문자열 속 hex 는 어느 집행자도 안 봤다**: stylelint 는 `.css`
   만 보고, 위 §① 은 `var(--x)` 참조만 훑는다. 실측하면 살아 있는 리터럴이 두 파일에 있었다.

   ## 왜 「폴백이니까 괜찮다」가 아닌가

   `lib/ledger.ts:51-63` 이 그 논거를 이미 기각했다: *"폴백을 되살리지 말 것 … 2026-07-30 감사
   실측: 남아 있던 폴백 14건의 **값이 전부 틀렸다** … 유지되지 않는 죽은 값이면서, 오타가 나면
   그 죽은 값으로 조용히 렌더된다."* 그 사고(`--panel-2` 하이픈 오타)가 라이트 테마에서
   **의미 역전**을 몇 달 살렸다.

   JS 쪽 폴백도 **같은 형태**다 — `getPropertyValue('--bg')` 가 빈 문자열을 주는 유일한 실제
   조건이 «그 토큰이 없다» 이고, 그때 hex 로 조용히 그려진다.

   ## 그래서 지금 무엇을 하나 — 지우지 않고 **원장에 올린다**

   두 자리는 «지운다»가 옳은지가 **별개 판단**이다(지우면 실패가 시끄러워지는 대신 `theme-color`
   가 빈 문자열이 되고 스와치가 색을 잃는다). 그건 사용자·다음 리뷰 회차의 몫이라 여기서는
   **새로 생기는 것만 막고** 기존 둘은 사유+만료일로 잠근다(SCA·a11y 원장과 같은 규율).
   ⚠ 만료일이 지나면 게이트가 깨진다 — 유효기간 없는 예외는 판단이 아니라 방치다.

   ⚠ 주석은 안 본다(`주석제거`) — 근거에 옛 hex 를 인용하는 것이 위반이 되면 그건 이 저장소가
   다섯 번 못박은 역인센티브다(실측: 매치 대부분이 «그때 그 값이 틀렸다»를 적는 주석이었다).
   ⚠ `styles/` 는 대상 밖이다 — 토큰의 **정의**가 사는 곳이고 거기 hex 가 있는 것이 정상이다. */
const hex원장 = [
  {
    파일: 'app/ThemeProvider.tsx',
    사유: 'theme-color 메타의 `--bg` 읽기 폴백. 지우면 토큰 소실 시 content="" 로 떨어져 OS 기본 크롬이 된다 — 지울지는 별개 판단(V033)',
    만료: '2026-11-30',
  },
  {
    파일: 'features/settings/Settings.tsx',
    사유: '액센트 스와치의 `--acc` 읽기 폴백(4색). 같은 판단 대기 — 불변식 ④가 토큰 존재를 이미 게이트에서 잡는다',
    만료: '2026-11-30',
  },
];

/** 문자열/템플릿 안의 `#rgb`~`#rrggbbaa`. 주석은 이미 걷힌 본문을 받는다. */
const hex패턴 = /['"`]#[0-9a-fA-F]{3,8}\b/;

export function 생hex검사(파일목록, 읽기, 주석제거, 정규화) {
  const 위반 = [];
  for (const p of 파일목록) {
    if (!/\.(ts|tsx)$/.test(p)) continue;
    const 상대 = 정규화(p);
    if (상대.startsWith('styles/')) continue;
    const 본문 = 주석제거(읽기(p));
    if (!hex패턴.test(본문)) continue;
    위반.push(상대);
  }
  const 원장파일 = new Set(hex원장.map((r) => r.파일));
  const 새것 = 위반.filter((p) => !원장파일.has(p));
  const 만료된 = hex원장.filter((r) => new Date(r.만료) < new Date());
  const 사문화 = hex원장.filter((r) => !위반.includes(r.파일));

  if (새것.length || 만료된.length || 사문화.length) {
    for (const p of 새것) {
      console.error(`✗ TS 문자열에 생 hex: ${p}`);
    }
    if (새것.length) {
      console.error(
        '\n  절대규칙 #3 — 색은 파생물이다. 토큰(`var(--x)`)을 쓰거나, 폴백이 꼭 필요하면\n' +
          '  사유+만료일과 함께 `scripts/_hexcheck.mjs` 의 원장에 올리세요.\n' +
          '  ⚠ `var(--x, #hex)` 형태는 **되살리지 마세요** — `lib/ledger.ts` 가 그 사고의 기록입니다.',
      );
    }
    for (const r of 만료된) console.error(`✗ hex 원장 만료: ${r.파일}(만료 ${r.만료}) — 다시 판단할 때다.`);
    for (const r of 사문화)
      console.error(`✗ hex 원장 사문화: ${r.파일} — 생 hex 가 사라졌다. 원장에서 빼세요(그래야 되돌아오면 잡힌다).`);
    return { ok: false, 원장: hex원장.length };
  }
  return { ok: true, 원장: hex원장.length };
}
