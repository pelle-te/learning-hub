/* ============================================================
   AmbientCanvas — WebGL 오로라 배경(앰비언트). 풀스크린 프래그먼트 셰이더가 테마 액센트 색을
   fbm 노이즈로 흘려 "비싼" 깊이를 만든다. 콘텐츠 뒤(z-1)·포인터 무시.
   안전장치: WebGL 없으면 CSS 그라데이션 폴백 · 저해상도(0.6x)+12fps 캡 · 탭 숨김/reduced-motion 시 정지.
   순수 표현(외부 상태 없음). 테마 변경은 data-theme 변동을 관찰해 색 유니폼만 갱신.

   ⚠⚠ **컨텍스트 손실은 "일어날 수도 있는 일"이 아니라 관측된 일이다**(H19 · 2026-08-01).
   사용자 PC 에서 화면이 한 번씩 검게 꺼진다 — Windows TDR(디스플레이 드라이버 타임아웃 리셋)이고,
   그 순간 살아 있던 WebGL 컨텍스트는 **전부** 죽는다. sleep/resume·드라이버 업데이트·GPU 전환도
   같은 결과를 낸다. 종전 코드에는 전 저장소를 통틀어 `webglcontextlost` 핸들러가 **0개**였고,
   그래서 그 뒤 벌어지는 일은:
     ① 캔버스가 투명해져 **배경이 영구히 빈 채로 남는다**(앱을 껐다 켜야 돌아온다)
     ② `drawArrays` 는 조용한 no-op 이 되는데 **12fps 루프는 계속 돈다** — 아무것도 안 그리며
     ③ 정지 프레임 게이트는 이걸 **원리적으로 못 본다**(스냅샷은 손실 전 프레임을 찍는다)
   → 셋 다 닫는다. `preventDefault()` 가 **복구의 전제조건**이다(안 부르면 브라우저는
   `webglcontextrestored` 를 영원히 안 쏜다).

   ⚠ **손실 예산이 있다**(`MAX_LOSS`). 무한 복구는 틀린 처방이다 — 드라이버가 반복 리셋되는
   기계에서 앱 최대 상시 부하(풀스크린 프래그먼트 셰이더)를 매번 다시 세우는 것은 리셋을
   *다시 유발할* 쪽에 가깝다. 예산을 넘기면 **영구히 CSS 폴백**으로 내려가 GPU 를 더는 건드리지
   않는다. 즉 이 컴포넌트의 실패 모드는 "빈 화면"이 아니라 "덜 화려한 배경"이다.
============================================================ */
import { prefersReducedMotion } from '@/lib/motion';
import { useEffect, useRef } from 'react';

const FALLBACK_BG =
  'radial-gradient(38% 38% at 22% 26%, color-mix(in srgb, var(--acc) 16%, transparent), transparent 72%),' +
  'radial-gradient(34% 34% at 80% 70%, color-mix(in srgb, var(--acc2) 12%, transparent), transparent 72%),' +
  'radial-gradient(42% 40% at 64% 6%, color-mix(in srgb, var(--violet) 12%, transparent), transparent 72%)';

const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

// fbm 노이즈로 액센트 글로우 3겹을 딥 베이스 위에 흘린다(은은하게).
const FRAG = `precision highp float;
uniform vec2 u_res; uniform float u_time;
uniform vec3 u_bg, u_c1, u_c2, u_c3;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbm(vec2 p){
  // 5 octave 고정 — 4로 줄이면 mastery 탭(어두운 빈 영역에 배경이 비침)에서 비주얼 스냅샷이
  // 4% 틀어진다(2% 게이트 초과). 즉 octave 축소는 "외형 불변"이 아니라 채택 불가. 부담 절감은
  // fps 캡(12)·포커스 밖 정지로만 — 이 둘은 정지프레임을 안 바꿔 스냅샷 동치(40/40 통과).
  float v = 0.0, amp = 0.5;
  for(int i = 0; i < 5; i++){ v += amp * noise(p); p *= 2.02; amp *= 0.5; }
  return v;
}
void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = uv; p.x *= u_res.x / u_res.y;
  float t = u_time * 0.025;
  float n1 = fbm(p * 1.15 + vec2(t, t * 0.6));
  float n2 = fbm(p * 1.55 + vec2(-t * 0.7, t * 0.45) + 5.3);
  float n3 = fbm(p * 0.95 + vec2(t * 0.5, -t * 0.55) + 12.7);
  float w1 = smoothstep(0.45, 0.95, n1) * 0.42;
  float w2 = smoothstep(0.50, 0.97, n2) * 0.34;
  float w3 = smoothstep(0.45, 0.92, n3) * 0.34;
  vec3 glow = u_c1 * w1 + u_c2 * w2 + u_c3 * w3;
  float wsum = w1 + w2 + w3;
  // 세로(모바일) 화면 감쇠 — 좁은 뷰포트는 노이즈의 좁은 슬라이스만 보게 돼 글로우장이 겹쳐
  // 가산 블로우아웃(헤더가 하얗게 타버림). 가로(aspect>=1.15)는 1.0 그대로 = 데스크톱 픽셀 불변.
  float aspect = u_res.x / u_res.y;
  float att = mix(0.30, 1.0, smoothstep(0.75, 1.15, aspect));
  glow *= att; wsum *= att;
  /* 가산 합성은 밝은 캔버스에서 색을 지운다(라이트 테마).
     u_bg + glow 는 딥블랙(약 0.02)에서는 정확히 원하는 것 — 어둠 위에 빛을 더한다. 그런데
     라이트의 --bg 는 #fafbfc(약 0.98)라 어느 채널이든 곧장 1.0 으로 클램프되고, 남는 것은
     색상(hue)이 사라진 흰 반점이다(전이 밴드에선 라임의 G 만 살아 옅은 올리브 캐스트가 뜬다).
     즉 원칙 1(단일 네온)이 라이트에서 무채색으로 붕괴해 있었다.
     tokens.css 는 이걸 이미 알고 있었다 — 라이트 블록이 --acc-soft·--glow 를 크게 눌러 두고
     "흰 패널 위 오로라가 올리브빛 얼룩으로 번지지 않게" 라 적었다. 그런데 셰이더는 그 파생을
     안 쓰고 생 --acc 를 읽는 유일한 소비처라 그 방어를 통째로 비껴갔다.
     → 밝은 배경에서는 가산이 아니라 혼합(mix)으로 — 배경을 색 쪽으로 당기면 hue 가 산다.
     분기하는 것이 요점이다: 가산은 어두운 캔버스에선 옳다. 다크까지 혼합으로 바꾸면 결과가
     -u_bg*wsum 만큼 미세하게 달라져 다크 스냅샷 44장을 이유 없이 태운다. 고칠 것은 밝은
     배경이지 합성 방식 자체가 아니다. 판정은 배경 휘도 하나로 한다(테마 유니폼을 새로 넘기지
     않는다 — 이미 있는 값으로 답할 수 있으면 새 입력을 만들지 않는다). */
  vec3 tint = wsum > 0.0001 ? glow / wsum : u_bg;
  float lum = dot(u_bg, vec3(0.2126, 0.7152, 0.0722));
  vec3 lit = mix(u_bg, tint, clamp(wsum, 0.0, 1.0));
  gl_FragColor = vec4(mix(u_bg + glow, lit, step(0.5, lum)), 1.0);
}`;

function hexToRgb(s: string): [number, number, number] | null {
  const h = s.trim().replace('#', '');
  if (h.length === 3) {
    const r = parseInt(h[0]! + h[0]!, 16);
    const g = parseInt(h[1]! + h[1]!, 16);
    const b = parseInt(h[2]! + h[2]!, 16);
    return [r / 255, g / 255, b / 255];
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return [r / 255, g / 255, b / 255];
  }
  return null;
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

/* 컴파일·링크·버퍼·유니폼 위치를 한 번에 세운다. **컨텍스트 손실 후 복구가 이 함수를 그대로 다시
   부른다** — 그래서 초기화가 효과 본문에 흩어져 있으면 안 된다(종전 형태). GL 객체는 컨텍스트에
   묶여 있어 손실 시 전부 무효가 되므로, 재사용할 수 있는 것은 **소스 문자열뿐**이다. */
type Rig = {
  gl: WebGLRenderingContext;
  uRes: WebGLUniformLocation | null;
  uTime: WebGLUniformLocation | null;
  uBg: WebGLUniformLocation | null;
  uC1: WebGLUniformLocation | null;
  uC2: WebGLUniformLocation | null;
  uC3: WebGLUniformLocation | null;
};

function buildRig(canvas: HTMLCanvasElement): Rig | null {
  const gl = canvas.getContext('webgl', {
    antialias: false,
    alpha: false,
    depth: false,
    powerPreference: 'low-power',
  });
  if (!gl) return null;

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);

  // 풀스크린 트라이앵글.
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  return {
    gl,
    uRes: gl.getUniformLocation(prog, 'u_res'),
    uTime: gl.getUniformLocation(prog, 'u_time'),
    uBg: gl.getUniformLocation(prog, 'u_bg'),
    uC1: gl.getUniformLocation(prog, 'u_c1'),
    uC2: gl.getUniformLocation(prog, 'u_c2'),
    uC3: gl.getUniformLocation(prog, 'u_c3'),
  };
}

/* 복구 시도 상한. 1회면 TDR·resume 한 번은 넘기지만 반복 리셋 기계에서 루프가 된다. 2회로 두면
   "우연한 두 번"까지 흡수하고 세 번째부터는 원인이 우연이 아니라고 판정한다 — 그때 GPU 를
   놓는 것이 사용자에게 이롭다(위 머리주석). */
const MAX_LOSS = 2;

export default function AmbientCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    let rig = buildRig(canvas);
    // WebGL 미지원(또는 컴파일·링크 실패) → CSS 그라데이션 폴백.
    if (!rig) {
      canvas.style.background = FALLBACK_BG;
      return;
    }

    const SCALE = 0.6; // 내부 렌더 해상도(노이즈라 저해상도여도 부드러움 → GPU 부담↓).
    const setColors = () => {
      if (!rig) return;
      const { gl } = rig;
      const cs = getComputedStyle(document.documentElement);
      const bg = hexToRgb(cs.getPropertyValue('--bg')) || [0.02, 0.02, 0.024];
      const c1 = hexToRgb(cs.getPropertyValue('--acc')) || [0.6, 0.55, 1];
      const c2 = hexToRgb(cs.getPropertyValue('--acc2')) || [0.37, 0.85, 0.74];
      const c3 = hexToRgb(cs.getPropertyValue('--violet')) || [0.72, 0.58, 0.96];
      gl.uniform3fv(rig.uBg, bg);
      gl.uniform3fv(rig.uC1, c1);
      gl.uniform3fv(rig.uC2, c2);
      gl.uniform3fv(rig.uC3, c3);
    };
    const resize = () => {
      const w = Math.max(1, Math.floor(window.innerWidth * SCALE));
      const h = Math.max(1, Math.floor(window.innerHeight * SCALE));
      canvas.width = w;
      canvas.height = h;
      if (!rig) return;
      rig.gl.viewport(0, 0, w, h);
      rig.gl.uniform2f(rig.uRes, w, h);
    };
    setColors();
    resize();

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0;
    let timer = 0; // 12fps 예약 핸들 — RAF 콜백을 주사율만큼 깨우지 않기 위한 짝(아래 draw).
    // 12fps 캡 — 드리프트가 극도로 느려(t*0.025) 24fps와 시각적으로 무구분(스냅샷은 단일 프레임이라
    // 불변). 앱 최대 상시 비용(풀스크린 프래그먼트 셰이더)을 그대로 절반으로 낮춘다.
    const FRAME = 1000 / 12;
    // 정지 조건: 모션 비선호 · 탭 숨김 · 창 포커스 밖 · 발광효과끄기(data-fx=lite).
    // '창 포커스 밖'은 앱 모드 창이 다른 창 뒤에 있을 때(visibilitychange는 최소화/탭전환만 잡고 "뒤에 가림"은
    // 못 잡음) GPU를 계속 태우는 낭비를 막는다. lite는 사용자가 끈 경우 — 정적 프레임만 그리고 멈춘다.
    /* ⚠ 모션 자제 판정은 `lib/motion` 하나다(H19) — 여기서 두 이유(OS·`data-fx`)를 다시
       조립하면 그게 곧 사본이고, 사본이 갈리는 것이 H19 의 형태였다. `reduce`(MediaQueryList)는
       **변화를 듣기 위해서만** 남긴다(판정은 아래 한 줄이 한다). */
    const paused = () => prefersReducedMotion() || document.hidden || !document.hasFocus();
    /* ⚠ **다음 프레임을 `setTimeout` 으로 예약한다.** 예전엔 맨 앞에서 무조건 `requestAnimationFrame`
       을 걸고 그 뒤 `ms - last < FRAME` 으로 버렸다 — 그리기는 12회/초인데 **깨어나기는 디스플레이
       주사율만큼**(60~144회/초)이었다. 콜백 자체는 μs 급이라 체감은 없지만, 앱이 포커스를 쥔 내내
       도는 유일한 상시 루프라 유휴 전력에서는 공짜가 아니다.
       ⚠ 정지 프레임은 불변이다(그리는 시점·내용이 그대로) → 스냅샷 영향 0. */
    const draw = (ms: number) => {
      if (!rig) return; // 손실 중 — 루프를 되살리는 것은 restore 핸들러의 일이다.
      rig.gl.uniform1f(rig.uTime, ms / 1000);
      rig.gl.drawArrays(rig.gl.TRIANGLES, 0, 3);
      timer = window.setTimeout(() => {
        raf = requestAnimationFrame(draw);
      }, FRAME);
    };
    const drawOnce = () => {
      if (!rig) return;
      rig.gl.uniform1f(rig.uTime, 0);
      rig.gl.drawArrays(rig.gl.TRIANGLES, 0, 3);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      if (!rig) return; // ⚠ 손실 중엔 12fps 루프를 돌리지 않는다(종전의 "아무것도 안 그리며 도는" 상태).
      if (paused()) {
        drawOnce();
        return;
      }
      raf = requestAnimationFrame(draw);
    };

    const onResize = () => {
      resize();
      if (paused()) drawOnce();
    };
    const onTheme = () => {
      setColors();
      start(); // 색 갱신 후 모션 재평가(data-fx 토글 해제 시 재개, 설정 시 정지).
    };

    /* ⚠ **컨텍스트 손실·복구**(H19). 순서가 계약이다:
       ① `preventDefault()` — 이걸 안 부르면 브라우저는 `webglcontextrestored` 를 **영원히 안 쏜다**.
       ② 루프 정지 + `rig = null` — 손실된 컨텍스트의 GL 객체는 전부 무효다.
       ③ CSS 폴백을 **즉시** 켠다. `alpha:false` 라 살아 있을 땐 캔버스가 불투명해 이 배경을 가리고,
          손실되면 캔버스가 투명해지므로 같은 한 줄이 "정상 시 무해 · 손실 시 즉시 대체"를 겸한다.
       복구 쪽은 `buildRig` 를 다시 부르는 것이 전부다 — 그래서 초기화가 함수로 나와 있다. */
    let losses = 0;
    const onLost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      rig = null;
      losses += 1;
      canvas.style.background = FALLBACK_BG;
    };
    const onRestored = () => {
      // 예산 초과 — 여기서 멈추는 것이 처방이다(GPU 를 더 건드리지 않는다). 폴백은 이미 켜져 있다.
      if (losses > MAX_LOSS) return;
      rig = buildRig(canvas);
      if (!rig) return; // 복구했는데 다시 세우지 못함 → 폴백 유지.
      canvas.style.background = '';
      setColors();
      resize();
      start();
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', start);
    window.addEventListener('focus', start); // 창 포커스 복귀 → 모션 재개
    window.addEventListener('blur', start); //  창 포커스 상실 → 일시정지
    reduce.addEventListener('change', start);
    // data-theme/data-accent → 색 유니폼 갱신, data-fx(발광효과끄기) → 정지/재개.
    const mo = new MutationObserver(onTheme);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-accent', 'data-fx'],
    });

    start();

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      /* ⚠ 손실 리스너를 **먼저** 뗀다. 아래 `loseContext()` 는 진짜 `webglcontextlost` 를 쏘는데,
         언마운트 중에 그게 `onLost` 를 타면 이미 버린 클로저가 `losses` 를 올리고 폴백 배경을
         켠다(관측 불가한 부작용). 자발적 해제와 드라이버 사고는 같은 이벤트를 쓰므로 **구분은
         리스너를 떼는 순서로만** 할 수 있다. */
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', start);
      window.removeEventListener('focus', start);
      window.removeEventListener('blur', start);
      reduce.removeEventListener('change', start);
      mo.disconnect();
      const lose = rig?.gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: -1,
        pointerEvents: 'none',
        display: 'block',
      }}
    />
  );
}
