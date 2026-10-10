import * as THREE from 'three';
import { NOISE_GLSL, SPHERE_GLSL } from './glsl.js';

/**
 * Space-side scene pieces for the opening: the galaxy and stars behind
 * everything, planets lit by a point sun with real day/night terminators,
 * atmospheric limbs, and the sun itself.
 *
 * Everything here renders into a linear HDR target; tone mapping, bloom and
 * grading happen once, in post.js. Values well above 1 (the sun, engines,
 * re-entry plasma) are meant to bloom.
 */

/* ------------------------------------------------------------ background -- */
/** Full-screen galaxy lookup plus an optional sun disc for scenes where the
    sun is "at infinity". Drawn first, at the far plane, no depth write. */
export function makeBackground(galaxyTex) {
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uGalaxy: { value: galaxyTex },
      uInvProj: { value: new THREE.Matrix4() },
      uCamRot: { value: new THREE.Matrix3() },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uSunDisc: { value: 0 },          // 0 when the sun is a real object in the scene
      uGain: { value: 1 },
    },
    vertexShader: /* glsl */`
      out vec2 vNdc;
      void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
    fragmentShader: /* glsl */`
      precision highp float;
      ${SPHERE_GLSL}
      in vec2 vNdc;
      out vec4 fragColor;
      uniform sampler2D uGalaxy;
      uniform mat4 uInvProj;
      uniform mat3 uCamRot;
      uniform vec3 uSunDir;
      uniform float uSunDisc, uGain;
      void main() {
        vec4 v = uInvProj * vec4(vNdc, 1.0, 1.0);
        vec3 d = normalize(uCamRot * (v.xyz / v.w));
        vec3 col = sampleSphere(uGalaxy, d).rgb * uGain;
        if (uSunDisc > 0.0) {
          float c = dot(d, normalize(uSunDir));
          float a = acos(clamp(c, -1.0, 1.0));
          col += vec3(1.0, 0.93, 0.82) * 60.0 * smoothstep(0.0062, 0.0050, a) * uSunDisc;   // the disc
          col += vec3(1.0, 0.78, 0.55) * (0.9 * exp(-a * 38.0) + 0.12 * exp(-a * 6.0)) * uSunDisc;
        }
        fragColor = vec4(col, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  mesh.onBeforeRender = (r, s, cam) => {
    mat.uniforms.uInvProj.value.copy(cam.projectionMatrixInverse);
    mat.uniforms.uCamRot.value.setFromMatrix4(cam.matrixWorld);
  };
  return mesh;
}

/** Point stars: crisper than anything a texture can hold. Placed at infinity. */
export function makeStars(count = 7000, seed = 7) {
  let s = seed;
  const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9 | 0) >>> 0) / 4294967296;
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), mag = new Float32Array(count);
  const gN = new THREE.Vector3(0.28, 0.93, -0.24).normalize();
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    // denser along the galactic plane, like the real sky
    do {
      v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
    } while (v.lengthSq() > 1 || v.lengthSq() < 1e-4);
    v.normalize();
    if (rnd() < 0.45) { v.addScaledVector(gN, -v.dot(gN) * (0.6 + 0.4 * rnd())).normalize(); }
    pos.set([v.x, v.y, v.z], i * 3);
    const m = Math.pow(rnd(), 9);                  // few bright, many faint
    mag[i] = m;
    const t = rnd();                                // colour temperature
    const c = t < 0.15 ? [1.0, 0.72, 0.52] : t < 0.35 ? [1.0, 0.88, 0.72] : t < 0.8 ? [0.95, 0.96, 1.0] : [0.72, 0.82, 1.0];
    col.set(c, i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPx: { value: 1 }, uGain: { value: 1 }, uStreak: { value: 0 } },
    vertexShader: /* glsl */`
      attribute float mag;
      varying vec3 vCol;
      varying float vI;
      uniform float uTime, uPx, uGain;
      void main() {
        vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 0.0);
        gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
        float tw = 0.85 + 0.15 * sin(uTime * (1.3 + mag * 7.0) + position.x * 91.0);
        vI = (0.10 + 2.4 * mag) * tw * uGain;      // only the brightest few reach the bloom threshold
        vCol = color;
        gl_PointSize = (1.2 + 2.2 * sqrt(mag)) * uPx;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vCol;
      varying float vI;
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float r = dot(q, q);
        float a = exp(-r * 4.0);
        gl_FragColor = vec4(vCol * vI * a, 1.0);
      }`,
    vertexColors: true,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, transparent: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = -90;
  return pts;
}

/* --------------------------------------------------------------- planets -- */
const PLANET_VERT = /* glsl */`
varying vec3 vObjN;
varying vec3 vN;
varying vec3 vPos;
varying vec3 vEast;
varying vec3 vNorth;
void main() {
  vObjN = normalize(position);
  vN = normalize(mat3(modelMatrix) * normal);
  // local east / north on the sphere, for relief from the height channel
  vec3 eastO = normalize(vec3(-vObjN.z, 0.0, vObjN.x) + 1e-5);
  vEast = mat3(modelMatrix) * eastO;
  vNorth = mat3(modelMatrix) * cross(vObjN, eastO);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const PLANET_FRAG = /* glsl */`
precision highp float;
${SPHERE_GLSL}
varying vec3 vObjN;
varying vec3 vN;
varying vec3 vPos;
varying vec3 vEast;
varying vec3 vNorth;
uniform sampler2D uMap;
uniform vec3 uSunPos;
uniform vec3 uSunCol;
uniform vec3 uAtmo;          // limb / scattering colour, 0 for airless
uniform float uBump;         // relief strength from the alpha channel (Mars)
uniform float uClouds;       // alpha is cloud cover (Earth)
uniform float uOcean;        // specular on dark-blue texels
uniform float uNight;        // city lights on the night side
uniform float uCloudShift;
uniform float uTexel;        // 1 / texture width

void main() {
  vec3 d = normalize(vObjN);
  vec4 tex = sampleSphere(uMap, d);
  vec3 albedo = tex.rgb;
  vec3 N = normalize(vN);
  vec3 L = normalize(uSunPos - vPos);
  vec3 V = normalize(cameraPosition - vPos);

  if (uBump > 0.0) {
    // Relief from the baked height: gradient in longitude and latitude,
    // turned into a tilt of the normal in the local east/north frame.
    vec2 uv = uvFromDir(d);
    float c = cos(asin(clamp(d.y, -1.0, 1.0)));
    float hE = textureLod(uMap, uv + vec2(uTexel / max(c, 0.05), 0.0), 0.0).a;
    float hW = textureLod(uMap, uv - vec2(uTexel / max(c, 0.05), 0.0), 0.0).a;
    float hN = textureLod(uMap, uv + vec2(0.0, uTexel * 2.0), 0.0).a;
    float hS = textureLod(uMap, uv - vec2(0.0, uTexel * 2.0), 0.0).a;
    vec3 east = normalize(vEast), north = normalize(vNorth);
    N = normalize(N - (east * (hE - hW) + north * (hN - hS)) * uBump);
  }

  float ndl = dot(N, L);
  float ndlS = dot(normalize(vN), L);
  // A hazy atmosphere carries light a little past the geometric terminator.
  float day = uAtmo == vec3(0.0) ? max(ndl, 0.0)
            : smoothstep(-0.12, 0.25, ndlS) * max(ndl * 0.85 + 0.15, 0.0);
  vec3 col = albedo * uSunCol * day;

  if (uClouds > 0.0) {
    vec2 uv = uvFromDir(d) + vec2(uCloudShift, 0.0);
    float cl = textureLod(uMap, uv, 1.0).a;
    float shadowed = textureLod(uMap, uv + vec2(0.002, 0.0015), 2.0).a;
    col *= 1.0 - 0.45 * shadowed * uClouds;
    col = mix(col, vec3(0.92) * uSunCol * day, cl * uClouds);
  }
  if (uOcean > 0.0) {
    float water = smoothstep(0.08, 0.02, albedo.g + albedo.r) * (1.0 - tex.a * uClouds);
    vec3 H = normalize(L + V);
    col += uSunCol * pow(max(dot(N, H), 0.0), 120.0) * 2.5 * water * step(0.0, ndlS) * uOcean;
  }
  if (uNight > 0.0) {
    // sparse settlements clustered on the coasts, only on the night side
    float land = step(0.12, albedo.r + albedo.g) * step(albedo.b, albedo.r + 0.02);
    float cell = fract(sin(dot(floor(d * 420.0), vec3(12.9, 78.2, 37.7))) * 43758.5);
    float lights = smoothstep(0.965, 0.995, cell);
    col += vec3(1.0, 0.66, 0.34) * lights * land * smoothstep(0.0, -0.25, ndlS) * 0.6 * uNight;
  }
  if (uAtmo != vec3(0.0)) {
    float fres = pow(1.0 - max(dot(normalize(vN), V), 0.0), 3.0);
    float lit = smoothstep(-0.25, 0.4, ndlS);
    // forward-scattered sunset band right at the terminator
    float sunset = exp(-pow(ndlS / 0.12, 2.0));
    col += uAtmo * fres * lit * 1.4 + uAtmo * sunset * fres * 0.6;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const ATMO_FRAG = /* glsl */`
varying vec3 vN;
varying vec3 vPos;
uniform vec3 uSunPos;
uniform vec3 uAtmo;
uniform float uLimbDot;      // dot(N,V) at the planet's own silhouette, seen from the shell
uniform float uStrength;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vPos);
  float dv = dot(N, V);                                   // back faces: [-1, 0]
  float g = pow(clamp(-dv / uLimbDot, 0.0, 1.0), 2.2);
  float lit = smoothstep(-0.35, 0.35, dot(N, normalize(uSunPos - vPos)));
  gl_FragColor = vec4(uAtmo * g * lit * uStrength, 1.0);
}`;

export function makePlanet({ radius, map, atmo = null, atmoScale = 1.03, bump = 0, clouds = 0, ocean = 0,
                             night = 0, segments = 96 }) {
  const group = new THREE.Group();
  const u = {
    uMap: { value: map },
    uSunPos: { value: new THREE.Vector3() },
    uSunCol: { value: new THREE.Color(1.0, 0.96, 0.9).multiplyScalar(1.6) },
    uAtmo: { value: atmo ? new THREE.Color(atmo) : new THREE.Color(0, 0, 0) },
    uBump: { value: bump },
    uClouds: { value: clouds },
    uOcean: { value: ocean },
    uNight: { value: night },
    uCloudShift: { value: 0 },
    uTexel: { value: 1 / (map.image?.width || 2048) },
  };
  const body = new THREE.Mesh(new THREE.SphereGeometry(radius, segments, segments / 2),
    new THREE.ShaderMaterial({ uniforms: u, vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG }));
  group.add(body);
  group.userData.body = body;
  group.userData.uniforms = u;
  group.userData.radius = radius;
  if (atmo) {
    const shell = new THREE.Mesh(new THREE.SphereGeometry(radius * atmoScale, segments, segments / 2),
      new THREE.ShaderMaterial({
        uniforms: { uSunPos: u.uSunPos, uAtmo: u.uAtmo,
                    uLimbDot: { value: Math.sqrt(1 - 1 / (atmoScale * atmoScale)) }, uStrength: { value: 1.6 } },
        vertexShader: PLANET_VERT, fragmentShader: ATMO_FRAG,
        side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
      }));
    group.add(shell);
    group.userData.shell = shell;
  }
  return group;
}

/** Airless lumpy moon (Phobos): displaced icosphere, grey-brown, cratered look. */
export function makeMoon(radius, seed = 3) {
  const geo = new THREE.IcosahedronGeometry(radius, 5);
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    const f = 1 + 0.18 * Math.sin(n.x * 3.1 + seed) * Math.cos(n.y * 2.3) + 0.08 * Math.sin(n.z * 7.7 + n.x * 5.0)
            + 0.04 * Math.sin(n.y * 17.0 + seed * 2.0);
    v.copy(n).multiplyScalar(radius * f);
    v.x *= 1.25; v.z *= 0.92;                       // Phobos is 27 x 22 x 18 km
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x5a4a40, roughness: 1, metalness: 0, flatShading: false }));
}

/* ------------------------------------------------------------------ sun -- */
export function makeSun(radius) {
  const group = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vObj; varying vec3 vPos;
      void main() { vObj = position; vN = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0); vPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */`
      ${NOISE_GLSL}
      varying vec3 vN; varying vec3 vObj; varying vec3 vPos;
      uniform float uTime;
      void main() {
        float mu = max(dot(normalize(vN), normalize(cameraPosition - vPos)), 0.0);
        float limb = 0.35 + 0.65 * pow(mu, 0.55);                   // limb darkening
        float gran = fbm3(normalize(vObj) * 9.0 + uTime * 0.05, 4);
        vec3 c = vec3(1.0, 0.80, 0.52) * (0.75 + 0.5 * gran) * limb;
        gl_FragColor = vec4(c * 9.0, 1.0);
      }`,
  }));
  group.add(core);
  // corona: camera-facing additive glow quad
  const corona = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    uniforms: { uSize: { value: radius * 5.5 } },
    vertexShader: /* glsl */`
      uniform float uSize; varying vec2 vQ;
      void main() { vQ = position.xy * 2.0;
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        mv.xy += position.xy * uSize;
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`
      varying vec2 vQ;
      void main() { float r = length(vQ);
        float g = 0.55 * exp(-r * 7.5) + 0.16 * exp(-r * 2.6);
        float ray = 0.5 + 0.5 * sin(atan(vQ.y, vQ.x) * 14.0);
        g *= 1.0 + 0.2 * ray * exp(-r * 3.0);
        gl_FragColor = vec4(vec3(1.0, 0.72, 0.45) * g * 3.0 * smoothstep(1.0, 0.6, r), 1.0); }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  corona.frustumCulled = false;
  group.add(corona);
  group.userData.core = core;
  return group;
}

/** Faint orbit circles on the ecliptic. */
export function makeOrbit(radius, color = 0x8fb4ff, opacity = 0.18) {
  const pts = [];
  for (let i = 0; i <= 256; i++) { const a = i / 256 * Math.PI * 2; pts.push(Math.cos(a) * radius, 0, Math.sin(a) * radius); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false,
                                                          blending: THREE.AdditiveBlending }));
}
