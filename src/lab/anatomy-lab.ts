import { createHandBoneAppearance, drawHandBones } from '../anatomy/hand-bones.ts';
import { explainCameraError, requestCamera, stopCameraTracks } from '../camera.ts';
import { startHandTracker } from '../tracking/hand-tracker.ts';
import type { HandTrackingFrame } from '../tracking/types.ts';
import { EXAMPLE_HAND, type ExamplePose } from './example-hand.ts';
import { createFingerMotion, HAND_FRAME_MAX_AGE_MS, INDEX_MIDDLE_JOINT } from './finger-motion.ts';

type Step = 'straighten' | 'bend' | 'quiz' | 'complete';

interface LabCamera {
  stream?: MediaStream;
  stopTracking?: () => void;
  staleTimer?: number;
  ready?: boolean;
}

const LESSON = {
  straighten: {
    title: 'Straighten your index finger',
    description: 'The highlighted bones are the proximal phalanx (closer to the palm) and the middle phalanx.',
  },
  bend: {
    title: 'Bend the middle joint',
    description: 'Watch the two highlighted bones change position around the ring as you bend your index finger.',
  },
  quiz: {
    title: 'Check what you learned',
    description: 'Think about where the ring appeared on the bent finger.',
  },
  complete: {
    title: 'Lesson complete',
    description: 'The middle joint of the index finger is the proximal interphalangeal (PIP) joint. It connects the proximal and middle phalanges.',
  },
} satisfies Record<Step, { title: string; description: string }>;

function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

export function createAnatomyLab(root: HTMLElement) {
  function get<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = root.querySelector<T>(`#${id}`);
    if (!element) throw new Error(`Missing lab element: ${id}`);
    return element;
  }

  const title = get('lab-title');
  const exampleButton = get<HTMLButtonElement>('lab-use-example');
  const cameraButton = get<HTMLButtonElement>('lab-use-camera');
  const stage = get('lab-stage');
  const example = get<HTMLCanvasElement>('lab-example');
  const live = get('lab-live');
  const video = get<HTMLVideoElement>('lab-video');
  const overlay = get<HTMLCanvasElement>('lab-overlay');
  const placeholder = get('lab-camera-placeholder');
  const cameraStatus = get('lab-camera-status');
  const stepTitle = get('lab-step-title');
  const stepDescription = get('lab-step-description');
  const stepIndicators = get('lab-steps').querySelectorAll<HTMLElement>('[data-lab-step]');
  const poseControls = get('lab-pose-controls');
  const straightButton = get<HTMLButtonElement>('lab-straight');
  const bentButton = get<HTMLButtonElement>('lab-bent');
  const motionStatus = get('lab-motion-status');
  const next = get<HTMLButtonElement>('lab-next');
  const quiz = get<HTMLFormElement>('lab-quiz');
  const feedback = get('lab-quiz-feedback');
  const restart = get<HTMLButtonElement>('lab-restart');
  const exampleContext = example.getContext('2d');
  const liveContext = overlay.getContext('2d');
  const appearance = createHandBoneAppearance('xray', 1);
  const tracker = createFingerMotion();

  let camera: LabCamera | undefined;
  let input: 'example' | 'camera' = 'example';
  let step: Step = 'straighten';
  let examplePose: ExamplePose = 'straight';
  let motion = tracker.reset();

  function draw(context: CanvasRenderingContext2D | null, points?: Float32Array): void {
    if (!context) return;
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    if (points) drawHandBones(context, points, appearance, INDEX_MIDDLE_JOINT);
  }

  function resizeCanvas(canvas: HTMLCanvasElement, width: number, height: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
  }

  function resize(): void {
    if (input === 'example') {
      const size = Math.min(stage.clientWidth, stage.clientHeight);
      example.style.width = `${size}px`;
      example.style.height = `${size}px`;
      resizeCanvas(example, size, size);
      draw(exampleContext, EXAMPLE_HAND[examplePose]);
    } else if (video.videoWidth && video.videoHeight && !live.hidden) {
      const scale = Math.min(stage.clientWidth / video.videoWidth, stage.clientHeight / video.videoHeight);
      const width = video.videoWidth * scale;
      const height = video.videoHeight * scale;
      live.style.width = `${width}px`;
      live.style.height = `${height}px`;
      resizeCanvas(overlay, width, height);
      draw(liveContext, motion.hand?.landmarks);
    }
  }

  const resizeObserver = new ResizeObserver(resize);
  video.addEventListener('resize', resize);

  function updateMotionStatus(): void {
    const activity = step === 'straighten' || step === 'bend';
    next.hidden = !activity;
    motionStatus.hidden = !activity;
    if (!activity) {
      setText(motionStatus, '');
      return;
    }
    const straightening = step === 'straighten';
    let text: string;
    if (input === 'example') {
      const expected = straightening ? 'straight' : 'bent';
      next.disabled = examplePose !== expected;
      text = next.disabled
        ? (straightening ? 'Select Straight to extend the example finger.' : 'Select Bent to move the middle joint.')
        : (straightening ? 'The example finger is straight.' : 'The example finger is bent at the middle joint.');
    } else {
      next.disabled = !(straightening ? motion.straightened : motion.bent);
      if (!camera?.ready) {
        text = 'You can also complete this step in Example.';
      } else if (!motion.hand) {
        text = 'Show one full hand with the index finger in view. You can switch to Example at any time.';
      } else if (!next.disabled) {
        text = straightening ? 'Straight position found. Select Continue.' : 'Bend found. Select Continue.';
      } else if (!motion.straightened || straightening) {
        text = 'Straighten your index finger and hold it briefly.';
      } else {
        text = 'Curl your index finger at the middle joint and hold it briefly.';
      }
    }
    setText(motionStatus, text);
  }

  function updateLesson(): void {
    setText(stepTitle, LESSON[step].title);
    setText(stepDescription, LESSON[step].description);
    for (const indicator of stepIndicators) {
      const activeStep = step === 'complete' ? 'quiz' : step;
      if (indicator.dataset.labStep === activeStep) indicator.setAttribute('aria-current', 'step');
      else indicator.removeAttribute('aria-current');
    }
    poseControls.hidden = input !== 'example' || step === 'quiz' || step === 'complete';
    straightButton.setAttribute('aria-pressed', String(examplePose === 'straight'));
    bentButton.setAttribute('aria-pressed', String(examplePose === 'bent'));
    quiz.hidden = step !== 'quiz';
    restart.hidden = step !== 'complete';
    updateMotionStatus();
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
    motion = tracker.reset();
    draw(liveContext);
    live.hidden = true;
  }

  function selectExample(): void {
    stopCamera();
    input = 'example';
    examplePose = step === 'quiz' || step === 'complete' ? 'bent' : 'straight';
    exampleButton.setAttribute('aria-pressed', 'true');
    cameraButton.setAttribute('aria-pressed', 'false');
    example.hidden = false;
    placeholder.hidden = true;
    setText(cameraStatus, 'Example hand. Your camera is off.');
    updateLesson();
    resize();
  }

  function cameraFailed(active: LabCamera, text: string): void {
    if (camera !== active) return;
    stopCamera();
    placeholder.hidden = false;
    setText(cameraStatus, `${text} Choose Example to keep learning or Use camera to retry.`);
    updateMotionStatus();
  }

  function acceptFrame(active: LabCamera, frame: HandTrackingFrame): void {
    if (camera !== active) return;
    window.clearTimeout(active.staleTimer);
    const remaining = HAND_FRAME_MAX_AGE_MS - (performance.now() - frame.timestampMs);
    motion = remaining > 0
      ? tracker.observe(frame, video.videoWidth / video.videoHeight)
      : tracker.reset();
    draw(liveContext, motion.hand?.landmarks);
    setText(cameraStatus, motion.hand ? 'Camera on. Hand detected.' : 'Camera on. Looking for a hand.');
    updateMotionStatus();
    if (motion.hand) {
      active.staleTimer = window.setTimeout(() => {
        if (camera !== active) return;
        motion = tracker.reset();
        draw(liveContext);
        setText(cameraStatus, 'Camera on. Looking for a hand.');
        updateMotionStatus();
      }, remaining);
    }
  }

  async function useCamera(): Promise<void> {
    if (camera) return;
    const active: LabCamera = {};
    camera = active;
    input = 'camera';
    exampleButton.setAttribute('aria-pressed', 'false');
    cameraButton.setAttribute('aria-pressed', 'true');
    example.hidden = true;
    placeholder.hidden = false;
    setText(cameraStatus, 'Waiting for camera permission…');
    updateLesson();
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
      placeholder.hidden = true;
      live.hidden = false;
      resize();
      setText(cameraStatus, 'Starting hand tracking…');
      active.stopTracking = startHandTracker(video, {
        onReady() {
          if (camera !== active) return;
          active.ready = true;
          setText(cameraStatus, 'Camera on. Looking for a hand.');
          updateMotionStatus();
        },
        onFrame: (frame) => acceptFrame(active, frame),
        onError: () => cameraFailed(active, 'Hand tracking is unavailable.'),
      });
    } catch (error) {
      cameraFailed(active, explainCameraError(error));
    }
  }

  function setExamplePose(pose: ExamplePose): void {
    examplePose = pose;
    draw(exampleContext, EXAMPLE_HAND[pose]);
    updateLesson();
  }

  function resetLesson(): void {
    step = 'straighten';
    examplePose = 'straight';
    motion = tracker.reset();
    quiz.reset();
    setText(feedback, '');
    updateLesson();
    if (input === 'example') draw(exampleContext, EXAMPLE_HAND.straight);
  }

  exampleButton.addEventListener('click', selectExample);
  cameraButton.addEventListener('click', () => void useCamera());
  straightButton.addEventListener('click', () => setExamplePose('straight'));
  bentButton.addEventListener('click', () => setExamplePose('bent'));
  next.addEventListener('click', () => {
    if (next.disabled || (step !== 'straighten' && step !== 'bend')) return;
    if (step === 'straighten') motion = tracker.beginBend();
    step = step === 'straighten' ? 'bend' : 'quiz';
    updateLesson();
    stepTitle.focus();
  });
  quiz.addEventListener('submit', (event) => {
    event.preventDefault();
    if (step !== 'quiz') return;
    const answer = new FormData(quiz).get('lab-answer');
    if (answer !== 'middle') {
      setText(feedback, answer
        ? 'Look for the joint between the two highlighted bones. Try again.'
        : 'Choose an answer to continue.');
      return;
    }
    step = 'complete';
    setText(feedback, '');
    updateLesson();
    stepTitle.focus();
  });
  restart.addEventListener('click', () => {
    resetLesson();
    stepTitle.focus();
  });

  return {
    open() {
      resetLesson();
      selectExample();
      resizeObserver.observe(stage);
      title.focus();
    },
    resumeLayout() {
      resizeObserver.observe(stage);
      resize();
    },
    close() {
      resizeObserver.disconnect();
      stopCamera();
      if (input === 'camera') {
        placeholder.hidden = false;
        setText(cameraStatus, 'Camera is off. Choose Use camera to restart or Example to continue.');
        updateMotionStatus();
      }
    },
  };
}
