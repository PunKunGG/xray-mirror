import { copyFile, mkdir } from 'node:fs/promises';

const source = new URL('../node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url);
const destination = new URL('../public/wasm/', import.meta.url);

await mkdir(destination, { recursive: true });
await Promise.all(['js', 'wasm'].map((extension) => {
  const file = `vision_wasm_module_internal.${extension}`;
  return copyFile(new URL(file, source), new URL(file, destination));
}));
