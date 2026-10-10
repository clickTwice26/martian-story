/**
 * Shared GLSL for the opening cinematic.
 *
 * Value noise on a cheap arithmetic hash. It is only ever evaluated in bake
 * passes (planet surfaces, the galaxy) or on small screen areas, so quality
 * per octave matters more than speed here.
 */
export const NOISE_GLSL = /* glsl */`
float n3hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float n3(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(n3hash(i),                  n3hash(i + vec3(1, 0, 0)), f.x),
                 mix(n3hash(i + vec3(0, 1, 0)),  n3hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(n3hash(i + vec3(0, 0, 1)),  n3hash(i + vec3(1, 0, 1)), f.x),
                 mix(n3hash(i + vec3(0, 1, 1)),  n3hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm3(vec3 p, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 10; i++) {
    if (i >= oct) break;
    s += a * n3(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}
float ridged3(vec3 p, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 10; i++) {
    if (i >= oct) break;
    s += a * (1.0 - abs(2.0 * n3(p) - 1.0));
    p = p * 2.07 + vec3(5.3, 1.1, 7.7);
    a *= 0.5;
  }
  return s;
}
vec3 n3hash3(vec3 p) {
  return vec3(n3hash(p), n3hash(p + 17.31), n3hash(p + 41.07));
}
/* Impact craters on a unit sphere direction: bowl, raised rim, faint ejecta.
   Returns a height offset. Cells are 3D so there is no seam or pole pinch. */
float craters(vec3 d, float scale, float density) {
  vec3 p = d * scale;
  vec3 ip = floor(p);
  float h = 0.0;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 c = ip + vec3(x, y, z);
    vec3 r = n3hash3(c);
    if (r.z > density) continue;
    vec3 ctr = c + 0.15 + 0.7 * r;
    float rad = 0.12 + 0.33 * r.x * r.x;
    float q = length(p - ctr) / rad;
    if (q > 2.2) continue;
    float bowl = q < 1.0 ? (q * q - 1.0) : 0.0;
    float rim = exp(-pow((q - 1.0) * 4.2, 2.0)) * 0.42;
    float ejecta = q > 1.0 ? exp(-(q - 1.0) * 2.6) * 0.07 : 0.0;
    h += (bowl * 0.8 + rim + ejecta) * (0.6 + r.y);
  }
  return h;
}
`;

/* Equirectangular <-> direction, shared by every bake and every lookup so a
   baked texel and the fragment sampling it agree exactly. Longitude east is
   atan(z, x); latitude is asin(y). */
export const SPHERE_GLSL = /* glsl */`
const float PI = 3.14159265358979;
vec3 dirFromUV(vec2 uv) {
  float lon = (uv.x - 0.5) * 2.0 * PI;
  float lat = (uv.y - 0.5) * PI;
  return vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
}
vec2 uvFromDir(vec3 d) {
  return vec2(atan(d.z, d.x) / (2.0 * PI) + 0.5, asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5);
}
/* The longitude wraps at the seam, so the screen-space derivative of u jumps
   by 1 there and the GPU would pick the smallest mip: a one-pixel crack. Take
   the gradient from whichever of u or u+0.5 is continuous at this pixel. */
vec4 sampleSphere(sampler2D tex, vec3 d) {
  vec2 uv = uvFromDir(d);
  vec2 uvB = vec2(fract(uv.x + 0.5), uv.y);
  vec2 dxA = dFdx(uv), dyA = dFdy(uv), dxB = dFdx(uvB), dyB = dFdy(uvB);
  bool useB = abs(dxB.x) + abs(dyB.x) < abs(dxA.x) + abs(dyA.x);
  return textureGrad(tex, uv, useB ? dxB : dxA, useB ? dyB : dyA);
}
`;
