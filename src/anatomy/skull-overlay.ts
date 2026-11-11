import {
  AmbientLight, BufferGeometry, DirectionalLight, Group, Material, Mesh, Scene, Texture, WebGLRenderer,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { TrackedFace } from '../tracking/types.ts';
import type { HeadFit } from './fit.ts';
import { applyHeadFit, applyHeadPose, createHeadCamera } from './head-transform.ts';

const SKULL_URL = `${import.meta.env.BASE_URL}models/skull.glb`;
const METERS_TO_CENTIMETERS = 100;

export interface SkullOverlay {
  load(): Promise<void>;
  resize(width: number, height: number, aspect: number, dpr: number): void;
  setFit(fit: HeadFit): void;
  render(face: TrackedFace | null): void;
  dispose(): void;
}

export function createSkullOverlay(canvas: HTMLCanvasElement): SkullOverlay {
  const context = canvas.getContext('webgl2', { alpha: true, antialias: true });
  if (!context) throw new Error('WebGL 2 is unavailable.');
  const renderer = new WebGLRenderer({ canvas, context, alpha: true, antialias: true });
  const camera = createHeadCamera();
  const scene = new Scene();
  const pose = new Group();
  const registration = new Group();
  const adjustment = new Group();
  const key = new DirectionalLight(0xe0f3ff, 2.1);
  const abort = new AbortController();
  let model: Object3D | undefined;
  let loading: Promise<void> | undefined;
  let faceDrawn: TrackedFace | null = null;
  let dirty = true;

  pose.matrixAutoUpdate = false;
  // Midpoint of the canonical inner eye corners (MediaPipe landmarks 133 and 362).
  registration.position.set(0, 2.59, 3.76);
  pose.add(registration);
  registration.add(adjustment);
  key.position.set(-4, 8, 10);
  scene.add(pose, new AmbientLight(0xc9d9e8, 0.55), key);
  renderer.setClearColor(0, 0);

  function onRestore(): void {
    dirty = true;
  }
  canvas.addEventListener('webglcontextrestored', onRestore);

  return {
    async load() {
      if (model || abort.signal.aborted) return;
      loading ??= (async () => {
        try {
          const response = await fetch(SKULL_URL, { signal: abort.signal });
          if (!response.ok) throw new Error(`Skull model download failed (HTTP ${response.status}).`);
          const data = await response.arrayBuffer();
          if (abort.signal.aborted) return;
          const { scene: skull } = await new GLTFLoader().parseAsync(data, '');
          if (abort.signal.aborted) {
            disposeModel(skull);
            return;
          }
          model = skull;
          skull.scale.multiplyScalar(METERS_TO_CENTIMETERS);
          // Move the GLB's lacrimal midpoint to the fit pivot before applying head pose.
          skull.position.set(-0.06, 1.63, -7.17);
          adjustment.add(skull);
          dirty = true;
        } finally {
          loading = undefined;
        }
      })();
      await loading;
    },
    resize(width, height, aspect, dpr) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      const pixelRatio = Math.min(dpr, 2);
      if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      dirty = true;
    },
    setFit(fit) {
      applyHeadFit(adjustment, fit);
      dirty = true;
    },
    render(face) {
      if (face === faceDrawn && !dirty) return;
      dirty = false;
      faceDrawn = face;
      if (!face || !model) {
        renderer.clear();
        return;
      }
      applyHeadPose(pose, face.poseMatrix);
      renderer.render(scene, camera);
    },
    dispose() {
      abort.abort();
      canvas.removeEventListener('webglcontextrestored', onRestore);
      if (model) {
        adjustment.remove(model);
        disposeModel(model);
        model = undefined;
      }
      renderer.dispose();
    },
  };
}

function disposeModel(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof Texture) textures.add(value);
      }
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}
