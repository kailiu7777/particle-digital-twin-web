# Vendored browser hand-tracking assets (P27F)

Everything the browser needs to run MediaPipe Hand Landmarker **locally**. Nothing here is
fetched from a CDN at runtime, and no camera frame ever leaves the page.

| file (shipped) | decompressed | source |
|---|---:|---|
| `vision_bundle.mjs.br` | 155,439 B | `@mediapipe/tasks-vision` **1.0.1**, npm |
| `wasm/vision_wasm_internal.js.br` | 323,377 B | same package, SIMD loader |
| `wasm/vision_wasm_internal.wasm.br` | 11,756,954 B | same package, SIMD runtime |
| `models/hand_landmarker.task.br` | 7,819,105 B | MediaPipe Hand Landmarker, float16, bundle v1 |

Shipped total: **7,842,989 B** compressed, against 20,054,875 B decompressed.

## The model is the one the native sidecar uses

```
fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1  hand_landmarker.task
```

That digest is identical to `hand_tracking/models/SHA256SUMS`. The browser and the native
Python sidecar therefore run **the same weights**, which is what lets P27F claim it reproduces
the native gesture language rather than approximating it.

## Package integrity

The npm tarball was verified against the registry's published `integrity` field before
extraction:

```
sha512-rvRE2FmAZ6ZxKSw7wq+e+jQDpN3t1B/tD2mJz9SmAzb1msoDkd4dMoE4wAh8Z30Um0PQwLiHr9QtomhmXk3aUQ==
```

`SHA256SUMS` in this directory records the digest of each **decompressed** payload — what the
browser actually executes or loads, not what sits on disk. `p27f-tracker.js` re-verifies the
model digest in the browser with `crypto.subtle` before handing it to MediaPipe, mirroring
`mos_hand_sidecar.py:verify_model()`. **Runtime download is never permitted**, exactly as in
`models/MODEL_PROVENANCE.md`.

## Why Brotli, and why only SIMD

These files are served pre-compressed with `Content-Encoding: br`, which is the same contract
the main Unity build already depends on — it ships `.wasm.br` and `.data.br` and will not load
without that header either. So there is no deployment where these would fail while the app
itself worked.

Only the **SIMD** WASM variant is vendored. Both target browsers support WebAssembly SIMD, and
the tracker points MediaPipe at these files explicitly instead of relying on runtime feature
detection, so the choice is deterministic. If SIMD were ever unavailable, the tracker fails
to initialise and the app falls back to mouse-only control, which is required behaviour anyway.

## Loading is lazy

None of this is fetched during startup. It is requested only when the visitor presses
**ENABLE HAND CONTROL**, so the initial page transfer is unchanged by P27F.
