/**
 * Fragment output path, inlined on purpose.
 *
 * three.js only injects toneMapping() and the generated linearToOutputTexel()
 * into the prefixes of its OWN materials. A GLSL3 ShaderMaterial gets neither,
 * and it is not given a `gl_FragColor` alias either - three emits an empty
 * string for both the output declaration and the #define when glslVersion is
 * GLSL3. Chunk names have also churned across releases (encodings_fragment ->
 * colorspace_fragment in r152). So we declare our own output and carry three's
 * exact ACES fit and sRGB transfer function here, which keeps custom shaders
 * matching built-in materials without depending on renderer internals.
 */
/**
 * Regression guard. Both shader bugs that cost time earlier were silent at
 * author time and only surfaced as a link failure at runtime, so assert the
 * invariants here instead of rediscovering them.
 */
export function assertShaderContract(fragmentSource, name) {
  const problems = [];
  if (/\bgl_FragColor\b/.test(fragmentSource))
    problems.push('uses gl_FragColor, which does not exist in a GLSL3 ShaderMaterial');
  if (/#include\s*<\s*(tonemapping|colorspace|encodings)_fragment\s*>/.test(fragmentSource))
    problems.push('includes a three.js output chunk; those are not injected into GLSL3 ShaderMaterials');
  if (/\bvec3\s+RRTAndODTFit\s*\(/.test(fragmentSource))
    problems.push('redefines RRTAndODTFit, which three already provides via tonemapping_pars_fragment');
  if (!/\bmx_writeOutput\s*\(/.test(fragmentSource))
    problems.push('never calls mx_writeOutput(); nothing would be written to the framebuffer');
  if (problems.length)
    throw new Error(`shader contract violated in ${name}:\n  - ${problems.join('\n  - ')}`);
  return true;
}

export const OUTPUT_PARS = /* glsl */`
layout(location = 0) out vec4 fragColor;
uniform float uExposure;

vec3 mx_RRTAndODTFit(vec3 v){
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}

// Verbatim from three.js ACESFilmicToneMapping so custom and built-in
// materials tone-map identically.
// name-spaced: three already injects RRTAndODTFit via tonemapping_pars_fragment
vec3 mx_acesFilmic(vec3 color){
  const mat3 ACESInputMat = mat3(
    vec3(0.59719, 0.07600, 0.02840),
    vec3(0.35458, 0.90834, 0.13383),
    vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACESOutputMat = mat3(
    vec3( 1.60475, -0.10208, -0.00327),
    vec3(-0.53108,  1.10813, -0.07276),
    vec3(-0.07367, -0.00605,  1.07602));
  color *= uExposure / 0.6;
  color = ACESInputMat * color;
  color = mx_RRTAndODTFit(color);
  color = ACESOutputMat * color;
  return clamp(color, 0.0, 1.0);
}

// three.js sRGBTransferOETF
vec3 mx_linearToSRGB(vec3 c){
  return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055),
             c * 12.92,
             vec3(lessThanEqual(c, vec3(0.0031308))));
}

void mx_writeOutput(vec3 linearColor){
  fragColor = vec4(mx_linearToSRGB(mx_acesFilmic(linearColor)), 1.0);
}
`;
