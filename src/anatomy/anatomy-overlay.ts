import {
  AmbientLight, BufferGeometry, DirectionalLight, Group, LoadingManager, Material, Mesh, Scene, Texture, Vector3,
  WebGLRenderer,
  type Object3D, type ShaderMaterial,
} from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type GUI from 'three/addons/libs/lil-gui.module.min.js';
import type { TrackedFace } from '../tracking/types.ts';
import type { HeadFit } from './fit.ts';
import { applyHeadFit, applyHeadPose, createHeadCamera } from './head-transform.ts';
import { createHeadCompositor } from './head-compositor.ts';
import type { Lens } from './hand-bones.ts';
import type { LabelAnchor } from './label-layout.ts';
import { MODEL_LAYERS, type AnatomyLayer, type ModelLayer } from './layers.ts';
import { createXRayMaterial, type SkullLook } from './xray-material.ts';

const METERS_TO_CENTIMETERS = 100;

const LAYER_STYLE = {
  skull: { label: 'Skull', colors: [0x2484cf, 0x95edff], glow: 1 },
  brain: { label: 'Brain', colors: [0x7b47ce, 0xd5a3ff], glow: 0.32 },
  muscles: { label: 'Muscles', colors: [0xb33b4b, 0xff8a96], glow: 1 },
  eyes: { label: 'Eyes', colors: [0x38977d, 0xa2ffdd], glow: 1 },
} as const satisfies Record<ModelLayer, { label: string; colors: readonly [number, number]; glow: number }>;

const HEAD_LABELS: Record<ModelLayer, Record<string, string>> = {
  skull: {
    'Frontal bone': 'Frontal bone',
    'Parietal bone left': 'Parietal bone',
    'Parietal bone right': 'Parietal bone',
    'Temporal bone left': 'Temporal bone',
    'Temporal bone right': 'Temporal bone',
    'Occipital bone': 'Occipital bone',
    'Zygomatic bone left': 'Zygomatic bone',
    'Zygomatic bone right': 'Zygomatic bone',
    'Maxilla left': 'Maxilla',
    'Maxilla right': 'Maxilla',
    Mandible: 'Mandible',
  },
  brain: {
    // BodyParts3D IDs for the cerebral white matter, cerebellum, and pons.
    'Brain FJ1758': 'Cerebrum',
    'Brain FJ1806': 'Cerebrum',
    'Brain FJ1781': 'Cerebellum',
    'Brain FJ1830': 'Cerebellum',
    'Brain FJ1775': 'Brainstem',
    'Brain FJ1822': 'Brainstem',
  },
  muscles: {
    // BodyParts3D pairs for the inferior oblique, genioglossus, and levator veli palatini.
    'Head muscle FJ1294': 'Eye muscles',
    'Head muscle FJ1345': 'Eye muscles',
    'Head muscle FJ2738': 'Tongue muscles',
    'Head muscle FJ2750': 'Tongue muscles',
    'Head muscle FJ2741': 'Soft palate muscles',
    'Head muscle FJ2753': 'Soft palate muscles',
  },
  eyes: { 'Cornea left FJ1289': 'Left eye', 'Cornea right FJ1340': 'Right eye' },
};

const EYE_DETAIL_LABELS: Readonly<Record<string, string>> = {
  'Cornea left FJ1289': 'Cornea',
  'Cornea right FJ1340': 'Cornea',
  'Iris left FJ1297': 'Iris',
  'Iris right FJ1348': 'Iris',
  'Lens left FJ1305': 'Lens',
  'Lens right FJ1356': 'Lens',
  'Sclera left FJ1317': 'Sclera',
  'Sclera right FJ1368': 'Sclera',
};

type LabelSurface = 'front' | 'upper-front' | 'side' | 'back';

const LABEL_SURFACES: Partial<Record<string, LabelSurface>> = {
  'Parietal bone': 'side',
  'Temporal bone': 'side',
  'Occipital bone': 'back',
  Cerebellum: 'back',
  Cornea: 'upper-front',
  Iris: 'side',
  Sclera: 'side',
};

interface ModelLabel {
  text: string;
  mesh: Mesh;
  point: Vector3;
  eyeDetail?: boolean;
}

interface ModelSlot {
  name: ModelLayer;
  xray: ShaderMaterial;
  solid: Map<Mesh, Material | Material[]>;
  labels: ModelLabel[];
  selected: boolean;
  pending: boolean;
  failed: boolean;
  model?: Object3D;
}

export interface AnatomyOverlay {
  setLayers(enabled: ReadonlySet<AnatomyLayer>): void;
  resize(width: number, height: number, aspect: number, dpr: number): void;
  setFit(fit: HeadFit): void;
  setAppearance(look: SkullLook, brightness: number): void;
  setReveal(realMe: number, featherPx: number): void;
  render(face: TrackedFace | null, lens: Lens | null): void;
  getLabelAnchors(): LabelAnchor[];
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
      labels: [],
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
  const decoderDownloads = new LoadingManager();
  let decoder = new DRACOLoader(decoderDownloads).setWorkerLimit(2);
  let loader = new GLTFLoader().setDRACOLoader(decoder);
  let decoderFailed = false;
  let look: SkullLook = 'xray';
  let realMe = 0;
  let featherPx = 0;
  let faceDrawn: TrackedFace | null = null;
  let lensDrawn: Lens | null = null;
  const projected = new Vector3();
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
      const { scene: model } = await loader.parseAsync(data, '').catch((error: unknown) => {
        decoderFailed = true;
        throw error;
      });
      if (abort.signal.aborted) {
        disposeModel(model);
        return;
      }
      model.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        slot.solid.set(object, object.material);
        // GLTFLoader stores the original node name before sanitizing it for Three.js.
        const name = object.userData.name as string;
        const text = HEAD_LABELS[slot.name][name];
        if (text) {
          slot.labels.push({ text, mesh: object, point: labelPoint(object.geometry, LABEL_SURFACES[text]) });
        }
        const detail = slot.name === 'eyes' ? EYE_DETAIL_LABELS[name] : undefined;
        if (detail) {
          slot.labels.push({
            text: detail, mesh: object, point: labelPoint(object.geometry, LABEL_SURFACES[detail]), eyeDetail: true,
          });
        }
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
      // A failed decoder download is cached by DRACOLoader. Retry with a fresh loader.
      if (decoderFailed && !slots.some((slot) => slot.pending)) {
        decoder.dispose();
        decoder = new DRACOLoader(decoderDownloads).setWorkerLimit(2);
        loader = new GLTFLoader().setDRACOLoader(decoder);
        decoderFailed = false;
      }
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
    render(face, lens) {
      if (face === faceDrawn && lens === lensDrawn && !dirty) return;
      dirty = false;
      faceDrawn = face;
      lensDrawn = lens;
      if (!face || realMe === 1 || !slots.some((slot) => slot.model?.visible)) {
        renderer.clear();
        return;
      }
      applyHeadPose(pose, face.poseMatrix);
      compositor.render(scene, camera, featherPx, look === 'xray', lens);
    },
    getLabelAnchors() {
      const anchors: (LabelAnchor & { depth: number })[] = [];
      if (!faceDrawn || realMe === 1) return anchors;
      const showEyeDetails = !slots.some((slot) => slot.name !== 'eyes' && slot.selected);
      for (const slot of slots) {
        if (!slot.model?.visible || (look === 'xray' && slot.xray.uniforms.brightness.value <= 0)) continue;
        for (const { text, mesh, point, eyeDetail = false } of slot.labels) {
          if (slot.name === 'eyes' && eyeDetail !== showEyeDetails) continue;
          projected.copy(point).applyMatrix4(mesh.matrixWorld).project(camera);
          if (projected.z < -1 || projected.z > 1) continue;
          anchors.push({ text, x: (1 + projected.x) / 2, y: (1 - projected.y) / 2, depth: projected.z });
        }
      }
      // Prefer the nearer mesh for a shared label. The label overlay checks image and lens bounds.
      return anchors.sort((first, second) => first.depth - second.depth);
    },
    dispose() {
      abort.abort();
      canvas.removeEventListener('webglcontextrestored', invalidate);
      tuningPanel?.destroy();
      decoderDownloads.abort();
      decoder.dispose();
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

function labelPoint(geometry: BufferGeometry, surface: LabelSurface = 'front'): Vector3 {
  // Choose a real surface vertex near the center of the requested side of the mesh.
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  const target = bounds.getCenter(new Vector3());
  if (surface === 'side') target.x = target.x > 0 ? bounds.max.x : bounds.min.x;
  else target.z = surface === 'back' ? bounds.min.z : bounds.max.z;
  if (surface === 'upper-front') target.y += (bounds.max.y - bounds.min.y) * 0.25;
  const position = geometry.getAttribute('position');
  const point = new Vector3();
  const vertex = new Vector3();
  let nearest = Infinity;
  for (let index = 0; index < position.count; index++) {
    vertex.fromBufferAttribute(position, index);
    const distance = vertex.distanceToSquared(target);
    if (distance >= nearest) continue;
    nearest = distance;
    point.copy(vertex);
  }
  return point;
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
