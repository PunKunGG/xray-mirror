import { defineConfig } from 'vite';
import { FACE_MODEL_URL, HAND_MODEL_URL } from './src/tracking/model-url.ts';

const connections = `connect-src 'self' ${FACE_MODEL_URL} ${HAND_MODEL_URL}`;

export default defineConfig({
  worker: { format: 'es' },
  // Apply the policy to worker responses too. MediaPipe includes its own metrics client.
  server: { headers: { 'Content-Security-Policy': `${connections} ws://localhost:* ws://127.0.0.1:*` } },
  preview: { headers: { 'Content-Security-Policy': connections } },
});
