'use strict';
const WRIST = 0, THUMB_TIP = 4, INDEX_MCP = 5, INDEX_TIP = 8;
const MIDDLE_MCP = 9, MIDDLE_TIP = 12, RING_TIP = 16, PINKY_TIP = 20;
const F_HAND_PRESENT = 1 << 0, F_POINTER_OK = 1 << 1, F_DEPTH_OK = 1 << 2;
const F_SPIN_POSE = 1 << 3, F_MIRRORED = 1 << 4, F_RIGHT_HAND = 1 << 5;
const HAND_UNKNOWN = 0, HAND_LEFT = 1, HAND_RIGHT = 2;
const MOSH_MAGIC = 0x4D4F5348, MOSH6_VERSION = 6;
const MOSH_HDR = 34, MOSH6_HAND = 100, MOSH_MAX_HANDS = 2;
const MIRROR_INVERTS_HANDEDNESS = true;
const PROCESS_LONG_SIDE_DEFAULT = 480;   // cfg.processLongSide may lower it (320) before any MOS fidelity is reduced
const LCH = {
  state: 'off',            // off | starting | ready | tracking | denied | error
  error: '', reason: '',
  permission: 'unknown',
  packet: null, packetSeq: -1, lastPolled: -1,
  aspect: 4 / 3,           // canonical frame width / height (after rotation)
  rotation: 0,             // degrees applied to the sensor frame: 0 | 90 | -90 | 180
  orientation: 'unknown',  // portrait | landscape-left | landscape-right
  orientSeq: 0,
  tel: { initialized: false, hz: 0, inferMs: 0, inferMsP95: 0, hands: 0, frames: 0, dropped: 0,
         late: 0, lastError: '', modelVerified: false, targetHz: 15, captureMs: 0,
         videoW: 0, videoH: 0, procW: 0, procH: 0, delegate: '' },
  _cfg: null, _video: null, _stream: null, _canvas: null, _ctx: null, _landmarker: null,
  _timer: null, _busy: false, _seq: 0, _session: 0, _prevWrists: {}, _times: [], _hzWin: [],
  _stopping: false,
};
function screenAngle() {
  try {
    if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  } catch (e) {}
  if (typeof window.orientation === 'number') return window.orientation;
  return 0;
}
function screenOrientation() {
  const landscape = window.innerWidth > window.innerHeight;
  if (!landscape) return 'portrait';
  const a = ((screenAngle() % 360) + 360) % 360;
  return a === 270 ? 'landscape-right' : 'landscape-left';
}
function rotationFor(vw, vh) {
  const frameLandscape = vw >= vh;
  const screenLandscape = window.innerWidth > window.innerHeight;
  if (frameLandscape === screenLandscape) return 0;
  const a = ((screenAngle() % 360) + 360) % 360;
  return a === 270 ? -90 : 90;
}
function D(lms, a, b, k) { return Math.hypot((lms[a].x - lms[b].x) * k, lms[a].y - lms[b].y); }
function extract(lms, k) {
  const scale = D(lms, MIDDLE_MCP, WRIST, k);
  if (scale < 1e-4) return null;
  const pinch = D(lms, THUMB_TIP, INDEX_TIP, k) / scale;
  const ext = (tip) => D(lms, tip, WRIST, k) / scale;
  const idxE = ext(INDEX_TIP), midE = ext(MIDDLE_TIP), ringE = ext(RING_TIP), pkyE = ext(PINKY_TIP);
  const spinPose = (idxE > 1.6 && midE > 1.6 && ringE < 1.3 && pkyE < 1.3 && pinch > 0.5);
  const sdx = 0.5 * (lms[INDEX_TIP].x + lms[MIDDLE_TIP].x);
  const sdy = 0.5 * (lms[INDEX_TIP].y + lms[MIDDLE_TIP].y);
  return { px: lms[INDEX_TIP].x, py: lms[INDEX_TIP].y, pinch, scale, spinDx: sdx, spinDy: sdy, spinPose };
}
function fingerExtension(lms, mcp, k) {
  const chain = D(lms, mcp, mcp + 1, k) + D(lms, mcp + 1, mcp + 2, k) + D(lms, mcp + 2, mcp + 3, k);
  if (chain < 1e-6) return 0.0;
  return D(lms, mcp, mcp + 3, k) / chain;
}
function palmQuaternion(world) {
  if (!world || world.length <= MIDDLE_MCP) return [0, 0, 0, 1];
  const w = world[WRIST], i = world[INDEX_MCP], m = world[MIDDLE_MCP];
  const ax = i.x - w.x, ay = i.y - w.y, az = i.z - w.z;
  const bx = m.x - w.x, by = m.y - w.y, bz = m.z - w.z;
  const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  const norm = (x, y, z) => { const n = Math.sqrt(x * x + y * y + z * z); return n > 1e-9 ? [x / n, y / n, z / n] : [0, 0, 1]; };
  const zc = norm(nx, ny, nz), xc = norm(ax, ay, az);
  const yc = [zc[1] * xc[2] - zc[2] * xc[1], zc[2] * xc[0] - zc[0] * xc[2], zc[0] * xc[1] - zc[1] * xc[0]];
  const tr = xc[0] + yc[1] + zc[2];
  if (tr > 0) { const s = Math.sqrt(tr + 1.0) * 2; return [(yc[2] - zc[1]) / s, (zc[0] - xc[2]) / s, (xc[1] - yc[0]) / s, 0.25 * s]; }
  return [0, 0, 0, 1];
}
function normaliseHandedness(label) {
  let h;
  if (label === 'Left') h = HAND_LEFT; else if (label === 'Right') h = HAND_RIGHT; else return HAND_UNKNOWN;
  if (MIRROR_INVERTS_HANDEDNESS) h = (h === HAND_LEFT) ? HAND_RIGHT : HAND_LEFT;
  return h;
}
function assignSlots(cands, prevWrists) {
  for (const c of cands) c.slot = (c.handedness !== HAND_RIGHT) ? 0 : 1;
  if (cands.length === 2 && cands[0].slot === cands[1].slot) {
    const contested = cands[0].slot, free = 1 - contested;
    let keeper = null;
    if (prevWrists[contested]) {
      const [px, py] = prevWrists[contested];
      const d0 = (cands[0].wrist[0] - px) ** 2 + (cands[0].wrist[1] - py) ** 2;
      const d1 = (cands[1].wrist[0] - px) ** 2 + (cands[1].wrist[1] - py) ** 2;
      keeper = d0 <= d1 ? 0 : 1;
    }
    if (keeper === null) keeper = cands[0].conf >= cands[1].conf ? 0 : 1;
    cands[1 - keeper].slot = free;
  }
  cands.sort((a, b) => a.slot - b.slot);
  return cands;
}
function packMosh6(seq, session, tCapture, tResult, hands) {
  const n = Math.min(hands.length, MOSH_MAX_HANDS);
  const buf = new ArrayBuffer(MOSH_HDR + MOSH6_HAND * n);
  const dv = new DataView(buf);
  let o = 0;
  dv.setUint32(o, MOSH_MAGIC, true); o += 4;
  dv.setUint16(o, MOSH6_VERSION, true); o += 2;
  dv.setUint32(o, seq >>> 0, true); o += 4;
  dv.setUint32(o, session >>> 0, true); o += 4;
  dv.setFloat64(o, tCapture, true); o += 8;
  dv.setFloat64(o, tResult, true); o += 8;
  dv.setUint16(o, n, true); o += 2;
  dv.setUint16(o, 0, true); o += 2;
  for (let i = 0; i < n; i++) {
    const h = hands[i];
    dv.setUint16(o, h.flags, true); o += 2;
    dv.setUint16(o, h.handedness, true); o += 2;
    for (const v of [h.px, h.py, h.thumbX, h.thumbY, h.pinch, h.scale, h.conf,
      h.extMiddle, h.extRing, h.extPinky, h.palmX, h.palmY, h.qx, h.qy, h.qz, h.qw, h.spinDx, h.spinDy,
      h.indexMcpX, h.indexMcpY, h.extIndex, h.middleTipX, h.middleTipY, h.pinchMiddle]) { dv.setFloat32(o, v, true); o += 4; }
  }
  return new Uint8Array(buf);
}
async function fetchBytes(url) {
  const r = await fetch(url, { cache: 'force-cache' });
  if (!r.ok) throw new Error(`fetch ${url} -> HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
function hex(buf) { return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join(''); }
async function loadSums(base) {
  try {
    const t = await (await fetch(base + 'SHA256SUMS', { cache: 'force-cache' })).text();
    const m = {};
    for (const line of t.split('\n')) { const [d, , name] = line.trim().split(/(\s+)/); if (d && name) m[name.trim()] = d; }
    return m;
  } catch { return {}; }
}
async function init(cfg) {
  const base = cfg.assetBase;
  const sfx = cfg.assetSuffix == null ? '.br' : cfg.assetSuffix;
  const sums = await loadSums(base);
  const vision = await import(new URL(base + 'vision_bundle.mjs' + sfx, location.href).href);
  const modelBytes = await fetchBytes(base + 'models/hand_landmarker.task' + sfx);
  const want = sums['models/hand_landmarker.task'];
  if (want && crypto && crypto.subtle) {
    const got = hex(await crypto.subtle.digest('SHA-256', modelBytes));
    if (got !== want) throw new Error(`model digest mismatch: expected ${want} got ${got}`);
    LCH.tel.modelVerified = true;
  }
  const fileset = { wasmLoaderPath: base + 'wasm/vision_wasm_internal.js' + sfx, wasmBinaryPath: base + 'wasm/vision_wasm_internal.wasm' + sfx };
  const opts = (delegate) => ({ baseOptions: { modelAssetBuffer: modelBytes, delegate }, runningMode: 'VIDEO', numHands: MOSH_MAX_HANDS,
    minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
  try { LCH._landmarker = await vision.HandLandmarker.createFromOptions(fileset, opts('GPU')); LCH.tel.delegate = 'GPU'; }
  catch (e) {
    LCH.tel.lastError = 'GPU delegate unavailable, using CPU: ' + (e && e.message);
    LCH._landmarker = await vision.HandLandmarker.createFromOptions(fileset, opts('CPU')); LCH.tel.delegate = 'CPU';
  }
  LCH.tel.initialized = true;
}
async function openCamera(cfg) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const e = new Error('getUserMedia unavailable (needs https)'); e.name = 'InsecureContext'; throw e;
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: Math.max(cfg.targetHz, 15), max: 30 } },
    audio: false,
  });
  const v = document.createElement('video');
  v.autoplay = true; v.playsInline = true; v.muted = true;
  v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
  v.srcObject = stream;
  await v.play();
  return { stream, video: v };
}
function waitForFrame(v, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    (function poll() {
      if (v.readyState >= 2 && v.videoWidth > 0) return resolve(true);
      if (performance.now() - t0 > timeoutMs) return resolve(false);
      setTimeout(poll, 50);
    })();
  });
}
function tick() {
  if (LCH._stopping || LCH._busy || !LCH._landmarker || !LCH._video) return;
  const v = LCH._video;
  if (v.readyState < 2 || v.videoWidth === 0) { LCH.tel.dropped++; return; }
  LCH._busy = true;
  try {
    const t0 = performance.now();
    const vw = v.videoWidth, vh = v.videoHeight;
    LCH.tel.videoW = vw; LCH.tel.videoH = vh;
    const rot = rotationFor(vw, vh);
    const orient = screenOrientation();
    if (rot !== LCH.rotation || orient !== LCH.orientation) { LCH.rotation = rot; LCH.orientation = orient; LCH.orientSeq++; LCH._prevWrists = {}; }
    const quarter = rot === 90 || rot === -90;
    const fw = quarter ? vh : vw, fh = quarter ? vw : vh;          // canonical frame size
    const s = Math.min(1, ((LCH._cfg && LCH._cfg.processLongSide) || PROCESS_LONG_SIDE_DEFAULT) / Math.max(fw, fh));
    const cw = Math.max(2, Math.round(fw * s)), ch = Math.max(2, Math.round(fh * s));
    if (!LCH._canvas || LCH._canvas.width !== cw || LCH._canvas.height !== ch) {
      LCH._canvas = document.createElement('canvas'); LCH._canvas.width = cw; LCH._canvas.height = ch;
      LCH._ctx = LCH._canvas.getContext('2d', { willReadFrequently: false });
    }
    LCH.tel.procW = cw; LCH.tel.procH = ch;
    LCH.aspect = cw / ch;
    const ctx = LCH._ctx;
    ctx.save();
    ctx.translate(cw, 0); ctx.scale(-1, 1);
    ctx.translate(cw / 2, ch / 2);
    if (rot) ctx.rotate(rot * Math.PI / 180);
    const dw = quarter ? ch : cw, dh = quarter ? cw : ch;
    ctx.drawImage(v, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
    const tCap = performance.now();
    LCH.tel.captureMs = tCap - t0;
    const res = LCH._landmarker.detectForVideo(LCH._canvas, Math.round(tCap));
    const tRes = performance.now();
    const infer = tRes - tCap;
    LCH._times.push(infer); if (LCH._times.length > 120) LCH._times.shift();
    LCH.tel.inferMs = infer;
    const sorted = LCH._times.slice().sort((a, b) => a - b);
    LCH.tel.inferMsP95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const k = LCH.aspect;
    const lmSets = res.landmarks || [], worldSets = res.worldLandmarks || [], handed = res.handednesses || res.handedness || [];
    let cands = [];
    for (let i = 0; i < lmSets.length; i++) {
      const cat = (handed[i] && handed[i][0]) || {};
      cands.push({ handedness: normaliseHandedness(cat.categoryName || cat.displayName || ''), conf: cat.score || 0,
        wrist: [lmSets[i][0].x, lmSets[i][0].y], landmarks: lmSets[i], index: i });
    }
    cands = assignSlots(cands, LCH._prevWrists);
    LCH._prevWrists = {};
    for (const c of cands) LCH._prevWrists[c.slot] = c.wrist;
    const control = [];
    for (const c of cands) {
      const lms = c.landmarks;
      const f = extract(lms, k);
      if (!f) continue;
      let flags = F_MIRRORED | F_HAND_PRESENT | F_POINTER_OK | F_DEPTH_OK;
      if (f.spinPose) flags |= F_SPIN_POSE;
      if (c.handedness === HAND_RIGHT) flags |= F_RIGHT_HAND;
      const q = palmQuaternion(worldSets[c.index]);
      const pi = [0, 5, 9, 13, 17];
      control.push({ flags, handedness: c.handedness, px: f.px, py: f.py,
        thumbX: lms[THUMB_TIP].x, thumbY: lms[THUMB_TIP].y, pinch: f.pinch, scale: f.scale, conf: c.conf,
        extMiddle: fingerExtension(lms, MIDDLE_MCP, k), extRing: fingerExtension(lms, 13, k), extPinky: fingerExtension(lms, 17, k),
        palmX: pi.reduce((a, i) => a + lms[i].x, 0) / pi.length, palmY: pi.reduce((a, i) => a + lms[i].y, 0) / pi.length,
        qx: q[0], qy: q[1], qz: q[2], qw: q[3], spinDx: f.spinDx, spinDy: f.spinDy,
        indexMcpX: lms[INDEX_MCP].x, indexMcpY: lms[INDEX_MCP].y, extIndex: fingerExtension(lms, INDEX_MCP, k),
        middleTipX: lms[MIDDLE_TIP].x, middleTipY: lms[MIDDLE_TIP].y,
        pinchMiddle: D(lms, THUMB_TIP, MIDDLE_TIP, k) / f.scale });
    }
    LCH.packet = packMosh6(LCH._seq, LCH._session, tCap / 1000.0, tRes / 1000.0, control);
    LCH.packetSeq = LCH._seq;
    LCH._seq = (LCH._seq + 1) >>> 0;
    LCH.tel.frames++;
    LCH.tel.hands = control.length;
    LCH.state = control.length > 0 ? 'tracking' : 'ready';
    const now = performance.now();
    LCH._hzWin.push(now);
    while (LCH._hzWin.length > 1 && now - LCH._hzWin[0] > 2000) LCH._hzWin.shift();
    LCH.tel.hz = LCH._hzWin.length > 1 ? (LCH._hzWin.length - 1) * 1000 / (now - LCH._hzWin[0]) : 0;
    if (infer > 1000 / LCH._cfg.targetHz) LCH.tel.late++;
  } catch (e) {
    LCH.tel.lastError = String((e && e.message) || e);
  } finally {
    LCH._busy = false;
  }
}
function classify(e) {
  const s = String((e && e.name) || '') + ' ' + String((e && e.message) || e || '');
  if (/InsecureContext/i.test(s)) return 'insecureContext';
  if (/NotAllowedError|SecurityError|Permission/i.test(s)) return 'permissionDenied';
  if (/NotFoundError|OverconstrainedError|DevicesNotFound/i.test(s)) return 'noDevice';
  if (/NotReadableError|TrackStartError|AbortError/i.test(s)) return 'deviceBusy';
  if (/TrackerFailure|digest|HandLandmarker|wasm|import/i.test(s)) return 'trackerFailure';
  return 'streamFailure';
}
async function start(cfg) {
  if (LCH.state === 'starting' || LCH.state === 'ready' || LCH.state === 'tracking') return { ok: true };
  LCH._cfg = cfg; LCH._stopping = false; LCH.state = 'starting'; LCH.error = ''; LCH.reason = '';
  LCH.tel.targetHz = cfg.targetHz;
  let cam = null;
  try {
    if (window.isSecureContext === false) { const e = new Error('camera needs https'); e.name = 'InsecureContext'; throw e; }
    cam = await openCamera(cfg);
    LCH.permission = 'granted';
    if (!(await waitForFrame(cam.video, 6000))) { const e = new Error('no usable video frame within 6 s'); e.name = 'StreamFailure'; throw e; }
    if (!LCH.tel.initialized) await init(cfg);
    if (!LCH._landmarker) { const e = new Error('hand tracker did not initialise'); e.name = 'TrackerFailure'; throw e; }
    LCH._stream = cam.stream; LCH._video = cam.video;
    LCH._session = (Date.now() & 0x7fffffff) >>> 0;
    LCH._seq = 0;
    LCH.state = 'ready';
    LCH._timer = setInterval(tick, Math.max(1, Math.round(1000 / cfg.targetHz)));
    return { ok: true };
  } catch (e) {
    LCH.reason = classify(e);
    LCH.error = String((e && e.name) || '') + ': ' + String((e && e.message) || e);
    LCH.tel.lastError = LCH.error;
    if (LCH.reason === 'permissionDenied') LCH.permission = 'denied';
    try { if (cam) { for (const t of cam.stream.getTracks()) t.stop(); cam.video.srcObject = null; } } catch {}
    LCH.state = LCH.reason === 'permissionDenied' ? 'denied' : 'error';
    return { ok: false, reason: LCH.reason, detail: LCH.error };
  }
}
function setRate(hz) {
  if (!LCH._cfg) return;
  LCH._cfg.targetHz = hz; LCH.tel.targetHz = hz;
  if (LCH._timer) { clearInterval(LCH._timer); LCH._timer = setInterval(tick, Math.max(1, Math.round(1000 / hz))); }
  LCH._hzWin = []; LCH.tel.late = 0;
}
function stop() {
  LCH._stopping = true;
  if (LCH._timer) { clearInterval(LCH._timer); LCH._timer = null; }
  if (LCH._stream) { for (const t of LCH._stream.getTracks()) t.stop(); LCH._stream = null; }
  if (LCH._video) { try { LCH._video.pause(); } catch {} LCH._video.srcObject = null; LCH._video = null; }
  LCH.packet = null;
  if (LCH.state === 'ready' || LCH.state === 'tracking' || LCH.state === 'starting') LCH.state = 'off';
}
function liveTracks() {
  let n = 0;
  try { if (LCH._stream) for (const t of LCH._stream.getTracks()) if (t.readyState === 'live') n++; } catch {}
  return n;
}
export { LCH, start, stop, setRate, tick, liveTracks, extract, fingerExtension, rotationFor, screenOrientation, packMosh6 };
export function setProcessLongSide(px) { if (LCH._cfg) { LCH._cfg.processLongSide = px; } }
