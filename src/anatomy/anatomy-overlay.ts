import {
  AmbientLight, BufferGeometry, DirectionalLight, Group, Material, Mesh, Scene, Texture, WebGLRenderer,
  type Object3D, type ShaderMaterial,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type GUI from 'three/addons/libs/lil-gui.module.min.js';
import type { TrackedFace } from '../tracking/types.ts';
import type { HeadFit } from './fit.ts';
import { applyHeadFit, applyHeadPose, createHeadCamera } from './head-transform.ts';
import { createHeadCompositor } from './head-compositor.ts';
import { MODEL_LAYERS, type HeadLayer, type ModelLayer } from './layers.ts';
import { createXRayMaterial, type SkullLook } from './xray-material.ts';

const METERS_TO_CENTIMETERS = 100;

const LAYER_STYLE = {
  skull: { label: 'Skull', colors: [0x2484cf, 0x95edff], glow: 1 },
  brain: { label: 'Brain', colors: [0x7b47ce, 0xd5a3ff], glow: 0.32 },
  muscles: { label: 'Muscles', colors: [0xb33b4b, 0xff8a96], glow: 1 },
  eyes: { label: 'Eyes', colors: [0x38977d, 0xa2ffdd], glow: 1 },
} as const satisfies Record<ModelLayer, { label: string; colors: readonly [number, number]; glow: number }>;

interface ModelSlot {
  name: ModelLayer;
  xray: ShaderMaterial;
  solid: Map<Mesh, Material | Material[]>;
  selected: boolean;
  pending: boolean;
  failed: boolean;
  model?: Object3D;
}

export interface AnatomyOverlay {
  setLayers(enabled: ReadonlySet<HeadLayer>): void;
  resize(width: number, height: number, aspect: number, dpr: number): void;
  setFit(fit: HeadFit): void;
  setAppearance(look: SkullLook, brightness: number): void;
  setReveal(realMe: number, featherPx: number): void;
  render(face: TrackedFace | null): void;
  dispose(): void;
}

export function createAnatomyOverlay(canvas: HTMLCanvasElement, onStatus: (message: string) => void): AnatomyOverlay {
  const context = canvas.getContext('webgl2', { alpha: true, antialias: true });
  if (!context) throw new Error('WebGL 2 is unavailable.');
  const renderer = new WebGLRenderer({ canvas, context, alpha: true, antialias: true });
  const compositor = createHeadCompositor(renderer);
  const camera = createHeadCamera();
  const scene = new Scene();
  const pose = new Group();
  const registration = new Group();
  const adjustment = new Group();
  const key = new DirectionalLight(0xe0f3ff);
  const ambient = new AmbientLight(0xc9d9e8);
  const slots: ModelSlot[] = MODEL_LAYERS.map((name) => {
    const [bodyColor, rimColor] = LAYER_STYLE[name].colors;
    return {
      name,
      xray: createXRayMaterial(bodyColor, rimColor),
      solid: new Map(),
      selected: false,
      pending: false,
      failed: false,
    };
  });
  // Dev tuning uses the same Fresnel controls for every color.
  const tuning = slots[0].xray.uniforms;
  for (const { xray } of slots.slice(1)) {
    xray.uniforms.rimPower = tuning.rimPower;
    xray.uniforms.rimStrength = tuning.rimStrength;
    xray.uniforms.surfaceStrength = tuning.surfaceStrength;
  }
  const abort = new AbortController();
  const loader = new GLTFLoader();
  let look: SkullLook = 'xray';
  let realMe = 0;
  let featherPx = 0;
  let faceDrawn: TrackedFace | null = null;
  let dirty = true;
  let tuningPanel: GUI | undefined;

  pose.matrixAutoUpdate = false;
  // Midpoint of the canonical inner eye corners (MediaPipe landmarks 133 and 362).
  registration.position.set(0, 2.59, 3.76);
  pose.add(registration);
  registration.add(adjustment);
  key.position.set(-4, 8, 10);
  scene.add(pose, ambient, key);
  renderer.setClearColor(0, 0);

  function invalidate(): void {
    dirty = true;
  }
  canvas.addEventListener('webglcontextrestored', invalidate);

  if (import.meta.env.DEV && new URLSearchParams(location.search).has('tune')) {
    void import('three/addons/libs/lil-gui.module.min.js').then(({ GUI }) => {
      if (abort.signal.aborted) return;
      tuningPanel = new GUI({ title: 'X-ray shader' });
      tuningPanel.add(tuning.rimPower, 'value', 0.5, 6, 0.05).name('Rim power').onChange(invalidate);
      tuningPanel.add(tuning.rimStrength, 'value', 0, 1, 0.01).name('Rim strength').onChange(invalidate);
      tuningPanel.add(tuning.surfaceStrength, 'value', 0, 0.4, 0.01).name('Surface glow').onChange(invalidate);
    }).catch((error) => console.warn('Shader tuning panel unavailable:', error));
  }

  function applyMaterial(slot: ModelSlot, mode: SkullLook): void {
    for (const [mesh, solid] of slot.solid) mesh.material = mode === 'xray' ? slot.xray : solid;
  }

  function reportStatus(): void {
    const pending = slots.filter((slot) => slot.selected && slot.pending).map(({ name }) => LAYER_STYLE[name].label);
    const failed = slots.filter((slot) => slot.selected && slot.failed).map(({ name }) => LAYER_STYLE[name].label);
    const loadingMessage = pending.length ? `Loading ${pending.join(', ')}…` : '';
    const errorMessage = failed.length ? `Could not load ${failed.join(', ')}. Toggle the layer off and on to retry.` : '';
    onStatus([loadingMessage, errorMessage].filter(Boolean).join(' '));
  }

  async function loadLayer(slot: ModelSlot): Promise<void> {
    slot.pending = true;
    slot.failed = false;
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}models/${slot.name}.glb`, { signal: abort.signal });
      if (!response.ok) throw new Error(`Model download failed (HTTP ${response.status}).`);
      const data = await response.arrayBuffer();
      if (abort.signal.aborted) return;
      const { scene: model } = await loader.parseAsync(data, '');
      if (abort.signal.aborted) {
        disposeModel(model);
        return;
      }
      model.traverse((object) => {
        if (object instanceof Mesh) slot.solid.set(object, object.material);
      });
      applyMaterial(slot, look);
      // All layers share the skull's source origin and lacrimal fit pivot.
      model.scale.multiplyScalar(METERS_TO_CENTIMETERS);
      model.position.set(-0.06, 1.63, -7.17);
      model.visible = slot.selected;
      slot.model = model;
      adjustment.add(model);
      invalidate();
    } catch (error) {
      if (abort.signal.aborted) return;
      slot.failed = true;
      console.warn(`${LAYER_STYLE[slot.name].label} model unavailable:`, error);
    } finally {
      slot.pending = false;
      if (!abort.signal.aborted) reportStatus();
    }
  }

  return {
    setLayers(enabled) {
      for (const slot of slots) {
        const selected = enabled.has(slot.name);
        if (slot.selected === selected) continue;
        slot.selected = selected;
        if (slot.model) slot.model.visible = selected;
        else if (selected && !slot.pending) void loadLayer(slot);
      }
      reportStatus();
      invalidate();
    },
    resize(width, height, aspect, dpr) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      const pixelRatio = Math.min(dpr, 2);
      if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      compositor.resize(width, height);
      dirty = true;
    },
    setFit(fit) {
      applyHeadFit(adjustment, fit);
      dirty = true;
    },
    setAppearance(mode, brightness) {
      if (look !== mode) {
        for (const slot of slots) applyMaterial(slot, mode);
        look = mode;
      }
      canvas.dataset.look = look;
      for (const { name, xray } of slots) xray.uniforms.brightness.value = brightness * LAYER_STYLE[name].glow;
      ambient.intensity = 0.55 * brightness;
      key.intensity = 2.1 * brightness;
      dirty = true;
    },
    setReveal(real, feather) {
      realMe = real;
      featherPx = feather;
      canvas.style.opacity = String(1 - realMe);
      canvas.style.visibility = realMe === 1 ? 'hidden' : '';
      invalidate();
    },
    render(face) {
      if (face === faceDrawn && !dirty) return;
      dirty = false;
      faceDrawn = face;
      if (!face || realMe === 1 || !slots.some((slot) => slot.model?.visible)) {
        renderer.clear();
        return;
      }
      applyHeadPose(pose, face.poseMatrix);
      compositor.render(scene, camera, featherPx, look === 'xray');
    },
    dispose() {
      abort.abort();
      canvas.removeEventListener('webglcontextrestored', invalidate);
      tuningPanel?.destroy();
      for (const slot of slots) {
        if (slot.model) {
          applyMaterial(slot, 'solid');
          adjustment.remove(slot.model);
          disposeModel(slot.model);
          slot.solid.clear();
        }
        slot.xray.dispose();
      }
      compositor.dispose();
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
