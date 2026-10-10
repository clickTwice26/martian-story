import * as THREE from 'three';
import { NOISE_GLSL, SPHERE_GLSL } from './glsl.js';

/**
 * One-off procedural bakes for the opening cinematic.
 *
 * Planet surfaces and the galaxy are expensive to evaluate (warped fBm, crater
 * fields, a dozen landmarks) but never change, so each is rendered once into
 * an equirectangular texture and the frame shaders merely look it up. The bake
 * is cut into horizontal slices spread across frames, so a weak GPU never has
 * to swallow one enormous draw (which a driver watchdog may kill).
 */

/* Linear albedo, deliberately dark: Mars' bolometric albedo is ~0.25. The
   landmarks sit at their real areocentric positions (lat, east lon). */
export const MARS_SURFACE = /* glsl */`
vec3 ll(float latDeg, float lonDeg) {
  float la = radians(latDeg), lo = radians(lonDeg);
  return vec3(cos(la) * cos(lo), sin(la), cos(la) * sin(lo));
}
float ang(vec3 d, vec3 c) { return acos(clamp(dot(d, c), -1.0, 1.0)); }

vec4 surface(vec3 d) {
  float lat = asin(d.y), lon = atan(d.z, d.x);
  vec3 w = vec3(fbm3(d * 2.1 + 3.1, 4), fbm3(d * 2.1 + 7.7, 4), fbm3(d * 2.1 + 1.3, 4));
  float n = fbm3(d * 2.6 + w * 1.7, 7);

  // Classical albedo features: a dark belt through the southern mid-latitudes
  // (Mare Erythraeum, Sinus Meridiani), Syrtis Major, Acidalia in the north;
  // bright dusty Tharsis, Arabia and Elysium.
  float belt = exp(-pow((lat + 0.30) / 0.42, 2.0));
  float syrtis = exp(-pow(ang(d, ll(9.0, 69.0)) / 0.22, 2.0));
  float acid = exp(-pow(ang(d, ll(47.0, -28.0)) / 0.30, 2.0));
  float brightDust = exp(-pow(ang(d, ll(3.0, -112.0)) / 0.55, 2.0))
                   + exp(-pow(ang(d, ll(20.0, 10.0)) / 0.45, 2.0))
                   + 0.7 * exp(-pow(ang(d, ll(25.0, 150.0)) / 0.40, 2.0));
  float darkness = smoothstep(0.50, 0.70, n + 0.22 * belt + 0.35 * syrtis + 0.25 * acid - 0.30 * brightDust);

  vec3 dust = vec3(0.62, 0.34, 0.18);
  vec3 mid  = vec3(0.47, 0.24, 0.12);
  vec3 dark = vec3(0.19, 0.115, 0.075);
  vec3 col = mix(mix(mid, dust, smoothstep(0.35, 0.75, fbm3(d * 5.0 + w, 5))), dark, darkness);

  // Relief: cratered southern highlands, smoother northern lowlands.
  float highland = smoothstep(-0.25, 0.35, -d.y + 0.35 * (w.x - 0.5));
  float h = 0.5 + 0.05 * (n - 0.5);
  h += craters(d, 16.0, 0.50) * 0.040 * (0.4 + highland);
  h += craters(d, 42.0, 0.45) * 0.020 * (0.3 + highland);
  h += craters(d, 110.0, 0.35) * 0.010 * highland;

  // Tharsis shield volcanoes and Olympus Mons, calderas on top.
  vec3 vol[4];
  vol[0] = ll(18.65, -133.8); vol[1] = ll(-8.3, -120.5); vol[2] = ll(1.5, -113.0); vol[3] = ll(11.8, -104.5);
  float vr[4];
  vr[0] = 0.16; vr[1] = 0.075; vr[2] = 0.07; vr[3] = 0.07;
  for (int i = 0; i < 4; i++) {
    float q = ang(d, vol[i]) / vr[i];
    h += 0.16 * exp(-q * q * 1.6) * (i == 0 ? 1.4 : 1.0);
    h -= 0.05 * exp(-pow(q / 0.16, 2.0));                         // caldera
    col = mix(col, dust * 1.08, 0.35 * exp(-q * q));
  }

  // Valles Marineris: a 4000 km rift along the equator east of Tharsis.
  if (lon > radians(-100.0) && lon < radians(-35.0)) {
    float t = (lon - radians(-100.0)) / radians(65.0);
    float cl = radians(-8.0 + 4.0 * sin(t * 9.0) * (1.0 - t)) + 0.02 * (w.y - 0.5);
    float width = radians(1.2 + 3.5 * sin(t * 3.14159) * (0.6 + 0.6 * w.z));
    float v = 1.0 - smoothstep(0.0, width, abs(lat - cl));
    v *= smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.85, t);
    h -= 0.20 * v;
    col = mix(col, dark * 1.15, 0.75 * v);
  }

  // Impact basins.
  float hellas = ang(d, ll(-42.4, 70.5)) / 0.36;
  h -= 0.22 * (1.0 - smoothstep(0.75, 1.0, hellas));
  h += 0.05 * exp(-pow((hellas - 1.02) * 6.0, 2.0));
  col = mix(col, vec3(0.70, 0.46, 0.30), 0.55 * (1.0 - smoothstep(0.6, 1.0, hellas)));
  float argyre = ang(d, ll(-49.7, -42.8)) / 0.24;
  h -= 0.14 * (1.0 - smoothstep(0.7, 1.0, argyre));
  col = mix(col, vec3(0.63, 0.40, 0.25), 0.45 * (1.0 - smoothstep(0.6, 1.0, argyre)));

  // Jezero: 45 km across, with the delta on its western rim.
  float jz = ang(d, ll(18.44, 77.45)) / 0.0066;
  h += -0.06 * (1.0 - smoothstep(0.8, 1.0, jz)) + 0.03 * exp(-pow((jz - 1.0) * 5.0, 2.0));

  // Polar caps: water ice under a seasonal CO2 frost, ragged spiral edges.
  float capN = smoothstep(radians(77.0), radians(83.0), lat + 0.05 * (fbm3(d * 9.0, 4) - 0.5) + 0.03 * sin(lon * 3.0 + lat * 40.0));
  float capS = smoothstep(radians(-81.0), radians(-86.0), lat - 0.04 * (fbm3(d * 9.0 + 5.0, 4) - 0.5));
  float ice = max(capN, capS);
  col = mix(col, vec3(0.86, 0.84, 0.82), ice);

  return vec4(col, clamp(h, 0.0, 1.0));
}
`;

export const EARTH_SURFACE = /* glsl */`
vec4 surface(vec3 d) {
  float lat = asin(d.y);
  vec3 w = vec3(fbm3(d * 1.7 + 2.0, 4), fbm3(d * 1.7 + 9.0, 4), fbm3(d * 1.7 + 4.0, 4));
  float land = fbm3(d * 1.9 + w * 1.35, 7);
  float coast = smoothstep(0.515, 0.535, land);
  vec3 deep = vec3(0.006, 0.026, 0.085), shallow = vec3(0.018, 0.10, 0.16);
  vec3 ocean = mix(deep, shallow, smoothstep(0.44, 0.53, land));

  float dry = smoothstep(0.45, 0.62, fbm3(d * 4.0 + 11.0, 5)) * exp(-pow((abs(lat) - 0.42) / 0.22, 2.0));
  float cold = smoothstep(0.85, 1.15, abs(lat));
  vec3 forest = vec3(0.045, 0.10, 0.032), grass = vec3(0.13, 0.17, 0.06);
  vec3 desert = vec3(0.46, 0.35, 0.20), tundra = vec3(0.28, 0.26, 0.22);
  vec3 ground = mix(forest, grass, smoothstep(0.4, 0.7, fbm3(d * 8.0, 4)));
  ground = mix(ground, desert, dry);
  ground = mix(ground, tundra, cold);
  ground = mix(ground, vec3(0.42, 0.40, 0.38), smoothstep(0.62, 0.78, ridged3(d * 6.0, 5)) * 0.6);
  vec3 col = mix(ocean, ground, coast);
  float ice = smoothstep(1.17, 1.24, abs(lat) + 0.08 * (fbm3(d * 7.0, 4) - 0.5));
  col = mix(col, vec3(0.80, 0.84, 0.88), ice);

  // Cloud cover in alpha: frontal swirls in mid-latitudes, the ITCZ, cells.
  vec3 sw = d + 0.35 * vec3(sin(d.y * 9.0 + w.x * 4.0), 0.0, cos(d.y * 9.0 + w.z * 4.0));
  float c = fbm3(sw * 3.2 + w * 1.8, 7);
  c += 0.18 * exp(-pow(lat / 0.08, 2.0)) * fbm3(d * 14.0, 3);
  float clouds = smoothstep(0.50, 0.78, c);
  return vec4(col, clouds);
}
`;

export const JUPITER_SURFACE = /* glsl */`
vec4 surface(vec3 d) {
  float lat = asin(d.y), lon = atan(d.z, d.x);
  float turb = fbm3(d * vec3(3.0, 14.0, 3.0) + 2.0, 6);
  float b = sin(lat * 17.0 + turb * 2.6 + 0.4 * sin(lon * 2.0 + lat * 30.0) * turb);
  vec3 zone = vec3(0.80, 0.72, 0.58), belt = vec3(0.46, 0.29, 0.18);
  vec3 col = mix(belt, zone, smoothstep(-0.35, 0.45, b));
  col *= 0.85 + 0.3 * fbm3(d * vec3(6.0, 40.0, 6.0), 5);
  col = mix(col, vec3(0.42, 0.42, 0.44), smoothstep(1.05, 1.35, abs(lat)));
  // the Great Red Spot, 22 degrees south
  vec2 g = vec2((lon - 0.6) / 0.20, (lat + radians(22.0)) / 0.085);
  float spot = 1.0 - smoothstep(0.6, 1.0, length(g));
  float swirl = fbm3(vec3(g * 2.0, 1.0) + vec3(sin(length(g) * 6.0)), 4);
  col = mix(col, vec3(0.66, 0.27, 0.15) * (0.8 + 0.4 * swirl), spot);
  return vec4(col, 0.0);
}
`;

/* The galaxy, as radiance. A band along the galactic plane with a brighter
   core, dark dust lanes down its spine, star clouds and faint emission. */
export const GALAXY_SKY = /* glsl */`
vec4 surface(vec3 d) {
  vec3 gN = normalize(vec3(0.28, 0.93, -0.24));
  vec3 gC = normalize(cross(gN, vec3(0.0, 0.0, 1.0)));
  float y = dot(d, gN);
  float core = exp(-acos(clamp(dot(d, gC), -1.0, 1.0)) * 1.4);
  float band = exp(-pow(y / (0.11 + 0.08 * core), 2.0));
  float clouds = fbm3(d * 7.0, 6);
  float lane = smoothstep(0.42, 0.72, fbm3(d * 4.5 + 3.0, 6)) * exp(-pow(y / 0.035, 2.0));
  float glow = band * (0.35 + 0.9 * clouds) * (0.35 + 1.6 * core) * (1.0 - 0.85 * lane);
  vec3 col = mix(vec3(0.55, 0.62, 0.85), vec3(1.0, 0.82, 0.62), core) * glow * 0.11;
  // unresolved star dust and a little emission
  col += vec3(0.9, 0.95, 1.0) * pow(n3(d * 900.0), 18.0) * 0.6 * (0.3 + band);
  col += vec3(0.55, 0.12, 0.10) * smoothstep(0.62, 0.85, fbm3(d * 3.0 + 9.0, 5)) * band * 0.030;
  col += vec3(0.10, 0.18, 0.40) * smoothstep(0.60, 0.85, fbm3(d * 2.5 + 4.0, 5)) * 0.012;
  return vec4(col, 1.0);
}
`;

const VERT = /* glsl */`
in vec3 position;
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export function floatTargetType(renderer) {
  const ext = renderer.extensions;
  return ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float')
    ? THREE.HalfFloatType : THREE.UnsignedByteType;
}

/**
 * Bake `surfaceGLSL` (defining vec4 surface(vec3 dir)) into a w x h
 * equirectangular texture, `rowsPerSlice` rows per frame.
 */
export async function bakeEquirect(renderer, w, h, surfaceGLSL, { type, rowsPerSlice = 128, yieldFn } = {}) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: type ?? THREE.UnsignedByteType,
    depthBuffer: false, stencilBuffer: false,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping,
  });
  rt.texture.colorSpace = THREE.NoColorSpace;
  const mat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: `precision highp float;\nin vec2 vUv;\nout vec4 fragColor;\n${NOISE_GLSL}\n${SPHERE_GLSL}\n${surfaceGLSL}\n` +
      `void main() { fragColor = surface(dirFromUV(vUv)); }`,
    depthTest: false, depthWrite: false,
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const quad = new THREE.Mesh(geo, mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(quad);
  const cam = new THREE.Camera();

  const prev = renderer.getRenderTarget(), prevClear = renderer.autoClear;
  renderer.autoClear = false;
  for (let row = 0; row < h; row += rowsPerSlice) {
    rt.scissor.set(0, row, w, Math.min(rowsPerSlice, h - row));
    rt.scissorTest = true;
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    renderer.setRenderTarget(prev);
    if (yieldFn) await yieldFn();
  }
  renderer.autoClear = prevClear;
  rt.scissorTest = false;
  geo.dispose(); mat.dispose();
  return rt;
}
