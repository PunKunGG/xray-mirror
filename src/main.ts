import { DEFAULT_FIT, FIT_KEYS, fitValue, readFit, saveFit, type HeadFit } from './anatomy/fit.ts';
import { createAnatomyOverlay, type AnatomyOverlay } from './anatomy/anatomy-overlay.ts';
import { DEFAULT_LABEL_OPTIONS, LABEL_FOCI, decodeLabelOptions } from './anatomy/label-options.ts';
import { ANATOMY_LAYERS, PRESETS, type AnatomyLayer } from './anatomy/layers.ts';
import { readOverlaySettings, saveOverlaySettings } from './anatomy/overlay-settings.ts';
import { VIEWS, type ViewSettings } from './anatomy/views.ts';
import type { SkullLook } from './anatomy/xray-material.ts';
import { explainCameraError, requestCamera, stopCameraTracks } from './camera.ts';
import { createAnatomyLab } from './lab/anatomy-lab.ts';
import { createJawLesson } from './lab/jaw-lesson.ts';
import { createBrainLesson } from './lab/brain-lesson.ts';
import { createPreview } from './preview.ts';
import { startFaceTracker } from './tracking/face-tracker.ts';
import { startHandTracker } from './tracking/hand-tracker.ts';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: ${id}`);
  return node as T;
}

const startButton = element<HTMLButtonElement>('start-camera');
const stopButton = element<HTMLButtonElement>('stop-camera');
const retryTracking = element<HTMLButtonElement>('retry-tracking');
const showTracking = element<HTMLInputElement>('show-tracking');
const showLabels = element<HTMLInputElement>('show-labels');
const labelControls = element('label-options');
const labelFocus = LABEL_FOCI.map((focus) => ({ focus, input: element<HTMLInputElement>(`label-focus-${focus}`) }));
const labelHeadOptions = element('label-head-options');
const labelHandOptions = element('label-hand-options');
const labelHeadGroup = element<HTMLSelectElement>('label-head-group');
const labelHandGroup = element<HTMLSelectElement>('label-hand-group');
const labelGroupNotice = element('label-group-notice');
const labelOverflow = element<HTMLDetailsElement>('label-overflow');
const labelOverflowList = element('label-overflow-list');
const status = element('camera-status');
const message = element('camera-message');
const stage = element('stage');
const surface = element('camera-image');
const placeholder = element('camera-placeholder');
const video = element<HTMLVideoElement>('camera-video');
const canvas = element<HTMLCanvasElement>('tracking-overlay');
const labelCanvas = element<HTMLCanvasElement>('label-overlay');
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
const revealMode = element<HTMLSelectElement>('reveal-mode');
const lensControls = element('lens-controls');
const lensSize = element<HTMLInputElement>('lens-size');
const lensSizeOutput = element<HTMLOutputElement>('lens-size-value');
const lensMessage = element('lens-message');
const handMessage = element('hand-message');
const retryHands = element<HTMLButtonElement>('retry-hands');
const handCountRow = element('hand-count-row');
const handCountOutput = element('hand-count');
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
const layerControls = ANATOMY_LAYERS.map((key) => ({ key, checkbox: element<HTMLInputElement>(`layer-${key}`) }));
const presetButtons = [...document.querySelectorAll<HTMLButtonElement>('button[data-layer-preset]')];
const viewButtons = [...document.querySelectorAll<HTMLButtonElement>('button[data-view-preset]')];
const mirrorWorkspace = element('mirror-workspace');
const labWorkspace = element('anatomy-lab');
const openLabButton = element<HTMLButtonElement>('open-lab');
const labLessons = {
  finger: { section: element('finger-lesson'), button: element('lab-select-finger') },
  jaw: { section: element('jaw-lesson'), button: element('lab-select-jaw') },
  brain: { section: element('brain-lesson'), button: element('lab-select-brain') },
};
type LabLesson = keyof typeof labLessons;

interface CameraSession {
  stream?: MediaStream;
  playing?: boolean;
  stopTracking?: () => void;
  stopHands?: () => void;
}

let session: CameraSession | undefined;
let slowSince: number | undefined;
let showingSlowWarning = false;
let anatomy: AnatomyOverlay | undefined;
let selectedLayers = new Set<AnatomyLayer>(VIEWS.classic.layers);
let labelOptions = DEFAULT_LABEL_OPTIONS;
let fit = readFit();
let handsState: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
let handCount = 0;
let fingerLesson: ReturnType<typeof createAnatomyLab> | undefined;
let jawLesson: ReturnType<typeof createJawLesson> | undefined;
let brainLesson: ReturnType<typeof createBrainLesson> | undefined;
let activeLesson: LabLesson | undefined;

function setMessage(text = ''): void {
  if (message.textContent !== text) message.textContent = text;
  message.hidden = !text;
}

function display(value: number | null, suffix = ''): string {
  return value === null ? '—' : `${value.toFixed(1)}${suffix}`;
}

const preview = createPreview(stage, surface, video, canvas, labelCanvas, (metrics) => {
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
  render: (face, lens) => anatomy?.render(face, lens),
  getLabelAnchors: (detailedEyes) => anatomy?.getLabelAnchors(detailedEyes) ?? [],
  onLabelOverflow: updateLabelOverflow,
  onHands: (count) => {
    handCount = count;
    updateHandStatus();
  },
});

function updateHandStatus(): void {
  handCountRow.hidden = handsState !== 'ready';
  handCountOutput.textContent = String(handCount);
  const handText = handsState === 'error' ? 'Hand tracking is unavailable.'
    : handsState === 'loading' ? 'Loading hand tracking…' : '';
  if (handMessage.textContent !== handText) handMessage.textContent = handText;
  handMessage.hidden = !handText;
  retryHands.hidden = handsState !== 'error';

  const waiting = revealMode.value === 'hand-lens' && session?.playing && !handCount;
  const text = 'Showing whole head until a hand is detected.';
  if (waiting && lensMessage.textContent !== text) lensMessage.textContent = text;
  lensMessage.hidden = !waiting;
}

function stopHands(active: CameraSession | undefined): void {
  active?.stopHands?.();
  if (active) active.stopHands = undefined;
  handsState = 'idle';
  handCount = 0;
  preview.acceptHands(null);
  updateHandStatus();
}

function syncHandTracking(): void {
  const active = session;
  if (!active?.playing || !(selectedLayers.has('hands') || revealMode.value === 'hand-lens')) {
    stopHands(active);
    return;
  }
  if (active.stopHands || handsState === 'error') {
    updateHandStatus();
    return;
  }
  handsState = 'loading';
  updateHandStatus();
  active.stopHands = startHandTracker(video, {
    onReady() {
      if (session !== active) return;
      handsState = 'ready';
      updateHandStatus();
    },
    onFrame(frame) {
      if (session === active) preview.acceptHands(frame);
    },
    onError(error) {
      if (session !== active) return;
      stopHands(active);
      handsState = 'error';
      updateHandStatus();
      console.warn('Hand tracking unavailable:', error);
    },
  });
}

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
  preview.setAppearance(look, percent / 100);
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

function updateLens(): void {
  const lensSelected = revealMode.value === 'hand-lens';
  const percent = lensSize.valueAsNumber;
  lensControls.hidden = !lensSelected;
  lensSizeOutput.textContent = `${percent}%`;
  lensSize.setAttribute('aria-valuetext', `${percent}%`);
  preview.setLens(lensSelected ? percent / 100 : 0);
}

function matchesLayers(layers: readonly AnatomyLayer[]): boolean {
  return layers.length === selectedLayers.size && layers.every((layer) => selectedLayers.has(layer));
}

function updateLabelOverflow(names: readonly string[]): void {
  if (!names.length) {
    if (!labelOverflow.hidden && labelOverflow.contains(document.activeElement)) {
      (labelOptions.focus === 'head' ? labelHeadGroup : labelHandGroup).focus();
    }
    labelOverflow.open = false;
  }
  labelOverflow.hidden = names.length === 0;
  labelOverflowList.replaceChildren(...names.map((name) => {
    const item = document.createElement('li');
    item.textContent = name;
    return item;
  }));
}

function updateLabelGroupNotice(): void {
  let notice = '';
  if (labelOptions.focus === 'head' && !selectedLayers.has(labelOptions.headGroup)) {
    notice = `Turn on ${labelHeadGroup.selectedOptions[0].textContent} in Layers to see these labels.`;
  } else if (labelOptions.focus === 'hands' && !selectedLayers.has('hands')) {
    notice = 'Turn on Hand bones in Layers to see these labels.';
  }
  labelGroupNotice.textContent = notice;
  labelGroupNotice.hidden = !notice;
}

function syncLabelControls(): void {
  labelControls.hidden = !showLabels.checked;
  for (const { focus, input } of labelFocus) input.checked = labelOptions.focus === focus;
  labelHeadOptions.hidden = labelOptions.focus !== 'head';
  labelHandOptions.hidden = labelOptions.focus !== 'hands';
  labelHeadGroup.value = labelOptions.headGroup;
  labelHandGroup.value = labelOptions.handGroup;
  updateLabelGroupNotice();
  preview.setLabels(showLabels.checked, labelOptions);
}

function updateViewButtons(): void {
  for (const button of viewButtons) {
    const view = VIEWS[button.dataset.viewPreset as keyof typeof VIEWS];
    const matches = matchesLayers(view.layers) && lookSolid.checked === (view.look === 'solid') &&
      brightness.valueAsNumber === view.brightness && revealMode.value === view.reveal &&
      (view.reveal === 'whole-head' || lensSize.valueAsNumber === view.lensSize) &&
      revealReal.valueAsNumber === view.realMe && revealFeather.valueAsNumber === view.feather &&
      showLabels.checked === view.labels && (!view.labels || (
        labelOptions.focus === view.labelOptions.focus &&
        (labelOptions.focus !== 'head' || labelOptions.headGroup === view.labelOptions.headGroup) &&
        (labelOptions.focus !== 'hands' || labelOptions.handGroup === view.labelOptions.handGroup)
      ));
    button.setAttribute('aria-pressed', String(matches));
  }
}

function updateLayers(): void {
  for (const { key, checkbox } of layerControls) checkbox.checked = selectedLayers.has(key);
  for (const button of presetButtons) {
    const preset = PRESETS[button.dataset.layerPreset as keyof typeof PRESETS];
    button.setAttribute('aria-pressed', String(matchesLayers(preset)));
  }
  preview.setOutline(selectedLayers.has('outline'));
  preview.setHandBones(selectedLayers.has('hands'));
  updateLabelGroupNotice();
  if (session?.stream) anatomy?.setLayers(selectedLayers);
  syncHandTracking();
}

function applyView(view: ViewSettings): void {
  selectedLayers = new Set(view.layers);
  lookXRay.checked = view.look === 'xray';
  lookSolid.checked = view.look === 'solid';
  brightness.value = String(view.brightness);
  revealMode.value = view.reveal;
  lensSize.value = String(view.lensSize);
  revealReal.value = String(view.realMe);
  revealFeather.value = String(view.feather);
  showLabels.checked = view.labels;
  labelOptions = view.labelOptions;
  syncLabelControls();
  updateAppearance();
  updateReveal();
  updateLens();
  updateLayers();
  updateViewButtons();
}

function rememberOverlaySettings(): void {
  saveOverlaySettings({
    layers: [...selectedLayers],
    look: lookSolid.checked ? 'solid' : 'xray',
    brightness: brightness.valueAsNumber,
    reveal: revealMode.value === 'hand-lens' ? 'hand-lens' : 'whole-head',
    lensSize: lensSize.valueAsNumber,
    realMe: revealReal.valueAsNumber,
    feather: revealFeather.valueAsNumber,
    labels: showLabels.checked,
    labelOptions,
    diagnostics: showTracking.checked,
  });
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
  stopHands(active);
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
    active.playing = true;
    surface.hidden = false;
    placeholder.hidden = true;
    prepareAnatomy();
    preview.start();
    startTracking(active);
    syncHandTracking();
  } catch (error) {
    if (session === active) stop(explainCameraError(error));
  }
}

startButton.addEventListener('click', () => void start());
stopButton.addEventListener('click', () => stop());

function currentLesson() {
  if (activeLesson === 'jaw') return jawLesson;
  if (activeLesson === 'finger') return fingerLesson;
  if (activeLesson === 'brain') return brainLesson;
}

function selectLesson(lesson: LabLesson): void {
  if (activeLesson === lesson) return;
  currentLesson()?.close();
  activeLesson = lesson;
  for (const [key, { section, button }] of Object.entries(labLessons)) {
    section.hidden = key !== lesson;
    button.setAttribute('aria-pressed', String(key === lesson));
  }
  if (lesson === 'jaw') {
    jawLesson ??= createJawLesson(labLessons.jaw.section);
    jawLesson.open();
  } else if (lesson === 'brain') {
    brainLesson ??= createBrainLesson(labLessons.brain.section);
    brainLesson.open();
  } else {
    fingerLesson ??= createAnatomyLab(labLessons.finger.section);
    fingerLesson.open();
  }
}

openLabButton.addEventListener('click', () => {
  stop();
  mirrorWorkspace.hidden = true;
  labWorkspace.hidden = false;
  selectLesson('finger');
});
labLessons.finger.button.addEventListener('click', () => selectLesson('finger'));
labLessons.jaw.button.addEventListener('click', () => selectLesson('jaw'));
labLessons.brain.button.addEventListener('click', () => selectLesson('brain'));
element('close-lab').addEventListener('click', () => {
  currentLesson()?.close();
  activeLesson = undefined;
  labWorkspace.hidden = true;
  mirrorWorkspace.hidden = false;
  openLabButton.focus();
});
retryTracking.addEventListener('click', () => {
  if (session?.stream) startTracking(session);
});
showTracking.addEventListener('change', showDebug);
showLabels.addEventListener('change', syncLabelControls);
for (const { focus, input } of labelFocus) {
  input.addEventListener('change', () => {
    if (!input.checked) return;
    labelOptions = { ...labelOptions, focus };
    syncLabelControls();
    rememberOverlaySettings();
  });
}
for (const select of [labelHeadGroup, labelHandGroup]) {
  select.addEventListener('change', () => {
    labelOptions = decodeLabelOptions({ ...labelOptions, headGroup: labelHeadGroup.value, handGroup: labelHandGroup.value });
    syncLabelControls();
    rememberOverlaySettings();
  });
}
lookXRay.addEventListener('change', updateAppearance);
lookSolid.addEventListener('change', updateAppearance);
brightness.addEventListener('input', updateAppearance);
revealReal.addEventListener('input', updateReveal);
revealFeather.addEventListener('input', updateReveal);
revealMode.addEventListener('change', () => {
  updateLens();
  syncHandTracking();
});
lensSize.addEventListener('input', updateLens);
retryHands.addEventListener('click', () => {
  if (handsState !== 'error') return;
  handsState = 'idle';
  syncHandTracking();
});
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
    updateViewButtons();
    rememberOverlaySettings();
  });
}
for (const button of viewButtons) {
  button.addEventListener('click', () => {
    applyView(VIEWS[button.dataset.viewPreset as keyof typeof VIEWS]);
    rememberOverlaySettings();
  });
}
// Sliders update the preview on input and save once the user commits the change.
for (const control of [
  showTracking, showLabels, lookXRay, lookSolid, brightness, revealMode, lensSize, revealReal, revealFeather,
  ...layerControls.map(({ checkbox }) => checkbox),
]) {
  control.addEventListener('change', rememberOverlaySettings);
}
// User edits update the highlighted view after the control's own listener has run.
element('overlay-settings').addEventListener('input', updateViewButtons);
element('overlay-settings').addEventListener('change', updateViewButtons);
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
  fingerLesson?.close();
  jawLesson?.dispose();
  brainLesson?.dispose();
  stop();
  anatomy?.dispose();
  anatomy = undefined;
  anatomyCanvas.hidden = true;
}

window.addEventListener('pagehide', dispose);
window.addEventListener('pageshow', (event) => {
  if (event.persisted && !labWorkspace.hidden) currentLesson()?.resumeLayout();
});
if (import.meta.hot) import.meta.hot.dispose(dispose);

const savedSettings = readOverlaySettings();
showTracking.checked = savedSettings.diagnostics;
updateFit(fit);
applyView(savedSettings);
showDebug();
