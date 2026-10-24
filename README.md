# Atelier — jewellery photo try-on

Upload a portrait and a 3D jewellery model, adjust the placement, then generate a more natural image with a pretrained local FLUX.2 Klein 4B editor. No training, paid API, API key or cloud image processing is required. The 3D preview remains available for precise placement. The deployed site still runs the older placement-only version; the AI upgrade runs locally on this Mac.

## Run locally

```sh
npm install
npm run local:setup  # once: Python packages and about 4.6 GB of model weights
npm run local
```

Open **http://127.0.0.1:3002**. The model and Python environment have already been installed on this Mac. `start-local.command` is also a launcher. Stop with Ctrl+C. The frontend uses port 3002; the local Python service uses port 8765. Both bind to loopback. A current WebGL2 browser, Python 3.12+, Node 22.13+, and a supported Apple Silicon Mac/macOS version are required. Tested on this M5 Mac with 16 GB RAM.

Setup downloads packages and model weights. Generation uses local files with Hugging Face/Transformers offline mode enabled. Portraits and rendered references travel only from the local browser to the local Python service. Inputs, outputs, masks and diagnostic logs remain in the git-ignored `local-runtime/jobs/` directory until you delete them. Delete its contents when the service is stopped to remove saved photos. Model weights and the Python environment are also git-ignored. No user image or CAD asset is included in the site bundle.

For the placement-only preview, `npm run dev -- --hostname 127.0.0.1 --port 3002` works without starting the model service.

## Use

1. Upload JPG, PNG or WebP (up to 25 MB). Include visible ears or neck/chest.
2. Upload a self-contained GLB, a Rhino 3DM with saved render meshes, or STL (up to 80 MB / 3 million triangles).
3. Select earrings, pendant/necklace, or a single piece. Earrings repeats the entire model twice; upload ONE earring rather than a pair or a CAD layout of multiple products.
4. Click **Preview placement**. Select an attachment point and click the portrait, or use the position sliders. Adjust size, XYZ rotation and finish as needed. Rhino files initially receive a -90° X rotation for their typical Z-up convention.
5. Click **Generate natural try-on**. The local editor reconstructs the jewellery regions, including perspective, reflections and contact with skin/hair. Watch real generation stages or cancel the job. The result appears below the guide and can be downloaded as a PNG. Changing placement clears a previous result.
6. Inspect the result: this small model can alter stone settings, material color or shape. It is an AI visualization, not an exact SKU rendering. Use an actual earring/necklace model for the selected category; a ring will not reliably become a correct earring.

Exports preserve the input aspect ratio and are capped at 1800 pixels on the longest side. Inference uses a padded crop around all jewellery regions, capped at 768 pixels on its long side (rounded to multiples of 16); generated regions are mapped back and feathered into the source image. Set `TRYON_CROP=0 TRYON_MAX_SIDE=896` to restore full-frame inference. Pixels outside the edit mask remain identical to the input.

## Pipeline

- MediaPipe Face Landmarker runs a pretrained model in IMAGE mode. A single detected face provides estimated earring/pendant anchors. Multiple faces, missing faces, or detector errors use explicit manual placement.
- Three.js loads 3DM through its Rhino WASM worker, GLB through GLTFLoader, and STL through STLLoader. It rejects CAD objects that the importer reports as lacking a render mesh. Curves, points, cameras and lights are excluded; hidden CAD layers are respected.
- Meshes are centered and normalized for adjustable visual scale. A transparent orthographic renderer adds jewellery with an environment reflection map and lights. Original materials are the default; finish overrides apply to the whole piece, including stones.
- Canvas combines the photograph with the transparent render for the placement guide, and renders a separate product reference. Projected CAD bounds determine padded edit regions.
- A FastAPI service accepts these rendered images (not raw CAD) and uses one persistent MLX worker for sequential jobs. MFLUX 0.19.1 loads the prequantized `mlx-community/flux2-klein-4b-4bit` model, pinned to revision `860e87183ceb29e39627c0612ebd66d8ea66e68c`. It uses 4 distilled steps, two reference images, and memory-saving callbacks. Weights stay loaded between jobs; cancellation and service shutdown release the worker.
- The model generates an edited crop; the output keeps only feathered jewellery regions and retains the source portrait elsewhere. This is masked blending of generated content, not a pasted CAD render. It helps preserve identity but can expose seams if the model moves the jewellery too far.
- The UI polls job progress, displays the generated PNG, and downloads the same bytes. Cancellation terminates the worker. Direct browser calls from public origins are rejected; production uses a same-origin authenticated backend gateway to a private inference host. See [deployment requirements](local-runtime/DEPLOYMENT.md).
- External model dependencies are blocked. Export GLB with embedded textures; compressed GLBs requiring Draco/KTX2 decoders are not currently supported.

## Limitations

The geometric guide does not simulate hair/skin occlusion, chain draping or physical sizing. Local AI attempts photographic integration, but does not perform calibrated physics or guarantee exact product geometry. Only flexible chains should drape; rigid metal should rotate without bending. Face landmarks do not locate exact piercing holes. Neck placement is estimated from the face, not reconstructed from a body model. The app does not infer whether a uploaded object is a ring, bracelet, earring or necklace, and it renders the supplied whole object.

A single pendant asset does not create a missing necklace chain. GLB/STL tessellation, suitable per-product materials, pivots and dimensions remain an asset preparation task.

## Supplied CAD files

- `RDLR556.3dm`, `RDLR851.3dm`, `RDWT284.3dm`: usable mesh data; browser import and image output tested.
- `RDLB501-0.50CT.3dm`: 116 Brep objects have no saved render meshes (2,100 faces without cached meshes). Import is intentionally rejected to avoid an incomplete design. Open it in Rhino, generate render meshes in a shaded/rendered view and save including meshes, or export a meshed GLB/STL.

Source CAD files remain in the parent workspace and are excluded from the app bundle.

## Verification

```sh
npx tsc --noEmit
npx oxlint app/page.tsx lib/tryon/engine.ts lib/tryon/local.ts
npm run build
.venv-local/bin/python tests/local-service.py
node tests/local-pipeline.mjs # actual MLX inference; start npm run local first
node tests/pipeline.mjs # geometric regression checks
```

The browser test expects the dev server at `http://127.0.0.1:3002/` and Chrome at the standard macOS location (override with `CHROME_PATH`). The supplied four CAD files are read from `../`. Download Google's public portrait fixture before running:

```sh
mkdir -p tests/fixtures
curl -fL https://storage.googleapis.com/mediapipe-assets/portrait.jpg -o tests/fixtures/portrait.jpg
```

Tests cover actual face detection, all four Rhino inputs, GLB/STL, invalid uploads, manual fallback, generated pixels, original comparison, orientation/material controls, stale-export invalidation, PNG download, mobile overflow, browser errors and network locality. Test photos and outputs are git-ignored. The optional WebMCP `generate_tryon_image` action calls the same generation path and rejects calls before both uploads exist.

## Primary references

- https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js
- https://threejs.org/docs/pages/Rhino3dmLoader.html
- https://threejs.org/docs/pages/GLTFLoader.html
- https://threejs.org/docs/pages/STLLoader.html

Local tests additionally cover model readiness, external-origin rejection, invalid inputs, busy-job rejection, cancellation, actual CAD-to-reference-to-MLX generation, exact download bytes, mobile layout, stale-result invalidation and no third-party browser requests. Results are written to `test-results/local-report.json`. Repository-wide lint also reports pre-existing errors in bundled UI components and vendor code; the changed application files are linted separately.

Local inference references: [MFLUX](https://github.com/mflux-community/mflux), [FLUX.2 Klein editing](https://github.com/mflux-community/mflux/blob/main/src/mflux/models/flux2/README.md), [quantized weights](https://huggingface.co/mlx-community/flux2-klein-4b-4bit).

Measured on this Mac: the complete browser/CAD/local-AI/download test took **36 seconds of generation**, at 704×896 working resolution with **8.45 GB peak MLX allocation** (this excludes browser and other system memory). A first 416×640 edit of the supplied example took 29 seconds and 4.93 GB. Timing and fidelity vary with inputs. The generated example improved reflections and angle but changed some product details, so exact SKU fidelity remains a limitation.

## Live camera capture

Choose the try-on type before clicking **Use camera**. The browser requests video access only (no microphone). A separate MediaPipe VIDEO detector checks one face, framing, centering, approximate frontal pose and level eyes. Pendant mode requires more space below the chin. Manual mode enables capture after about 0.9 seconds of valid framing. Automatic mode captures once after 3 continuous seconds of valid framing, displays a countdown, and resets when framing becomes invalid or the video stalls. The current frame is checked again before capture. Capture enters the same photo/detection/placement pipeline as an uploaded image. Closing or capturing releases the camera tracks. Camera frames are processed in the browser; only the captured photo is later submitted to the local editor when generation is requested.

These are landmark-based framing heuristics, not a classifier for exposed ears, hair occlusion, exact pitch, necklace contact or physical fit. The video preview is mirrored; captured pixels are unmirrored. Camera access needs localhost or HTTPS. Permission errors retain the upload fallback. Verification: `tests/camera.mjs` uses Chrome's simulated webcam with a local Y4M portrait fixture, exercises actual MediaPipe video detection and capture, and checks track cleanup, permission errors, and framing rules.

The local UI has four sections: Jewellery (model and category), Photo (upload or manual/automatic camera capture), Preview (placement and adjustments), and Try on (generation and download). `tests/sections.mjs` verifies layout/action wiring with stubbed inference; `tests/camera.mjs` exercises actual MediaPipe with a simulated webcam, including the automatic delay.

## Jewellery categories and coordinate checks

The five choices are Ring, Earring (a repeated pair), Pendant, Necklace and Bracelet. Ring and bracelet use the local MediaPipe Hand Landmarker; pendant and necklace use Pose Landmarker Lite; earrings use Face Landmarker. Changing category re-detects an uploaded photo and clears stale output.

Ring capture requires one whole, sufficiently large hand facing the camera with a straight, separated ring finger. Its default placement is between ring-finger MCP/PIP landmarks 13/14. Bracelet capture additionally reserves a margin past wrist landmark 0 toward the forearm, using landmark 9 to estimate direction. Pendant/necklace capture checks visible shoulders 11/12 and nose 0, shoulder alignment, centering, and chest clearance (more for pendants). Earrings retain face pose/framing checks. The live overlay and manual/automatic capture share these checks. Ring, bracelet and necklace render around a centered anchor; earrings and pendants use a top attachment anchor.

Coordinates estimate framing and placement, not anatomical fit, hand-surface orientation classification, visible piercing holes, chain drape, clothing or hair occlusion. An uploaded image without a reliable single subject remains manually positionable. Models are served locally from `public/models/`; no camera frames go to an external detector. `tests/jewellery-types.mjs` covers category heuristics and real face, body and hand inference on public fixtures; service tests validate all five accepted kinds. Positive ring checks use https://storage.googleapis.com/mediapipe-assets/right_hands.jpg.

## Speed verification

A same-input, same-seed comparison on this Mac measured 37.03 seconds for the original full-frame 896 configuration, 21.32 seconds for a cold 768 crop, and 19.46 seconds for a repeated crop with weights loaded. Peak MLX memory for the cropped runs was 7.43 GB. These are single-sample local measurements, not production latency guarantees. Resolution/cropping changes can affect product fidelity. The same model and four steps are retained.

`tests/worker-lifecycle.py` checks worker reuse/cancel/restart and crop boundaries. `tests/speed-service.py <saved-job-folder>` performs two real HTTP generations and checks reuse, output dimensions and unchanged pixels outside the blend mask. `tests/client-transport.mjs` checks localhost vs production same-origin routing. Production integration and CPU-only VPS inference have not been deployed or load-tested.

The default crop is now tighter (`TRYON_CROP_MODE=tight`). On the same saved input, HTTP generation measured 15.71 seconds cold and 14.09 seconds warm, with a 768×272 working image and approximately 6.43 GB peak MLX memory. Original output dimensions and pixels outside the mask were verified unchanged. Product details can still vary: this test added small hanging details, so use `TRYON_CROP_MODE=balanced` to restore more context when fidelity is more important than speed. These timings are for this Mac and sample only.
