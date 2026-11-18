import { Matrix4 } from 'three';
import { createAnatomyOverlay, type AnatomyOverlay, type SkullPart, type SkullPick } from '../anatomy/anatomy-overlay.ts';
import { DEFAULT_FIT, readFit } from '../anatomy/fit.ts';
import type { TrackedFace } from '../tracking/types.ts';
import { createLessonFaceCamera } from './face-camera.ts';

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

const BONE_QUESTIONS = [
  { bone: 'Mandible', title: 'Find the mandible', hint: 'Look for the bone that includes the chin.', explanation: CONTENT.lower.description },
  { bone: 'Maxilla', title: 'Find the maxilla', hint: 'Look just above the upper teeth, beneath the eye sockets.', explanation: CONTENT.upper.description },
] as const;

interface BoneChallenge {
  index: number;
  stage: 'question' | 'correct' | 'finished';
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
  const modes = get('jaw-modes');
  const useExampleButton = get('jaw-use-example');
  const useCameraButton = get('jaw-use-camera');
  const stage = get('jaw-stage');
  const surface = get('jaw-surface');
  const video = get<HTMLVideoElement>('jaw-video');
  const canvas = get<HTMLCanvasElement>('jaw-overlay');
  const status = get('jaw-status');
  const turns = get('jaw-turn-controls');
  const turnButtons = turns.querySelectorAll<HTMLButtonElement>('[data-jaw-angle]');
  const progress = get('jaw-steps');
  const steps = progress.querySelectorAll<HTMLElement>('[data-jaw-step]');
  const activity = get('jaw-activity');
  const lessonContent = get('jaw-lesson-content');
  const stepTitle = get('jaw-step-title');
  const description = get('jaw-description');
  const next = get('jaw-next');
  const quiz = get<HTMLFormElement>('jaw-quiz');
  const question = get('jaw-question');
  const feedback = get('jaw-feedback');
  const restart = get('jaw-restart');
  const openChallenge = get('jaw-open-challenge');
  const challengeContent = get('jaw-challenge');
  const challengeTitle = get('jaw-challenge-title');
  const challengeInstructions = get('jaw-challenge-instructions');
  const chooseByDescription = get<HTMLDetailsElement>('jaw-challenge-descriptions');
  const descriptionButtons = chooseByDescription.querySelectorAll<HTMLButtonElement>('[data-jaw-part]');
  const challengeFeedback = get('jaw-challenge-feedback');
  const challengeNext = get('jaw-challenge-next');
  const closeChallenge = get('jaw-close-challenge');

  let skull: AnatomyOverlay | undefined;
  let renderUnavailable = false;
  let input: 'example' | 'camera' = 'example';
  let step: Step = 'upper';
  let questionIndex = 0;
  let challenge: BoneChallenge | null = null;
  let exampleFace = modelPose('front');
  const camera = createLessonFaceCamera(video, {
    readyMessage: 'Look toward the camera to show the outline of your face.',
    detectedMessage: 'Face detected. Turn slowly to compare the jaws from each side.',
    onVideoReady: resize,
    onChange() { showStatus(); draw(); },
  });

  function draw(): void {
    skull?.render(input === 'example' ? exampleFace : camera.face, null);
  }

  function showStatus(): void {
    const model = skull?.getLayerState('skull');
    updateChallengeAvailability();
    const modelStatus = renderUnavailable ? 'The 3D view is unavailable. You can finish the lesson using the descriptions.'
      : model === 'error' ? 'The skull model could not load. Select Example to retry.'
      : model === 'loading' ? 'Loading the skull model…' : '';
    let text = input === 'example' ? 'Reference skull. Your camera is off.' : camera.status;
    if (challenge && (renderUnavailable || model === 'error')) {
      text = 'The skull view is unavailable. Use Choose by description to continue.';
    } else if (modelStatus) text = `${text} ${modelStatus}`;
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
    openChallenge.hidden = step !== 'complete';
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

  function setChallengeView(): void {
    const active = challenge !== null;
    modes.hidden = active;
    progress.hidden = active;
    lessonContent.hidden = active;
    challengeContent.hidden = !active;
    activity.setAttribute('aria-labelledby', active ? challengeTitle.id : stepTitle.id);
    if (!active) canvas.removeAttribute('data-picking');
  }

  function updateChallengeAvailability(): void {
    if (!challenge) return;
    const model = skull?.getLayerState('skull');
    const ready = model === 'ready';
    const unavailable = renderUnavailable || model === 'error';
    canvas.toggleAttribute('data-picking', ready && challenge.stage === 'question');
    turns.hidden = !ready;
    if (unavailable) chooseByDescription.open = true;
    if (challenge.stage !== 'finished') {
      challengeInstructions.textContent = ready ? 'Select a bone on the skull.'
        : unavailable ? 'Select the matching area by description.'
        : 'Wait for the skull to load, or choose by description.';
    }
  }

  function updateChallenge(): void {
    if (!challenge) return;
    const current = BONE_QUESTIONS[challenge.index];
    const finished = challenge.stage === 'finished';
    challengeTitle.textContent = finished ? 'Practice complete' : current.title;
    if (finished) challengeInstructions.textContent = CONTENT.complete.description;
    challengeInstructions.hidden = challenge.stage === 'correct';
    chooseByDescription.hidden = challenge.stage !== 'question';
    challengeNext.hidden = challenge.stage !== 'correct';
    challengeNext.textContent = challenge.index === BONE_QUESTIONS.length - 1 ? 'Finish' : 'Next question';
    skull?.setSkullFocus(challenge.stage === 'correct' ? current.bone : null);
    updateChallengeAvailability();
    draw();
  }

  function answerChallenge(part: SkullPick): void {
    if (challenge?.stage !== 'question') return;
    const current = BONE_QUESTIONS[challenge.index];
    if (part === null) {
      challengeFeedback.textContent = 'Select a bone on the skull.';
      return;
    }
    if (part !== current.bone) {
      challengeFeedback.textContent = `${current.hint} Try again.`;
      return;
    }
    challenge.stage = 'correct';
    challengeFeedback.textContent = `Correct. ${current.explanation}`;
    updateChallenge();
    challengeNext.focus();
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

  function useExample(retryModel = true): void {
    camera.stop();
    if (retryModel) loadSkull();
    skull?.setFit(DEFAULT_FIT);
    setInput('example');
    if (challenge) updateChallenge();
    else updateLesson();
  }

  function useCamera(): void {
    if (camera.running || challenge) return;
    loadSkull();
    if (!skull) {
      showStatus();
      return;
    }
    skull.setFit(readFit());
    updateLesson();
    setInput('camera');
    void camera.start();
  }

  function resetLesson(): void {
    step = 'upper';
    questionIndex = 0;
    quiz.reset();
    feedback.textContent = '';
    chooseAngle('front');
    updateLesson();
  }

  useExampleButton.addEventListener('click', () => useExample());
  useCameraButton.addEventListener('click', useCamera);
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
  openChallenge.addEventListener('click', () => {
    if (step !== 'complete' || challenge) return;
    challenge = { index: 0, stage: 'question' };
    challengeFeedback.textContent = '';
    chooseByDescription.open = false;
    setChallengeView();
    useExample(false);
    chooseAngle('front');
    challengeTitle.focus();
  });
  canvas.addEventListener('click', (event) => {
    if (!skull || !canvas.hasAttribute('data-picking')) return;
    const { left, top, width, height } = canvas.getBoundingClientRect();
    answerChallenge(skull.pickSkullPart((event.clientX - left) / width, (event.clientY - top) / height));
  });
  for (const button of descriptionButtons) {
    button.addEventListener('click', () => answerChallenge(button.dataset.jawPart as SkullPart));
  }
  challengeNext.addEventListener('click', () => {
    if (challenge?.stage !== 'correct') return;
    if (challenge.index === BONE_QUESTIONS.length - 1) challenge.stage = 'finished';
    else {
      challenge.index++;
      challenge.stage = 'question';
    }
    challengeFeedback.textContent = '';
    updateChallenge();
    challengeTitle.focus();
  });
  closeChallenge.addEventListener('click', () => {
    challenge = null;
    setChallengeView();
    useExample(false);
    openChallenge.focus();
  });

  function close(): void {
    challenge = null;
    setChallengeView();
    observer.disconnect();
    camera.stop();
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
      if (input === 'example') useExample(!challenge);
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
