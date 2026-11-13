# X-Ray Mirror architecture

## Phase 1 data flow

1. The page requests a video-only `MediaStream` after the user starts the camera. It shows the stream in an aspect-preserving surface shared with the overlay canvas. CSS mirrors the entire surface once.
2. The tracking adapter observes new video frames and transfers one `ImageBitmap` at a time to a module Web Worker. It skips incoming frames while a bitmap or inference is in flight. Rendering follows its own animation loop and uses the latest available result.
3. The Worker opens the MediaPipe Face Landmarker with the version-matched module WASM files and the model bytes from the page. It tries the GPU delegate first and falls back to CPU on a GPU failure. It closes each bitmap after inference.
4. `FaceTrackingFrame` describes the result independently of DOM or rendering types. A detected face contains 478 normalized XYZ triplets in unmirrored image coordinates and a column-major 4×4 pose matrix. One Euro filters smooth landmarks, translation, uniform scale, and quaternion orientation. Tracking loss clears the filters and returns a null face.
5. Stop, camera disconnect, and page exit cancel the active session and stop its camera tracks. The page asks the Worker to close its task and terminates it if it does not acknowledge. A late permission result from an old session has its tracks stopped immediately. Tracker errors keep the camera preview available and expose a separate Retry action.

The page and workers run locally in the browser. Third-party asset requests fetch the versioned Face Landmarker and Hand Landmarker models. Vite dev and preview apply an outbound connection policy to the page and workers, which blocks the SDK metrics destination.

## Phase 2 skull overlay

The skull canvas and debug canvas share the video’s aspect-preserving rectangle and the same CSS reflection. The renderer consumes the unmirrored column-major face transform with a perspective camera using the [MediaPipe Face Geometry projection](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/cc/vision/face_geometry/face_geometry_from_landmarks_graph.cc#L59-L68). A fixed registration places the skull’s orbital midpoint at the canonical eye line. The GLB uses meters and is scaled into MediaPipe’s centimeter coordinate space at load time.

Fit offsets and scales apply below the tracked transform, so the adjustments follow the head as it turns. Fit state has a versioned `localStorage` key, and `Reset fit` restores and saves defaults. Loss of tracking clears the skull canvas. The page reuses the renderer and parsed model across camera restarts and disposes both when leaving the page.

## Phase 3 skull appearance

X-ray uses a shared Three.js shader that brightens bone surfaces as their normals turn away from the view direction. It blends the premultiplied glow additively in WebGL and composites the result over the video inside the mirrored preview. Solid restores the GLB materials and uses the scene lights. Brightness scales the shader glow or the Solid lights without reloading the model. The Vite dev server can load the lil-gui module bundled with Three.js when the page opens with `?tune`.

The hand canvas uses the same Look and Brightness controls. X-ray gives the hand bones a blue fill and outline. Solid uses an opaque ivory gradient across each bone, including the estimated wrist and forearm shapes. A Look or Brightness change invalidates the canvas so it redraws with the current tracking frame.

## Phase 4 head layers

The skull, brain, muscles, and eyes share the BodyParts3D origin, head transform, and fit adjustment. Each GLB has its own visibility and load state. The overlay fetches it when first selected during an active camera session and reuses the parsed model for later selections. A failed load can be retried by toggling that layer.

X-ray uses the same Fresnel shader for every model with a distinct color per layer. The head outline is a blue stroke on the landmark canvas around the MediaPipe face oval. It follows the tracked face and jaw independently of the debug points and the 3D renderer.

## Phase 5 whole-head reveal

Whole head reveals the full silhouette of the selected 3D models. The anatomy canvas opacity controls how much live video shows through. A nonzero feather radius renders the anatomy into a WebGL target and uses its alpha coverage to soften the silhouette inward. The pass adjusts opacity in screen pixels and preserves the distinct color blending for X-ray and Solid. At a radius of zero, the renderer draws directly into the anatomy canvas.

## Phase 6 hand tracking and reveal

Hand Landmarker runs in its own module Worker when hand bones or the hand lens are active. Each tracker has one video frame in flight. The hand Worker uses the same WASM assets, delegate fallback, and shutdown protocol as the face tracker. It returns up to two sets of 21 points. Wrist and palm motion associate results across frames, with handedness resolving ambiguous matches and a separate One Euro filter smoothing each track.

The shared 2D canvas draws the metacarpals and phalanges from unmirrored image coordinates. It fits the eight carpal silhouettes and the distal radius and ulna to axes estimated from the wrist and knuckles. When the projected palm collapses edge-on, only the metacarpals and phalanges are drawn. The hand lens follows the current track ID and uses the palm center. The head compositor clips the 3D models to a circular window in display pixels, and the 2D canvas clips the head outline to the same window. Hand bones remain visible across the camera view. A missing or stale hand clears the lens and restores the whole-head reveal.

## Phase 7 anatomy labels

The head overlay stores a surface vertex on each labeled GLB mesh. Each frame with labels enabled projects those vertices through the same model transforms and perspective camera as the anatomy overlay. Hand labels use segment midpoints from the displayed hand skeleton and estimate wrist and forearm positions along and across the tracked palm. The label canvas reflects anchor coordinates inside the aspect-preserving video rectangle and draws the text normally. Two columns sit at the edges of the preview and reserve vertical space for each label in anchor Y order. When space is limited, the overlay uses shorter rows and prioritizes head and hand group labels. The overlay skips anchors outside the camera image and skips head anchors outside the active lens.

## Phase 8 model delivery

The anatomy GLBs use Draco compression. Three.js loads its decoder from the app origin when the first selected model is parsed and shares up to two decode workers across the head layers. Parsed models remain available across camera restarts. Leaving the page or reloading the app in development disposes the decoder and its workers along with the renderer.
