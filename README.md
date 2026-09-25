# Compositional AI Digital Twin — web version

Browser version of the Particle Digital Twin: a real-time interactive demonstration of particle-scale flow built from learned, compositional flow operators. Open it on a phone at

**https://kailiu7777.github.io/particle-digital-twin-web/**

<img src="qr.png" alt="QR code for the site" width="320">

It is a simple demonstration for trial, not the qualified desktop application, and it does not claim that particle-resolved DNS runs in real time.

## Using it

- Drag empty space to orbit, pinch to zoom, drag a particle to move it.
- **+** spawns a particle at a held touch, **−** deletes half, **?** opens the gesture board.
- The appearance button beside the close button switches the whole demo between light and dark, viewport included; it shows the current state, sun for light and moon for dark, and the choice is remembered on that device. Light is the default. Tracer and slice shading stay intensity-based in both, so nothing about the physics reading changes with the appearance.
- With the front camera enabled: right hand OK-pinch grabs, thumb–middle pinch spawns, snap removes half; left hand OK-pinch orbits and zooms, point up or down spins the held particle. Camera frames never leave the device.
- The control sheet selects the model (POINT / NEURAL), the wake solver, tracers (OFF / NEAR / SELECTED), six axis-aligned views, the particle limit (8 / 16 / 32) and the slice plane.
- Closing with the × asks to confirm: Exit stops the simulation and the camera, Back returns to it.

Needs WebGL2 (any current iPhone, Android or desktop browser). Browsers without it get a recorded playback.

## Privacy

Anonymous visit counts help us understand use of this demo. No cookies, persistent identifiers, camera frames, hand data, comments, or precise location are stored.

## What is in this repository

- `index.html` — the page.
- `live/<release>/Build/` — the Unity WebGL2 build (sphere-only, one network).
- `live/<release>/handtracking/` — the vendored MediaPipe Hand Landmarker (`PROVENANCE.md`, `SHA256SUMS`; the page verifies the model digest before use).
- `live/<release>/guide/`, `live/<release>/lite-hand-tracker.js` — gesture board pictures and the tracker.
- `fallback/` — recorded playback for browsers without WebGL2.
- `SHA256.txt` — every file with its SHA-256.
- `retired/` — a record of superseded public releases; their files stay in place unmodified.

The native desktop packages are distributed separately.
