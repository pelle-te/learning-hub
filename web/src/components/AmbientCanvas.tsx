/* ============================================================
   AmbientCanvas — WebGL 오로라 배경(앰비언트). 풀스크린 프래그먼트 셰이더가 테마 액센트 색을
   fbm 노이즈로 흘려 "비싼" 깊이를 만든다. 콘텐츠 뒤(z-1)·포인터 무시.
   안전장치: WebGL 없으면 CSS 그라데이션 폴백 · 저해상도(0.6x)+30fps 캡 · 탭 숨김/reduced-motion 시 정지.
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
  vec3 col = u_bg;
  col += u_c1 * smoothstep(0.45, 0.95, n1) * 0.42;
  col += u_c2 * smoothstep(0.50, 0.97, n2) * 0.34;
  col += u_c3 * smoothstep(0.45, 0.92, n3) * 0.34;
  gl_FragColor = vec4(col, 1.0);
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
    let last = 0;
    const FRAME = 1000 / 30; // 30fps 캡.
    const draw = (ms: number) => {
      raf = requestAnimationFrame(draw);
      if (ms - last < FRAME) return;
      last = ms;
      gl.uniform1f(uTime, ms / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const drawOnce = () => {
      gl.uniform1f(uTime, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      if (reduce.matches || document.hidden) {
        drawOnce();
        return;
      }
      last = 0;
      raf = requestAnimationFrame(draw);
    };

    const onResize = () => {
      resize();
      if (reduce.matches || document.hidden) drawOnce();
    };
    const onVisible = () => start();
    const onTheme = () => {
      setColors();
      if (reduce.matches || document.hidden) drawOnce();
    };

    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisible);
    reduce.addEventListener('change', start);
    // 테마(data-theme) 변동 → 색 유니폼 갱신.
    const mo = new MutationObserver(onTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent'] });

    start();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisible);
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
