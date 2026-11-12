# X-Ray Mirror

X-Ray Mirror is a browser-based anatomy demo with head layers that follow head pose in a mirrored camera preview.

## Run locally

Use Node.js 24.11 or later and Chrome on Windows for the reference setup.

```sh
npm ci
npm run dev
```

Open `http://localhost:5173`, select **Start camera**, and allow access. Turn on **Show tracking data** to see landmarks, render FPS, tracking FPS, detection time, frame age, and the active delegate. **Stop** releases the camera. Use `npm.cmd` on Windows if PowerShell restricts `npm.ps1`.

Under **Look**, choose **X-ray** for a colored glow along anatomical contours or **Solid** for lit, opaque models. **Brightness** adjusts the overlay from 0% to 200% in either mode. X-ray and 100% are the defaults.

Under **Layers**, toggle **Skull**, **Brain**, **Muscles**, **Eyes**, and **Head outline** independently. The **Skull**, **Brain**, and **Muscles** presets show one model at a time. **Everything** enables all five layers. The camera starts with only the skull selected and loads optional models when you enable them.

Under **Mixed reality**, **Whole head** reveals the full tracked anatomy. **Real me showing through** fades the 3D layers from their normal appearance at 0% to the camera view at 100%. **Edge feather** softens the silhouette inward by up to 24 pixels. Both sliders start at zero.

Use **Fit to my head** to adjust overall size, each dimension, and position. Positive offsets move the skull to the right in the mirror, up, or toward the viewer when you face the camera. The fit is saved on this browser and origin. **Reset fit** restores the defaults.

```sh
npm test
npm run build
npm run preview
```

Open `http://localhost:4173` to test the production bundle. The app requires HTTPS or a loopback origin for the camera. Initial tracking setup requires access to the Google-hosted model.

For shader tuning, open the dev server with `?tune` in the URL and start the camera. The lil-gui panel exposes the rim power, rim strength, and surface glow.

## Assets

- [MediaPipe Tasks Vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) provides the runtime. Dev and build copy the Web Worker WASM and loader from the exact version in the lockfile. The [Face Landmarker bundle](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task) is downloaded from Google by version.
- `public/models/skull.glb` contains 22 cranial and facial bones from the [BodyParts3D 4.0 reduced IS-A archive](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html), including the mandible. BodyParts3D, © The Database Center for Life Science licensed under [CC Attribution 4.0 International](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html).
- Skull source OBJ IDs are `FJ3199`, `FJ3200`, `FJ3263`, `FJ3265`, `FJ3269`, `FJ3272`, `FJ3273`, `FJ3274`, `FJ3281`, `FJ3287`, `FJ3289`, `FJ3309`, `FJ3369`, `FJ3371`, `FJ3375`, `FJ3378`, `FJ3379`, `FJ3380`, `FJ3386`, `FJ3392`, `FJ3394`, and `FJ3395`.
- `brain.glb`, `muscles.glb`, and `eyes.glb` use the same BodyParts3D archive. They represent the brain (`FMA50801`), head muscles (`FMA9616`), and structures of both eyeballs (`FMA12514` and `FMA12515`). The converter records the exact OBJ IDs, applies the skull's origin and units, assigns display materials, and reduces the triangle count of the eye meshes. [Head-layer converter](scripts/convert-head-layers.py)

The Blender conversion preserves the relative placement of the 22 bones, centers the assembly, converts millimeters to glTF meters, and adds a neutral material. See [the conversion script](scripts/convert-skull.py) for the source part map and reproduction steps.

The source OBJ headers carry the historical CC BY-SA 2.1 Japan notice. This project uses the archive's [current CC BY 4.0 terms, updated February 27, 2025](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html), for files obtained directly from that archive. Recheck the exact files and license before public deployment.

## Verify camera privacy

Camera frames stay in memory and are transferred directly from the page to the local tracking worker. The Worker returns landmark coordinates and a pose matrix through `postMessage`. Both Vite servers set a Content Security Policy that allows requests to the app origin and the exact model URL. Dev also allows the local Vite socket. This policy blocks the MediaPipe SDK’s external metrics endpoint. Carry the same production policy to the static host when publishing.

In Chrome DevTools, open **Network**, turn on **Preserve log**, disable cache, and reload the production preview. Start the camera, turn on tracking data, enable **Everything**, and stop the camera. Inspect the page and Worker traffic. Expected successful requests are `GET`s for static assets, including the same-origin anatomy GLBs, WASM, and the versioned `.task`. A blocked SDK metrics request may appear when the landmarker closes. Check the request status and verify that neither frames nor coordinates appear in request URLs or payloads.

Phase 1 was checked on Chrome 157 for Windows using a physical webcam and a repeatable camera stream made from a public MediaPipe portrait. Browser checks observed the page and Worker network traffic through start, tracking, and stop. A test request from the Worker to the SDK metrics destination was rejected by its CSP.

## Interpreting measurements

Detection time measures the call to MediaPipe. Frame age measures elapsed time from the browser video callback to the first overlay draw for that result. Camera capture, display scanout, and the filter’s response to movement require separate measurement. Available camera resolutions and inference speeds vary by device and browser. Test physical motion and jitter with good lighting on the target laptop before using these measurements as release criteria.

The anatomy represents one reference adult. Use the fit sliders to adjust for differences in head shape and camera perspective. The Muscles layer covers the reference meshes for muscles around the eyes, tongue, and soft palate. The 3D layers require WebGL 2.
