import type { FaceTrackingFrame, TrackedFace, TrackingDelegate } from './tracking/types.ts';

// MediaPipe's face oval, ordered clockwise from the top of the forehead.
const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];

interface PreviewLayer {
  resize(width: number, height: number, aspect: number, dpr: number): void;
  render(face: TrackedFace | null): void;
}

interface PreviewMetrics {
  renderFps: number | null;
  trackingFps: number | null;
  inferenceMs: number | null;
  overlayMs: number | null;
  delegate: TrackingDelegate | null;
}

class FrameRate {
  private start = 0;
  private count = 0;
  value: number | null = null;

  add(now: number): void {
    if (this.start === 0) {
      this.start = now;
      return;
    }
    this.count++;
    const elapsed = now - this.start;
    if (elapsed < 1_000) return;
    this.value = this.count * 1_000 / elapsed;
    this.start = now;
    this.count = 0;
  }

  reset(): void {
    this.start = 0;
    this.count = 0;
    this.value = null;
  }
}

export function createPreview(
  stage: HTMLElement,
  surface: HTMLElement,
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  onMetrics: (metrics: PreviewMetrics) => void,
  layer: PreviewLayer,
) {
  const context = canvas.getContext('2d');
  const renderRate = new FrameRate();
  const trackingRate = new FrameRate();
  let renderId: number | undefined;
  let latest: FaceTrackingFrame | null = null;
  let painted: FaceTrackingFrame | null = null;
  let overlayMs: number | null = null;
  let delegate: TrackingDelegate | null = null;
  let debug = false;
  let outline = false;
  let lastMetrics = -Infinity;

  function resize(): void {
    if (!video.videoWidth || !video.videoHeight) return;
    const scale = Math.min(stage.clientWidth / video.videoWidth, stage.clientHeight / video.videoHeight);
    const width = video.videoWidth * scale;
    const height = video.videoHeight * scale;
    surface.style.width = `${width}px`;
    surface.style.height = `${height}px`;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    layer.resize(width, height, video.videoWidth / video.videoHeight, dpr);
  }

  const resizeObserver = new ResizeObserver(resize);

  function metrics(): void {
    onMetrics({
      renderFps: renderRate.value,
      trackingFps: trackingRate.value,
      inferenceMs: latest?.inferenceMs ?? null,
      overlayMs,
      delegate,
    });
  }

  function render(now: number): void {
    renderId = requestAnimationFrame(render);
    renderRate.add(now);
    const current = latest && now - latest.timestampMs < 500 ? latest : null;
    layer.render(current?.face ?? null);
    if (current !== painted) {
      painted = current;
      overlayMs = current?.face ? Math.max(0, now - current.timestampMs) : null;
    }
    if ((debug || outline) && context) {
      const { width, height } = canvas;
      context.clearRect(0, 0, width, height);
      const landmarks = current?.face?.landmarks;
      if (landmarks && outline) {
        context.beginPath();
        for (const landmark of FACE_OVAL) {
          const index = landmark * 3;
          context.lineTo(landmarks[index] * width, landmarks[index + 1] * height);
        }
        context.closePath();
        context.lineJoin = 'round';
        context.lineWidth = 1.5 * (window.devicePixelRatio || 1);
        context.strokeStyle = '#66b8ff';
        context.stroke();
      }
      if (landmarks && debug) {
        const radius = Math.max(1, 1.25 * (window.devicePixelRatio || 1));
        context.beginPath();
        context.fillStyle = '#7ee7ff';
        for (let index = 0; index < landmarks.length; index += 3) {
          const x = landmarks[index] * width;
          const y = landmarks[index + 1] * height;
          context.moveTo(x + radius, y);
          context.arc(x, y, radius, 0, 2 * Math.PI);
        }
        context.fill();
      }
    }
    if (now - lastMetrics >= 250) {
      lastMetrics = now;
      metrics();
    }
  }

  function resetTracking(): void {
    latest = null;
    painted = null;
    delegate = null;
    overlayMs = null;
    trackingRate.reset();
    layer.render(null);
    metrics();
  }

  return {
    start() {
      if (renderId !== undefined) return;
      resizeObserver.observe(stage);
      video.addEventListener('resize', resize);
      window.addEventListener('resize', resize);
      resize();
      renderId = requestAnimationFrame(render);
    },
    stop() {
      if (renderId !== undefined) cancelAnimationFrame(renderId);
      renderId = undefined;
      resizeObserver.disconnect();
      video.removeEventListener('resize', resize);
      window.removeEventListener('resize', resize);
      renderRate.reset();
      lastMetrics = -Infinity;
      resetTracking();
      context?.clearRect(0, 0, canvas.width, canvas.height);
    },
    setDebug(show: boolean) {
      debug = show;
      canvas.hidden = !debug && !outline;
      if (show) metrics();
    },
    setOutline(show: boolean) {
      outline = show;
      canvas.hidden = !debug && !outline;
    },
    setDelegate(value: TrackingDelegate) {
      delegate = value;
      metrics();
    },
    accept(frame: FaceTrackingFrame) {
      latest = frame;
      trackingRate.add(performance.now());
    },
    resetTracking,
  };
}
