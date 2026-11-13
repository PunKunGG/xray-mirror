import {
  Camera, Mesh, NoBlending, PlaneGeometry, Scene, ShaderMaterial, Vector2, WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import type { Lens } from './hand-bones.ts';

export function createHeadCompositor(renderer: WebGLRenderer) {
  const target = new WebGLRenderTarget(1, 1, { samples: 4, resolveDepthBuffer: false });
  const geometry = new PlaneGeometry(2, 2);
  const viewportSize = new Vector2(1, 1);
  const drawingSize = new Vector2();
  const material = new ShaderMaterial({
    name: 'Head edge feather',
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
    toneMapped: false,
    uniforms: {
      anatomy: { value: target.texture },
      radius: { value: new Vector2() },
      viewport: { value: viewportSize },
      lensCenter: { value: new Vector2() },
      lensRadius: { value: 0 },
      lensEdge: { value: 1 },
      xray: { value: false },
    },
    vertexShader: `
      varying vec2 screenUv;

      void main() {
        screenUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D anatomy;
      uniform vec2 radius;
      uniform vec2 viewport;
      uniform vec2 lensCenter;
      uniform float lensRadius;
      uniform float lensEdge;
      uniform bool xray;
      varying vec2 screenUv;

      float coverage(vec2 uv) {
        vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
        // Any nonzero alpha in the 8-bit target marks coverage, even at low brightness.
        return inside.x * inside.y * min(1.0, texture2D(anatomy, uv).a * 255.0);
      }

      float feather() {
        // Sample three rings of the coverage mask. Only opacity changes near the edge.
        float total = 2.0;
        for (int ring = 1; ring <= 3; ring++) {
          vec2 offset = radius * (float(ring) / 3.0);
          vec2 diagonal = offset * 0.70710678;
          total += coverage(screenUv + vec2(offset.x, 0.0));
          total += coverage(screenUv - vec2(offset.x, 0.0));
          total += coverage(screenUv + vec2(0.0, offset.y));
          total += coverage(screenUv - vec2(0.0, offset.y));
          total += coverage(screenUv + diagonal);
          total += coverage(screenUv - diagonal);
          total += coverage(screenUv + vec2(diagonal.x, -diagonal.y));
          total += coverage(screenUv + vec2(-diagonal.x, diagonal.y));
        }
        return smoothstep(0.42, 1.0, total / 26.0);
      }

      void main() {
        vec4 layer = texture2D(anatomy, screenUv);
        if (layer.a <= 0.0) discard;

        // X-ray accumulates in display space. Solid lighting is linear in the target.
        if (!xray) {
          layer.rgb = linearToOutputTexel(vec4(layer.rgb / layer.a, 1.0)).rgb * layer.a;
        }
        float reveal = 1.0;
        if (lensRadius > 0.0) {
          float distancePx = length((screenUv - lensCenter) * viewport);
          reveal = 1.0 - smoothstep(max(0.0, lensRadius - lensEdge), lensRadius, distancePx);
        }
        float edge = radius.x > 0.0 ? feather() : 1.0;
        gl_FragColor = layer * edge * reveal;
      }
    `,
  });
  const quad = new Mesh(geometry, material);
  quad.frustumCulled = false;
  const pass = new Scene();
  pass.add(quad);
  const passCamera = new Camera();

  return {
    resize(width: number, height: number): void {
      viewportSize.set(Math.max(1, width), Math.max(1, height));
      renderer.getDrawingBufferSize(drawingSize);
      target.setSize(Math.max(1, drawingSize.x), Math.max(1, drawingSize.y));
    },
    render(scene: Scene, camera: Camera, featherPx: number, xray: boolean, lens: Lens | null): void {
      if (featherPx === 0 && !lens) {
        renderer.render(scene, camera);
        return;
      }

      renderer.setRenderTarget(target);
      try {
        renderer.render(scene, camera);
      } finally {
        renderer.setRenderTarget(null);
      }
      material.uniforms.radius.value.set(featherPx / viewportSize.x, featherPx / viewportSize.y);
      material.uniforms.xray.value = xray;
      material.uniforms.lensCenter.value.set(lens?.x ?? 0, 1 - (lens?.y ?? 0));
      material.uniforms.lensRadius.value = lens ? Math.min(viewportSize.x, viewportSize.y) * lens.size / 2 : 0;
      material.uniforms.lensEdge.value = Math.max(1, featherPx);
      renderer.render(pass, passCamera);
    },
    dispose(): void {
      target.dispose();
      material.dispose();
      geometry.dispose();
    },
  };
}
