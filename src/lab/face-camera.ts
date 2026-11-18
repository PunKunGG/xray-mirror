import { explainCameraError, requestCamera, stopCameraTracks } from '../camera.ts';
import { startFaceTracker } from '../tracking/face-tracker.ts';
import type { TrackedFace } from '../tracking/types.ts';

interface CameraRun {
  events: AbortController;
  stream?: MediaStream;
  stopTracking?: () => void;
  staleTimer?: number;
}

interface FaceCameraOptions {
  readyMessage: string;
  detectedMessage: string;
  onVideoReady(): void;
  onChange(): void;
}

const OFF = 'Camera is off. Choose Use camera to restart or Example to continue.';
const FACE_LOST = 'Bring your face into view or switch to Example.';
const MAX_FACE_AGE_MS = 500;

export function createLessonFaceCamera(video: HTMLVideoElement, options: FaceCameraOptions) {
  let run: CameraRun | undefined;
  let face: TrackedFace | null = null;
  let status = OFF;

  function update(nextFace: TrackedFace | null, message: string): void {
    face = nextFace;
    status = message;
    options.onChange();
  }

  function release(): void {
    const active = run;
    run = undefined;
    window.clearTimeout(active?.staleTimer);
    active?.events.abort();
    active?.stopTracking?.();
    if (active?.stream) stopCameraTracks(active.stream);
    if (video.srcObject) {
      video.pause();
      video.srcObject = null;
    }
  }

  function fail(active: CameraRun, message: string): void {
    if (run !== active) return;
    release();
    update(null, `${message} Choose Example to continue or Use camera to retry.`);
  }

  async function start(): Promise<void> {
    if (run) return;
    const active: CameraRun = { events: new AbortController() };
    run = active;
    update(null, 'Waiting for camera permission…');
    try {
      const stream = await requestCamera();
      if (run !== active) {
        stopCameraTracks(stream);
        return;
      }
      active.stream = stream;
      for (const track of stream.getVideoTracks()) {
        track.addEventListener('ended', () => fail(active, 'The camera disconnected.'), {
          once: true, signal: active.events.signal,
        });
      }
      video.srcObject = stream;
      await video.play();
      if (run !== active) return;
      options.onVideoReady();
      update(null, 'Starting face tracking…');
      active.stopTracking = startFaceTracker(video, {
        onReady() {
          if (run === active) update(null, options.readyMessage);
        },
        onFrame(frame) {
          if (run !== active) return;
          window.clearTimeout(active.staleTimer);
          const freshFor = MAX_FACE_AGE_MS - (performance.now() - frame.timestampMs);
          const nextFace = freshFor > 0 ? frame.face : null;
          update(nextFace, nextFace ? options.detectedMessage : FACE_LOST);
          if (nextFace) {
            active.staleTimer = window.setTimeout(() => {
              if (run === active) update(null, FACE_LOST);
            }, freshFor);
          }
        },
        onError: () => fail(active, 'Face tracking is unavailable.'),
      });
    } catch (error) {
      fail(active, explainCameraError(error));
    }
  }

  return {
    get running() { return run !== undefined; },
    get face() { return face; },
    get status() { return status; },
    start,
    stop() {
      release();
      update(null, OFF);
    },
  };
}
