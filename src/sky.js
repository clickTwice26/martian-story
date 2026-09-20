import * as THREE from 'three';
import { OUTPUT_PARS, assertShaderContract } from './shaderlib.js';

/**
 * Martian sky.
 *
 * Mars is not Earth with a red filter. Suspended dust (not Rayleigh scattering)
 * dominates, so the daytime sky is butterscotch and DARKENS toward the zenith
 * rather than deepening to blue. The famous inversion is around the sun itself:
 * fine dust forward-scatters blue light, so the solar aureole and Martian
 * sunsets are blue-grey against a tan sky. Both behaviours are modelled here.
 *
 * The sun disc is ~0.35 deg across, about two thirds of its apparent size from
 * Earth, because Mars sits at ~1.52 AU.
 */
const VERT = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */`
precision highp float;
${OUTPUT_PARS}
varying vec3 vDir;
uniform vec3  uSunDir;
uniform vec3  uZenith;
uniform vec3  uHorizon;
uniform vec3  uAureole;
uniform float uOpacity;

void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -1.0, 1.0);

  // tan at the horizon, darker and greyer overhead - opposite of Earth
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.62));
  // ground haze below the horizon so the terrain edge never shows a seam
  sky = mix(uHorizon * 0.82, sky, smoothstep(-0.14, 0.03, h));

  float cosA = dot(d, normalize(uSunDir));

  // Blue forward-scattering halo: the signature Martian solar aureole.
  float aureole = pow(max(cosA, 0.0), 12.0) * 0.55
                + pow(max(cosA, 0.0), 3.2) * 0.22;
  sky = mix(sky, uAureole, clamp(aureole, 0.0, 0.85));

  // sun disc, ~0.35 deg -> cos(0.00305 rad) ~ 0.9999953
  float disc = smoothstep(0.999988, 0.999996, cosA);
  sky += vec3(1.0, 0.95, 0.88) * disc * 6.0;
  // soft bloom skirt
  sky += vec3(1.0, 0.92, 0.82) * pow(max(cosA, 0.0), 900.0) * 0.9;

  mx_writeOutput(sky * uOpacity);
}
`;

assertShaderContract(FRAG, 'marsSky');

export function createMarsSky(sunDir) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    glslVersion: THREE.GLSL3,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uSunDir:  { value: sunDir.clone().normalize() },
      uZenith:  { value: new THREE.Color(0x4e3b2c) },
      uHorizon: { value: new THREE.Color(0xc2986c) },
      uAureole: { value: new THREE.Color(0x8fa6bd) },   // the blue solar halo
      uOpacity: { value: 1.0 },
      uExposure: { value: 1.0 },
    },
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.material = mat;
  return mesh;
}
