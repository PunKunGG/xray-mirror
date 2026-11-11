# X-Ray Mirror: Requirements

## 1. Overview
Browser-only web app. Uses the webcam to track the user's head and hands and overlays an anatomical X-ray (skull, brain, muscles, eyes, hand bones) in real time. Anatomy is a reference model from one adult. The app scales and aligns this model to the head in the camera image.

## 2. Constraints
- C1: Fully client-side. No backend. Video frames never leave the device.
- C2: Vite + TypeScript (strict). Three.js for rendering, @mediapipe/tasks-vision for tracking, lil-gui for temporary controls.
- C3: Tracking/state logic is separated from DOM/UI so it can be ported to Angular later.
- C4: Runs on HTTPS or localhost only.
- C5: No new dependencies without approval.
- C6: Only use 3D models whose license allows this use. Record source and license in README. Primary model source: BodyParts3D 4.0 from the official LSDB Archive under CC BY 4.0. Show attribution and a license link in the app and README. Record the archive version, part IDs, and changes made during conversion. Re-check the license and provenance of the exact files before public deployment.

## 3. Functional Requirements

### Camera
- FR-1: Show the webcam feed mirrored (prefer 1280x720, front camera).
- FR-2: Clear errors with a retry button: permission denied, no camera, camera busy, insecure context.

### Tracking
- FR-3: Face tracking (478 landmarks + head transform matrix), 1 face.
- FR-4: Hand tracking (21 landmarks per hand), up to 2 hands.
- FR-5: Smooth all tracked values with a One Euro Filter, separate per face/hand.
- FR-6: "Show tracking data" toggle: draw landmarks, FPS, detection latency.

### Rendering
- FR-7: Three.js canvas aligned exactly with the video (no stretch on resize).
- FR-8: Skull bound to head pose; follows rotation, tilt, and distance.
- FR-9: Hand bones follow the 21 hand landmarks (fingers bend with the real hand).
- FR-10: Layers with individual toggles: Skull, Brain, Muscles, Eyes, Head outline, Hand bones. Presets: Skull / Brain / Muscles / Everything.
- FR-11: Look modes: X-ray (Fresnel + additive blending) and Solid. Brightness slider.
- FR-11a: Head outline is a thin blue edge line around the face and jaw so the skull looks attached to the real head.

### Fit to my head
- FR-12: Sliders: overall size, width, height, depth, left/right, up/down, forward/back. Reset button.
- FR-13: Persist these values in localStorage.

### Mixed reality
- FR-14: "Real me showing through" slider blends the real video with the skull.
- FR-15: Edge feather slider.
- FR-16: Reveal dropdown with modes: "Whole head" (overlay covers the entire head; default when no hand is detected) and "X-ray lens (follows your hand)" (a circular lens that follows the hand and reveals the anatomy inside it). Lens size slider.

### Labels
- FR-17: "Show labels" toggle: leader lines + organ names, projected from 3D to screen each frame. Labels are placed in two columns, left and right of the head, sorted by screen Y so text never overlaps, with leader lines running to each structure. Hand bones get labels too when a hand is visible.

### Info
- FR-18: Visible notice: for demonstration only. The app scales and aligns a 3D reference dataset of one adult to the head. Camera frames are processed on the device and never uploaded.
- FR-19: Visible attribution line: "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International", with a link to the license.

## 4. Non-Functional Requirements
- NFR-1: Performance: at least 25 FPS on a typical laptop (target 30+). Tracking must not block rendering.
- NFR-2: Latency: overlay lag behind head movement should not be noticeable (under about 100 ms).
- NFR-3: Stability: no visible jitter when the user holds still.
- NFR-4: Models: total initial download under about 15 MB (Draco/Meshopt), lazy-load optional layers.
- NFR-5: Resource safety: dispose all Three.js geometries/materials/textures, stop camera tracks, close landmarkers on unload.
- NFR-6: Privacy: no network request may contain video data. Document how it was verified.
- NFR-7: Browsers: latest Chrome, Edge, Safari (desktop); Chrome on Android. Safari/iOS best effort.
- NFR-8: Graceful degradation: GPU delegate falls back to CPU; show a message if FPS is very low.
- NFR-9: Accessibility basics: keyboard-operable controls, visible labels, readable contrast.

## 5. Out of Scope
- Any medical diagnosis or measurement
- Recording, uploading, or sharing video
- Full-body tracking (head + hands only)
- Accounts, backend, analytics on video

## 6. Acceptance (whole project)
- Skull stays attached through head turns, tilts, and moving closer/farther.
- Hand bones track open hand, fist, and finger bends without visible popping.
- All toggles and sliders respond instantly with no reload.
- Camera denied/unavailable shows a friendly error, no console crashes.
- `npm run build` passes with zero TS errors.
- README covers run steps, model sources and licenses, privacy verification, and known limitations.

## 7. Delivery Rules
- Build in phases (1-8). Finish one phase, report what was done and what couldn't be verified, then stop for review.

## 8. Phase Map
| Phase | Scope |
|---|---|
| 1 | Webcam + face tracking + debug overlay + One Euro Filter |
| 2 | Skull GLB bound to head matrix + Fit-to-head sliders |
| 3 | X-ray Fresnel shader, Solid mode, Brightness |
| 4 | Layers (brain, muscles, eyes, head outline) + presets |
| 5 | Mixed reality mask (blend, feather, Whole head reveal) |
| 6 | Hand tracking + hand bones + X-ray lens that follows the hand |
| 7 | Labels (two columns, no overlap) |
| 8 | Polish, disclaimer + license attribution, model compression, deploy |
