import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { HandFilter } from './hand-filter.ts';
import type { TrackerReply, TrackerRequest } from './protocol.ts';
import { HAND_LANDMARK_COUNT, type HandTrackingFrame, type TrackedHand, type TrackingDelegate } from './types.ts';

const worker = self as DedicatedWorkerGlobalScope;
const filter = new HandFilter();
let landmarker: HandLandmarker | undefined;
let createCpuLandmarker: (() => Promise<HandLandmarker>) | undefined;
let delegate: TrackingDelegate = 'GPU';
let closing = false;

function send(reply: TrackerReply<HandTrackingFrame>, transfer: Transferable[] = []): void {
  worker.postMessage(reply, transfer);
}

function closeLandmarker(): void {
  const active = landmarker;
  landmarker = undefined;
  active?.close();
}

async function initialize(wasmUrl: string, model: ArrayBuffer): Promise<void> {
  const fileset = await FilesetResolver.forVisionTasks(wasmUrl, true);
  if (closing) return;
  const create = (device: TrackingDelegate) => {
    // The module factory is consumed per initialization. Reload it for the CPU delegate.
    const loader = new URL(fileset.wasmLoaderPath);
    loader.searchParams.set('delegate', device.toLowerCase());
    return HandLandmarker.createFromOptions({ ...fileset, wasmLoaderPath: loader.href }, {
      baseOptions: { modelAssetBuffer: new Uint8Array(model), delegate: device },
      runningMode: 'VIDEO',
      numHands: 2,
    });
  };

  createCpuLandmarker = () => create('CPU');
  try {
    landmarker = await create('GPU');
  } catch (error) {
    if (closing) return;
    await useCpu(error);
  }
  if (closing) {
    closeLandmarker();
    return;
  }
  send({ type: 'ready', delegate });
}

async function useCpu(gpuError: unknown): Promise<void> {
  const create = createCpuLandmarker;
  createCpuLandmarker = undefined;
  if (!create) throw new Error('CPU fallback is unavailable.');
  try {
    closeLandmarker();
  } catch (error) {
    console.warn('GPU hand landmarker cleanup failed:', error);
  }
  filter.reset();
  delegate = 'CPU';
  try {
    landmarker = await create();
  } catch (error) {
    throw new AggregateError([gpuError, error], `GPU: ${gpuError}; CPU: ${error}`);
  }
}

function detect(bitmap: ImageBitmap, timestampMs: number): void {
  if (!landmarker) throw new Error('Hand tracker is unavailable.');
  const start = performance.now();
  const result = landmarker.detectForVideo(bitmap, timestampMs);
  const inferenceMs = performance.now() - start;
  const detections: Pick<TrackedHand, 'handedness' | 'landmarks'>[] = [];
  for (const [handIndex, points] of result.landmarks.entries()) {
    if (points.length !== HAND_LANDMARK_COUNT) continue;
    const landmarks = new Float32Array(HAND_LANDMARK_COUNT * 3);
    for (let index = 0; index < points.length; index++) {
      const { x, y, z } = points[index];
      landmarks[index * 3] = x;
      landmarks[index * 3 + 1] = y;
      landmarks[index * 3 + 2] = z;
    }
    if (!landmarks.every(Number.isFinite)) continue;
    const category = result.handedness[handIndex]?.[0]?.categoryName;
    const handedness = category === 'Left' || category === 'Right' ? category : null;
    detections.push({ landmarks, handedness });
  }

  const hands = filter.apply(detections, timestampMs);
  send({ type: 'frame', result: { timestampMs, inferenceMs, hands } }, hands.map((hand) => hand.landmarks.buffer));
}

worker.addEventListener('message', async ({ data }: MessageEvent<TrackerRequest>) => {
  try {
    switch (data.type) {
      case 'initialize':
        await initialize(data.wasmUrl, data.model);
        break;
      case 'frame':
        try {
          if (closing) return;
          try {
            detect(data.bitmap, data.timestampMs);
          } catch (error) {
            if (delegate !== 'GPU') throw error;
            await useCpu(error);
            if (closing) {
              closeLandmarker();
              return;
            }
            send({ type: 'ready', delegate });
            detect(data.bitmap, data.timestampMs);
          }
        } finally {
          data.bitmap.close();
        }
        break;
      case 'dispose':
        closing = true;
        try {
          closeLandmarker();
        } finally {
          send({ type: 'disposed' });
          worker.close();
        }
        break;
    }
  } catch (error) {
    if (!closing) send({ type: 'error', message: String(error) });
  }
});
