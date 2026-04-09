/**
 * Preloader: панели с VideoTexture (MP4 с CDN). После правок в этом файле обязательно: npm run build.
 * В странице подключается preloader.bundle.js — не preloader.js.
 */
import * as THREE from "three";

const VIDEO_URLS = [
  "https://futurista-world-new-zone.b-cdn.net/preview/video%20preview/Adidas%20Originals%20-%20Quiet%20Please/00086400web-mp4-h264.mp4",
  "https://futurista-world-new-zone.b-cdn.net/preview/video%20preview/CK%20ONE/00086400web-mp4-h264.mp4",
  "https://futurista-world-new-zone.b-cdn.net/preview/video%20preview/Prada%20LG/00086400web-mp4-h264.mp4",
  "https://futurista-world-new-zone.b-cdn.net/preview/video%20preview/versace%20versace/00086400web-mp4-h264.mp4",
  "https://futurista-world-new-zone.b-cdn.net/preview/video%20preview/feragamo%20fantasy%20and%20reality/00090000web-mp4-h264.mp4",
  "https://futurista-world-new-zone.b-cdn.net/preview/video%20preview/versace%20ss19/00090000web-mp4-h264.mp4",
  "https://futurista-world-new-zone.b-cdn.net/preview/video%20preview/puma%20selena%20gomez/00086400web-mp4-h264.mp4",
];

/** Широтные пояса дискошара и столбцы по долготе (~21:9 на экваторе при 9 поясах) */
const DISCO_N_BANDS = 9;
const DISCO_N_LON = 8;

/** Доля зазора между ячейками по угловому шагу */
const CELL_GAP = 0.068;

const ORANGE = 0xff5a1f;
/** Базовый радиус × 1.15 */
const SPHERE_RADIUS = 2.35 * 1.15;
const LOAD_TIMEOUT_MS = 45000;
const ROT_SPEED = { x: 0.38, y: 0.55, z: 0.3 };

/** Сегменты сетки на каждой ячейке (гладкий изгиб по сфере) */
const PLANE_SEGMENTS = 12;

/** Появление плиток по очереди: пауза перед следующей = start × ratioⁿ — сначала дольше, к концу быстрее */
const REVEAL_GAP_START_MS = 500;
const REVEAL_GAP_RATIO = 0.72;

/** После появления всех панелей — общая сборка в шар и изгиб (~1 c) */
const ASSEMBLE_DURATION_MS = 1000;

const FADE_CSS_MS = 850;

const _qIdent = new THREE.Quaternion();
const _vZero = new THREE.Vector3(0, 0, 0);
const _vfA = new THREE.Vector3();
const _vfB = new THREE.Vector3();
const _vfC = new THREE.Vector3();
const _vfLon = new THREE.Vector3();
const _vfLat = new THREE.Vector3();
const _vfP = new THREE.Vector3();

function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildSlotUrlIndices(nSlots) {
  return shuffle(
    Array.from({ length: nSlots }, (_, i) => i % VIDEO_URLS.length),
  );
}

/**
 * Дискошар: nBands широтных поясов, nLon столбцов; зазор gap по φ и θ.
 * Крайние пояса — треугольники с вершиной на полюсе; средние — сферические четырёхугольники.
 */
function discoBandGrid(nBands, nLon, gap) {
  const util = 1 - gap;
  const dBand = Math.PI / nBands;
  const dLon = (2 * Math.PI) / nLon;
  const slots = [];
  const unitDirs = [];

  function pushUnitDir(phi, theta) {
    const c = Math.cos(phi);
    unitDirs.push(
      new THREE.Vector3(
        c * Math.cos(theta),
        Math.sin(phi),
        c * Math.sin(theta),
      ).normalize(),
    );
  }

  const phiRimSouth = -Math.PI / 2 + (0.5 + util / 2) * dBand;
  for (let j = 0; j < nLon; j++) {
    const thetaC = -Math.PI + (j + 0.5) * dLon;
    const thetaMin = thetaC - (util * dLon) / 2;
    const thetaMax = thetaC + (util * dLon) / 2;
    slots.push({
      kind: "triSouth",
      phiRim: phiRimSouth,
      thetaMin,
      thetaMax,
    });
    pushUnitDir((-Math.PI / 2 + phiRimSouth) / 2, thetaC);
  }

  for (let i = 1; i < nBands - 1; i++) {
    const phiC = -Math.PI / 2 + (i + 0.5) * dBand;
    const phiMin = phiC - (util * dBand) / 2;
    const phiMax = phiC + (util * dBand) / 2;
    for (let j = 0; j < nLon; j++) {
      const thetaC = -Math.PI + (j + 0.5) * dLon;
      const thetaMin = thetaC - (util * dLon) / 2;
      const thetaMax = thetaC + (util * dLon) / 2;
      slots.push({
        kind: "quad",
        phiMin,
        phiMax,
        thetaMin,
        thetaMax,
      });
      pushUnitDir(phiC, thetaC);
    }
  }

  const phiRimNorth = -Math.PI / 2 + (nBands - 0.5 - util / 2) * dBand;
  for (let j = 0; j < nLon; j++) {
    const thetaC = -Math.PI + (j + 0.5) * dLon;
    const thetaMin = thetaC - (util * dLon) / 2;
    const thetaMax = thetaC + (util * dLon) / 2;
    slots.push({
      kind: "triNorth",
      phiRim: phiRimNorth,
      thetaMin,
      thetaMax,
    });
    pushUnitDir((Math.PI / 2 + phiRimNorth) / 2, thetaC);
  }

  return { slots, unitDirs };
}

/**
 * Половины ширины/высоты эталонного прямоугольника (касательный экваторный quad) — один размер для всех плиток на этапе загрузки.
 */
function equatorUniformHalfExtents(radius, nBands, nLon, gap) {
  const util = 1 - gap;
  const dBand = Math.PI / nBands;
  const dLon = (2 * Math.PI) / nLon;
  const firstQuad = 1;
  const lastQuad = nBands - 2;
  const iMid = Math.floor((firstQuad + lastQuad) / 2);
  const phiC = -Math.PI / 2 + (iMid + 0.5) * dBand;
  const phiMin = phiC - (util * dBand) / 2;
  const phiMax = phiC + (util * dBand) / 2;
  const dPhi = phiMax - phiMin;
  const dTheta = util * dLon;
  const phiMid = (phiMin + phiMax) / 2;
  const halfW = 0.5 * radius * Math.cos(phiMid) * dTheta;
  const halfH = 0.5 * radius * dPhi;
  return { halfW, halfH };
}

/**
 * Сферический четырёхугольник (φ от юга к северу, θ азимут); UV 0…1 — растяжение видео на ячейку.
 * flatHalfW / flatHalfH — общий прямоугольник на этапе загрузки (в касательной к центру ячейки).
 */
function createSphericalQuadGeometry(
  phiMin,
  phiMax,
  thetaMin,
  thetaMax,
  radius,
  segU,
  segV,
  flatHalfW,
  flatHalfH,
) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const rowVerts = segU + 1;

  const phiMid = (phiMin + phiMax) / 2;
  const thetaMid = (thetaMin + thetaMax) / 2;
  const dPhi = phiMax - phiMin;
  const dTheta = thetaMax - thetaMin;
  const cosPm = Math.cos(phiMid);
  const sinPm = Math.sin(phiMid);
  const cosTm = Math.cos(thetaMid);
  const sinTm = Math.sin(thetaMid);
  _vfC.set(
    radius * cosPm * cosTm,
    radius * sinPm,
    radius * cosPm * sinTm,
  );
  _vfLon.set(-cosPm * sinTm, 0, cosPm * cosTm).normalize();
  _vfLat.set(-sinPm * cosTm, cosPm, -sinPm * sinTm).normalize();
  const flatPositions = [];

  for (let iy = 0; iy <= segV; iy++) {
    const v = iy / segV;
    const phi = phiMin + v * (phiMax - phiMin);
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    for (let ix = 0; ix <= segU; ix++) {
      const u = ix / segU;
      const theta = thetaMin + u * (thetaMax - thetaMin);
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const x = radius * cosPhi * cosT;
      const y = radius * sinPhi;
      const z = radius * cosPhi * sinT;
      positions.push(x, y, z);
      uvs.push(u, v);

      const fu = (u - 0.5) * 2;
      const fv = (v - 0.5) * 2;
      _vfP.copy(_vfC);
      _vfP.addScaledVector(_vfLon, fu * flatHalfW);
      _vfP.addScaledVector(_vfLat, fv * flatHalfH);
      flatPositions.push(_vfP.x, _vfP.y, _vfP.z);
    }
  }

  for (let iy = 0; iy < segV; iy++) {
    for (let ix = 0; ix < segU; ix++) {
      const a = iy * rowVerts + ix;
      const b = iy * rowVerts + ix + 1;
      const c = (iy + 1) * rowVerts + ix;
      const d = (iy + 1) * rowVerts + ix + 1;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(flatPositions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.userData.positionsFlat = new Float32Array(flatPositions);
  geo.userData.positionsSpherical = new Float32Array(positions);
  return geo;
}

/**
 * Полярный треугольник: вершина на полюсе, основание — дуга на параллели phiRim.
 * UV: u вдоль основания, v от вершины к основанию.
 */
function createPolarCapTriangleGeometry(
  south,
  phiRim,
  thetaMin,
  thetaMax,
  radius,
  segU,
  segV,
  flatHalfW,
  flatHalfH,
) {
  const positions = [];
  const flatPositions = [];
  const uvs = [];
  const indices = [];

  const thetaMid = (thetaMin + thetaMax) / 2;
  let phiC;
  if (south) {
    const phiPole = -Math.PI / 2;
    phiC = (phiPole + phiRim) * 0.5;
  } else {
    const phiPole = Math.PI / 2;
    phiC = (phiRim + phiPole) * 0.5;
  }
  const cosPm = Math.cos(phiC);
  const sinPm = Math.sin(phiC);
  const cosTm = Math.cos(thetaMid);
  const sinTm = Math.sin(thetaMid);
  _vfC.set(
    radius * cosPm * cosTm,
    radius * sinPm,
    radius * cosPm * sinTm,
  );
  _vfLon.set(-cosPm * sinTm, 0, cosPm * cosTm).normalize();
  _vfLat.set(-sinPm * cosTm, cosPm, -sinPm * sinTm).normalize();

  function pushFlatFromUv(uTex, vTex) {
    _vfP.copy(_vfC);
    _vfP.addScaledVector(_vfLon, (uTex - 0.5) * 2 * flatHalfW);
    _vfP.addScaledVector(_vfLat, (vTex - 0.5) * 2 * flatHalfH);
    flatPositions.push(_vfP.x, _vfP.y, _vfP.z);
  }

  const apexY = south ? -radius : radius;
  const rowStart = [];

  let idx = 0;
  for (let iv = 0; iv <= segV; iv++) {
    rowStart.push(idx);
    const vfrac = iv / segV;
    if (iv === 0) {
      positions.push(0, apexY, 0);
      const uTex = 0.5;
      const vTex = south ? 0 : 1;
      pushFlatFromUv(uTex, vTex);
      uvs.push(uTex, vTex);
      idx++;
    } else {
      for (let iu = 0; iu <= segU; iu++) {
        const ufrac = iu / segU;
        const theta = thetaMin + ufrac * (thetaMax - thetaMin);
        const cp = Math.cos(phiRim);
        const sp = Math.sin(phiRim);
        const ct = Math.cos(theta);
        const st = Math.sin(theta);
        const bx = radius * cp * ct;
        const by = radius * sp;
        const bz = radius * cp * st;
        const ax = 0;
        const ay = apexY;
        const az = 0;
        let x = ax + (bx - ax) * vfrac;
        let y = ay + (by - ay) * vfrac;
        let z = az + (bz - az) * vfrac;
        const len = Math.sqrt(x * x + y * y + z * z) || 1;
        x = (x / len) * radius;
        y = (y / len) * radius;
        z = (z / len) * radius;
        positions.push(x, y, z);
        const vUv = south ? vfrac : 1 - vfrac;
        pushFlatFromUv(ufrac, vUv);
        uvs.push(ufrac, vUv);
        idx++;
      }
    }
  }

  const apexIndex = rowStart[0];
  const r1 = rowStart[1];
  for (let iu = 0; iu < segU; iu++) {
    if (south) {
      indices.push(apexIndex, r1 + iu, r1 + iu + 1);
    } else {
      indices.push(apexIndex, r1 + iu + 1, r1 + iu);
    }
  }

  for (let iv = 1; iv < segV; iv++) {
    const ra = rowStart[iv];
    const rb = rowStart[iv + 1];
    for (let iu = 0; iu < segU; iu++) {
      const a0 = ra + iu;
      const a1 = ra + iu + 1;
      const b0 = rb + iu;
      const b1 = rb + iu + 1;
      if (south) {
        indices.push(a0, b0, a1);
        indices.push(a1, b0, b1);
      } else {
        indices.push(a0, a1, b0);
        indices.push(a1, b1, b0);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(flatPositions, 3),
  );
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.userData.positionsFlat = new Float32Array(flatPositions);
  geo.userData.positionsSpherical = new Float32Array(positions);
  return geo;
}

function applyPanelBendMorph(geometry, bend) {
  const flat = geometry.userData.positionsFlat;
  const sph = geometry.userData.positionsSpherical;
  if (!flat || !sph) return;
  const pos = geometry.attributes.position;
  const arr = pos.array;
  const t = Math.min(1, Math.max(0, bend));
  for (let i = 0; i < flat.length; i++) {
    arr[i] = flat[i] + (sph[i] - flat[i]) * t;
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

/**
 * Порядок появления/сборки: «полосы» вокруг оси Y — сначала выше по шару, внутри полосы по азимуту.
 * Визуально непрерывные линии сетки, обёрнутой на сферу (как ряды при обходе грида).
 */
function revealOrderHorizontalBands(unitDirs) {
  const n = unitDirs.length;
  const order = Array.from({ length: n }, (_, i) => i);
  order.sort((ia, ib) => {
    const a = unitDirs[ia];
    const b = unitDirs[ib];
    if (Math.abs(a.y - b.y) > 1e-5) return b.y - a.y;
    return Math.atan2(a.x, a.z) - Math.atan2(b.x, b.z);
  });
  return order;
}

/**
 * Соотношение сторон ячейки в касательном приближении (ширина по дуге / высота по меридиану) для object-fit: cover.
 */
function slotPlaneAspect(slot) {
  const dTheta = slot.thetaMax - slot.thetaMin;
  if (slot.kind === "quad") {
    const phiMid = (slot.phiMin + slot.phiMax) / 2;
    const dPhi = slot.phiMax - slot.phiMin;
    const w = dTheta * Math.cos(phiMid);
    const h = Math.max(1e-6, dPhi);
    return Math.max(1e-6, w / h);
  }
  if (slot.kind === "triSouth") {
    const phiAvg = (-Math.PI / 2 + slot.phiRim) / 2;
    const dPhi = slot.phiRim - -Math.PI / 2;
    const w = dTheta * Math.cos(phiAvg);
    const h = Math.max(1e-6, dPhi);
    return Math.max(1e-6, w / h);
  }
  const phiAvg = (Math.PI / 2 + slot.phiRim) / 2;
  const dPhi = Math.PI / 2 - slot.phiRim;
  const w = dTheta * Math.cos(phiAvg);
  const h = Math.max(1e-6, dPhi);
  return Math.max(1e-6, w / h);
}

function rngForSlot(slotIndex) {
  let s = Math.imul(slotIndex, 2654435761) + 12345;
  return function next() {
    s = Math.imul(s ^ (s >>> 15), s | 1);
    s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
    return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Видео: object-fit cover в UV по uPlaneAspect / uVideoAspect.
 */
function createVideoPanelShaderMaterial(videoTexture, planeAspect) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: videoTexture },
      uPlaneAspect: { value: planeAspect },
      uVideoAspect: { value: 16 / 9 },
    },
    vertexShader: `
      out vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform sampler2D map;
      uniform float uPlaneAspect;
      uniform float uVideoAspect;

      in vec2 vUv;

      layout(location = 0) out vec4 fragColor;

      void main() {
        float va = uVideoAspect;
        float pa = max(uPlaneAspect, 1e-5);
        float rx = 1.0;
        float ry = 1.0;
        if (va > pa) {
          rx = pa / va;
        } else {
          ry = va / pa;
        }
        vec2 mapUv = vUv * vec2(rx, ry) + vec2((1.0 - rx) * 0.5, (1.0 - ry) * 0.5);
        fragColor = texture(map, mapUv);
      }
    `,
    side: THREE.DoubleSide,
    toneMapped: false,
    glslVersion: THREE.GLSL3,
    outputColorSpace: THREE.SRGBColorSpace,
  });
}

/**
 * crossOrigin только если видео с другого домена.
 * Для http://localhost/… + ./file.webm без CORS-заголовков на сервере иначе VideoTexture в WebGL остаётся чёрной.
 */
function videoNeedsCrossOrigin(src) {
  if (typeof location === "undefined") return false;
  if (location.protocol === "file:") return false;
  try {
    const resolved = new URL(src, location.href);
    return resolved.origin !== location.origin;
  } catch {
    return false;
  }
}

/**
 * Chrome/WebKit: с file:// (и расширениями) кадры video для WebGL считаются cross-origin — texImage2D падает.
 * Нужен http(s):// (например python -m http.server или npx serve).
 */
function isWebGLVideoTextureAllowed() {
  if (typeof location === "undefined") return true;
  const p = location.protocol;
  return (
    p !== "file:" &&
    p !== "chrome-extension:" &&
    p !== "moz-extension:"
  );
}

function main() {
  const canvas = document.getElementById("preloader-canvas");
  const preloaderEl = document.getElementById("preloader");
  if (!canvas || !preloaderEl) return;

  const canUseWebGLVideo = isWebGLVideoTextureAllowed();
  if (!canUseWebGLVideo && typeof console !== "undefined") {
    console.warn(
      "[Futurista] Видео в WebGL с file:// в этом браузере недоступно (SecurityError). Запустите локальный сервер в папке проекта, например: npx --yes serve . — затем откройте http://localhost:3000",
    );
  }

  const { slots, unitDirs } = discoBandGrid(
    DISCO_N_BANDS,
    DISCO_N_LON,
    CELL_GAP,
  );
  const N = slots.length;
  const slotUrlIndices = buildSlotUrlIndices(N);

  const { halfW: uniformFlatHalfW, halfH: uniformFlatHalfH } =
    equatorUniformHalfExtents(
      SPHERE_RADIUS,
      DISCO_N_BANDS,
      DISCO_N_LON,
      CELL_GAP,
    );
  const chaosPlaneAspect = Math.max(
    1e-5,
    uniformFlatHalfW / uniformFlatHalfH,
  );

  const revealOrder = revealOrderHorizontalBands(unitDirs);
  const pendingRevealSlots = revealOrder.slice();
  let nextRevealDueTime = 0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(ORANGE);

  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    100,
  );
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const sphereGroup = new THREE.Group();
  scene.add(sphereGroup);

  /** В DOM: без этого часть браузеров не декодирует/не стартует видео для WebGL. */
  const videoSink = document.createElement("div");
  videoSink.className = "preloader-video-sink";
  videoSink.setAttribute("aria-hidden", "true");
  if (canUseWebGLVideo) {
    preloaderEl.appendChild(videoSink);
  }

  const videos = [];
  const materials = [];
  const textures = [];
  const videoReady = [];

  function tryPlayVideo(v) {
    if (!v || v.error) return;
    const pr = v.play();
    if (pr !== undefined) pr.catch(() => {});
  }

  function resumeAllVideos() {
    for (const v of videos) tryPlayVideo(v);
  }

  for (let i = 0; i < VIDEO_URLS.length; i++) {
    if (!canUseWebGLVideo) {
      videos.push(null);
      videoReady.push(true);
      textures.push(null);
      materials.push(
        new THREE.MeshBasicMaterial({
          color: ORANGE,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      );
      continue;
    }

    const video = document.createElement("video");
    video.defaultMuted = true;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("autoplay", "");
    video.style.cssText =
      "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;";
    const src = VIDEO_URLS[i];
    if (videoNeedsCrossOrigin(src)) {
      video.crossOrigin = "anonymous";
    }
    video.src = src;
    videoSink.appendChild(video);
    videos.push(video);
    videoReady.push(false);

    video.addEventListener("loadeddata", () => tryPlayVideo(video));
    video.addEventListener("canplay", () => tryPlayVideo(video));

    const tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(1, 1);
    tex.offset.set(0, 0);
    textures.push(tex);
    materials.push(null);
  }

  const panels = [];
  let createdCount = 0;
  let globalAssemblyStartTime = null;

  function createPanelForSlot(slotIndex) {
    const urlIndex = slotUrlIndices[slotIndex];
    const video = videos[urlIndex];
    const slot = slots[slotIndex];

    let geo;
    if (slot.kind === "quad") {
      geo = createSphericalQuadGeometry(
        slot.phiMin,
        slot.phiMax,
        slot.thetaMin,
        slot.thetaMax,
        SPHERE_RADIUS,
        PLANE_SEGMENTS,
        PLANE_SEGMENTS,
        uniformFlatHalfW,
        uniformFlatHalfH,
      );
    } else if (slot.kind === "triSouth") {
      geo = createPolarCapTriangleGeometry(
        true,
        slot.phiRim,
        slot.thetaMin,
        slot.thetaMax,
        SPHERE_RADIUS,
        PLANE_SEGMENTS,
        PLANE_SEGMENTS,
        uniformFlatHalfW,
        uniformFlatHalfH,
      );
    } else {
      geo = createPolarCapTriangleGeometry(
        false,
        slot.phiRim,
        slot.thetaMin,
        slot.thetaMax,
        SPHERE_RADIUS,
        PLANE_SEGMENTS,
        PLANE_SEGMENTS,
        uniformFlatHalfW,
        uniformFlatHalfH,
      );
    }

    const planeAspectTarget = slotPlaneAspect(slot);
    const mat = canUseWebGLVideo
      ? createVideoPanelShaderMaterial(
          textures[urlIndex],
          slot.kind === "quad" ? chaosPlaneAspect : planeAspectTarget,
        )
      : materials[urlIndex];

    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 0;

    const rnd = rngForSlot(slotIndex);
    const chaosPos = new THREE.Vector3(
      (rnd() - 0.5) * 9,
      (rnd() - 0.5) * 7,
      3.5 + rnd() * 5.5,
    );
    const chaosQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        (rnd() - 0.5) * 2.6,
        (rnd() - 0.5) * 2.6,
        (rnd() - 0.5) * 2.6,
      ),
    );
    const chaosScale = 0.45 + rnd() * 0.95;
    mesh.position.copy(chaosPos);
    mesh.quaternion.copy(chaosQuat);
    mesh.scale.setScalar(chaosScale);

    sphereGroup.add(mesh);
    panels[slotIndex] = {
      mesh,
      geo,
      chaosPos,
      chaosQuat,
      chaosScale,
      assembled: false,
      urlIndex,
      planeAspectTarget,
      slotKind: slot.kind,
    };
    createdCount++;
    if (createdCount === N) {
      globalAssemblyStartTime = performance.now();
    }

    tryPlayVideo(video);
  }

  function maybeCreateNextPanel(now) {
    if (pendingRevealSlots.length === 0) return;
    if (now < nextRevealDueTime) return;
    const slotIndex = pendingRevealSlots[0];
    const urlIndex = slotUrlIndices[slotIndex];
    if (!videoReady[urlIndex]) return;
    pendingRevealSlots.shift();
    createPanelForSlot(slotIndex);
    if (pendingRevealSlots.length > 0) {
      nextRevealDueTime =
        now +
        REVEAL_GAP_START_MS *
          REVEAL_GAP_RATIO ** Math.max(0, createdCount - 1);
    }
  }

  function onVideoReady(index) {
    if (videoReady[index]) return;
    videoReady[index] = true;
    maybeCreateNextPanel(performance.now());
  }

  if (canUseWebGLVideo) {
    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      const idx = i;
      const mark = () => onVideoReady(idx);
      v.addEventListener("canplay", mark, { once: true });
      v.addEventListener("error", mark, { once: true });
      v.load();
    }
  } else {
    maybeCreateNextPanel(performance.now());
  }

  const onFirstGesture = () => resumeAllVideos();
  window.addEventListener("pointerdown", onFirstGesture, {
    capture: true,
    passive: true,
    once: true,
  });

  const onVis = () => {
    if (document.visibilityState === "visible") resumeAllVideos();
  };
  document.addEventListener("visibilitychange", onVis);

  if (canUseWebGLVideo) {
    requestAnimationFrame(() => resumeAllVideos());
  }

  const loadTimeoutId = window.setTimeout(() => {
    for (let i = 0; i < videoReady.length; i++) {
      if (!videoReady[i]) onVideoReady(i);
    }
  }, LOAD_TIMEOUT_MS);

  let spinning = false;
  let fadeScheduled = false;
  let lastT = performance.now();

  let rafId = 0;
  let teardownCalled = false;
  let videoKickAcc = 0;

  function startExitSequence() {
    if (fadeScheduled) return;
    fadeScheduled = true;
    preloaderEl.classList.add("is-hidden");
    preloaderEl.setAttribute("aria-hidden", "true");

    const onFadeEnd = (e) => {
      if (e.propertyName !== "opacity") return;
      preloaderEl.removeEventListener("transitionend", onFadeEnd);
      teardown();
    };
    preloaderEl.addEventListener("transitionend", onFadeEnd);
    window.setTimeout(() => {
      if (!teardownCalled) teardown();
    }, FADE_CSS_MS + 200);
  }

  function onPreloaderClick() {
    startExitSequence();
  }
  preloaderEl.addEventListener("click", onPreloaderClick);

  function teardown() {
    if (teardownCalled) return;
    teardownCalled = true;
    cancelAnimationFrame(rafId);
    window.clearTimeout(loadTimeoutId);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("pointerdown", onFirstGesture, { capture: true });
    document.removeEventListener("visibilitychange", onVis);
    preloaderEl.removeEventListener("click", onPreloaderClick);
    if (videoSink.parentNode) {
      videoSink.parentNode.removeChild(videoSink);
    }

    for (const v of videos) {
      if (!v) continue;
      v.pause();
      v.removeAttribute("src");
      v.load();
    }

    for (const p of panels) {
      if (!p) continue;
      sphereGroup.remove(p.mesh);
      p.geo.dispose();
      if (canUseWebGLVideo && p.mesh.material?.isShaderMaterial) {
        p.mesh.material.dispose();
      }
    }

    for (let i = 0; i < materials.length; i++) {
      if (materials[i]) materials[i].dispose();
      if (textures[i]) textures[i].dispose();
    }

    renderer.dispose();
    scene.clear();
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener("resize", onResize);

  function animate(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    videoKickAcc++;
    if (canUseWebGLVideo && videoKickAcc % 48 === 0) {
      for (const v of videos) {
        if (v && v.paused && v.readyState >= 2 && !v.error) tryPlayVideo(v);
      }
    }

    maybeCreateNextPanel(now);

    let kAssembly = 0;
    let bendT = 0;
    if (globalAssemblyStartTime !== null) {
      const rawT = (now - globalAssemblyStartTime) / ASSEMBLE_DURATION_MS;
      if (rawT >= 1) {
        kAssembly = 1;
        bendT = 1;
      } else {
        const tClamped = Math.max(0, rawT);
        kAssembly = 1 - (1 - tClamped) ** 3;
        bendT = kAssembly;
      }
    }

    for (let i = 0; i < N; i++) {
      const p = panels[i];
      if (!p) continue;
      if (!p.geo.userData._bendDone) {
        applyPanelBendMorph(p.geo, bendT);
        if (bendT >= 1) p.geo.userData._bendDone = true;
      }
      if (globalAssemblyStartTime === null) {
        continue;
      }
      if (kAssembly >= 1) {
        if (!p.assembled) {
          p.mesh.position.copy(_vZero);
          p.mesh.quaternion.copy(_qIdent);
          p.mesh.scale.set(1, 1, 1);
          p.assembled = true;
        }
      } else {
        p.mesh.position.lerpVectors(p.chaosPos, _vZero, kAssembly);
        p.mesh.quaternion.slerpQuaternions(p.chaosQuat, _qIdent, kAssembly);
        p.mesh.scale.setScalar(
          THREE.MathUtils.lerp(p.chaosScale, 1, kAssembly),
        );
      }
    }

    const assemblyDone =
      globalAssemblyStartTime !== null &&
      now - globalAssemblyStartTime >= ASSEMBLE_DURATION_MS;
    spinning = assemblyDone;

    for (let i = 0; i < N; i++) {
      const p = panels[i];
      if (!p?.mesh?.material) continue;
      const m = p.mesh.material;
      if (
        m.isShaderMaterial &&
        m.uniforms.uVideoAspect &&
        canUseWebGLVideo
      ) {
        const vid = videos[p.urlIndex];
        if (vid?.videoWidth > 0 && vid?.videoHeight > 0) {
          m.uniforms.uVideoAspect.value =
            vid.videoWidth / vid.videoHeight;
        }
      }
      if (
        m.isShaderMaterial &&
        m.uniforms.uPlaneAspect &&
        canUseWebGLVideo &&
        p.planeAspectTarget != null
      ) {
        if (p.slotKind === "quad") {
          m.uniforms.uPlaneAspect.value =
            chaosPlaneAspect +
            (p.planeAspectTarget - chaosPlaneAspect) * kAssembly;
        } else {
          m.uniforms.uPlaneAspect.value = p.planeAspectTarget;
        }
      }
    }

    if (spinning) {
      sphereGroup.rotation.x += ROT_SPEED.x * dt;
      sphereGroup.rotation.y += ROT_SPEED.y * dt;
      sphereGroup.rotation.z += ROT_SPEED.z * dt;
    }

    for (let ti = 0; ti < textures.length; ti++) {
      const t = textures[ti];
      const vid = videos[ti];
      if (t && t.isVideoTexture && vid && vid.readyState >= 2) {
        t.needsUpdate = true;
      }
    }

    renderer.render(scene, camera);

    if (!teardownCalled) {
      rafId = requestAnimationFrame(animate);
    }
  }

  rafId = requestAnimationFrame(animate);
}

main();
