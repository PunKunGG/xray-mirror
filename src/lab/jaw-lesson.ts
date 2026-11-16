import { Matrix4 } from 'three';
import { createAnatomyOverlay, type AnatomyOverlay } from '../anatomy/anatomy-overlay.ts';
import { DEFAULT_FIT, readFit } from '../anatomy/fit.ts';
import { explainCameraError, requestCamera, stopCameraTracks } from '../camera.ts';
import { startFaceTracker } from '../tracking/face-tracker.ts';
import type { TrackedFace } from '../tracking/types.ts';

type Step = 'upper' | 'lower' | 'quiz' | 'complete';
const ANGLES = { left: -38, front: 0, right: 38 } as const;
type Angle = keyof typeof ANGLES;
const SKULL = new Set(['skull'] as const);
const NO_LAYERS = new Set<never>();

const CONTENT = {
  upper: { title: 'Find the upper jaw', description: 'The left and right maxillae meet to form the upper jaw and support the upper teeth.' },
  lower: { title: 'Find the lower jaw', description: 'The mandible forms the lower jaw, including the chin, and supports the lower teeth.' },
  quiz: { title: 'Identify the jaws', description: 'Use the shape and position of the highlighted bone to answer each question.' },
  complete: { title: 'Lesson complete', description: 'The paired maxillae form the upper jaw. The mandible is the single bone of the lower jaw.' },
} as const;

const QUESTIONS = [
  { bone: 'Maxilla', answer: 'maxilla', text: 'Which name matches the upper jaw?', hint: 'Look above the mouth, beneath the eye sockets.' },
  { bone: 'Mandible', answer: 'mandible', text: 'Which name matches the lower jaw?', hint: 'Look for the bone that includes the chin.' },
] as const;

interface CameraRun {
  stream?: MediaStream;
  stopTracking?: () => void;
  staleTimer?: number;
}

function modelPose(angle: Angle): TrackedFace {
  const matrix = new Matrix4().makeRotationY(ANGLES[angle] * Math.PI / 180).setPosition(0, -4, -29);
  return { landmarks: new Float32Array(), poseMatrix: Float32Array.from(matrix.elements) };
}

export function createJawLesson(root: HTMLElement) {
  function get<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = root.querySelector<T>(`#${id}`);
    if (!element) throw new Error(`Missing jaw lesson element: ${id}`);
    return element;
  }

  const title = get('jaw-title');
  const useExampleButton = get('jaw-use-example');
  const useCameraButton = get('jaw-use-camera');
  const stage = get('jaw-stage');
  const surface = get('jaw-surface');
  const video = get<HTMLVideoElement>('jaw-video');
  const canvas = get<HTMLCanvasElement>('jaw-overlay');
  const status = get('jaw-status');
  const turns = get('jaw-turn-controls');
  const turnButtons = turns.querySelectorAll<HTMLButtonElement>('[data-jaw-angle]');
  const steps = get('jaw-steps').querySelectorAll<HTMLElement>('[data-jaw-step]');
  const stepTitle = get('jaw-step-title');
  const description = get('jaw-description');
  const next = get('jaw-next');
  const quiz = get<HTMLFormElement>('jaw-quiz');
  const question = get('jaw-question');
  const feedback = get('jaw-feedback');
  const restart = get('jaw-restart');

  let skull: AnatomyOverlay | undefined;
  let renderUnavailable = false;
  let camera: CameraRun | undefined;
  let input: 'example' | 'camera' = 'example';
  let step: Step = 'upper';
  let questionIndex = 0;
  let exampleFace = modelPose('front');
  let liveFace: TrackedFace | null = null;
  let cameraStatus = '';

  function draw(): void {
    skull?.render(input === 'example' ? exampleFace : liveFace, null);
  }

  function showStatus(): void {
    const model = skull?.getLayerState('skull');
    const modelStatus = renderUnavailable ? 'The 3D view is unavailable. You can finish the lesson using the descriptions.'
      : model === 'error' ? 'The skull model could not load. Select Example to retry.'
      : model === 'loading' ? 'Loading the skull model…' : '';
    let text = input === 'example' ? 'Reference skull. Your camera is off.' : cameraStatus;
    if (modelStatus) text = `${text} ${modelStatus}`;
    if (status.textContent !== text) status.textContent = text;
  }

  function resize(): void {
    const aspect = input === 'example' ? 1 : video.videoWidth / video.videoHeight;
    if (!Number.isFinite(aspect) || aspect <= 0) return;
    const width = Math.min(stage.clientWidth, stage.clientHeight * aspect);
    if (width <= 0) return;
    const height = width / aspect;
    surface.style.width = `${width}px`;
    surface.style.height = `${height}px`;
    skull?.resize(width, height, aspect, window.devicePixelRatio || 1);
    draw();
  }

  const observer = new ResizeObserver(resize);
  video.addEventListener('resize', resize);

  function loadSkull(): void {
    if (!skull) {
      try {
        skull = createAnatomyOverlay(canvas, () => {
          showStatus();
          draw();
        });
        skull.setAppearance('solid', 1);
        renderUnavailable = false;
      } catch {
        renderUnavailable = true;
        return;
      }
    }
    if (skull.getLayerState('skull') === 'error') skull.setLayers(NO_LAYERS);
    skull.setLayers(SKULL);
  }

  function updateLesson(): void {
    stepTitle.textContent = CONTENT[step].title;
    description.textContent = CONTENT[step].description;
    const active = step === 'complete' ? 'quiz' : step;
    for (const indicator of steps) {
      if (indicator.dataset.jawStep === active) indicator.setAttribute('aria-current', 'step');
      else indicator.removeAttribute('aria-current');
    }
    next.hidden = step === 'quiz' || step === 'complete';
    quiz.hidden = step !== 'quiz';
    restart.hidden = step !== 'complete';
    if (step === 'quiz') question.textContent = QUESTIONS[questionIndex].text;
    skull?.setSkullFocus(step === 'upper' ? 'Maxilla' : step === 'lower' ? 'Mandible'
      : step === 'quiz' ? QUESTIONS[questionIndex].bone : null);
    draw();
  }

  function chooseAngle(angle: Angle): void {
    exampleFace = modelPose(angle);
    for (const button of turnButtons) button.setAttribute('aria-pressed', String(button.dataset.jawAngle === angle));
    draw();
  }

  function setInput(nextInput: 'example' | 'camera'): void {
    input = nextInput;
    surface.dataset.input = input;
    useExampleButton.setAttribute('aria-pressed', String(input === 'example'));
    useCameraButton.setAttribute('aria-pressed', String(input === 'camera'));
    turns.hidden = input !== 'example' || renderUnavailable;
    video.hidden = input === 'example';
    resize();
    draw();
    showStatus();
  }

  function stopCamera(): void {
    const active = camera;
    camera = undefined;
    window.clearTimeout(active?.staleTimer);
    active?.stopTracking?.();
    if (active?.stream) stopCameraTracks(active.stream);
    if (video.srcObject) {
      video.pause();
      video.srcObject = null;
    }
    liveFace = null;
    cameraStatus = 'Camera is off. Choose Use camera to restart or Example to continue.';
  }

  function useExample(): void {
    stopCamera();
    loadSkull();
    skull?.setFit(DEFAULT_FIT);
    setInput('example');
    updateLesson();
  }

  function cameraFailed(active: CameraRun, text: string): void {
    if (camera !== active) return;
    stopCamera();
    cameraStatus = `${text} Choose Example to continue or Use camera to retry.`;
    draw();
    showStatus();
  }

  async function useCamera(): Promise<void> {
    if (camera) return;
    loadSkull();
    if (!skull) {
      showStatus();
      return;
    }
    skull.setFit(readFit());
    updateLesson();
    const active: CameraRun = {};
    camera = active;
    cameraStatus = 'Waiting for camera permission…';
    setInput('camera');
    try {
      const stream = await requestCamera();
      if (camera !== active) {
        stopCameraTracks(stream);
        return;
      }
      active.stream = stream;
      for (const track of stream.getVideoTracks()) {
        track.addEventListener('ended', () => cameraFailed(active, 'The camera disconnected.'), { once: true });
      }
      video.srcObject = stream;
      await video.play();
      if (camera !== active) return;
      resize();
      cameraStatus = 'Starting face tracking…';
      showStatus();
      active.stopTracking = startFaceTracker(video, {
        onReady() {
          if (camera !== active) return;
          cameraStatus = 'Look toward the camera to show the outline of your face.';
          showStatus();
        },
        onFrame(frame) {
          if (camera !== active) return;
          window.clearTimeout(active.staleTimer);
          function showFace(face: TrackedFace | null): void {
            if (camera !== active) return;
            liveFace = face;
            cameraStatus = face ? 'Face detected. Turn slowly to compare the jaws from each side.'
              : 'Bring your face into view or switch to Example.';
            showStatus();
            draw();
          }
          const freshFor = 500 - (performance.now() - frame.timestampMs);
          showFace(freshFor > 0 ? frame.face : null);
          if (liveFace) active.staleTimer = window.setTimeout(() => showFace(null), freshFor);
        },
        onError: () => cameraFailed(active, 'Face tracking is unavailable.'),
      });
    } catch (error) {
      cameraFailed(active, explainCameraError(error));
    }
  }

  function resetLesson(): void {
    step = 'upper';
    questionIndex = 0;
    quiz.reset();
    feedback.textContent = '';
    chooseAngle('front');
    updateLesson();
  }

  useExampleButton.addEventListener('click', useExample);
  useCameraButton.addEventListener('click', () => void useCamera());
  for (const button of turnButtons) {
    button.addEventListener('click', () => { chooseAngle(button.dataset.jawAngle as Angle); });
  }
  next.addEventListener('click', () => {
    if (step !== 'upper' && step !== 'lower') return;
    step = step === 'upper' ? 'lower' : 'quiz';
    updateLesson();
    stepTitle.focus();
  });
  quiz.addEventListener('submit', (event) => {
    event.preventDefault();
    if (step !== 'quiz') return;
    const answer = new FormData(quiz).get('jaw-answer');
    const current = QUESTIONS[questionIndex];
    if (answer !== current.answer) {
      feedback.textContent = answer ? `${current.hint} Try again.` : 'Choose an answer to continue.';
      return;
    }
    quiz.reset();
    if (questionIndex === 0) {
      questionIndex = 1;
      feedback.textContent = 'Correct. Now identify the lower jaw.';
    } else {
      step = 'complete';
      feedback.textContent = '';
    }
    updateLesson();
    if (step === 'complete') stepTitle.focus();
    else quiz.querySelector<HTMLInputElement>('input')?.focus();
  });
  restart.addEventListener('click', () => {
    resetLesson();
    stepTitle.focus();
  });

  function close(): void {
    observer.disconnect();
    stopCamera();
    draw();
  }

  return {
    open() {
      resetLesson();
      useExample();
      observer.observe(stage);
      title.focus();
    },
    close,
    resumeLayout() {
      if (input === 'example') useExample();
      else showStatus();
      observer.observe(stage);
      resize();
    },
    dispose() {
      close();
      skull?.dispose();
      skull = undefined;
    },
  };
}
