import { DEFAULT_FIT, FIT_KEYS, fitValue, readFit, saveFit, type HeadFit } from './anatomy/fit.ts';
import { createAnatomyOverlay, type AnatomyOverlay } from './anatomy/anatomy-overlay.ts';
import { HEAD_LAYERS, PRESETS, type HeadLayer } from './anatomy/layers.ts';
import type { SkullLook } from './anatomy/xray-material.ts';
import { explainCameraError, requestCamera, stopCameraTracks } from './camera.ts';
import { createPreview } from './preview.ts';
import { startFaceTracker } from './tracking/face-tracker.ts';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: ${id}`);
  return node as T;
}

const startButton = element<HTMLButtonElement>('start-camera');
const stopButton = element<HTMLButtonElement>('stop-camera');
const retryTracking = element<HTMLButtonElement>('retry-tracking');
const showTracking = element<HTMLInputElement>('show-tracking');
const status = element('camera-status');
const message = element('camera-message');
const stage = element('stage');
const surface = element('camera-image');
const placeholder = element('camera-placeholder');
const video = element<HTMLVideoElement>('camera-video');
const canvas = element<HTMLCanvasElement>('tracking-overlay');
const anatomyCanvas = element<HTMLCanvasElement>('anatomy-overlay');
const anatomyMessage = element('anatomy-message');
const lookXRay = element<HTMLInputElement>('look-xray');
const lookSolid = element<HTMLInputElement>('look-solid');
const brightness = element<HTMLInputElement>('look-brightness');
const brightnessOutput = element<HTMLOutputElement>('look-brightness-value');
const revealReal = element<HTMLInputElement>('reveal-real');
const revealRealOutput = element<HTMLOutputElement>('reveal-real-value');
const revealFeather = element<HTMLInputElement>('reveal-feather');
const revealFeatherOutput = element<HTMLOutputElement>('reveal-feather-value');
const stats = element('tracking-stats');
const renderFps = element('render-fps');
const trackingFps = element('tracking-fps');
const inferenceMs = element('inference-ms');
const overlayMs = element('overlay-ms');
const processor = element('tracking-delegate');
const fitControls = FIT_KEYS.map((key) => ({
  key,
  slider: element<HTMLInputElement>(`fit-${key}`),
  value: element<HTMLOutputElement>(`fit-${key}-value`),
}));
const layerControls = HEAD_LAYERS.map((key) => ({ key, checkbox: element<HTMLInputElement>(`layer-${key}`) }));
const presetButtons = [...document.querySelectorAll<HTMLButtonElement>('button[data-layer-preset]')];

interface CameraSession {
  stream?: MediaStream;
  stopTracking?: () => void;
}

let session: CameraSession | undefined;
let slowSince: number | undefined;
let showingSlowWarning = false;
let anatomy: AnatomyOverlay | undefined;
let selectedLayers = new Set<HeadLayer>(PRESETS.skull);
let fit = readFit();

function setMessage(text = ''): void {
  if (message.textContent !== text) message.textContent = text;
  message.hidden = !text;
}

function display(value: number | null, suffix = ''): string {
  return value === null ? '—' : `${value.toFixed(1)}${suffix}`;
}

const preview = createPreview(stage, surface, video, canvas, (metrics) => {
  if (showTracking.checked) {
    renderFps.textContent = display(metrics.renderFps);
    trackingFps.textContent = display(metrics.trackingFps);
    inferenceMs.textContent = display(metrics.inferenceMs, ' ms');
    overlayMs.textContent = display(metrics.overlayMs, ' ms');
    processor.textContent = metrics.delegate ?? '—';
  }

  const slow = metrics.trackingFps !== null && metrics.renderFps !== null &&
    Math.min(metrics.trackingFps, metrics.renderFps) < 15 && !document.hidden;
  if (slow) {
    const now = performance.now();
    slowSince ??= now;
    if (now - slowSince >= 3_000) {
      showingSlowWarning = true;
      setMessage('Tracking is running slowly. Try closing other tabs or apps.');
    }
  } else {
    slowSince = undefined;
    if (showingSlowWarning) setMessage();
    showingSlowWarning = false;
  }
}, {
  resize: (width, height, aspect, dpr) => anatomy?.resize(width, height, aspect, dpr),
  render: (face) => anatomy?.render(face),
});

function updateFit(next: HeadFit): void {
  fit = next;
  for (const { key, slider, value } of fitControls) {
    slider.value = String(fit[key]);
    value.textContent = slider.step === '0.01' ? `${fit[key].toFixed(2)}×` : `${fit[key].toFixed(1)} cm`;
  }
  anatomy?.setFit(fit);
}

function setAnatomyMessage(text = ''): void {
  if (anatomyMessage.textContent !== text) anatomyMessage.textContent = text;
  anatomyMessage.hidden = !text;
}

function updateAppearance(): void {
  const look: SkullLook = lookSolid.checked ? 'solid' : 'xray';
  const percent = brightness.valueAsNumber;
  brightnessOutput.textContent = `${percent}%`;
  brightness.setAttribute('aria-valuetext', `${percent}%`);
  anatomy?.setAppearance(look, percent / 100);
}

function updateReveal(): void {
  const realMe = revealReal.valueAsNumber;
  const featherPx = revealFeather.valueAsNumber;
  revealRealOutput.textContent = `${realMe}%`;
  revealFeatherOutput.textContent = `${featherPx} px`;
  revealReal.setAttribute('aria-valuetext', `${realMe}%`);
  revealFeather.setAttribute('aria-valuetext', `${featherPx} px`);
  anatomy?.setReveal(realMe / 100, featherPx);
}

function updateLayers(): void {
  for (const { key, checkbox } of layerControls) checkbox.checked = selectedLayers.has(key);
  for (const button of presetButtons) {
    const preset = PRESETS[button.dataset.layerPreset as keyof typeof PRESETS];
    const matches = preset.length === selectedLayers.size && preset.every((layer) => selectedLayers.has(layer));
    button.setAttribute('aria-pressed', String(matches));
  }
  preview.setOutline(selectedLayers.has('outline'));
  if (session?.stream) anatomy?.setLayers(selectedLayers);
}

function prepareAnatomy(): void {
  try {
    if (!anatomy) {
      anatomy = createAnatomyOverlay(anatomyCanvas, (message) => {
        if (session?.stream) setAnatomyMessage(message);
      });
      anatomy.setFit(fit);
      updateAppearance();
      updateReveal();
      anatomyCanvas.hidden = false;
    }
  } catch (error) {
    setAnatomyMessage('3D rendering is unavailable. Enable WebGL 2 in your browser and restart the camera.');
    console.warn('Anatomy rendering unavailable:', error);
    return;
  }
  anatomy.setLayers(selectedLayers);
}

function showDebug(): void {
  stats.hidden = !showTracking.checked;
  preview.setDebug(showTracking.checked);
}

function stop(text = ''): void {
  const active = session;
  session = undefined;
  if (active?.stream) stopCameraTracks(active.stream);
  active?.stopTracking?.();
  video.pause();
  video.srcObject = null;
  preview.stop();
  anatomy?.setLayers(new Set());
  surface.hidden = true;
  placeholder.hidden = false;
  startButton.disabled = false;
  startButton.textContent = text ? 'Retry' : 'Start camera';
  stopButton.disabled = true;
  retryTracking.hidden = true;
  setAnatomyMessage();
  status.textContent = text ? 'Camera unavailable' : 'Camera is off';
  setMessage(text);
}

function startTracking(active: CameraSession): void {
  active.stopTracking?.();
  active.stopTracking = undefined;
  preview.resetTracking();
  status.textContent = 'Starting face tracking…';
  retryTracking.hidden = true;
  setMessage();

  function showTrackingError(error: unknown): void {
    if (session !== active) return;
    active.stopTracking = undefined;
    preview.resetTracking();
    status.textContent = 'Camera on · tracking unavailable';
    retryTracking.hidden = false;
    setMessage('Face tracking could not start or continue. Check your connection and retry tracking.');
    console.warn('Face tracking unavailable:', error);
  }

  try {
    active.stopTracking = startFaceTracker(video, {
      onReady(delegate) {
        if (session !== active) return;
        preview.setDelegate(delegate);
        status.textContent = 'Camera on · looking for a face';
      },
      onFrame(frame) {
        if (session !== active) return;
        preview.accept(frame);
        const text = frame.face ? 'Camera on · face detected' : 'Camera on · looking for a face';
        if (status.textContent !== text) status.textContent = text;
      },
      onError: showTrackingError,
    });
  } catch (error) {
    showTrackingError(error);
  }
}

async function start(): Promise<void> {
  if (session) return;
  const active: CameraSession = {};
  session = active;
  startButton.disabled = true;
  stopButton.disabled = false;
  status.textContent = 'Waiting for camera…';
  setMessage();

  try {
    const stream = await requestCamera();
    if (session !== active) {
      stopCameraTracks(stream);
      return;
    }
    active.stream = stream;
    for (const track of stream.getVideoTracks()) {
      track.addEventListener('ended', () => {
        if (session === active) stop('The camera disconnected. Check the connection and retry.');
      }, { once: true });
    }
    video.srcObject = stream;
    await video.play();
    if (session !== active) return;
    surface.hidden = false;
    placeholder.hidden = true;
    prepareAnatomy();
    preview.start();
    startTracking(active);
  } catch (error) {
    if (session === active) stop(explainCameraError(error));
  }
}

startButton.addEventListener('click', () => void start());
stopButton.addEventListener('click', () => stop());
retryTracking.addEventListener('click', () => {
  if (session?.stream) startTracking(session);
});
showTracking.addEventListener('change', showDebug);
lookXRay.addEventListener('change', updateAppearance);
lookSolid.addEventListener('change', updateAppearance);
brightness.addEventListener('input', updateAppearance);
revealReal.addEventListener('input', updateReveal);
revealFeather.addEventListener('input', updateReveal);
for (const { key, checkbox } of layerControls) {
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) selectedLayers.add(key);
    else selectedLayers.delete(key);
    updateLayers();
  });
}
for (const button of presetButtons) {
  button.addEventListener('click', () => {
    selectedLayers = new Set(PRESETS[button.dataset.layerPreset as keyof typeof PRESETS]);
    updateLayers();
  });
}
for (const { key, slider } of fitControls) {
  slider.addEventListener('input', () => {
    updateFit({ ...fit, [key]: fitValue(key, slider.valueAsNumber) });
    saveFit(fit);
  });
}
element('reset-fit').addEventListener('click', () => {
  updateFit({ ...DEFAULT_FIT });
  saveFit(fit);
});

function dispose(): void {
  stop();
  anatomy?.dispose();
  anatomy = undefined;
  anatomyCanvas.hidden = true;
}

window.addEventListener('pagehide', dispose);
if (import.meta.hot) import.meta.hot.dispose(dispose);
updateFit(fit);
updateAppearance();
updateReveal();
updateLayers();
showDebug();
