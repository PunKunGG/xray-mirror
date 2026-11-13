import { createHandBoneAppearance, drawHandBones, handLabelAnchors, palmCenter, type Lens } from './anatomy/hand-bones.ts';
import type { LabelAnchor } from './anatomy/label-layout.ts';
import { createLabelOverlay } from './anatomy/label-overlay.ts';
import type { SkullLook } from './anatomy/xray-material.ts';
import type { FaceTrackingFrame, HandTrackingFrame, TrackedFace, TrackedHand, TrackingDelegate } from './tracking/types.ts';

// MediaPipe's face oval, ordered clockwise from the top of the forehead.
const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];

interface PreviewLayer {
  resize(width: number, height: number, aspect: number, dpr: number): void;
  render(face: TrackedFace | null, lens: Lens | null): void;
  getLabelAnchors(): readonly LabelAnchor[];
  onHands(count: number): void;
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
  labelCanvas: HTMLCanvasElement,
  onMetrics: (metrics: PreviewMetrics) => void,
  layer: PreviewLayer,
) {
  const context = canvas.getContext('2d');
  const labels = createLabelOverlay(labelCanvas);
  const renderRate = new FrameRate();
  const trackingRate = new FrameRate();
  let renderId: number | undefined;
  let latest: FaceTrackingFrame | null = null;
  let painted: FaceTrackingFrame | null = null;
  let overlayMs: number | null = null;
  let delegate: TrackingDelegate | null = null;
  let debug = false;
  let outline = false;
  let handBones = false;
  let handAppearance = createHandBoneAppearance('xray', 1);
  let lensSize = 0;
  let latestHands: HandTrackingFrame | null = null;
  let handCount = 0;
  let lensHand: TrackedHand | undefined;
  let lens: Lens | null = null;
  let paintedFace: TrackedFace | null = null;
  let paintedHands: HandTrackingFrame | null = null;
  let canvasDirty = true;
  let lastMetrics = -Infinity;

  function updateLens(hands: readonly TrackedHand[]): void {
    // Keep following the same hand if the detector changes its result order.
    const hand = lensSize > 0
      ? hands.find(({ id }) => id === lensHand?.id) ?? hands[0]
      : undefined;
    if (hand === lensHand && (lens?.size ?? 0) === (hand ? lensSize : 0)) return;
    lensHand = hand;
    lens = hand ? { ...palmCenter(hand.landmarks), size: lensSize } : null;
    canvasDirty = true;
  }

  function updateCanvasVisibility(): void {
    canvas.hidden = !debug && !outline && !handBones && lensSize === 0;
    canvasDirty = true;
  }

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
    canvasDirty = true;
    layer.resize(width, height, video.videoWidth / video.videoHeight, dpr);
    labels.resize(stage.clientWidth, stage.clientHeight, width, height, dpr);
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
    const handsFrame = latestHands && now - latestHands.timestampMs < 500 ? latestHands : null;
    const hands = handsFrame?.hands ?? [];
    if (hands.length !== handCount) {
      handCount = hands.length;
      layer.onHands(handCount);
    }
    updateLens(hands);
    const face = current?.face ?? null;
    layer.render(face, lens);
    if (!labelCanvas.hidden) {
      const handAnchors = handBones && handAppearance.opacity > 0 ? handLabelAnchors(hands) : [];
      // Use the nose tip when head labels are visible, otherwise center on the hands.
      const headAnchors = layer.getLabelAnchors();
      const centerX = face && headAnchors.length ? face.landmarks[3]
        : handAnchors.length ? hands.reduce((sum, hand) => sum + palmCenter(hand.landmarks).x, 0) / hands.length
          : 0.5;
      labels.render(headAnchors, handAnchors, centerX, lens);
    }
    if (current !== painted) {
      painted = current;
      overlayMs = current?.face ? Math.max(0, now - current.timestampMs) : null;
    }
    if (context && !canvas.hidden && (canvasDirty || paintedFace !== face || paintedHands !== handsFrame)) {
      canvasDirty = false;
      paintedFace = face;
      paintedHands = handsFrame;
      const { width, height } = canvas;
      const dpr = window.devicePixelRatio || 1;
      context.clearRect(0, 0, width, height);
      const landmarks = face?.landmarks;
      if (lens) {
        context.save();
        context.beginPath();
        context.arc(lens.x * width, lens.y * height, lens.size * Math.min(width, height) / 2, 0, 2 * Math.PI);
        context.strokeStyle = '#8bdbf6';
        context.lineWidth = 1.5 * dpr;
        context.stroke();
        context.clip();
      }
      if (landmarks && outline) {
        context.beginPath();
        for (const landmark of FACE_OVAL) {
          const index = landmark * 3;
          context.lineTo(landmarks[index] * width, landmarks[index + 1] * height);
        }
        context.closePath();
        context.lineJoin = 'round';
        context.lineWidth = 1.5 * dpr;
        context.strokeStyle = '#66b8ff';
        context.stroke();
      }
      if (lens) context.restore();
      if (handBones) {
        for (const hand of hands) drawHandBones(context, hand.landmarks, handAppearance);
      }
      if (debug) {
        const radius = Math.max(1, 1.25 * dpr);
        context.beginPath();
        context.fillStyle = '#7ee7ff';
        const points = hands.map((hand) => hand.landmarks);
        if (landmarks) points.push(landmarks);
        for (const coordinates of points) {
          for (let index = 0; index < coordinates.length; index += 3) {
            const x = coordinates[index] * width;
            const y = coordinates[index + 1] * height;
            context.moveTo(x + radius, y);
            context.arc(x, y, radius, 0, 2 * Math.PI);
          }
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
    layer.render(null, null);
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
      labels.clear();
    },
    setDebug(show: boolean) {
      debug = show;
      updateCanvasVisibility();
      if (show) metrics();
    },
    setOutline(show: boolean) {
      outline = show;
      updateCanvasVisibility();
    },
    setHandBones(show: boolean) {
      handBones = show;
      updateCanvasVisibility();
    },
    setAppearance(look: SkullLook, brightness: number) {
      handAppearance = createHandBoneAppearance(look, brightness);
      canvasDirty = true;
    },
    setLabels(show: boolean) {
      labelCanvas.hidden = !show;
      if (!show) labels.clear();
    },
    setLens(size: number) {
      lensSize = size;
      updateCanvasVisibility();
    },
    acceptHands(frame: HandTrackingFrame | null) {
      latestHands = frame;
      if (!frame) {
        handCount = 0;
        updateLens([]);
      }
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
