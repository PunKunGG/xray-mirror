import { Matrix4, Vector3 } from 'three';
import { createAnatomyOverlay, type AnatomyOverlay } from '../anatomy/anatomy-overlay.ts';
import { BRAIN_REGIONS, type BrainRegion } from '../anatomy/brain-regions.ts';
import { DEFAULT_FIT, readFit } from '../anatomy/fit.ts';
import type { TrackedFace } from '../tracking/types.ts';
import { createLessonFaceCamera } from './face-camera.ts';

const ANGLES = { front: 0, side: Math.PI / 2, back: Math.PI } as const;
type Angle = keyof typeof ANGLES;
type Phase = 'study' | 'question' | 'correct' | 'complete';
type Input = 'example' | 'camera';

const BRAIN = new Set(['brain'] as const);
const NO_LAYERS = new Set<never>();
// Model center in the common head registration, in centimeters.
const BRAIN_CENTER = new Vector3(-0.06, 6.1, -4.1);

const CONTENT: Record<BrainRegion, { view: Angle; description: string; hint: string }> = {
  Cerebrum: {
    view: 'front',
    description: 'The cerebrum is the large upper region. Its folded surface helps process sensation and supports thinking and voluntary movement.',
    hint: 'Look for the large folded region at the top.',
  },
  Cerebellum: {
    view: 'back',
    description: 'The cerebellum sits low at the back of the brain. It helps coordinate movement and maintain balance.',
    hint: 'Try the Back view and look beneath the large upper region.',
  },
  Brainstem: {
    view: 'side',
    description: 'The brainstem connects the brain to the spinal cord. It includes the midbrain, pons, and medulla, and helps regulate functions such as breathing.',
    hint: 'Try the Side view and look for the stalk at the base.',
  },
};

function modelPose(angle: Angle): TrackedFace {
  const matrix = new Matrix4().makeRotationX(-Math.PI / 18).multiply(new Matrix4().makeRotationY(ANGLES[angle]));
  const center = BRAIN_CENTER.clone().applyMatrix4(matrix).negate();
  center.z -= 23;
  matrix.setPosition(center);
  return { landmarks: new Float32Array(), poseMatrix: Float32Array.from(matrix.elements) };
}

export function createBrainLesson(root: HTMLElement) {
  function get<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = root.querySelector<T>(`#${id}`);
    if (!element) throw new Error(`Missing brain lesson element: ${id}`);
    return element;
  }

  const title = get('brain-title');
  const modes = get('brain-modes');
  const exampleButton = get('brain-use-example');
  const cameraButton = get<HTMLButtonElement>('brain-use-camera');
  const stage = get('brain-stage');
  const surface = get('brain-surface');
  const video = get<HTMLVideoElement>('brain-video');
  const canvas = get<HTMLCanvasElement>('brain-overlay');
  const status = get('brain-status');
  const turns = get('brain-turn-controls');
  const turnButtons = turns.querySelectorAll<HTMLButtonElement>('[data-brain-angle]');
  const retry = get('brain-retry');
  const stepTitle = get('brain-step-title');
  const description = get('brain-description');
  const descriptions = get<HTMLDetailsElement>('brain-descriptions');
  const choices = descriptions.querySelectorAll<HTMLButtonElement>('[data-brain-region]');
  const feedback = get('brain-feedback');
  const next = get('brain-next');

  let overlay: AnatomyOverlay | undefined;
  let unavailable = false;
  let phase: Phase = 'study';
  let input: Input = 'example';
  let index = 0;
  let pose = modelPose('front');
  const camera = createLessonFaceCamera(video, {
    readyMessage: 'Bring your face into view to see the brain overlay.',
    detectedMessage: 'Face detected. Turn slowly from side to side. Use Example for the back view.',
    onVideoReady: resize,
    onChange() {
      if (input === 'camera' && status.textContent !== camera.status) status.textContent = camera.status;
      draw();
    },
  });

  function draw(): void {
    overlay?.render(input === 'example' ? pose : camera.face, null);
  }

  function showStatus(): void {
    const model = overlay?.getLayerState('brain');
    const failed = unavailable || model === 'error';
    const ready = model === 'ready';
    const text = input === 'camera' ? camera.status
      : failed ? 'The brain model is unavailable. You can continue using the descriptions.'
      : ready ? 'Reference brain. Your camera is off.' : 'Loading the brain model…';
    if (status.textContent !== text) status.textContent = text;
    turns.hidden = !ready || input === 'camera';
    cameraButton.disabled = !ready;
    retry.hidden = model !== 'error';
    canvas.toggleAttribute('data-picking', ready && input === 'example' && phase === 'question');
    if (phase === 'question') {
      if (failed) descriptions.open = true;
      description.textContent = ready ? 'Select a region on the model.'
        : failed ? 'Select the matching region by description.'
        : 'Wait for the model to load, or choose by description.';
    }
  }

  function resize(): void {
    const aspect = input === 'example' ? 1 : video.videoWidth / video.videoHeight;
    if (!Number.isFinite(aspect) || aspect <= 0) return;
    const width = Math.min(stage.clientWidth, stage.clientHeight * aspect);
    if (width <= 0) return;
    const height = width / aspect;
    surface.style.width = `${width}px`;
    surface.style.height = `${height}px`;
    overlay?.resize(width, height, aspect, window.devicePixelRatio || 1);
    draw();
  }

  function chooseAngle(angle: Angle): void {
    pose = modelPose(angle);
    for (const button of turnButtons) button.setAttribute('aria-pressed', String(button.dataset.brainAngle === angle));
    draw();
  }

  function update(): void {
    const region = BRAIN_REGIONS[index];
    const last = index === BRAIN_REGIONS.length - 1;
    stepTitle.textContent = phase === 'complete' ? 'Lesson complete'
      : phase === 'study' ? region : `Find the ${region.toLowerCase()}`;
    modes.hidden = phase !== 'study';
    description.hidden = phase === 'correct';
    if (phase === 'study') description.textContent = CONTENT[region].description;
    if (phase === 'complete') description.textContent = 'You located the cerebrum, cerebellum, and brainstem.';
    descriptions.hidden = phase !== 'question';
    next.hidden = phase === 'question';
    next.textContent = phase === 'study' ? (last ? 'Start practice' : 'Continue')
      : phase === 'complete' ? 'Start over' : last ? 'Finish' : 'Next question';
    overlay?.setBrainFocus(phase === 'study' || phase === 'correct' ? region : null);
    showStatus();
    draw();
  }

  function loadBrain(): void {
    if (!overlay) {
      try {
        overlay = createAnatomyOverlay(canvas, () => { showStatus(); draw(); });
        overlay.setAppearance('solid', 1);
        unavailable = false;
      } catch {
        unavailable = true;
        showStatus();
        return;
      }
    }
    if (overlay.getLayerState('brain') === 'error') overlay.setLayers(NO_LAYERS);
    overlay.setLayers(BRAIN);
    update();
    resize();
  }

  function answer(part: ReturnType<AnatomyOverlay['pickBrainRegion']>): void {
    if (phase !== 'question') return;
    const region = BRAIN_REGIONS[index];
    if (part !== region) {
      feedback.textContent = part === null ? 'Select a region on the brain.' : `${CONTENT[region].hint} Try again.`;
      return;
    }
    phase = 'correct';
    feedback.textContent = `Correct. ${CONTENT[region].description}`;
    update();
    next.focus();
  }

  function setInput(nextInput: Input): void {
    input = nextInput;
    surface.dataset.input = input;
    video.hidden = input === 'example';
    canvas.setAttribute('aria-label', input === 'example' ? '3D model of the brain' : 'Tracked brain overlay');
    exampleButton.setAttribute('aria-pressed', String(input === 'example'));
    cameraButton.setAttribute('aria-pressed', String(input === 'camera'));
    overlay?.setFit(input === 'example' ? DEFAULT_FIT : readFit());
    showStatus();
    resize();
    draw();
  }

  function useExample(): void {
    if (input !== 'example') setInput('example');
    camera.stop();
  }

  exampleButton.addEventListener('click', useExample);
  cameraButton.addEventListener('click', () => {
    if (phase !== 'study' || camera.running || overlay?.getLayerState('brain') !== 'ready') return;
    setInput('camera');
    void camera.start();
  });
  video.addEventListener('resize', resize);
  canvas.addEventListener('click', (event) => {
    if (!overlay || !canvas.hasAttribute('data-picking')) return;
    const { left, top, width, height } = canvas.getBoundingClientRect();
    answer(overlay.pickBrainRegion((event.clientX - left) / width, (event.clientY - top) / height));
  });
  for (const choice of choices) choice.addEventListener('click', () => answer(choice.dataset.brainRegion as BrainRegion));
  for (const button of turnButtons) button.addEventListener('click', () => chooseAngle(button.dataset.brainAngle as Angle));
  retry.addEventListener('click', loadBrain);

  function reset(): void {
    index = 0;
    phase = 'study';
    descriptions.open = false;
    feedback.textContent = '';
    chooseAngle('front');
    update();
  }

  next.addEventListener('click', () => {
    if (phase === 'question') return;
    if (phase === 'complete') reset();
    else {
      if (index < BRAIN_REGIONS.length - 1) {
        index++;
        if (phase === 'correct') phase = 'question';
      } else if (phase === 'study') {
        phase = 'question';
        index = 0;
        useExample();
      } else phase = 'complete';
      feedback.textContent = '';
      if (phase !== 'complete') chooseAngle(CONTENT[BRAIN_REGIONS[index]].view);
      update();
    }
    stepTitle.focus();
  });

  const observer = new ResizeObserver(resize);
  function close(): void {
    observer.disconnect();
    useExample();
  }
  function resumeLayout(): void {
    if (!overlay) loadBrain();
    observer.observe(stage);
    resize();
  }

  return {
    open() {
      reset();
      resumeLayout();
      title.focus();
    },
    close,
    resumeLayout,
    dispose() {
      close();
      overlay?.dispose();
      overlay = undefined;
    },
  };
}
