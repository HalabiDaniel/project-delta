/**
 * GLSL for the pencil strokes. Each edge of a mesh is a quad whose four vertices all sit on the
 * edge; the vertex shader decides whether the edge shows this frame (boundary, crease or
 * silhouette), then pushes the corners apart on screen to a few pixels' width with stable,
 * per-edge irregularities (uneven width, a little wobble, runs past the corners). The fragment
 * shader draws a soft graphite line with grain and lighter ends.
 */

export const strokeVertexGLSL = /* glsl */ `
attribute vec3 vertex_position;
attribute vec3 aOther;
attribute vec3 aNormalA;
attribute vec3 aNormalB;
attribute vec4 aInfo;

uniform mat4 matrix_model;
uniform mat4 matrix_viewProjection;
uniform mat3 matrix_normal;
uniform vec3 view_position;
uniform vec4 screen_size;

// x: width (px), y: opacity, z: cosine of the crease angle, w: overshoot (px)
uniform vec4 outline_stroke;
// x: full-width distance, y: smallest width scale, z: fade start, w: fade end
uniform vec4 outline_fade;
// x: device pixels per CSS pixel, y: wobble (px), z: shortest stroke (px), w: depth bias
uniform vec4 outline_global;

varying vec4 vStroke;
varying vec2 vGrain;

float hash(float n) {
    return fract(sin(n) * 43758.5453);
}

void hide() {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    vStroke = vec4(0.0);
    vGrain = vec2(0.0);
}

void main(void) {
    vec3 a = (matrix_model * vec4(vertex_position, 1.0)).xyz;
    vec3 b = (matrix_model * vec4(aOther, 1.0)).xyz;
    vec3 nA = normalize(matrix_normal * aNormalA);
    vec3 nB = normalize(matrix_normal * aNormalB);
    vec3 toCam = view_position - 0.5 * (a + b);
    float fa = dot(nA, toCam);
    float fb = dot(nB, toCam);
    float kind = aInfo.z;
    bool crease = dot(nA, nB) < outline_stroke.z;
    bool show;
    if (kind > 0.5 && kind < 1.5) {
        // A boundary: the rim of a sheet, always drawn.
        show = true;
    } else if (kind > 1.5) {
        // Inside a sheet seen from both sides: folds and silhouettes.
        show = crease || fa * fb <= 0.0;
    } else {
        // A closed surface: silhouettes, and creases on the side facing the camera.
        show = fa * fb <= 0.0 || (crease && max(fa, fb) > 0.0);
    }
    if (!show) {
        hide();
        return;
    }

    // Pull both ends a little towards the camera so the line wins against its own faces.
    a += normalize(view_position - a) * (outline_global.w * length(view_position - a) + 0.01);
    b += normalize(view_position - b) * (outline_global.w * length(view_position - b) + 0.01);
    vec4 ca = matrix_viewProjection * vec4(a, 1.0);
    vec4 cb = matrix_viewProjection * vec4(b, 1.0);

    // Clip the segment against the near plane before projecting.
    const float nearW = 0.05;
    if (ca.w < nearW && cb.w < nearW) {
        hide();
        return;
    }
    if (ca.w < nearW) ca = mix(ca, cb, (nearW - ca.w) / (cb.w - ca.w));
    if (cb.w < nearW) cb = mix(cb, ca, (nearW - cb.w) / (ca.w - cb.w));

    vec2 sa = ca.xy / ca.w * screen_size.xy * 0.5;
    vec2 sb = cb.xy / cb.w * screen_size.xy * 0.5;
    float lengthPx = length(sb - sa);
    // Always measured from end 0 to end 1, so both ends agree on which side is which.
    float end = aInfo.y;
    vec2 dir = lengthPx > 0.0001 ? (sb - sa) / lengthPx : vec2(1.0, 0.0);
    if (end > 0.5) dir = -dir;
    vec2 perp = vec2(-dir.y, dir.x);

    float distance = ca.w;
    float scale = clamp(outline_fade.x / max(distance, 0.001), outline_fade.y, 1.0);
    float px = outline_global.x * scale;
    float seed = aInfo.w;
    float widthJitter = mix(0.7, 1.2, hash(seed * 91.7 + end * 13.1));
    float halfWidth = 0.5 * outline_stroke.x * px * widthJitter;
    float wobble = (hash(seed * 3.1 + end * 5.3) - 0.5) * 2.0 * outline_global.y * px;
    float overshoot = outline_stroke.w * px * hash(seed * 17.3 + end * 7.7) * min(1.0, lengthPx / 24.0);
    vec2 offset = perp * (aInfo.x * halfWidth + wobble) + dir * (end > 0.5 ? overshoot : -overshoot);
    ca.xy += offset * 2.0 * screen_size.zw * ca.w;
    gl_Position = ca;

    float fade = 1.0 - smoothstep(outline_fade.z, outline_fade.w, distance);
    fade *= smoothstep(outline_global.z * 0.5, outline_global.z, lengthPx);
    // x: across (-1…1), y: along (0…1), z: opacity, w: unused.
    vStroke = vec4(aInfo.x, end, outline_stroke.y * fade, 0.0);
    // The stroke's length in pixels and its seed, for the graphite grain.
    vGrain = vec2(lengthPx, seed);
}
`;

export const strokeFragmentGLSL = /* glsl */ `
uniform vec3 outline_color;
varying vec4 vStroke;
varying vec2 vGrain;

float hash(float n) {
    return fract(sin(n) * 43758.5453);
}

void main(void) {
    if (vStroke.z <= 0.003) discard;
    float across = abs(vStroke.x);
    float body = 1.0 - smoothstep(0.6, 1.0, across);
    float along = vStroke.y;
    float ends = smoothstep(0.0, 0.12, along) * smoothstep(0.0, 0.12, 1.0 - along);
    // Graphite grain along the stroke: every couple of pixels a little lighter or darker.
    float grain = hash(floor(along * vGrain.x * 0.5) + vGrain.y * 113.0);
    float alpha = vStroke.z * body * mix(0.55, 1.0, ends) * mix(0.72, 1.0, grain);
    gl_FragColor = vec4(outline_color, alpha);
}
`;
