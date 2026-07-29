/* ============================================================
   AmbientCanvas — WebGL 오로라 배경(앰비언트). 풀스크린 프래그먼트 셰이더가 테마 액센트 색을
   fbm 노이즈로 흘려 "비싼" 깊이를 만든다. 콘텐츠 뒤(z-1)·포인터 무시.
   안전장치: WebGL 없으면 CSS 그라데이션 폴백 · 저해상도(0.6x)+12fps 캡 · 탭 숨김/reduced-motion 시 정지.
   순수 표현(외부 상태 없음). 테마 변경은 data-theme 변동을 관찰해 색 유니폼만 갱신.
============================================================ */
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

export default function AmbientCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', {
      antialias: false,
      alpha: false,
      depth: false,
      powerPreference: 'low-power',
    });
    // WebGL 미지원 → CSS 그라데이션 폴백.
    if (!gl) {
      canvas.style.background = FALLBACK_BG;
      return;
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) {
      canvas.style.background = FALLBACK_BG;
      return;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      canvas.style.background = FALLBACK_BG;
      return;
    }
    gl.useProgram(prog);

    // 풀스크린 트라이앵글.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, 'u_res');
    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uBg = gl.getUniformLocation(prog, 'u_bg');
    const uC1 = gl.getUniformLocation(prog, 'u_c1');
    const uC2 = gl.getUniformLocation(prog, 'u_c2');
    const uC3 = gl.getUniformLocation(prog, 'u_c3');

    const SCALE = 0.6; // 내부 렌더 해상도(노이즈라 저해상도여도 부드러움 → GPU 부담↓).
    const setColors = () => {
      const cs = getComputedStyle(document.documentElement);
      const bg = hexToRgb(cs.getPropertyValue('--bg')) || [0.02, 0.02, 0.024];
      const c1 = hexToRgb(cs.getPropertyValue('--acc')) || [0.6, 0.55, 1];
      const c2 = hexToRgb(cs.getPropertyValue('--acc2')) || [0.37, 0.85, 0.74];
      const c3 = hexToRgb(cs.getPropertyValue('--violet')) || [0.72, 0.58, 0.96];
      gl.uniform3fv(uBg, bg);
      gl.uniform3fv(uC1, c1);
      gl.uniform3fv(uC2, c2);
      gl.uniform3fv(uC3, c3);
    };
    const resize = () => {
      const w = Math.max(1, Math.floor(window.innerWidth * SCALE));
      const h = Math.max(1, Math.floor(window.innerHeight * SCALE));
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
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
    const paused = () =>
      reduce.matches ||
      document.hidden ||
      !document.hasFocus() ||
      document.documentElement.getAttribute('data-fx') === 'lite';
    /* ⚠ **다음 프레임을 `setTimeout` 으로 예약한다.** 예전엔 맨 앞에서 무조건 `requestAnimationFrame`
       을 걸고 그 뒤 `ms - last < FRAME` 으로 버렸다 — 그리기는 12회/초인데 **깨어나기는 디스플레이
       주사율만큼**(60~144회/초)이었다. 콜백 자체는 μs 급이라 체감은 없지만, 앱이 포커스를 쥔 내내
       도는 유일한 상시 루프라 유휴 전력에서는 공짜가 아니다.
       ⚠ 정지 프레임은 불변이다(그리는 시점·내용이 그대로) → 스냅샷 영향 0. */
    const draw = (ms: number) => {
      gl.uniform1f(uTime, ms / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      timer = window.setTimeout(() => {
        raf = requestAnimationFrame(draw);
      }, FRAME);
    };
    const drawOnce = () => {
      gl.uniform1f(uTime, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
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
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', start);
      window.removeEventListener('focus', start);
      window.removeEventListener('blur', start);
      reduce.removeEventListener('change', start);
      mo.disconnect();
      const lose = gl.getExtension('WEBGL_lose_context');
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
