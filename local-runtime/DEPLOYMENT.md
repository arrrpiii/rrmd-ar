# Deploying jewellery try-on

The web UI can run on your production website. Inference is a separate service:

Browser → your website's authenticated `/api/tryon/*` gateway → private inference service.

The browser uses localhost:8765 only when the page is on localhost. On a public website it uses `/api/tryon`; it never tries to connect to a customer's computer. Existing photo/product/placement uploads and asynchronous job polling use the same contract in both environments.

## Hardware requirement

This repository's worker uses MLX/Metal on Apple Silicon. **It will not run unchanged on a typical Linux VPS.** Host this worker on an Apple Silicon inference machine reachable privately from the VPS, or implement and benchmark a Linux runtime for the same FLUX.2 Klein 4B model. The MLX checkpoint is not a drop-in CUDA checkpoint. CPU-only VPS inference has not been implemented or benchmarked here. Pulling the code alone does not provision inference.

## Website backend integration (required before public access)

Implement a server-side gateway in the existing website backend. Do not expose port 8765 publicly or put a service secret in frontend code.

- Authenticate customers or assign a secure anonymous session; apply per-user/IP quotas and rate limits.
- POST `/api/tryon/jobs` forwards multipart `photo`, `guide`, `product`, `settings` to private `/jobs`. Settings contain `kind`, normalized `regions`, and `seed`. Use your product catalogue's approved product reference/asset and type for each product page.
- Record the returned job ID against the requesting session. Check ownership before proxying GET `/jobs/{id}`, GET `/jobs/{id}/result` and POST `/jobs/{id}/cancel`. Return 404 for jobs owned by anyone else.
- GET `/api/tryon/status` proxies `/status`.
- The gateway adds `Authorization: Bearer <TRYON_SERVICE_TOKEN>` to every internal request, removes the browser's Origin header on internal requests, and never returns the token to clients.
- Enforce 25 MB request limits, upload timeouts, HTTPS and CSRF protection for your session scheme. Disable caching of portraits, status and results.
- Preserve 409 (worker busy), 422 (invalid input) and 503 (model not ready) responses. The service permits one active generation; it does not provide a durable multi-user queue.

Production requires a durable queue and job/ownership store, worker routing, retries, monitoring, capacity tests for expected traffic, and a defined deletion policy for uploaded photos/results. Current records are in memory and jobs remain on disk. Do not run multiple Uvicorn workers against this implementation: they have separate locks and records. These integration tasks depend on your website stack and hosting specifications; they are not verified by local tests.

## Inference configuration

Run one worker process under a service manager on the inference host:

```
TRYON_SERVICE_TOKEN=<server-only-random-secret> \
TRYON_CROP=1 TRYON_MAX_SIDE=768 \
.venv-local/bin/python -m uvicorn server:app --app-dir local-runtime --host 127.0.0.1 --port 8765 --workers 1
```

Use a private authenticated tunnel or reverse proxy if the website gateway runs on a different machine. Provision model files using local setup; set `TRYON_MODEL_PATH` for another model directory. Never download weights in a web request.

`TRYON_CROP=1` (default) edits a padded bounding box containing all jewellery regions together. `TRYON_MAX_SIDE=768` (default) limits that crop's long edge. Four sampling steps and the same model are retained. The generated crop is mapped back to original coordinates and blended only inside the jewellery masks, preserving the rest of the original photograph. The crop includes surrounding anatomy but visual quality must be checked for each catalogue category.

For the old full-frame resolution use `TRYON_CROP=0 TRYON_MAX_SIDE=896`. Model weights remain in memory between jobs; the first request after startup or cancellation is cold. Cancelling kills the worker, frees memory and allows it to start fresh for the next request. Shutdown also stops the worker. Retaining weights consumes memory while idle, so reserve sufficient memory on the inference host.

## Rrumi repository findings

Inspected `../rrumi`: storefront is Next.js 16 / React 19; `Rrumidiamondbackend` is Node 22+, Express 5 and MongoDB/Mongoose. It already has authentication middleware, express-rate-limit, Multer, Sharp, object-storage integration and Mongo-backed background media jobs. Its existing worker runs media optimisation and blog scheduling, not model inference.

Implement the gateway/ownership records in that Express backend and connect it through the storefront's same-origin `/api/tryon` route/reverse proxy. Product pages should load an approved jewellery asset/type/placement preset by product ID rather than require shoppers to upload CAD. The product catalogue needs these assets prepared for each supported product. Reuse the backend's authentication and durable-job conventions; do not launch MLX inside the Express web process.

The reported VPS is modest and CPU-only. Keep Next.js, Express and MongoDB there; place model execution on a separate suitable inference host. The tested Mac speed is not a CPU-VPS performance estimate. No changes have been applied to the Rrumi production repository or live deployment as part of this optimisation.

### Tighter crop mode

`TRYON_CROP_MODE=tight` is now the default: extra context is reduced to 1.4× the combined region width and 1.65× its height, with minimum context and feather margins. Both earrings remain in one edit. `TRYON_CROP_MODE=balanced` restores the previous broader crop. The 768px maximum and four sampling steps are unchanged. Actual speed gains depend on the region geometry; narrower crops do not always reduce model pixels when resized to the same maximum edge. Test product fidelity per category before enabling a mode for a catalogue.

## Vercel frontend deployment

Import `arrrpiii/rrmd-ar` into Vercel with repository root `.`. The committed `vercel.json` selects Vite, runs `npm run build:vercel`, and publishes `dist-vercel`. This separate client build avoids the existing Cloudflare/Vinext deployment configuration; local `npm run local` remains unchanged.

Camera capture (over HTTPS), local MediaPipe checks, CAD upload and rendered previews work in the frontend. **AI generation is not functional on Vercel until an authenticated `/api/tryon` gateway and inference service are configured.** No API key is bundled, no paid provider is configured, and Vercel does not execute the local MLX worker. Adding a hosted provider requires an adapter for asynchronous jobs and the current crop/mask pipeline; it is not just a frontend API-key setting. Keep all provider keys server-side.
