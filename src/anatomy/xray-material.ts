import { AdditiveBlending, Color, ShaderMaterial } from 'three';

export type SkullLook = 'xray' | 'solid';

export function createXRayMaterial(bodyColor: number, rimColor: number): ShaderMaterial {
  return new ShaderMaterial({
    name: 'Anatomy X-ray',
    transparent: true,
    blending: AdditiveBlending,
    premultipliedAlpha: true,
    depthWrite: false,
    uniforms: {
      brightness: { value: 1 },
      rimPower: { value: 2.6 },
      rimStrength: { value: 0.38 },
      surfaceStrength: { value: 0.065 },
      bodyColor: { value: new Color(bodyColor) },
      rimColor: { value: new Color(rimColor) },
    },
    vertexShader: `
      varying vec3 surfaceNormal;
      varying vec3 viewDirection;

      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        surfaceNormal = normalMatrix * normal;
        viewDirection = -viewPosition.xyz;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform float brightness;
      uniform float rimPower;
      uniform float rimStrength;
      uniform float surfaceStrength;
      uniform vec3 bodyColor;
      uniform vec3 rimColor;
      varying vec3 surfaceNormal;
      varying vec3 viewDirection;

      void main() {
        float facing = clamp(dot(normalize(surfaceNormal), normalize(viewDirection)), 0.0, 1.0);
        float rim = pow(1.0 - facing, rimPower);
        float alpha = min((surfaceStrength + rim * rimStrength) * brightness, 1.0);
        gl_FragColor = vec4(mix(bodyColor, rimColor, rim), alpha);
        // Accumulate in display space in both the canvas and the feather target.
        gl_FragColor = sRGBTransferOETF(gl_FragColor);
        #include <premultiplied_alpha_fragment>
      }
    `,
  });
}
