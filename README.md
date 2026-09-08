# Atelier — jewellery photo try-on

A working browser-only prototype: upload a portrait and a jewellery model, generate a composite, adjust placement/orientation/finish, and download a PNG. No backend API key or ML training is required.

## Run locally

```sh
npm install
npm run dev
```

Open the Local URL printed by the server. Requires a current WebGL2-capable browser. All photo/model processing stays in that browser. The pretrained face detector, WASM runtimes and rendering environment are served with the app; photos and CAD files are not sent to an API, persisted or included in the deployed site.

## Use

1. Upload JPG, PNG or WebP (up to 25 MB). Include visible ears or neck/chest.
2. Upload a self-contained GLB, a Rhino 3DM with saved render meshes, or STL (up to 80 MB / 3 million triangles).
3. Select earrings, pendant/necklace, or a single piece. Earrings repeats the entire model twice; upload ONE earring rather than a pair or a CAD layout of multiple products.
4. Generate. Select an attachment point and click the portrait, or use the position sliders. Adjust size, XYZ rotation and finish as needed. Rhino files initially receive a -90° X rotation for their typical Z-up convention.
5. Generate again after changes, then download the PNG. Placement markers are excluded from exports. The result is capped at 1800 pixels on its longest side and preserves the source aspect ratio.

## Pipeline

- MediaPipe Face Landmarker runs a pretrained model in IMAGE mode. A single detected face provides estimated earring/pendant anchors. Multiple faces, missing faces, or detector errors use explicit manual placement.
- Three.js loads 3DM through its Rhino WASM worker, GLB through GLTFLoader, and STL through STLLoader. It rejects CAD objects that the importer reports as lacking a render mesh. Curves, points, cameras and lights are excluded; hidden CAD layers are respected.
- Meshes are centered and normalized for adjustable visual scale. A transparent orthographic renderer adds jewellery with an environment reflection map and lights. Original materials are the default; finish overrides apply to the whole piece, including stones.
- Canvas combines the unchanged photograph with the transparent render. Canvas PNG export supplies the downloadable result.
- External model dependencies are blocked. Export GLB with embedded textures; compressed GLBs requiring Draco/KTX2 decoders are not currently supported.

## Limitations

This is a geometric placement preview, not generative image editing or a calibrated fit simulator. There is no hair/skin occlusion, automatic lighting matching, chain draping, stone-specific optics or physical sizing. Face landmarks do not locate exact piercing holes. Neck placement is estimated from the face, not reconstructed from a body model. The app does not infer whether a uploaded object is a ring, bracelet, earring or necklace, and it renders the supplied whole object.

A single pendant asset does not create a missing necklace chain. GLB/STL tessellation, suitable per-product materials, pivots and dimensions remain an asset preparation task.

## Supplied CAD files

- `RDLR556.3dm`, `RDLR851.3dm`, `RDWT284.3dm`: usable mesh data; browser import and image output tested.
- `RDLB501-0.50CT.3dm`: 116 Brep objects have no saved render meshes (2,100 faces without cached meshes). Import is intentionally rejected to avoid an incomplete design. Open it in Rhino, generate render meshes in a shaded/rendered view and save including meshes, or export a meshed GLB/STL.

Source CAD files remain in the parent workspace and are excluded from the app bundle.

## Verification

```sh
npx tsc --noEmit
npm run build
node tests/pipeline.mjs
```

The browser test expects the dev server at `http://localhost:3002/` and Chrome at the standard macOS location (override with `CHROME_PATH`). The supplied four CAD files are read from `../`. Download Google's public portrait fixture before running:

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
