/**
 * Live shader demos for the Lab page. Each entry is Shadertoy-compatible:
 * write `void mainImage(out vec4 fragColor, in vec2 fragCoord)` and use
 * iTime / iResolution / iMouse. Add a new object here to add a new demo.
 */

export const shaders = [
  {
    id: 'raymarch-metaballs',
    title: 'Raymarched Metaballs',
    description:
      'Signed distance field raymarching with smooth-min blended spheres, soft shadows and fresnel lighting. Drag to orbit.',
    tags: ['GLSL', 'Raymarching', 'SDF'],
    source: `
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float map(vec3 p) {
  float t = iTime * 0.7;
  vec3 a = vec3(sin(t) * 0.9, cos(t * 1.3) * 0.5, 0.0);
  vec3 b = vec3(cos(t * 0.9) * 0.8, sin(t * 0.6) * 0.7, sin(t) * 0.4);
  vec3 c = vec3(sin(t * 1.4) * 0.5, cos(t) * 0.8, cos(t * 0.8) * 0.5);
  float d = smin(length(p - a) - 0.55, length(p - b) - 0.45, 0.5);
  d = smin(d, length(p - c) - 0.4, 0.5);
  d = smin(d, p.y + 1.3, 0.4); // floor
  return d;
}

vec3 normalAt(vec3 p) {
  vec2 e = vec2(0.001, 0.0);
  return normalize(vec3(
    map(p + e.xyy) - map(p - e.xyy),
    map(p + e.yxy) - map(p - e.yxy),
    map(p + e.yyx) - map(p - e.yyx)));
}

float softShadow(vec3 ro, vec3 rd) {
  float res = 1.0, t = 0.05;
  for (int i = 0; i < 32; i++) {
    float h = map(ro + rd * t);
    res = min(res, 8.0 * h / t);
    t += clamp(h, 0.02, 0.3);
    if (res < 0.005 || t > 8.0) break;
  }
  return clamp(res, 0.0, 1.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;

  float yaw = 0.4;
  if (iMouse.z > 0.0 || iMouse.x > 0.0)
    yaw = (iMouse.x / iResolution.x - 0.5) * 6.28;

  vec3 ro = vec3(sin(yaw) * 3.2, 1.2, cos(yaw) * 3.2);
  vec3 ww = normalize(-ro + vec3(0.0, -0.2, 0.0));
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.6 * ww);

  float t = 0.0;
  for (int i = 0; i < 90; i++) {
    float h = map(ro + rd * t);
    if (h < 0.001 || t > 12.0) break;
    t += h;
  }

  vec3 col = vec3(0.03, 0.04, 0.06) * (1.0 - length(uv) * 0.35);
  if (t < 12.0) {
    vec3 p = ro + rd * t;
    vec3 n = normalAt(p);
    vec3 lightDir = normalize(vec3(0.6, 0.9, 0.4));
    float dif = max(dot(n, lightDir), 0.0) * softShadow(p + n * 0.02, lightDir);
    float amb = 0.5 + 0.5 * n.y;
    float fre = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    vec3 base = p.y < -1.25 ? vec3(0.07, 0.08, 0.1)
                            : mix(vec3(0.1, 0.5, 0.45), vec3(0.2, 0.3, 0.7), 0.5 + 0.5 * sin(p.x * 2.0));
    col = base * (dif * vec3(1.0, 0.95, 0.85) + amb * 0.25) + fre * 0.25;
    col = mix(col, vec3(0.03, 0.04, 0.06), smoothstep(6.0, 12.0, t));
  }
  fragColor = vec4(pow(col, vec3(0.4545)), 1.0);
}`,
  },
  {
    id: 'menger-sponge',
    title: 'Menger Sponge',
    description:
      'A classic fractal rendered with distance field folding, ambient occlusion from iteration depth, and a slowly orbiting camera.',
    tags: ['GLSL', 'Fractal', 'Raymarching'],
    source: `
float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float map(vec3 p) {
  float d = sdBox(p, vec3(1.0));
  float s = 1.0;
  for (int m = 0; m < 4; m++) {
    vec3 a = mod(p * s, 2.0) - 1.0;
    s *= 3.0;
    vec3 r = abs(1.0 - 3.0 * abs(a));
    float da = max(r.x, r.y);
    float db = max(r.y, r.z);
    float dc = max(r.z, r.x);
    float c = (min(da, min(db, dc)) - 1.0) / s;
    d = max(d, c);
  }
  return d;
}

vec3 normalAt(vec3 p) {
  vec2 e = vec2(0.001, 0.0);
  return normalize(vec3(
    map(p + e.xyy) - map(p - e.xyy),
    map(p + e.yxy) - map(p - e.yxy),
    map(p + e.yyx) - map(p - e.yyx)));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;

  float ang = iTime * 0.25;
  if (iMouse.z > 0.0) ang = iMouse.x / iResolution.x * 6.28;
  vec3 ro = vec3(sin(ang) * 3.4, 1.6 + 0.6 * sin(iTime * 0.17), cos(ang) * 3.4);
  vec3 ww = normalize(-ro);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.8 * ww);

  float t = 0.0;
  int steps = 0;
  for (int i = 0; i < 100; i++) {
    float h = map(ro + rd * t);
    steps = i;
    if (h < 0.0008 || t > 10.0) break;
    t += h;
  }

  vec3 col = vec3(0.02, 0.03, 0.05);
  if (t < 10.0) {
    vec3 p = ro + rd * t;
    vec3 n = normalAt(p);
    float dif = max(dot(n, normalize(vec3(0.7, 1.0, 0.3))), 0.0);
    float ao = 1.0 - float(steps) / 100.0;
    vec3 base = mix(vec3(0.9, 0.6, 0.25), vec3(0.25, 0.65, 0.6),
                    0.5 + 0.5 * sin(p.y * 3.0 + 1.0));
    col = base * (dif * 0.8 + 0.2) * ao * ao;
    col = mix(col, vec3(0.02, 0.03, 0.05), smoothstep(5.0, 10.0, t));
  }
  fragColor = vec4(pow(col, vec3(0.4545)), 1.0);
}`,
  },
  {
    id: 'volumetric-clouds',
    title: 'Volumetric Noise',
    description:
      'FBM value-noise volume rendered with cheap ray integration — the same idea behind smoke and cloud shaders in production tools.',
    tags: ['GLSL', 'Volumes', 'FBM'],
    source: `
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

float fbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.02 + vec3(0.0, iTime * 0.15, 0.0);
    a *= 0.5;
  }
  return v;
}

float density(vec3 p) {
  float d = fbm(p * 1.4) - 0.45 - length(p) * 0.12;
  return clamp(d * 3.0, 0.0, 1.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;

  float ang = iTime * 0.1;
  if (iMouse.z > 0.0) ang = iMouse.x / iResolution.x * 6.28;
  vec3 ro = vec3(sin(ang) * 4.0, 0.6, cos(ang) * 4.0);
  vec3 ww = normalize(-ro);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.7 * ww);

  vec3 lightDir = normalize(vec3(0.5, 0.8, -0.3));
  vec4 acc = vec4(0.0);
  float t = 1.2;
  for (int i = 0; i < 48; i++) {
    if (acc.a > 0.98 || t > 7.0) break;
    vec3 p = ro + rd * t;
    float d = density(p);
    if (d > 0.01) {
      float lit = clamp(density(p + lightDir * 0.35) - d, -0.35, 0.35);
      vec3 c = mix(vec3(0.95, 0.85, 0.75), vec3(0.2, 0.3, 0.5), 0.5 + lit * 2.0);
      float a = d * 0.35;
      acc.rgb += c * a * (1.0 - acc.a);
      acc.a += a * (1.0 - acc.a);
    }
    t += 0.12;
  }

  vec3 bg = mix(vec3(0.04, 0.05, 0.09), vec3(0.1, 0.08, 0.12), uv.y * 0.5 + 0.5);
  vec3 col = bg * (1.0 - acc.a) + acc.rgb;
  fragColor = vec4(pow(col, vec3(0.4545)), 1.0);
}`,
  },
  {
    id: 'plasma-flow',
    title: 'Plasma Flow',
    description:
      'Domain-warped sine plasma — layered coordinate distortion producing an organic flowing field. Cheap enough to run anywhere.',
    tags: ['GLSL', 'Procedural', '2D'],
    source: `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;
  float t = iTime * 0.35;

  vec2 p = uv;
  for (float i = 1.0; i < 5.0; i++) {
    p.x += 0.35 / i * sin(i * 2.5 * p.y + t + i);
    p.y += 0.35 / i * cos(i * 1.5 * p.x + t + i * 1.7);
  }

  float v = sin(p.x + p.y + t) * 0.5 + 0.5;
  vec3 col = mix(vec3(0.02, 0.05, 0.09), vec3(0.31, 0.84, 0.75), pow(v, 1.6));
  col += vec3(0.55, 0.3, 0.75) * pow(sin(p.x * 2.0 + t) * 0.5 + 0.5, 3.0) * 0.35;
  col *= 1.0 - length(uv) * 0.25;
  fragColor = vec4(col, 1.0);
}`,
  },
];

/** Neonwave sunrise background, adapted from the supplied CC0 Shadertoy reference. */
export const heroShader = `
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f *= f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.0 + vec2(13.7, 4.2);
    a *= 0.5;
  }
  return v;
}

float ridge(vec2 p, float scale, float speed) {
  float h = fbm(vec2(p.x * scale + iTime * speed, p.y * scale));
  return abs(h * 2.0 - 1.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec2 p = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;
  float t = iTime * 0.055;
  float horizon = 0.03 + 0.06 * sin(p.x * 0.7 + t);

  vec3 sky = mix(vec3(0.025, 0.035, 0.09), vec3(0.22, 0.035, 0.22),
                 smoothstep(-0.1, 0.9, uv.y));
  float glow = exp(-14.0 * abs(p.y - horizon));
  sky += vec3(0.95, 0.16, 0.32) * glow * 0.8;
  sky += vec3(0.12, 0.12, 0.55) * exp(-2.5 * abs(p.y - horizon));

  // Stars near the cursor swell slightly and brighten, fading out with distance.
  vec2 mouse = (iMouse.xy * 2.0 - iResolution.xy) / iResolution.y;
  float hover = 0.0;
  if (iMouse.x > 0.0 || iMouse.y > 0.0)
    hover = 1.0 - smoothstep(0.0, 0.55, distance(p, mouse));

  // Sparse stars with a gentle shimmer.
  vec2 starCell = floor((p + vec2(2.0, 1.0)) * 16.0);
  // Jitter each star away from its cell center so the underlying grid vanishes.
  vec2 starJitter = (vec2(hash(starCell + 3.1), hash(starCell + 9.7)) - 0.5) * 0.7;
  vec2 starPos = fract((p + vec2(2.0, 1.0)) * 16.0) - 0.5 - starJitter;
  // Disc with a soft edge: hover grows the core radius while tightening the
  // falloff, so stars get bigger and crisper instead of just blurrier.
  float starDist = length(starPos);
  float starRadius = mix(0.045, 0.095, hover);
  float starSoft = mix(0.085, 0.03, hover);
  float star = (1.0 - smoothstep(starRadius - starSoft, starRadius + starSoft, starDist))
             * step(0.84, hash(starCell));
  float starSeed = hash(starCell + 19.7);
  float starSpeed = mix(0.55, 3.8, hash(starCell + 7.3));
  float starPhase = hash(starCell + 41.2) * 6.28318;
  float pulse = 0.5 + 0.5 * sin(iTime * starSpeed + starPhase);
  pulse = smoothstep(0.08, 0.92, pulse);
  sky += vec3(0.5, 0.72, 1.0) * star * mix(0.2, 1.0, starSeed) * (0.3 + 0.7 * pulse) * (1.0 + hover * 0.7);

  // Layered wireframe-like dunes receding into the horizon.
  vec3 col = sky;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float depth = 0.18 + fi * 0.12;
    float y = horizon - depth - ridge(vec2(p.x, fi), 1.2 + fi * 0.16, 0.04 + fi * 0.008) * (0.11 + fi * 0.025);
    float line = 1.0 - smoothstep(0.0, 0.012 + fi * 0.002, abs(p.y - y));
    float fade = 1.0 - fi / 8.0;
    col += mix(vec3(0.15, 0.25, 0.95), vec3(0.95, 0.08, 0.42), fade) * line * fade * 0.75;
  }

  float foreground = smoothstep(horizon - 0.5, horizon - 0.08, p.y);
  col = mix(col, vec3(0.018, 0.018, 0.055), foreground * 0.82);
  col += vec3(1.0, 0.12, 0.18) * glow * smoothstep(0.8, 0.0, uv.y) * 0.35;
  col *= 1.0 - 0.24 * length(p * vec2(0.5, 0.75));
  fragColor = vec4(col, 1.0);
}`;
