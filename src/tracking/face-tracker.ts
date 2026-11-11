import { FACE_MODEL_URL } from './model-url.ts';
import type { TrackerReply, TrackerRequest } from './protocol.ts';
import type { FaceTrackingFrame, TrackingDelegate } from './types.ts';

interface TrackerCallbacks {
  onReady(delegate: TrackingDelegate): void;
  onFrame(frame: FaceTrackingFrame): void;
  onError(error: unknown): void;
}

export function startFaceTracker(video: HTMLVideoElement, callbacks: TrackerCallbacks): () => void {
  const worker = new Worker(new URL('./face.worker.ts', import.meta.url), { type: 'module' });
  const abort = new AbortController();
  const hasVideoCallback = typeof video.requestVideoFrameCallback === 'function';
  let callbackId: number | undefined;
  let deadline: number | undefined;
  let ready = false;
  let busy = false;
  let disposed = false;
  let lastVideoTime = -1;
  let lastTimestamp = -1;

  function post(message: TrackerRequest, transfer: Transferable[] = []): void {
    worker.postMessage(message, transfer);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    abort.abort();
    window.clearTimeout(deadline);
    if (callbackId !== undefined) {
      if (hasVideoCallback) video.cancelVideoFrameCallback(callbackId);
      else cancelAnimationFrame(callbackId);
    }

    // Give the landmarker a chance to close, even when the current frame is in flight.
    const terminate = () => worker.terminate();
    const timeout = window.setTimeout(terminate, 1_000);
    worker.addEventListener('message', ({ data }: MessageEvent<TrackerReply>) => {
      if (data.type !== 'disposed') return;
      window.clearTimeout(timeout);
      terminate();
    });
    post({ type: 'dispose' });
  }

  function fail(error: unknown): void {
    if (disposed) return;
    dispose();
    callbacks.onError(error);
  }

  function schedule(): void {
    callbackId = hasVideoCallback
      ? video.requestVideoFrameCallback(onVideoFrame)
      : requestAnimationFrame(onVideoFrame);
  }

  function onVideoFrame(now: number): void {
    if (disposed) return;
    schedule();
    if (busy || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || now <= lastTimestamp) return;
    if (!hasVideoCallback && video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;
    lastTimestamp = now;
    busy = true;
    deadline = window.setTimeout(() => fail(new Error('Tracking frame timed out.')), 10_000);
    void capture(now);
  }

  async function capture(timestampMs: number): Promise<void> {
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(video);
      if (disposed) return;
      post({ type: 'frame', timestampMs, bitmap }, [bitmap]);
      bitmap = undefined;
    } catch (error) {
      fail(error);
    } finally {
      bitmap?.close();
    }
  }

  worker.addEventListener('message', ({ data }: MessageEvent<TrackerReply>) => {
    if (disposed) return;
    switch (data.type) {
      case 'ready':
        if (!ready) {
          ready = true;
          window.clearTimeout(deadline);
          schedule();
        }
        callbacks.onReady(data.delegate);
        break;
      case 'frame':
        window.clearTimeout(deadline);
        busy = false;
        callbacks.onFrame(data.result);
        break;
      case 'error':
        fail(new Error(data.message));
        break;
    }
  });
  worker.addEventListener('error', (event) => {
    event.preventDefault();
    fail(new Error(event.message || 'Tracking worker could not start.'));
  });
  worker.addEventListener('messageerror', () => fail(new Error('Tracking worker sent an unreadable response.')));

  deadline = window.setTimeout(() => fail(new Error('Face tracker setup timed out.')), 30_000);
  void (async () => {
    try {
      const response = await fetch(FACE_MODEL_URL, {
        credentials: 'omit', referrerPolicy: 'no-referrer', signal: abort.signal,
      });
      if (!response.ok) throw new Error(`Face model download failed (HTTP ${response.status}).`);
      const model = await response.arrayBuffer();
      if (disposed) return;
      const wasmUrl = new URL(`${import.meta.env.BASE_URL}wasm`, window.location.origin).href;
      post({ type: 'initialize', wasmUrl, model }, [model]);
    } catch (error) {
      fail(error);
    }
  })();

  return dispose;
}
