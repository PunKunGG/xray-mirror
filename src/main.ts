import { DEFAULT_FIT, FIT_KEYS, fitValue, readFit, saveFit, type HeadFit } from './anatomy/fit.ts';
import { createSkullOverlay, type SkullOverlay } from './anatomy/skull-overlay.ts';
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
const skullCanvas = element<HTMLCanvasElement>('skull-overlay');
const skullMessage = element('skull-message');
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

interface CameraSession {
  stream?: MediaStream;
  stopTracking?: () => void;
}

let session: CameraSession | undefined;
let slowSince: number | undefined;
let showingSlowWarning = false;
let skull: SkullOverlay | undefined;
let skullReady = false;
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
  resize: (width, height, aspect, dpr) => skull?.resize(width, height, aspect, dpr),
  render: (face) => skull?.render(face),
});

function updateFit(next: HeadFit): void {
  fit = next;
  for (const { key, slider, value } of fitControls) {
    slider.value = String(fit[key]);
    value.textContent = slider.step === '0.01' ? `${fit[key].toFixed(2)}×` : `${fit[key].toFixed(1)} cm`;
  }
  skull?.setFit(fit);
}

function setSkullMessage(text = ''): void {
  skullMessage.textContent = text;
  skullMessage.hidden = !text;
}

async function prepareSkull(): Promise<void> {
  if (skullReady) return;
  try {
    if (!skull) {
      skull = createSkullOverlay(skullCanvas);
      skull.setFit(fit);
      skullCanvas.hidden = false;
    }
  } catch (error) {
    setSkullMessage('3D rendering is unavailable. Enable WebGL 2 in your browser and restart the camera.');
    console.warn('Skull rendering unavailable:', error);
    return;
  }

  const overlay = skull;
  setSkullMessage('Loading skull model…');
  try {
    await overlay.load();
    if (skull !== overlay) return;
    skullReady = true;
    setSkullMessage();
  } catch (error) {
    if (skull !== overlay) return;
    setSkullMessage('The skull model could not load. Restart the camera to retry.');
    console.warn('Skull model unavailable:', error);
  }
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
  surface.hidden = true;
  placeholder.hidden = false;
  startButton.disabled = false;
  startButton.textContent = text ? 'Retry' : 'Start camera';
  stopButton.disabled = true;
  retryTracking.hidden = true;
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
    void prepareSkull();
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
  skull?.dispose();
  skull = undefined;
  skullReady = false;
  skullCanvas.hidden = true;
  setSkullMessage();
}

window.addEventListener('pagehide', dispose);
if (import.meta.hot) import.meta.hot.dispose(dispose);
updateFit(fit);
showDebug();
