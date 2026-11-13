# X-Ray Mirror

X-Ray Mirror is a browser-based anatomy demo with head layers that follow head pose in a mirrored camera preview. For demonstration only. The overlay scales and aligns a 3D model of one reference adult to your head. Camera video stays on your device.

## Run locally

Use Node.js 24.11 or later and Chrome on Windows for the reference setup.

```sh
npm ci
npm run dev
```

Open `http://localhost:5173`, select **Start camera**, and allow access. **Stop** releases the camera. Use `npm.cmd` on Windows if PowerShell restricts `npm.ps1`.

Use **Quick view** to set the overlay in one click. **Classic** restores the default X-ray skull. **Study** enables every layer and shows labels. **Hand lens** reveals the skull through a lens that follows your hand. **Hands only** shows solid hand bones with labels. You can change any setting afterward. Your saved head fit stays in effect when you switch views.

Open **Diagnostics** and turn on **Show tracking data** to see landmarks, render FPS, tracking FPS, detection time, frame age, and the active delegate.

Under **Appearance and reveal**, choose **X-ray** for a colored glow along the head models and blue hand bones, or **Solid** for lit head models and opaque, shaded hand bones. **Brightness** adjusts both the head and hand bones from 0% to 200%. X-ray and 100% are the defaults.

Open **Layers** to toggle **Skull**, **Brain**, **Muscles**, **Eyes**, **Head outline**, and **Hand bones** independently. Layer presets select one layer at a time or enable all six with **Everything**. The app loads optional models when you enable them.

Under **Mixed reality**, **Whole head** reveals the full tracked anatomy. **Real me showing through** fades the 3D layers from their normal appearance at 0% to the camera view at 100%. **Edge feather** softens the silhouette inward by up to 24 pixels. Both sliders start at zero.

Choose **X-ray lens (follows your hand)** and move an open hand in front of the camera. The circle follows one palm and reveals head anatomy inside it. **Lens size** sets the circle diameter from 10% to 60% of the shorter preview side. The reveal returns to **Whole head** while no hand is detected and resumes when a hand returns. **Hand bones** draws the articulated skeletons of up to two hands across the preview.

Turn on **Show labels** under **Quick view** to identify selected head structures and the hand bones. In lens mode, a head label appears when its anchor is inside the circle. Hand labels appear with the **Hand bones** layer.

The **Skull** layer labels the frontal, parietal, temporal, occipital, and zygomatic bones, plus the maxilla and mandible. Paired bones share one label. It points to the nearer anchor within the active view.

The **Brain** layer labels the cerebrum, cerebellum, and brainstem. The cerebrum label anchors to cerebral white matter, and the brainstem label anchors to the pons.

Select **Eyes** as the only 3D head layer to see **Cornea**, **Iris**, **Lens**, and **Sclera**. Each detail label points to the nearer eligible anchor. With other 3D head layers selected, the eye labels are **Left eye** and **Right eye**.

The **Muscles** layer labels **Eye muscles**, **Tongue muscles**, and **Soft palate muscles**. The labels point to representative meshes for the inferior oblique, genioglossus, and levator veli palatini, respectively.

Hand labels include the phalanges, metacarpus, carpus, and individual bones shown around the little finger, wrist, and distal forearm. The eight carpal bones and the wrist ends of the radius and ulna are drawn as reference shapes based on the tracked palm. Dashed leaders mark those estimates. The wrist and forearm shapes are hidden when the palm projects edge-on. When space is limited, the overlay keeps group labels before individual hand labels.

Use **Fit to my head** to adjust overall size, each dimension, and position. Positive offsets move the skull to the right in the mirror, up, or toward the viewer when you face the camera. The fit is saved on this browser and origin. **Reset fit** restores the defaults.

```sh
npm test
npm run build
npm run preview
```

Open `http://localhost:4173` to test the production bundle. The app requires HTTPS or a loopback origin for the camera. Initial tracking setup requires access to the Google-hosted model.

For shader tuning, open the dev server with `?tune` in the URL and start the camera. The lil-gui panel exposes the rim power, rim strength, and surface glow.

## Assets

- MediaPipe Tasks Vision provides the runtime. Dev and build copy the Web Worker WASM and loader from the exact version in the lockfile. The versioned Face Landmarker loads with the camera. Hand Landmarker loads when **Hand bones** or the lens is enabled. [MediaPipe Tasks Vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) · [Face model](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task) · [Hand model](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task)
- BodyParts3D, © The Database Center for Life Science licensed under [CC Attribution 4.0 International](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html).
- `public/models/skull.glb` contains 22 cranial and facial bones, including the mandible, from the [BodyParts3D 4.0 reduced IS-A archive](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html).
- Skull source OBJ IDs are `FJ3199`, `FJ3200`, `FJ3263`, `FJ3265`, `FJ3269`, `FJ3272`, `FJ3273`, `FJ3274`, `FJ3281`, `FJ3287`, `FJ3289`, `FJ3309`, `FJ3369`, `FJ3371`, `FJ3375`, `FJ3378`, `FJ3379`, `FJ3380`, `FJ3386`, `FJ3392`, `FJ3394`, and `FJ3395`.
- `brain.glb`, `muscles.glb`, and `eyes.glb` use the same BodyParts3D archive. They represent the brain (`FMA50801`), head muscles (`FMA9616`), and structures of both eyeballs (`FMA12514` and `FMA12515`). The converter records the exact OBJ IDs, applies the skull's origin and units, assigns display materials, and reduces the triangle count of the eye meshes. [Head-layer converter](scripts/convert-head-layers.py)

The Blender conversion preserves the relative placement of the 22 bones, centers the assembly, converts millimeters to glTF meters, and adds a neutral material. See [the conversion script](scripts/convert-skull.py) for the source part map and reproduction steps.

The source file is [`isa_BP3D_4.0_obj_99.zip`](https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/isa_BP3D_4.0_obj_99.zip). The copy checked in Phase 8 has SHA-256 `40665852c49f218326590e204db91064a1ecfc3c6f8cbd7bbbcaac62c7cd409e`. All 120 OBJ IDs used by the GLBs are present in that ZIP. The OBJ headers name the historical CC BY-SA 2.1 Japan terms and point to the archive license page, which now states CC BY 4.0 and is dated February 27, 2025.

After Blender export, compress each of the four GLBs with glTF Transform 4.5.1. Use distinct input and output files, then place the compressed outputs in `public/models/`.

```sh
npm exec --yes --package=@gltf-transform/cli@4.5.1 -- gltf-transform draco input.glb output.glb --method edgebreaker --quantize-position 16 --quantize-normal 12
```

Compression preserves the mesh names, triangle counts and materials and reduces the four files from 12.64 MB to 2.69 MB total. The Draco decoder comes from the installed Three.js package. [Draco license](public/licenses/draco.txt)

## Verify camera privacy

Camera frames stay in memory and transfer from the page to local tracking workers. The workers return landmark coordinates and the head pose matrix through `postMessage`. Both Vite servers set a Content Security Policy that allows requests to the app origin and the two exact MediaPipe model URLs. Dev also allows the local Vite socket. This policy blocks the MediaPipe SDK’s external metrics endpoint. Carry the same production policy to the static host when publishing.

In Chrome DevTools, open **Network**, turn on **Preserve log**, disable cache, and reload the production preview. Start the camera, turn on tracking data, enable **Everything**, choose the hand lens, and stop the camera. Inspect the page and Worker traffic. Expected successful requests are `GET`s for static assets, including the same-origin anatomy GLBs, WASM, and both versioned `.task` files. A blocked SDK metrics request may appear when a landmarker closes. Check the request status and verify that neither frames nor coordinates appear in request URLs or payloads.

To measure the cold start, record transferred bytes from reload through the first tracked skull draw, including requests from the face worker. Keep the default **Skull** preset for that measurement. Measure requests made after enabling **Everything** separately. Check the media runtime's `Content-Encoding` when comparing servers.

Phase 1 was checked on Chrome 157 for Windows using a physical webcam and a repeatable camera stream made from a public MediaPipe portrait. Browser checks observed the page and Worker network traffic through start, tracking, and stop. A test request from the Worker to the SDK metrics destination was rejected by its CSP.

Phase 8 checks on Chrome and Edge 157 for Windows used a repeatable face and hand stream and captured the page and worker requests through camera stop. The browser sent only asset GETs. Chrome downloaded about 19.6 MB up to the first tracked skull draw in Vite preview. A local static server serving the same build with gzip on the MediaPipe WASM file brought that total to about 10.0 MB. Both totals include a conservative allowance for the worker script bootstrap. Optional layers and Hand Landmarker loaded after selecting **Everything**.

## Interpreting measurements

Detection time measures the call to MediaPipe. Frame age measures elapsed time from the browser video callback to the first overlay draw for that result. Camera capture, display scanout, and the filter’s response to movement require separate measurement. Available camera resolutions and inference speeds vary by device and browser. Test physical motion and jitter with good lighting on the target laptop before using these measurements as release criteria.

With a 1280×720, 30 FPS webcam and **Everything** plus **Show labels** enabled, 12 one-second samples after warm-up on the Windows RTX 4060 Ti desktop recorded 75 render FPS, 9.8–10.4 face tracking FPS, 21.9–34.5 ms detection time, and 26.7–40.4 ms frame age. The hand tracker was enabled with no hand in view. Initial loading produced slower samples. These figures are specific to that desktop and run.

Safari on desktop and iOS remain unverified. The Android emulator did not complete the Chrome test after repeated System UI stalls. Check Chrome on a physical Android device and measure motion and jitter on the reference laptop before release.

Use the fit sliders to adjust for differences in head shape and camera perspective. The Muscles layer covers the reference meshes for muscles around the eyes, tongue, and soft palate. The 3D layers require WebGL 2.
