# MediaPipe Tasks Vision — vendored runtime & hand model

This folder contains the browser runtime used only after the user enables
the optional camera hand-gesture mode.

| Asset | Source | Version / license |
| --- | --- | --- |
| `vision_bundle.js` | npm package `@mediapipe/tasks-vision` (renamed from `vision_bundle.mjs`) | 0.10.14, Apache-2.0 |
| `wasm/vision_wasm_internal.*` | same package | 0.10.14 |
| `wasm/vision_wasm_nosimd_internal.*` | same package | 0.10.14 |
| `hand_landmarker.task` | MediaPipe Models — Hand Landmarker (float16/1) | Apache-2.0 |

Upstream:
- https://www.npmjs.com/package/@mediapipe/tasks-vision
- https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
- https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker

These files are loaded from the same origin only when the user enables
gesture control. No video frames leave the browser. Camera access requires
a secure context (HTTPS, localhost or the GitHub Pages demo).
