import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { FaceFilter } from './face-filter.ts';
import type { TrackerReply, TrackerRequest } from './protocol.ts';
import { FACE_LANDMARK_COUNT, type TrackingDelegate } from './types.ts';

const worker = self as DedicatedWorkerGlobalScope;
const filter = new FaceFilter();
let landmarker: FaceLandmarker | undefined;
let createCpuLandmarker: (() => Promise<FaceLandmarker>) | undefined;
let delegate: TrackingDelegate = 'GPU';
let closing = false;

function send(reply: TrackerReply, transfer: Transferable[] = []): void {
  worker.postMessage(reply, transfer);
}

function closeLandmarker(): void {
  const active = landmarker;
  landmarker = undefined;
  active?.close();
}

async function initialize(wasmUrl: string, model: ArrayBuffer): Promise<void> {
  const fileset = await FilesetResolver.forVisionTasks(wasmUrl, true);
  const create = (device: TrackingDelegate) => {
    // Each initialization consumes the module's global factory. Re-evaluate the loader for CPU.
    const loader = new URL(fileset.wasmLoaderPath);
    loader.searchParams.set('delegate', device.toLowerCase());
    return FaceLandmarker.createFromOptions({ ...fileset, wasmLoaderPath: loader.href }, {
      baseOptions: { modelAssetBuffer: new Uint8Array(model), delegate: device },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
    });
  };

  // A driver can fail on the first frame even if the GPU task initialized successfully.
  createCpuLandmarker = () => create('CPU');
  try {
    landmarker = await create('GPU');
  } catch (error) {
    if (closing) return;
    try {
      await useCpu();
    } catch (fallbackError) {
      throw new AggregateError([error, fallbackError], `GPU: ${error}; CPU: ${fallbackError}`);
    }
  }
  if (closing) {
    closeLandmarker();
    return;
  }
  send({ type: 'ready', delegate });
}

async function useCpu(): Promise<void> {
  const create = createCpuLandmarker;
  createCpuLandmarker = undefined;
  if (!create) throw new Error('CPU fallback is unavailable.');
  try {
    closeLandmarker();
  } catch (error) {
    console.warn('GPU landmarker cleanup failed:', error);
  }
  filter.reset();
  delegate = 'CPU';
  landmarker = await create();
}

function detect(bitmap: ImageBitmap, timestampMs: number): void {
  if (!landmarker) throw new Error('Face tracker is unavailable.');
  const start = performance.now();
  const result = landmarker.detectForVideo(bitmap, timestampMs);
  const inferenceMs = performance.now() - start;
  const points = result.faceLandmarks[0];
  const matrix = result.facialTransformationMatrixes[0];

  let face = null;
  if (points?.length === FACE_LANDMARK_COUNT && matrix?.rows === 4 && matrix.columns === 4) {
    const landmarks = new Float32Array(FACE_LANDMARK_COUNT * 3);
    for (let index = 0; index < points.length; index++) {
      const { x, y, z } = points[index];
      landmarks[index * 3] = x;
      landmarks[index * 3 + 1] = y;
      landmarks[index * 3 + 2] = z;
    }
    face = filter.apply(landmarks, matrix.data, timestampMs);
  } else {
    filter.reset();
  }

  send({ type: 'frame', result: { timestampMs, inferenceMs, face } },
    face ? [face.landmarks.buffer, face.poseMatrix.buffer] : []);
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
            await useCpu();
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
