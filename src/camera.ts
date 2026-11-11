export function requestCamera(): Promise<MediaStream> {
  const { hostname, protocol } = window.location;
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(hostname) || hostname.endsWith('.localhost');
  if (!window.isSecureContext || (protocol !== 'https:' && !(protocol === 'http:' && loopback))) {
    throw new Error('insecure-context');
  }
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('camera-unsupported');

  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: 'user' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });
}

export function explainCameraError(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === 'insecure-context') return 'Open this page over HTTPS or on localhost to use your camera.';
    if (error.message === 'camera-unsupported') return 'Camera access is unavailable in this browser. Open this page in a supported browser and retry.';
    switch (error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Camera access was denied. Allow camera access in your browser or system settings, then retry.';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'No camera is available. Connect or enable a camera, then retry.';
      case 'NotReadableError':
      case 'AbortError':
        return 'The camera could not open. Close other apps that may be using it, then retry.';
    }
  }
  return 'The camera could not start. Check your camera and browser settings, then retry.';
}

export function stopCameraTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}
