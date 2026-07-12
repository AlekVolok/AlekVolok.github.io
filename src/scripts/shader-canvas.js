/**
 * <shader-canvas> — Shadertoy-compatible WebGL2 fragment shader canvas.
 *
 * Usage:
 *   <shader-canvas></shader-canvas>  with a  <script type="x-shader/fragment">
 *   child, or set the `fragment` property before it connects.
 *
 * The fragment source uses the Shadertoy entry point:
 *   void mainImage(out vec4 fragColor, in vec2 fragCoord)
 * with uniforms iTime, iResolution, iMouse provided.
 *
 * Rendering pauses automatically when the element leaves the viewport.
 */

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG_HEADER = `#version 300 es
precision highp float;
uniform vec3 iResolution;
uniform float iTime;
uniform vec4 iMouse;
out vec4 outColor;
`;

const FRAG_FOOTER = `
void main() {
  mainImage(outColor, gl_FragCoord.xy);
  outColor.a = 1.0;
}`;

class ShaderCanvas extends HTMLElement {
  constructor() {
    super();
    this._raf = 0;
    this._visible = false;
    this._start = performance.now();
    this._mouse = [0, 0, 0, 0];
    this._hoverActivity = 0;
    this._lastFrameTime = 0;
  }

  connectedCallback() {
    const src =
      this.fragment ??
      this.querySelector('script[type="x-shader/fragment"]')?.textContent;
    if (!src) return;

    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'width:100%;height:100%;display:block;';
    this.appendChild(this.canvas);

    const gl = this.canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      powerPreference: 'low-power',
    });
    if (!gl) {
      this.textContent = 'WebGL2 is not available in this browser.';
      return;
    }
    this.gl = gl;

    try {
      this._program = this._compile(gl, src);
    } catch (err) {
      console.error(`[shader-canvas] ${this.id || '(unnamed)'}:`, err.message);
      this.textContent = 'Shader failed to compile.';
      return;
    }

    gl.useProgram(this._program);
    this._uResolution = gl.getUniformLocation(this._program, 'iResolution');
    this._uTime = gl.getUniformLocation(this._program, 'iTime');
    this._uMouse = gl.getUniformLocation(this._program, 'iMouse');

    this._onPointer = (e) => {
      const r = this.canvas.getBoundingClientRect();
      const scale = this.canvas.width / r.width;
      const x = (e.clientX - r.left) * scale;
      const y = this.canvas.height - (e.clientY - r.top) * scale;
      if (e.buttons & 1) {
        this._mouse = [x, y, x, y];
      } else {
        this._mouse[0] = x;
        this._mouse[1] = y;
        this._mouse[2] = 0;
      }
      this._hoverActivity = 1;
    };
    // mouse="window" tracks the pointer page-wide, for backgrounds that sit
    // beneath other content and never receive pointer events themselves.
    this._pointerTarget =
      this.getAttribute('mouse') === 'window' ? window : this.canvas;
    this._pointerTarget.addEventListener('pointermove', this._onPointer);
    this._pointerTarget.addEventListener('pointerdown', this._onPointer);

    this._observer = new IntersectionObserver((entries) => {
      this._visible = entries[0].isIntersecting;
      if (this._visible) this._loop();
      else cancelAnimationFrame(this._raf);
    });
    this._observer.observe(this);
  }

  disconnectedCallback() {
    cancelAnimationFrame(this._raf);
    this._observer?.disconnect();
    this._pointerTarget?.removeEventListener('pointermove', this._onPointer);
    this._pointerTarget?.removeEventListener('pointerdown', this._onPointer);
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }

  _compile(gl, fragBody) {
    const make = (type, source) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(s));
      }
      return s;
    };
    const program = gl.createProgram();
    gl.attachShader(program, make(gl.VERTEX_SHADER, VERT));
    gl.attachShader(
      program,
      make(gl.FRAGMENT_SHADER, FRAG_HEADER + fragBody + FRAG_FOOTER)
    );
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program));
    }
    return program;
  }

  _loop = () => {
    if (!this._visible) return;
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Cap resolution so heavy raymarchers stay smooth on laptops.
    const maxDim = Number(this.getAttribute('max-dim')) || 1280;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0) {
      this._raf = requestAnimationFrame(this._loop);
      return;
    }
    const k = Math.min(1, maxDim / (Math.max(rect.width, rect.height) * dpr));
    const w = Math.round(rect.width * dpr * k);
    const h = Math.round(rect.height * dpr * k);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      gl.viewport(0, 0, w, h);
    }

    const now = performance.now();
    const dt = this._lastFrameTime ? (now - this._lastFrameTime) / 1000 : 0;
    this._lastFrameTime = now;
    // Decay hover activity back to 0 a couple seconds after the pointer stops
    // moving, so mouse-reactive effects (e.g. hero stars) ease back to rest.
    this._hoverActivity = Math.max(0, this._hoverActivity - dt / 2);

    gl.uniform3f(this._uResolution, w, h, 1);
    gl.uniform1f(this._uTime, (now - this._start) / 1000);
    gl.uniform4f(
      this._uMouse,
      this._mouse[0],
      this._mouse[1],
      this._mouse[2],
      this._hoverActivity
    );
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this._raf = requestAnimationFrame(this._loop);
  };
}

customElements.define('shader-canvas', ShaderCanvas);
