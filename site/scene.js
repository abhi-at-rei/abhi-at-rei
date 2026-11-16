// The War Room: 3D contribution city. Everything here is procedural geometry and shaders.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { matchesFilter, replayAt } from './model.js';

// ---------- palette (generator/theme.py) ----------
const SH = {
  nika_white: '#FFFDF7', cream: '#FFF4DC', sun_gold: '#F6B800', sun_glow: '#FFD95A', straw: '#E9C46A',
  straw_band: '#C1121F', luffy_red: '#D62828', zoro_green: '#2E8B57', zoro_light: '#5FD08A',
  haki_black: '#1B1B1F', sea: '#2A9DF4', sea_deep: '#0E4C92',
};
const AK = {
  cloak: '#0B0B10', cloak_soft: '#1A1A24', cloud_red: '#C1121F', cloud_edge: '#FFFFFF', sharingan: '#E5383B',
  tomoe: '#0B0B10', rinnegan: '#8E7CC3', rinnegan_light: '#C9BCF0', rain: '#3A506B', crow: '#14141A',
};
const MODES = {
  light: { sky_left: '#FFF4DC', sky_right: '#EDE7F6', clash: '#F6B800', text: '#1B1B1F' },
  dark: { sky_left: '#1F1608', sky_right: '#0B0B10', clash: '#FFD95A', text: '#F5F1E8' },
};
// Contribution intensity (theme.POWER): index = GitHub level 0-4; gold is a light day, crimson the hottest.
const POWER = {
  light: ['#EFE6D2', '#FFE08A', '#F6B800', '#E5383B', '#C1121F'],
  dark: ['#1E1A12', '#6B5214', '#F6B800', '#E5383B', '#FF4D5A'],
};
// Derived scene surfaces (mixes of the tokens above), per mode.
const SURF = {
  light: {
    boardTop: '#E2D6BC', boardSide: '#B39A70', dimTo: '#E7DFCF', district: '#8A6400', matchGlow: 0.35,
    bridge: '#8A6400', bridgeHot: '#FF9F1C',
    seaTile: '#B8C9CC', lagoon: '#C9D5D2', reef: '#8FA5AC',
    water: { shallowL: '#D3DAD6', deepL: '#8EA3AC', shallowR: '#CFCCD2', deepR: '#7A7F8F', foam: '#FFFDF7' },
    hemiSky: '#FFF4DC', hemiGround: '#D8CCB8', hemi: 1.2, sun: 2.1, sunColor: '#FFF1CF', moon: 0.5, moonColor: '#E5383B',
    towerGlow: 0, bloom: 0.42, rain: '#7D8596', rainOpacity: 0.26, ember: [SH.luffy_red, SH.sun_gold], emberGain: 1.0,
    skyline: '#D2CCC8', skylineGlow: '#E5383B', lamp: '#FFE9B0', rock: '#8A7A5E', glitter: '#E9B949', glitterGain: 0.32,
    // Distant city: slate-lavender blocks with glass panes, a few sunlit windows, hazed into the sky with distance.
    city: '#A8A2B8', cityPane: '#7C7690', cityPaneAmt: 0.42, cityLit: '#FFF6DE', cityLitGain: 1.0, cityLitFrac: 0.07, cityHaze: 0.5,
    windowGlow: 0, windowPane: 0.1, zenith: 0, stars: 0, beam: '#FFE9B0', beamGain: 0.22, bird: '#2B2730', contact: '#5A4A30', contactAmt: 0.34,
  },
  dark: {
    boardTop: '#25211A', boardSide: '#3A2F1E', dimTo: '#15131A', district: '#FFD95A', matchGlow: 0.9,
    bridge: '#FFD95A', bridgeHot: '#FFD95A',
    seaTile: '#33536E', lagoon: '#25405A', reef: '#14273A',
    water: { shallowL: '#30506E', deepL: '#13253A', shallowR: '#2E2A3E', deepR: '#131423', foam: '#7FA3C4' },
    hemiSky: '#9A7A2E', hemiGround: '#3B2F63', hemi: 1.85, sun: 2.1, sunColor: '#FFD95A', moon: 1.25, moonColor: '#FF4D5A',
    towerGlow: 0.22, bloom: 0.85, rain: AK.rinnegan_light, rainOpacity: 0.17, ember: [SH.sun_gold, SH.sun_glow], emberGain: 2.0,
    skyline: '#2A2C3B', skylineGlow: '#E5383B', lamp: '#FFD27A', rock: '#241E16', glitter: '#FFD98A', glitterGain: 0.26,
    city: '#2C2E3E', cityPane: '#1A1B26', cityPaneAmt: 0.55, cityLit: '#FFD27A', cityLitGain: 1.5, cityLitFrac: 0.2, cityHaze: 0.3,
    windowGlow: 1, windowPane: 0.28, zenith: 0.38, stars: 1, beam: '#FFE2A0', beamGain: 0.55, bird: '#3A3446', contact: '#000000', contactAmt: 0.42,
  },
};
// Warm tint the sky passes through while the theme animates (a sunset going dark, a moonrise coming back).
const DUSK = '#F08A5D';

const CELL = 1;
const FOOT = 0.8;
const H_MAX = 7.2;
const WATER_Y = -0.32;
const ELEV = THREE.MathUtils.degToRad(16);
const LENS_SHIFT = 0.34; // extra virtual height below the frame: lifts the horizon into view without tilting the city
const ISO_AZ = THREE.MathUtils.degToRad(42);
const ISO_EL = THREE.MathUtils.degToRad(34);
const REEF_Y = WATER_Y - 0.5;

const hdr = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
const BEVEL = 0.07; // tower cap and edge rounding, in world units whatever the tower's height
const LIFT_H = 0.42; // how far a hovered tower floats up

// Glows that are additive at night and normally blended by day share one blend mode: the
// shader writes premultiplied colour and scales alpha by uNormalMix (0 additive, 1 normal),
// so the theme can cross-fade between the two without a pop.
const PREMUL_OUT = 'gl_FragColor = vec4(gl_FragColor.rgb * gl_FragColor.a, gl_FragColor.a * uNormalMix);';

// ---------- screen-space fog that matches the left/right sky gradient ----------
const FOG_PARS_EXTRA = /* glsl */`
uniform vec3 uSkyL;
uniform vec3 uSkyR;
uniform vec2 uFogRes;
`;
const FOG_FRAG = /* glsl */`
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  float fogX = smoothstep( 0.12, 0.88, gl_FragCoord.x / max( uFogRes.x, 1.0 ) );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, mix( uSkyL, uSkyR, fogX ), fogFactor );
#endif`;

export function createScene(opts) {
  const disposables = new Set();
  const listeners = [];
  const observers = [];
  const timers = new Set();
  const labelNodes = [];
  const track = (x) => { if (x) disposables.add(x); return x; };
  const listen = (el, type, fn, o) => { el.addEventListener(type, fn, o); listeners.push([el, type, fn, o]); };
  const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.add(id); return id; };
  let disposed = false;
  let raf = 0;
  let renderer = null;
  let canvas = null;

  const disposeAll = () => {
    if (disposed) return;
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    for (const id of timers) clearTimeout(id);
    timers.clear();
    for (const o of observers) o.disconnect();
    observers.length = 0;
    for (const [el, type, fn, o] of listeners) el.removeEventListener(type, fn, o);
    listeners.length = 0;
  };
  const attempt = (fn) => {
    try { fn(); } catch (e) { return e; }
    return null;
  };
  const release = () => {
    for (const d of disposables) if (d !== renderer) attempt(() => d.dispose());
    disposables.clear();
    if (renderer) {
      attempt(() => renderer.dispose());
      attempt(() => renderer.forceContextLoss());
    }
    for (const n of labelNodes) n.remove();
    labelNodes.length = 0;
    if (canvas) canvas.remove();
  };

  try {
    const { container, labels: labelRoot, toast, model } = opts;
    let mode = opts.theme === 'dark' ? 'dark' : 'light';
    let motion = !!opts.motion;
    const reduced = !!opts.reducedMotion;
    let quality = ['auto', 'low', 'high'].includes(opts.quality) ? opts.quality : 'auto';
    let interactive = opts.interactive !== false;
    let preset = 'front';
    const onHover = typeof opts.onHover === 'function' ? opts.onHover : () => {};
    const onPick = typeof opts.onPick === 'function' ? opts.onPick : () => {};

    const days = model.days || [];
    const N = days.length;
    const nWeeks = Math.max(1, model.nWeeks || 1);
    const coast = Math.min(Math.max(0, model.coast || 0), nWeeks);
    const maxCount = Math.max(1, model.maxCount || 1);
    const byDate = model.byDate || new Map();
    const longestDates = model.longestDates || new Set();
    const monthList = Array.isArray(model.months) ? model.months : [];

    const idxOf = (v) => {
      if (v == null) return null;
      if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < N) return v;
      const d = byDate.get(v);
      return d ? d.idx : null;
    };

    const xOf = (w) => (w - (nWeeks - 1) / 2) * CELL;
    const zOf = (wd) => (wd - 3) * CELL;
    const landStartW = Math.min(coast, nWeeks - 1);
    const landX0 = xOf(landStartW) - CELL / 2 - 0.35;
    const landX1 = xOf(nWeeks - 1) + CELL / 2 + 0.45;
    const boardZ0 = zOf(0) - CELL / 2 - 0.45;
    const boardZ1 = zOf(6) + CELL / 2 + 0.45;
    // Scenery only: the sea and sky shift from sunlit (left) to rainy moonlight (right) across the land.
    const duskX = landX0 + (landX1 - landX0) * 0.62;
    const reefX0 = xOf(0) - CELL / 2 - 0.35;

    const isSunken = (d) => d.sea && d.week < coast;
    const heightOf = (d) => {
      if (d.sea) return isSunken(d) ? 0.2 : 0.05;
      return d.count > 0 ? 0.5 + (H_MAX - 0.5) * Math.sqrt(d.count / maxCount) : 0.16;
    };
    const baseOf = (d) => (isSunken(d) ? REEF_Y : 0);

    // ---------- renderer ----------
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    track(renderer);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    canvas = renderer.domElement;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Interactive 3D city of daily contributions. The flat heatmap below has the same data and is keyboard accessible.');
    container.append(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 2, 0.5, 900);

    // Shared fog uniforms (referenced by every fogged material).
    const fogU = {
      uSkyL: { value: new THREE.Color() },
      uSkyR: { value: new THREE.Color() },
      uFogRes: { value: new THREE.Vector2(1, 1) },
    };
    const withFog = (mat, tag = '', extra) => {
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, fogU);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <fog_pars_fragment>', `#include <fog_pars_fragment>\n${FOG_PARS_EXTRA}`)
          .replace('#include <fog_fragment>', FOG_FRAG);
        if (extra) extra(shader);
      };
      mat.customProgramCacheKey = () => `gradfog:${tag}`;
      return mat;
    };
    scene.fog = new THREE.Fog(0xffffff, 60, 170);

    // Theme-dependent blending (see PREMUL_OUT): one shared uniform drives every such glow.
    const normalMix = { value: 0 };
    const themeBlend = (mat) => {
      mat.blending = THREE.CustomBlending;
      mat.blendEquation = THREE.AddEquation;
      mat.blendSrc = THREE.OneFactor;
      mat.blendDst = THREE.OneMinusSrcAlphaFactor;
      if (mat.isShaderMaterial) {
        mat.uniforms.uNormalMix = normalMix;
      } else {
        mat.onBeforeCompile = (shader) => {
          shader.uniforms.uNormalMix = normalMix;
          shader.fragmentShader = `uniform float uNormalMix;\n${shader.fragmentShader}`
            .replace('#include <fog_fragment>', `#include <fog_fragment>\n${PREMUL_OUT}`);
        };
        mat.customProgramCacheKey = () => 'premul';
      }
      return mat;
    };

    // ---------- sky: a screen-space gradient that matches the fog, darker overhead at night, with stars ----------
    const skyU = { uZenith: { value: 0 }, uStars: { value: 0 }, uTime: { value: 0 } };
    const skyMat = track(new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: { ...fogU, ...skyU },
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.9999, 1.0); }',
      fragmentShader: /* glsl */`
        uniform vec3 uSkyL; uniform vec3 uSkyR; uniform vec2 uFogRes; uniform float uZenith; uniform float uStars; uniform float uTime;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main(){
          vec2 fc = gl_FragCoord.xy / max(uFogRes, vec2(1.0));
          vec3 col = mix(uSkyL, uSkyR, smoothstep(0.12, 0.88, fc.x));
          col *= 1.0 - uZenith * smoothstep(0.6, 1.0, fc.y);
          // Stars: one candidate per 18 px cell, twinkling slowly, fading out toward the horizon.
          vec2 cell = floor(gl_FragCoord.xy / 18.0);
          float h = hash(cell);
          vec2 sp = (cell + 0.15 + 0.7 * vec2(hash(cell + 3.1), hash(cell + 7.7))) * 18.0;
          float star = step(0.88, h) * (1.0 - smoothstep(0.3, 1.5, length(gl_FragCoord.xy - sp)));
          star *= (0.55 + 0.45 * sin(uTime * (0.8 + h * 2.0) + h * 40.0)) * smoothstep(0.5, 0.82, fc.y);
          col += vec3(1.0, 0.94, 0.84) * star * uStars * (0.5 + 0.5 * hash(cell + 1.3));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    }));
    const sky = new THREE.Mesh(track(new THREE.PlaneGeometry(2, 2)), skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -1000;
    scene.add(sky);

    // ---------- lights ----------
    const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
    scene.add(hemi);
    const sunLight = new THREE.DirectionalLight(0xffffff, 2);
    const landMidX = (landX0 + landX1) / 2;
    sunLight.position.set(landMidX - 34, 38, 22);
    sunLight.target.position.set(landMidX, 0, 0);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(1024, 1024);
    const halfLand = (landX1 - landX0) / 2 + 6;
    Object.assign(sunLight.shadow.camera, { left: -halfLand, right: halfLand, top: 16, bottom: -16, near: 1, far: 140 });
    sunLight.shadow.bias = -0.0004;
    sunLight.shadow.normalBias = 0.03;
    sunLight.shadow.radius = 4;
    scene.add(sunLight, sunLight.target);
    const moonLight = new THREE.DirectionalLight(0xff0000, 1);
    moonLight.position.set(landX1 + 30, 22, -6);
    moonLight.target.position.set(landMidX, 0, 0);
    scene.add(moonLight, moonLight.target);

    // ---------- island boards ----------
    const boardH = 1.8;
    const mkBoard = (x0, x1) => {
      const g = track(new THREE.BoxGeometry(Math.max(0.01, x1 - x0), boardH, boardZ1 - boardZ0));
      const top = withFog(track(new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 })), 'std');
      const side = withFog(track(new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 })), 'std');
      const m = new THREE.Mesh(g, [side, side, top, side, side, side]);
      m.position.set((x0 + x1) / 2, -boardH / 2, (boardZ0 + boardZ1) / 2);
      m.receiveShadow = true;
      m.castShadow = false;
      scene.add(m);
      return { mesh: m, top, side };
    };
    const board = mkBoard(landX0, landX1);
    // The reef under the open sea: the weeks before setting sail stay visible as a sunken grid.
    let reef = null;
    let reefMat = null;
    if (coast > 0) {
      reefMat = withFog(track(new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 })), 'std');
      reef = new THREE.Mesh(track(new THREE.BoxGeometry(landX0 - reefX0, 0.4, boardZ1 - boardZ0)), reefMat);
      reef.position.set((reefX0 + landX0) / 2, REEF_Y - 0.2, (boardZ0 + boardZ1) / 2);
      reef.receiveShadow = true;
      scene.add(reef);
    }

    const districtMat = withFog(track(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 })), 'basic');
    const districtGroup = new THREE.Group();
    {
      const lineGeo = track(new THREE.BoxGeometry(0.045, 0.02, boardZ1 - boardZ0));
      const seenW = new Set();
      for (const m of monthList.slice(1)) {
        let w0 = Infinity;
        for (const date of m.dates || []) {
          const d = byDate.get(date);
          if (d) w0 = Math.min(w0, d.week);
        }
        if (!Number.isFinite(w0) || w0 <= landStartW || seenW.has(w0)) continue;
        seenW.add(w0);
        const line = new THREE.Mesh(lineGeo, districtMat);
        line.position.set(xOf(w0) - CELL / 2 - 0.02, 0.011, (boardZ0 + boardZ1) / 2);
        districtGroup.add(line);
      }
    }
    scene.add(districtGroup);

    // ---------- towers (one InstancedMesh, instance i == day i) ----------
    // Rounded caps and edges: the shader keeps the bevel a fixed world size however tall the tower is
    // (a plain scaled RoundedBox would stretch the top into a dome).
    const towerGeo = track(new RoundedBoxGeometry(1, 1, 1, 2, BEVEL));
    towerGeo.translate(0, 0.5, 0);
    const outlineGeo = track(new THREE.BoxGeometry(1, 1, 1));
    outlineGeo.translate(0, 0.5, 0);
    const towerGlow = { value: 0 };
    const towerU = {
      uDimTo: { value: new THREE.Color() }, uMatchGlow: { value: 0.4 },
      // hover: xz of the hovered tower and the eased amount; id of the hovered instance (-1 none)
      uHover: { value: new THREE.Vector3(0, 0, 0) }, uHoverId: { value: -1 },
      uWinOn: { value: 1 }, uWinGlow: { value: 0 }, uWinCol: { value: new THREE.Color() }, uWinPane: { value: 0.1 },
    };
    const towerMat = track(new THREE.MeshStandardMaterial({ roughness: 0.52, metalness: 0.06 }));
    towerMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, fogU, towerU);
      shader.uniforms.uTowerGlow = towerGlow;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          varying float vTowerY;
          attribute float aFilter;
          varying float vFilter;
          attribute float aHL; attribute float aWin;
          varying float vHL; varying float vWin; varying float vSeed; varying float vNear; varying float vH;
          varying vec3 vLoc; varying vec3 vObjN;
          uniform vec3 uHover; uniform float uHoverId;`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          vec3 tS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          objectNormal *= tS; // pre-scaled so the instance transform leaves the true bevel normal`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec3 fk = min(1.0 / max(tS, vec3(1e-4)), vec3(0.5 / ${BEVEL}));
          transformed.y = position.y > 0.5 ? 1.0 - (1.0 - position.y) * fk.y : position.y * fk.y;
          transformed.x = sign(position.x) * (0.5 - (0.5 - abs(position.x)) * fk.x);
          transformed.z = sign(position.z) * (0.5 - (0.5 - abs(position.z)) * fk.z);
          vTowerY = transformed.y;
          vFilter = aFilter;
          vHL = aHL; vWin = aWin; vH = tS.y; vSeed = float(gl_InstanceID);
          vLoc = transformed * tS; vObjN = normal;
          float isHover = abs(float(gl_InstanceID) - uHoverId) < 0.5 ? 1.0 : 0.0;
          vNear = uHover.z * (1.0 - isHover) * (1.0 - smoothstep(1.2, 5.5, distance(instanceMatrix[3].xz, uHover.xy)));`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <fog_pars_fragment>', `#include <fog_pars_fragment>\n${FOG_PARS_EXTRA}`)
        .replace('#include <fog_fragment>', FOG_FRAG)
        .replace('#include <common>', `#include <common>
          varying float vTowerY;
          varying float vFilter;
          uniform float uTowerGlow;
          uniform vec3 uDimTo;
          uniform float uMatchGlow;
          varying float vHL; varying float vWin; varying float vSeed; varying float vNear; varying float vH;
          varying vec3 vLoc; varying vec3 vObjN;
          uniform float uWinOn; uniform float uWinGlow; uniform vec3 uWinCol; uniform float uWinPane;
          float tHash(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += diffuseColor.rgb * uTowerGlow * (0.25 + 0.75 * smoothstep(0.55, 1.0, vTowerY));
          totalEmissiveRadiance += diffuseColor.rgb * uMatchGlow * max(clamp(vFilter, 0.0, 1.0), clamp(vHL, 0.0, 1.0)) * (0.4 + 0.6 * vTowerY);
          totalEmissiveRadiance += uWinCol * uWinGlow * tLit;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float tSide = 1.0 - step(0.5, abs(vObjN.y));
          diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.0, 1.0, vTowerY));
          // soft contact shading where the tower meets the ground
          diffuseColor.rgb *= mix(1.0, mix(0.6, 1.0, smoothstep(0.0, 0.45, vLoc.y)), tSide);
          // windows: glass panes on every storey; lit ones (dark theme) scale with the day's count
          float tLit = 0.0;
          if (uWinOn > 0.5 && tSide > 0.5 && vH > 0.7) {
            float u = abs(vObjN.x) > 0.5 ? vLoc.z : vLoc.x;
            vec2 cell = vec2((u + 0.4) / 0.2, (vLoc.y - 0.2) / 0.27);
            vec2 f = fract(cell);
            float inWin = step(0.24, f.x) * step(f.x, 0.76) * step(0.28, f.y) * step(f.y, 0.74)
              * step(0.2, vLoc.y) * step(vLoc.y, vH - 0.22) * step(0.0, cell.x) * step(cell.x, 4.0);
            float face = dot(sign(vObjN), vec3(1.0, 2.0, 3.0));
            tLit = inWin * step(tHash(vec3(floor(cell), vSeed * 1.37 + face * 5.1)), vWin);
            diffuseColor.rgb *= 1.0 - uWinPane * inWin * (1.0 - tLit);
          }
          float tDim = max(clamp(-vFilter, 0.0, 1.0), clamp(-vHL, 0.0, 1.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, uDimTo, tDim * 0.78);
          diffuseColor.rgb = mix(diffuseColor.rgb, uDimTo, vNear * 0.45);`);
    };
    towerMat.customProgramCacheKey = () => 'tower';
    const filterAttr = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
    filterAttr.setUsage(THREE.DynamicDrawUsage);
    towerGeo.setAttribute('aFilter', filterAttr);
    // Highlight (setHighlight): 1 emphasised, negative dimmed, 0 neutral. Independent of the filter.
    const hlAttr = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
    hlAttr.setUsage(THREE.DynamicDrawUsage);
    towerGeo.setAttribute('aHL', hlAttr);
    // Lit-window density: none on a quiet day, more the busier the day.
    const winAttr = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
    for (let i = 0; i < N; i++) {
      const d = days[i];
      winAttr.setX(i, d.sea || !(d.count > 0) ? 0 : 0.1 + 0.45 * Math.sqrt(d.count / maxCount));
    }
    towerGeo.setAttribute('aWin', winAttr);
    const towers = new THREE.InstancedMesh(towerGeo, towerMat, N);
    towers.castShadow = true;
    towers.receiveShadow = true;
    towers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    track(towers);
    scene.add(towers);

    // Soft contact shadows: one decal per day on the board, darker under taller towers (one draw call).
    const contactU = { uColor: { value: new THREE.Color() }, uAmt: { value: 0.3 } };
    const contactMat = track(new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: contactU,
      vertexShader: /* glsl */`
        attribute float aStr; varying float vStr; varying vec2 vP;
        void main(){ vStr = aStr; vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform float uAmt; varying float vStr; varying vec2 vP;
        void main(){
          vec2 q = max(abs(vP) - vec2(0.27), 0.0);
          float a = (1.0 - smoothstep(0.0, 0.22, length(q))) * vStr * uAmt;
          gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));
          #include <colorspace_fragment>
        }`,
    }));
    const contactGeo = track(new THREE.PlaneGeometry(1, 1));
    contactGeo.rotateX(-Math.PI / 2);
    const contactStr = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
    contactStr.setUsage(THREE.DynamicDrawUsage);
    contactGeo.setAttribute('aStr', contactStr);
    const contacts = track(new THREE.InstancedMesh(contactGeo, contactMat, N));
    contacts.frustumCulled = false;
    contacts.renderOrder = -2;
    scene.add(contacts);

    const dummy = new THREE.Object3D();
    const curH = new Float32Array(N);
    const rise = new Float32Array(N).fill(1);
    const lift = new Float32Array(N); // hover spring, 0..~1.1
    const colorRev = new Uint8Array(N).fill(1);
    const setTower = (i, h) => {
      const d = days[i];
      curH[i] = h;
      dummy.position.set(xOf(d.week), baseOf(d) + lift[i] * LIFT_H, zOf(d.weekday));
      dummy.scale.set(FOOT, Math.max(0.002, h), FOOT);
      dummy.updateMatrix();
      towers.setMatrixAt(i, dummy.matrix);
      contactStr.setX(i, d.sea ? 0 : clamp01(0.25 + 0.75 * Math.sqrt(h / H_MAX)) * (1 - 0.6 * clamp01(lift[i])));
      contactStr.needsUpdate = true;
    };
    for (let i = 0; i < N; i++) {
      const d = days[i];
      dummy.position.set(xOf(d.week), baseOf(d) + 0.012, zOf(d.weekday));
      dummy.scale.set(1.45, 1, 1.45);
      dummy.updateMatrix();
      contacts.setMatrixAt(i, dummy.matrix);
      setTower(i, heightOf(d));
    }
    contacts.instanceMatrix.needsUpdate = true;
    towers.instanceMatrix.needsUpdate = true;
    if (N > 0) {
      towers.computeBoundingSphere();
      towers.computeBoundingBox?.();
    } else {
      towers.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0);
    }

    const baseColors = new Array(N);
    const blankColors = new Array(N);
    const blankH = (d) => (d.sea ? heightOf(d) : 0.16);
    const shownColor = (i) => (i <= replayIdx ? baseColors[i] : blankColors[i]);
    const tmpC = new THREE.Color();
    const colorFor = (d) => {
      if (d.sea) return new THREE.Color(isSunken(d) ? SURF[mode].seaTile : SURF[mode].lagoon);
      return new THREE.Color(POWER[mode][d.level]);
    };

    const bridgeMat = withFog(track(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })), 'basic');
    const bridgeGroup = new THREE.Group();
    const streakPairs = [];
    for (let i = 0; i + 1 < N; i++) {
      const a = days[i];
      const b = days[i + 1];
      if (a.idx + 1 !== b.idx || !longestDates.has(a.date) || !longestDates.has(b.date)) continue;
      streakPairs.push([a.idx, b.idx]);
      const pa = new THREE.Vector3(xOf(a.week), heightOf(a) + 0.12, zOf(a.weekday));
      const pb = new THREE.Vector3(xOf(b.week), heightOf(b) + 0.12, zOf(b.weekday));
      const mid = pa.clone().lerp(pb, 0.5); mid.y += 0.3;
      const curve = new THREE.QuadraticBezierCurve3(pa, mid, pb);
      const tube = new THREE.Mesh(track(new THREE.TubeGeometry(curve, 10, 0.045, 6, false)), bridgeMat);
      tube.userData.pair = [a.idx, b.idx];
      bridgeGroup.add(tube);
    }
    scene.add(bridgeGroup);

    // ---------- hover outline + pinned marker ----------
    const edgeGeo = track(new THREE.EdgesGeometry(outlineGeo));
    const hoverMat = track(new THREE.LineBasicMaterial({ color: 0xffffff, fog: false, transparent: true }));
    const hoverBox = new THREE.LineSegments(edgeGeo, hoverMat);
    hoverBox.visible = false;
    hoverBox.renderOrder = 5;
    scene.add(hoverBox);

    const pinGroup = new THREE.Group();
    pinGroup.visible = false;
    const ringMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    const ring = new THREE.Mesh(track(new THREE.RingGeometry(0.62, 0.78, 48)), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    const beamMat = themeBlend(track(new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color() }, uTime: { value: 0 }, uOpacity: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uColor; uniform float uTime; uniform float uOpacity; uniform float uNormalMix; varying vec2 vUv;
        void main(){ float a = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 2.2) * (0.75 + 0.25 * sin(vUv.y * 26.0 - uTime * 4.0));
        gl_FragColor = vec4(uColor, clamp(a * uOpacity, 0.0, 1.0));
        #include <colorspace_fragment>
        ${PREMUL_OUT} }`,
    })));
    const beamGeo = track(new THREE.CylinderGeometry(0.46, 0.46, 1, 32, 1, true));
    beamGeo.translate(0, 0.5, 0);
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.scale.y = 7;
    pinGroup.add(ring, beam);
    scene.add(pinGroup);

    // ---------- water ----------
    const W_AMP = [0.12, 0.075, 0.04];
    const W_K = [0.33, 0.62, 1.25];
    const W_S = [1.0, 1.55, 2.3];
    const W_D = [[0.9, 0.42], [-0.35, 0.94], [0.6, -0.8]].map(([a, b]) => { const l = Math.hypot(a, b) || 1; return [a / l, b / l]; });
    let wTime = 0;
    const waveAt = (x, z, t) => {
      let h = 0;
      for (let i = 0; i < 2; i++) h += W_AMP[i] * Math.sin((W_D[i][0] * x + W_D[i][1] * z) * W_K[i] + t * W_S[i]);
      return h;
    };
    const waterGeo = track(new THREE.PlaneGeometry(640, 420, 220, 140));
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = track(new THREE.ShaderMaterial({
      transparent: true,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 }, uShallowL: { value: new THREE.Color() }, uDeepL: { value: new THREE.Color() },
        uShallowR: { value: new THREE.Color() }, uDeepR: { value: new THREE.Color() }, uFoam: { value: new THREE.Color() },
        uSunCol: { value: new THREE.Color() }, uMoonCol: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
        uSplitX: { value: duskX }, uOpacity: { value: 0.86 },
        uLand: { value: new THREE.Vector4(landX0, boardZ0, landX1, boardZ1) },
        uReef: { value: new THREE.Vector4(reefX0, boardZ0, landX0, boardZ1) },
        uShallowOpacity: { value: 0.3 },
        uGlitterCol: { value: new THREE.Color() }, uGlitter: { value: 1 }, uSunX: { value: 0.2 },
        uRefl: { value: null }, uReflMat: { value: new THREE.Matrix4() }, uReflAmt: { value: 0 },
      }]),
      vertexShader: /* glsl */`
        uniform float uTime;
        uniform mat4 uReflMat; varying vec4 vRefl;
        varying vec3 vWorld; varying float vFar;
        #include <fog_pars_vertex>
        const vec3 AMP = vec3(${W_AMP.join(',')});
        const vec3 K = vec3(${W_K.join(',')});
        const vec3 S = vec3(${W_S.join(',')});
        const vec2 D0 = vec2(${W_D[0].join(',')}); const vec2 D1 = vec2(${W_D[1].join(',')});
        void main(){
          vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
          vec2 q = p.xz;
          // Only the long swells displace geometry; detail is shaded per pixel.
          p.y += AMP.x * sin(dot(D0, q) * K.x + uTime * S.x) + AMP.y * sin(dot(D1, q) * K.y + uTime * S.y);
          vWorld = p;
          vRefl = uReflMat * vec4(p.x, ${WATER_Y.toFixed(2)}, p.z, 1.0);
          vec4 mvPosition = viewMatrix * vec4(p, 1.0);
          vFar = -mvPosition.z;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uShallowL, uDeepL, uShallowR, uDeepR, uFoam, uSunCol, uMoonCol, uSunDir, uMoonDir;
        uniform float uSplitX, uOpacity, uShallowOpacity, uTime; uniform vec4 uLand; uniform vec4 uReef;
        uniform vec3 uSkyL; uniform vec3 uSkyR; uniform vec2 uFogRes;
        varying vec3 vWorld; varying float vFar;
        #ifdef USE_FOG
          varying float vFogDepth;
          uniform vec3 fogColor;
          uniform float fogNear;
          uniform float fogFar;
        #endif
        const vec3 AMP = vec3(${W_AMP.join(',')});
        const vec3 K = vec3(${W_K.join(',')});
        const vec3 S = vec3(${W_S.join(',')});
        const vec2 D0 = vec2(${W_D[0].join(',')}); const vec2 D1 = vec2(${W_D[1].join(',')}); const vec2 D2 = vec2(${W_D[2].join(',')});
        const vec2 D3 = vec2(0.28, 0.96); const vec2 D4 = vec2(-0.86, 0.5);
        uniform vec3 uGlitterCol; uniform float uGlitter; uniform float uSunX;
        uniform sampler2D uRefl; uniform float uReflAmt; varying vec4 vRefl;
        float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float boxDist(vec2 p, vec4 b) { vec2 d = max(max(b.xy - p, p - b.zw), 0.0); return length(d); }
        void main(){
          vec2 q = vWorld.xz;
          float a0 = dot(D0, q) * K.x + uTime * S.x;
          float a1 = dot(D1, q) * K.y + uTime * S.y;
          float a2 = dot(D2, q) * K.z + uTime * S.z;
          float a3 = dot(D3, q) * 2.6 + uTime * 3.1;
          float a4 = dot(D4, q) * 3.7 + uTime * 3.9;
          float h = AMP.x * sin(a0) + AMP.y * sin(a1) + AMP.z * sin(a2);
          float detail = 1.0 - smoothstep(30.0, 110.0, vFar);
          vec2 g = AMP.x * K.x * cos(a0) * D0 + AMP.y * K.y * cos(a1) * D1
                 + detail * (AMP.z * K.z * cos(a2) * D2 + 0.018 * 2.6 * cos(a3) * D3 + 0.012 * 3.7 * cos(a4) * D4);
          vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
          vec3 V = normalize(cameraPosition - vWorld);
          float side = smoothstep(uSplitX - 10.0, uSplitX + 10.0, vWorld.x);
          vec3 shallow = mix(uShallowL, uShallowR, side);
          vec3 deep = mix(uDeepL, uDeepR, side);
          float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
          vec3 col = mix(deep, shallow, clamp(0.5 + h * 2.2, 0.0, 1.0) * 0.55 + fres * 0.45);
          vec3 sunHalf = uSunDir + V; float sunHalfLen = length(sunHalf);
          vec3 moonHalf = uMoonDir + V; float moonHalfLen = length(moonHalf);
          float sS = sunHalfLen > 1e-4 ? pow(max(dot(N, sunHalf / sunHalfLen), 0.0), 220.0) * (1.0 - side) : 0.0;
          float sM = moonHalfLen > 1e-4 ? pow(max(dot(N, moonHalf / moonHalfLen), 0.0), 160.0) * side : 0.0;
          col += (uSunCol * sS + uMoonCol * sM) * detail;
          // Sun glitter path: a broad sheen plus flickering glints on the facets that mirror the sun.
          vec3 Rv = reflect(-V, N);
          float sheen = pow(max(dot(Rv, uSunDir), 0.0), 180.0);
          vec2 gc = floor(q * 7.0);
          float flick = floor(uTime * 6.0 + hash2(gc) * 6.0);
          vec2 jit = vec2(hash2(gc + flick * 0.37), hash2(gc.yx + flick * 0.71)) - 0.5;
          vec3 Ng = normalize(N + vec3(jit.x, 0.0, jit.y) * 0.32);
          float glint = pow(max(dot(reflect(-V, Ng), uSunDir), 0.0), 900.0);
          vec2 fc = gl_FragCoord.xy / max(uFogRes, vec2(1.0));
          float colW = mix(0.05, 0.2, 1.0 - fc.y);
          float column = 1.0 - smoothstep(colW * 0.35, colW, abs(fc.x - uSunX));
          col += uGlitterCol * (sheen * 0.2 + glint * 2.2) * uGlitter * column * (1.0 - side * 0.85);
          // Tower reflections (desktop/high): a planar mirror render, rippled by the wave normal.
          if (uReflAmt > 0.001) {
            vec4 rc = texture2D(uRefl, vRefl.xy / vRefl.w + g * 0.022);
            col = mix(col, rc.rgb, clamp(rc.a * uReflAmt * (0.5 + 0.5 * fres) * (0.35 + 0.65 * detail), 0.0, 0.85));
          }
          float crest = smoothstep(0.16, 0.22, h) * detail * 0.6;
          // surf around the island and the reef
          float dl = boxDist(q, uLand);
          float surf = (1.0 - smoothstep(0.0, 1.0, dl)) * (0.55 + 0.45 * sin(dl * 8.0 - uTime * 2.2));
          float dr = boxDist(q, uReef);
          float reefIn = 1.0 - smoothstep(0.0, 0.6, dr);
          col = mix(col, uFoam, clamp(crest * 0.12 + surf * 0.5, 0.0, 0.75));
          col = mix(col, shallow, reefIn * 0.35);
          gl_FragColor = vec4(max(col, vec3(0.0)), clamp(mix(uOpacity, uShallowOpacity, reefIn), 0.0, 1.0));
          #ifdef USE_FOG
            float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
            float fogX = smoothstep( 0.12, 0.88, gl_FragCoord.x / max( uFogRes.x, 1.0 ) );
            gl_FragColor.rgb = mix( gl_FragColor.rgb, mix( uSkyL, uSkyR, fogX ), fogFactor );
          #endif
          #include <colorspace_fragment>
        }`,
    }));
    Object.assign(waterMat.uniforms, fogU);
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.set(0, WATER_Y, -60);
    water.renderOrder = -1; // first among transparent objects; it never writes depth
    waterMat.depthWrite = false;
    scene.add(water);

    // ---------- tower reflections: the towers alone, seen from a camera mirrored under the sea ----------
    let reflOn = false;
    const reflRT = track(new THREE.WebGLRenderTarget(2, 2, { depthBuffer: true }));
    waterMat.uniforms.uRefl.value = reflRT.texture;
    const reflScene = new THREE.Scene();
    const reflCam = new THREE.PerspectiveCamera();
    const reflMat = track(new THREE.ShaderMaterial({
      uniforms: { uDimTo: towerU.uDimTo, uWinGlow: towerU.uWinGlow, uWinCol: towerU.uWinCol },
      vertexShader: /* glsl */`
        attribute float aFilter; attribute float aHL; attribute float aWin;
        varying vec3 vN; varying float vY; varying float vWy; varying float vDim; varying vec3 vCol; varying float vWin;
        void main(){
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vN = normalize(mat3(instanceMatrix) * normal); vY = position.y; vWy = w.y; vWin = aWin;
          vDim = max(clamp(-aFilter, 0.0, 1.0), clamp(-aHL, 0.0, 1.0));
          vCol = vec3(1.0);
          #ifdef USE_INSTANCING_COLOR
            vCol = instanceColor;
          #endif
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uDimTo; uniform float uWinGlow; uniform vec3 uWinCol;
        varying vec3 vN; varying float vY; varying float vWy; varying float vDim; varying vec3 vCol; varying float vWin;
        void main(){
          if (vWy < ${WATER_Y.toFixed(2)}) discard;
          vec3 c = vCol * (0.62 + 0.38 * max(dot(vN, normalize(vec3(-0.6, 0.7, 0.4))), 0.0)) * mix(0.7, 1.0, vY);
          c = mix(c, uDimTo, vDim * 0.78) + uWinCol * uWinGlow * vWin * 0.2;
          // Reflections fade with height above the water, like a real harbour at dusk.
          gl_FragColor = vec4(c, 1.0 - 0.8 * smoothstep(0.0, 6.5, vWy - ${WATER_Y.toFixed(2)}));
        }`,
    }));
    const reflTowers = track(new THREE.InstancedMesh(towerGeo, reflMat, N));
    reflTowers.instanceMatrix = towers.instanceMatrix;
    reflTowers.frustumCulled = false;
    reflScene.add(reflTowers);
    {
      // The island's waterline wall, so the reflections meet the shore without a gap.
      const wallMat = track(new THREE.ShaderMaterial({
        uniforms: { uColor: { value: board.side.color } },
        vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 uColor; void main(){ gl_FragColor = vec4(uColor * 0.8, 1.0); }',
      }));
      const wall = new THREE.Mesh(track(new THREE.BoxGeometry(landX1 - landX0, -WATER_Y, boardZ1 - boardZ0)), wallMat);
      wall.position.set((landX0 + landX1) / 2, WATER_Y / 2, (boardZ0 + boardZ1) / 2);
      reflScene.add(wall);
    }
    const reflBias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    const rLook = new THREE.Vector3();
    const rClear = new THREE.Color();
    function renderReflection() {
      const wu = waterMat.uniforms;
      if (!reflOn || !N || camera.position.y <= WATER_Y + 0.05) { wu.uReflAmt.value = 0; return; }
      if (!reflTowers.instanceColor && towers.instanceColor) reflTowers.instanceColor = towers.instanceColor;
      camera.updateMatrixWorld();
      // Mirror the camera across the water plane (the Reflector construction, without its oblique clip:
      // nothing in the reflection scene sits below the water except reef tiles, which the shader discards).
      reflCam.position.set(camera.position.x, 2 * WATER_Y - camera.position.y, camera.position.z);
      rLook.set(0, 0, -1).applyQuaternion(camera.quaternion).add(camera.position);
      rLook.y = 2 * WATER_Y - rLook.y;
      reflCam.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
      reflCam.up.y = -reflCam.up.y;
      reflCam.lookAt(rLook);
      reflCam.far = camera.far;
      reflCam.updateMatrixWorld();
      reflCam.projectionMatrix.copy(camera.projectionMatrix);
      reflCam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
      wu.uReflMat.value.copy(reflBias).multiply(reflCam.projectionMatrix).multiply(reflCam.matrixWorldInverse);
      wu.uReflAmt.value = reflAmt.value;
      const sm = renderer.shadowMap;
      const au = sm.autoUpdate;
      const nu = sm.needsUpdate;
      sm.autoUpdate = false;
      sm.needsUpdate = false;
      renderer.getClearColor(rClear);
      const ca = renderer.getClearAlpha();
      renderer.setRenderTarget(reflRT);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(reflScene, reflCam);
      renderer.setRenderTarget(null);
      renderer.setClearColor(rClear, ca);
      sm.autoUpdate = au;
      sm.needsUpdate = nu;
    }
    const reflAmt = { value: 0.4 };

    // ---------- glow textures ----------
    const canvasTex = (w, h, draw, srgb = true) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      draw(c.getContext('2d'), w, h);
      const t = track(new THREE.CanvasTexture(c));
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const radialTex = canvasTex(128, 128, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.25, 'rgba(255,255,255,.55)');
      gr.addColorStop(0.6, 'rgba(255,255,255,.12)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }, false);
    const glowMats = []; // materials whose blending depends on the theme
    const glowSprite = (tex, color, scale, opacity = 1) => {
      const m = themeBlend(track(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, fog: false, opacity })));
      glowMats.push(m);
      const s = new THREE.Sprite(m);
      s.scale.set(...scale);
      return s;
    };

    // ---------- peak flag ----------
    const peakIdx = model.peak && model.peak.count > 0 ? model.peak.idx : -1;
    const peakDay = peakIdx >= 0 ? days[peakIdx] : null;
    const flag = new THREE.Group();
    let flagCloth = null;
    let flagBase = null;
    const beaconMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
    let beaconGlow = null;
    let beaconRing = null;
    if (peakDay) {
      const flagTex = canvasTex(256, 160, (g, w, h) => {
        g.fillStyle = SH.nika_white;
        g.fillRect(0, 0, w, h);
        drawHatEmblem(g, w * 0.5, h * 0.55, 1.2);
        g.fillStyle = POWER.light[4];
        g.fillRect(0, 0, 10, h);
      });
      const poleH = 2.6;
      const pole = new THREE.Mesh(track(new THREE.CylinderGeometry(0.045, 0.06, poleH, 10)), withFog(track(new THREE.MeshStandardMaterial({ color: '#D9D2C2', roughness: 0.4, metalness: 0.5 })), 'std'));
      pole.position.y = poleH / 2;
      pole.castShadow = true;
      const clothGeo = track(new THREE.PlaneGeometry(1.7, 1.06, 24, 12));
      clothGeo.translate(0.85, 0, 0);
      flagBase = clothGeo.attributes.position.array.slice();
      flagCloth = new THREE.Mesh(clothGeo, withFog(track(new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 0.8 })), 'std'));
      flagCloth.position.set(0.04, poleH - 0.6, 0);
      const beacon = new THREE.Mesh(track(new THREE.SphereGeometry(0.13, 16, 12)), beaconMat);
      beacon.position.y = poleH + 0.08;
      beaconGlow = glowSprite(radialTex, 0xffffff, [2.4, 2.4]);
      beaconGlow.position.y = poleH + 0.08;
      // The beacon pulses: a ring of light spreads across the peak tower's roof.
      beaconRing = new THREE.Mesh(track(new THREE.RingGeometry(0.34, 0.42, 48)),
        themeBlend(track(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }))));
      beaconRing.rotation.x = -Math.PI / 2;
      beaconRing.position.y = 0.06;
      beaconRing.renderOrder = 3;
      flag.add(pole, flagCloth, beacon, beaconGlow, beaconRing);
      flag.position.set(xOf(peakDay.week), heightOf(peakDay), zOf(peakDay.weekday));
      flag.userData.s = 1.35;
      flag.scale.setScalar(flag.userData.s);
      scene.add(flag);
    }

    // ---------- ship + set sail marker ----------
    const ship = new THREE.Group(); // carries position and heading
    const shipBody = new THREE.Group(); // bobs and rocks
    ship.add(shipBody);
    const hasSea = coast > 0;
    const shoreX = landX0;
    const SHIP_SCALE = 2.2;
    let shipFlag = null;
    let shipFlagBase = null;
    let wake = null;
    let wakeMat = null;
    const mastMat = withFog(track(new THREE.MeshStandardMaterial({ color: '#5C3B1C', roughness: 0.7 })), 'std');
    {
      // Hull planks: two planks per texture tile, with seams, butt joints and grain.
      const plankTex = canvasTex(128, 128, (g, w, h) => {
        for (let k = 0; k < 2; k++) {
          const y0 = (k * h) / 2;
          g.fillStyle = k ? '#7C4F25' : '#94622F';
          g.fillRect(0, y0, w, h / 2);
          g.fillStyle = 'rgba(38,20,6,.65)';
          g.fillRect(0, y0, w, 3);
          g.fillStyle = 'rgba(255,226,180,.10)';
          g.fillRect(0, y0 + 3, w, 2);
          g.strokeStyle = 'rgba(38,20,6,.45)';
          g.lineWidth = 2;
          const sx = k ? w * 0.28 : w * 0.74;
          g.beginPath(); g.moveTo(sx, y0 + 3); g.lineTo(sx, y0 + h / 2); g.stroke();
          g.strokeStyle = 'rgba(38,20,6,.14)';
          g.lineWidth = 1;
          for (let i = 0; i < 5; i++) {
            const yy = y0 + 9 + i * 10;
            g.beginPath(); g.moveTo(0, yy); g.bezierCurveTo(w * 0.3, yy + 2, w * 0.6, yy - 2, w, yy); g.stroke();
          }
        }
      });
      plankTex.wrapS = plankTex.wrapT = THREE.RepeatWrapping;
      plankTex.repeat.set(0.9, 4.4);
      const hullShape = new THREE.Shape();
      hullShape.moveTo(-1.12, 0.5);
      hullShape.quadraticCurveTo(0.1, 0.34, 1.32, 0.64);
      hullShape.quadraticCurveTo(1.12, 0.0, 0.6, -0.25);
      hullShape.lineTo(-0.72, -0.25);
      hullShape.quadraticCurveTo(-1.1, -0.1, -1.12, 0.5);
      const BEAM = 0.84;
      const hullGeo = track(new THREE.ExtrudeGeometry(hullShape, { depth: BEAM, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.05, bevelSegments: 3, curveSegments: 18 }));
      hullGeo.translate(0, 0, -BEAM / 2);
      const hull = new THREE.Mesh(hullGeo, withFog(track(new THREE.MeshStandardMaterial({ map: plankTex, roughness: 0.8 })), 'std'));
      // keel stripe
      const keel = new THREE.Mesh(track(new THREE.BoxGeometry(1.5, 0.06, BEAM + 0.16)), withFog(track(new THREE.MeshStandardMaterial({ color: SH.straw_band, roughness: 0.6 })), 'std'));
      keel.position.set(-0.05, -0.08, 0);
      // deck outline (top view) and rail
      const deckPts = [];
      for (let i = 0; i <= 24; i++) {
        const u = i / 24;
        const x = -1.02 + u * 2.24;
        const w = (BEAM / 2) * Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, (x - 0.15) / 1.12), 2.2)));
        deckPts.push([x, Math.max(0.03, w)]);
      }
      const deckShape = new THREE.Shape();
      deckShape.moveTo(deckPts[0][0], -deckPts[0][1]);
      for (const [x, w] of deckPts) deckShape.lineTo(x, -w);
      for (let i = deckPts.length - 1; i >= 0; i--) deckShape.lineTo(deckPts[i][0], deckPts[i][1]);
      const deckGeo = track(new THREE.ShapeGeometry(deckShape));
      deckGeo.rotateX(-Math.PI / 2);
      const deck = new THREE.Mesh(deckGeo, withFog(track(new THREE.MeshStandardMaterial({ color: '#C99A62', roughness: 0.85, side: THREE.DoubleSide })), 'std'));
      deck.position.y = 0.44;
      const railCurve = new THREE.CatmullRomCurve3([
        ...deckPts.map(([x, w]) => new THREE.Vector3(x, 0, w)),
        ...deckPts.slice().reverse().map(([x, w]) => new THREE.Vector3(x, 0, -w)),
      ], true);
      const goldMat = withFog(track(new THREE.MeshStandardMaterial({ color: SH.straw, roughness: 0.5, metalness: 0.2 })), 'std');
      const rail = new THREE.Mesh(track(new THREE.TubeGeometry(railCurve, 80, 0.022, 6, true)), goldMat);
      rail.position.y = 0.62;
      const posts = track(new THREE.InstancedMesh(track(new THREE.CylinderGeometry(0.014, 0.014, 0.18, 5)), goldMat, 26));
      for (let i = 0; i < 26; i++) {
        const pt = railCurve.getPointAt(i / 26);
        dummy.position.set(pt.x, 0.53, pt.z);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        posts.setMatrixAt(i, dummy.matrix);
      }
      // stern cabin
      const cabin = new THREE.Mesh(track(new THREE.BoxGeometry(0.46, 0.3, 0.5)), withFog(track(new THREE.MeshStandardMaterial({ color: '#E7D3AE', roughness: 0.8 })), 'std'));
      cabin.position.set(-0.72, 0.6, 0);
      const roof = new THREE.Mesh(track(new THREE.BoxGeometry(0.54, 0.06, 0.58)), withFog(track(new THREE.MeshStandardMaterial({ color: SH.luffy_red, roughness: 0.6 })), 'std'));
      roof.position.set(-0.72, 0.78, 0);
      // mast, crow's nest, yards
      const mast = new THREE.Mesh(track(new THREE.CylinderGeometry(0.035, 0.05, 2.95, 10)), mastMat);
      mast.position.set(0.08, 1.9, 0);
      const nest = new THREE.Mesh(track(new THREE.CylinderGeometry(0.16, 0.13, 0.14, 14, 1, true)), withFog(track(new THREE.MeshStandardMaterial({ color: '#7A4E24', roughness: 0.8, side: THREE.DoubleSide })), 'std'));
      nest.position.set(0.08, 2.98, 0);
      const yardGeo = track(new THREE.CylinderGeometry(0.022, 0.022, 1.7, 8));
      yardGeo.rotateX(Math.PI / 2);
      const yard = new THREE.Mesh(yardGeo, mastMat);
      yard.position.set(0.12, 2.62, 0);
      const yard2 = yard.clone();
      yard2.position.y = 1.1;
      // main sail: hat emblem with red bands
      const sailTex = canvasTex(256, 256, (g, w, h) => {
        g.fillStyle = SH.nika_white;
        g.fillRect(0, 0, w, h);
        g.strokeStyle = 'rgba(27,27,31,.07)';
        g.lineWidth = 3;
        for (let x = 32; x < w; x += 42) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
        g.fillStyle = SH.straw_band;
        g.fillRect(0, 10, w, 18);
        g.fillRect(0, h - 28, w, 18);
        drawHatEmblem(g, w * 0.5, h * 0.54, 1.25);
      });
      const sailGeo = track(new THREE.PlaneGeometry(1.55, 1.42, 12, 8));
      const sp = sailGeo.attributes.position;
      for (let i = 0; i < sp.count; i++) {
        const x = sp.getX(i);
        const y = sp.getY(i);
        sp.setZ(i, 0.24 * (1 - (x / 0.775) ** 2) * (1 - 0.35 * (y / 0.71) ** 2));
      }
      sailGeo.computeVertexNormals();
      const sail = new THREE.Mesh(sailGeo, withFog(track(new THREE.MeshStandardMaterial({ map: sailTex, side: THREE.DoubleSide, roughness: 0.85 })), 'std'));
      sail.rotation.y = Math.PI / 2;
      sail.position.set(0.16, 1.86, 0);
      // flag at the masthead
      const flagTex2 = canvasTex(128, 80, (g, w, h) => {
        g.fillStyle = SH.luffy_red;
        g.fillRect(0, 0, w, h);
        drawHatEmblem(g, w * 0.5, h * 0.56, 0.42);
      });
      const sfGeo = track(new THREE.PlaneGeometry(0.62, 0.38, 12, 4));
      sfGeo.translate(0.31, 0, 0);
      shipFlagBase = sfGeo.attributes.position.array.slice();
      shipFlag = new THREE.Mesh(sfGeo, withFog(track(new THREE.MeshStandardMaterial({ map: flagTex2, side: THREE.DoubleSide, roughness: 0.8 })), 'std'));
      shipFlag.position.set(0.1, 3.25, 0);
      shipFlag.rotation.y = Math.PI; // streams aft
      // bowsprit, jib and a small sun figurehead
      const spritGeo = track(new THREE.CylinderGeometry(0.02, 0.03, 0.9, 6));
      spritGeo.rotateZ(-Math.PI / 2.6);
      const sprit = new THREE.Mesh(spritGeo, mastMat);
      sprit.position.set(1.55, 0.78, 0);
      const jibShape = new THREE.Shape();
      jibShape.moveTo(0, 0);
      jibShape.lineTo(1.25, -0.02);
      jibShape.lineTo(0, 1.55);
      const jib = new THREE.Mesh(track(new THREE.ShapeGeometry(jibShape)), withFog(track(new THREE.MeshStandardMaterial({ color: SH.cream, side: THREE.DoubleSide, roughness: 0.9 })), 'std'));
      jib.position.set(0.18, 0.78, 0);
      const figure = new THREE.Mesh(track(new THREE.IcosahedronGeometry(0.11, 1)), withFog(track(new THREE.MeshStandardMaterial({ color: SH.sun_gold, roughness: 0.35, metalness: 0.4 })), 'std'));
      figure.position.set(1.36, 0.66, 0);
      // rigging
      const rigPts = [
        [0.08, 3.3, 0, 1.95, 0.95, 0], [0.08, 3.3, 0, -1.05, 0.62, 0],
        [0.08, 2.9, 0, 0.0, 0.62, BEAM / 2], [0.08, 2.9, 0, 0.0, 0.62, -BEAM / 2],
        [0.08, 2.9, 0, 0.35, 0.62, BEAM / 2 - 0.04], [0.08, 2.9, 0, 0.35, 0.62, -BEAM / 2 + 0.04],
      ].flat();
      const rigGeo = track(new THREE.BufferGeometry());
      rigGeo.setAttribute('position', new THREE.Float32BufferAttribute(rigPts, 3));
      const rigging = new THREE.LineSegments(rigGeo, track(new THREE.LineBasicMaterial({ color: '#3B2A1A', transparent: true, opacity: 0.7, fog: false })));
      shipBody.add(hull, keel, deck, rail, posts, cabin, roof, mast, nest, yard, yard2, sail, shipFlag, sprit, jib, figure, rigging);
      shipBody.scale.setScalar(SHIP_SCALE);
      scene.add(ship);

      // Foam wake: a V of churned water trailing the stern, displaced by the same swells as the sea.
      const WAKE_L = 18;
      const wakeGeo = track(new THREE.PlaneGeometry(WAKE_L, 8, 72, 16));
      wakeGeo.translate(-WAKE_L / 2 - 1.05 * SHIP_SCALE, 0, 0);
      wakeGeo.rotateX(-Math.PI / 2);
      wakeMat = track(new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color() }, uOpacity: { value: 0.8 } },
        vertexShader: /* glsl */`
          uniform float uTime; varying vec2 vUv;
          const vec2 D0 = vec2(${W_D[0].join(',')}); const vec2 D1 = vec2(${W_D[1].join(',')});
          void main(){
            vUv = uv;
            vec4 w = modelMatrix * vec4(position, 1.0);
            w.y += ${W_AMP[0]} * sin(dot(D0, w.xz) * ${W_K[0]} + uTime * ${W_S[0].toFixed(2)})
                 + ${W_AMP[1]} * sin(dot(D1, w.xz) * ${W_K[1]} + uTime * ${W_S[1].toFixed(2)}) + 0.035;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */`
          uniform float uTime; uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv;
          float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
          void main(){
            float s = 1.0 - vUv.x;                 // 0 at the stern
            float y = vUv.y - 0.5;
            float hw = 0.035 + 0.43 * s;
            float arms = 1.0 - smoothstep(0.0, 0.06 + 0.04 * s, abs(abs(y) - hw));
            float centre = (1.0 - smoothstep(0.0, 0.07 + 0.08 * s, abs(y))) * (1.0 - s * 0.8);
            float n = noise(vec2(s * 30.0 + uTime * 1.4, y * 22.0)) * 0.6 + noise(vec2(s * 70.0 + uTime * 2.6, y * 50.0)) * 0.4;
            float a = clamp(arms * 0.9 + centre, 0.0, 1.0) * smoothstep(0.28, 0.8, n) * pow(clamp(1.0 - s, 0.0, 1.0), 1.6) * smoothstep(0.0, 0.02, s);
            gl_FragColor = vec4(uColor, clamp(a * uOpacity, 0.0, 1.0));
            #include <colorspace_fragment>
          }`,
      }));
      wake = new THREE.Mesh(wakeGeo, wakeMat);
      wake.frustumCulled = false;
      wake.visible = hasSea;
      scene.add(wake);
    }

    // Set sail marker: a post with a lantern at the shore.
    let markerU = null;
    if (hasSea && model.joined) {
      const marker = new THREE.Group();
      const post = new THREE.Mesh(track(new THREE.CylinderGeometry(0.07, 0.09, 1.7, 8)), mastMat);
      post.position.y = 0.85;
      post.castShadow = true;
      const plank = new THREE.Mesh(track(new THREE.BoxGeometry(0.9, 0.34, 0.06)), withFog(track(new THREE.MeshStandardMaterial({ color: SH.straw, roughness: 0.7 })), 'std'));
      plank.position.set(-0.32, 1.35, 0);
      plank.castShadow = true;
      const lanternMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
      const lantern = new THREE.Mesh(track(new THREE.SphereGeometry(0.11, 12, 10)), lanternMat);
      lantern.position.y = 1.78;
      const lanternGlow = glowSprite(radialTex, 0xffffff, [1.6, 1.6]);
      lanternGlow.position.y = 1.78;
      marker.add(post, plank, lantern, lanternGlow);
      marker.position.set(shoreX + 0.25, 0, boardZ1 - 0.3);
      scene.add(marker);
      markerU = { marker, lanternMat, lanternGlow };
    }

    // ---------- sky bodies: a white-hot sun (left) and a red moon (right) ----------
    const sun = new THREE.Group();
    const sunCoreTex = canvasTex(256, 256, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.55, 'rgba(255,252,240,1)');
      gr.addColorStop(0.82, 'rgba(255,236,170,1)');
      gr.addColorStop(0.93, 'rgba(255,214,90,.9)');
      gr.addColorStop(1, 'rgba(255,200,60,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    });
    const sunCoreMat = track(new THREE.MeshBasicMaterial({ map: sunCoreTex, color: 0xffffff, fog: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    const sunCore = new THREE.Mesh(track(new THREE.PlaneGeometry(2.1, 2.1)), sunCoreMat);
    sunCore.renderOrder = 6;
    // Corona: noisy streamers in a shader, layered over soft glow sprites.
    const coronaMat = themeBlend(track(new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uInner: { value: new THREE.Color() }, uOuter: { value: new THREE.Color() }, uOpacity: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */`
        uniform float uTime; uniform vec3 uInner; uniform vec3 uOuter; uniform float uOpacity; uniform float uNormalMix; varying vec2 vUv;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
        void main(){
          vec2 p = (vUv * 2.0 - 1.0) * 7.0;          // in sun radii
          float r = length(p);
          vec2 dir = p / max(r, 1e-3);
          float streak = noise(dir * 5.0 + vec2(uTime * 0.05, -uTime * 0.04)) * 0.65
                       + noise(dir * 13.0 + vec2(-uTime * 0.09, uTime * 0.07) + r * 0.08) * 0.35;
          float fall = pow(max(r, 0.9), -2.1);
          float rim = 1.0 - smoothstep(4.8, 7.0, r);
          vec3 col = mix(uInner, uOuter, smoothstep(1.0, 4.0, r));
          float a = fall * (0.45 + 1.1 * streak * streak) * rim * uOpacity;
          gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
          #include <colorspace_fragment>
          ${PREMUL_OUT}
        }`,
    })));
    const corona = new THREE.Mesh(track(new THREE.PlaneGeometry(14, 14)), coronaMat);
    corona.renderOrder = 4;
    const sunLayer = (scale, order) => {
      const m = themeBlend(track(new THREE.SpriteMaterial({ map: radialTex, color: 0xffffff, transparent: true, depthWrite: false, fog: false })));
      const sp2 = new THREE.Sprite(m);
      sp2.scale.set(scale, scale, 1);
      sp2.renderOrder = order;
      return sp2;
    };
    const sunHaze = sunLayer(15, 1);
    const sunHalo = sunLayer(7, 3);
    const sunInner = sunLayer(3.4, 5);
    const pulses = [];
    for (let i = 0; i < 3; i++) {
      const pm = track(new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      const p = new THREE.Mesh(track(new THREE.RingGeometry(1, 1.035, 72)), pm);
      p.userData.phase = i / 3;
      p.renderOrder = 2;
      pulses.push(p);
    }
    sun.add(sunHaze, corona, sunHalo, sunInner, sunCore, ...pulses);
    scene.add(sun);

    // Warm light spilling from the sun side onto the nearest towers.
    const warmLight = new THREE.PointLight(0xffffff, 0, 34, 1);
    warmLight.position.set(landX0 + 1.5, 6.5, boardZ1 + 3);
    scene.add(warmLight);

    const moon = new THREE.Group();
    const moonCoreMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true }));
    const moonCore = new THREE.Mesh(track(new THREE.CircleGeometry(1, 48)), moonCoreMat);
    moonCoreMat.map = canvasTex(256, 256, (g, w, h) => {
      const gr = g.createRadialGradient(w * 0.42, h * 0.4, 4, w / 2, h / 2, w / 2);
      gr.addColorStop(0, '#FFFFFF');
      gr.addColorStop(0.7, '#E9E3E3');
      gr.addColorStop(1, '#B9AFAF');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      // soft maria (procedural, deterministic)
      const spots = [[0.34, 0.4, 0.17], [0.27, 0.62, 0.07], [0.7, 0.66, 0.09], [0.62, 0.8, 0.045]];
      for (const [x, y, r] of spots) {
        g.fillStyle = 'rgba(90,60,60,.16)';
        g.beginPath();
        g.arc(x * w, y * h, r * w, 0, Math.PI * 2);
        g.fill();
      }
    });
    const moonHalo = glowSprite(radialTex, 0xffffff, [6.5, 6.5], 0.9);
    const ripples = [];
    for (let i = 0; i < 4; i++) {
      const rm = track(new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      const r = new THREE.Mesh(track(new THREE.RingGeometry(1.35 + i * 0.42, 1.39 + i * 0.42, 72)), rm);
      r.position.z = -0.01;
      ripples.push(r);
    }
    moon.add(moonHalo, ...ripples, moonCore);
    scene.add(moon);

    // Red clouds drifting near the moon.
    const cloudTex = canvasTex(256, 128, (g, w, h) => drawCloud(g, w / 2, h / 2 + 6, 1.55, AK.cloud_red, AK.cloud_edge));
    const clouds = [];
    for (let i = 0; i < 3; i++) {
      // Slightly below white so the outlines stay under the bloom threshold.
      const m = track(new THREE.SpriteMaterial({ map: cloudTex, color: 0xe6e6e6, transparent: true, depthWrite: false, fog: false }));
      const s = new THREE.Sprite(m);
      s.userData = { phase: i * 2.1, scale: 1 - i * 0.18 };
      clouds.push(s);
      scene.add(s);
    }

    // The distant city: storeys of glass panes, a few lit (sunlit by day, lamplit by night), shaded
    // darker at street level and hazed into the sky with distance (atmospheric perspective).
    const cityU = {
      uCity: { value: new THREE.Color() }, uPane: { value: new THREE.Color() }, uPaneAmt: { value: 0.4 },
      uLit: { value: new THREE.Color() }, uLitFrac: { value: 0.1 }, uHaze: { value: 0.4 },
    };
    const skylineMat = track(new THREE.ShaderMaterial({
      fog: true,
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...fogU, ...cityU },
      vertexShader: /* glsl */`
        attribute vec3 aCity; varying vec3 vCity; varying vec3 vLoc; varying vec3 vN; varying float vH;
        #include <fog_pars_vertex>
        void main(){
          vec3 tS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vCity = aCity; vLoc = position * tS; vN = normal; vH = tS.y;
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uCity; uniform vec3 uPane; uniform float uPaneAmt; uniform vec3 uLit; uniform float uLitFrac; uniform float uHaze;
        uniform vec3 uSkyL; uniform vec3 uSkyR; uniform vec2 uFogRes;
        varying vec3 vCity; varying vec3 vLoc; varying vec3 vN; varying float vH;
        #include <fog_pars_fragment>
        float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        void main(){
          vec3 col = uCity * mix(0.74, 1.06, smoothstep(0.0, 1.0, vLoc.y / max(vH, 0.01)));
          col *= vN.y > 0.5 ? 1.12 : (abs(vN.x) > 0.5 ? 0.84 : 1.0);
          if (abs(vN.y) < 0.5 && vCity.z < 0.5) {
            float u = abs(vN.x) > 0.5 ? vLoc.z : vLoc.x;
            vec2 cell = vec2(u / 0.36, vLoc.y / 0.46);
            vec2 f = fract(cell);
            float inW = step(0.22, f.x) * step(f.x, 0.78) * step(0.3, f.y) * step(f.y, 0.74) * step(0.5, vLoc.y) * step(vLoc.y, vH - 0.3);
            float lit = step(hash(vec3(floor(cell), vCity.y * 91.0 + vN.x * 7.0 + vN.z * 3.0)), uLitFrac);
            col = mix(col, uPane, inW * uPaneAmt * (1.0 - lit));
            col = mix(col, uLit, inW * lit);
          }
          float fogX = smoothstep(0.12, 0.88, gl_FragCoord.x / max(uFogRes.x, 1.0));
          vec3 skyC = mix(uSkyL, uSkyR, fogX);
          col = mix(col, skyC, uHaze * (0.2 + 0.6 * vCity.x) * (1.0 - 0.15 * smoothstep(0.0, 1.0, vLoc.y / 8.0)));
          gl_FragColor = vec4(col, 1.0);
          #ifdef USE_FOG
            float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
            gl_FragColor.rgb = mix( gl_FragColor.rgb, skyC, fogFactor );
          #endif
          #include <colorspace_fragment>
        }`,
    }));
    {
      const cityGeo = track(new THREE.BoxGeometry(1, 1, 1));
      cityGeo.translate(0, 0.5, 0);
      const COUNT = 64;
      const cityAttr = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3);
      cityGeo.setAttribute('aCity', cityAttr);
      const city = track(new THREE.InstancedMesh(cityGeo, skylineMat, COUNT));
      let seed = 7;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const sx0 = landX0 + (landX1 - landX0) * 0.12;
      const sx1 = landX1 + 16;
      const SPIRES = 5;
      for (let i = 0; i < COUNT - SPIRES; i++) {
        const spire = i >= COUNT - SPIRES * 2;
        const row = rnd();
        const bx = sx0 + Math.pow(rnd(), 0.8) * (sx1 - sx0);
        const bz = boardZ0 - 13 - row * 18;
        const bh = spire ? 5 + rnd() * 3.5 : 1.2 + rnd() * rnd() * 4.5 + row * 1.6;
        dummy.position.set(bx, WATER_Y - 0.15, bz);
        if (spire) dummy.scale.set(0.9 + rnd() * 0.6, bh, 0.9 + rnd() * 0.6);
        else dummy.scale.set(1.1 + rnd() * 2.2, bh, 1 + rnd() * 1.8);
        dummy.updateMatrix();
        city.setMatrixAt(i, dummy.matrix);
        cityAttr.setXYZ(i, row, rnd(), 0);
        if (spire) {
          const k = i + SPIRES;
          dummy.position.y += bh;
          dummy.scale.set(0.1, 1.2 + rnd() * 1.2, 0.1);
          dummy.updateMatrix();
          city.setMatrixAt(k, dummy.matrix);
          cityAttr.setXYZ(k, row, 0, 1);
        }
      }
      city.instanceMatrix.needsUpdate = true;
      scene.add(city);
    }
    const cityGlow = glowSprite(radialTex, 0xffffff, [40, 12], 0.5);
    cityGlow.position.set(landX1 - 2, 3.4, boardZ0 - 26);
    scene.add(cityGlow);

    const lampMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
    const lampGlow = glowSprite(radialTex, 0xffffff, [5, 5], 0.9);
    const rockMat = withFog(track(new THREE.MeshStandardMaterial({ roughness: 1 })), 'std');
    const lighthouse = new THREE.Group();
    {
      const rock = new THREE.Mesh(track(new THREE.DodecahedronGeometry(1.4, 0)), rockMat);
      rock.scale.set(1.4, 0.6, 1.2);
      rock.position.y = WATER_Y - 0.35;
      const towerW = new THREE.Mesh(track(new THREE.CylinderGeometry(0.42, 0.62, 3.4, 12)), withFog(track(new THREE.MeshStandardMaterial({ color: SH.nika_white, roughness: 0.7 })), 'std'));
      towerW.position.y = WATER_Y + 1.5;
      const band = new THREE.Mesh(track(new THREE.CylinderGeometry(0.5, 0.55, 0.5, 12)), withFog(track(new THREE.MeshStandardMaterial({ color: SH.straw_band, roughness: 0.7 })), 'std'));
      band.position.y = WATER_Y + 2.4;
      const cap = new THREE.Mesh(track(new THREE.ConeGeometry(0.6, 0.7, 12)), withFog(track(new THREE.MeshStandardMaterial({ color: '#2B2B30', roughness: 0.6 })), 'std'));
      cap.position.y = WATER_Y + 3.6;
      const lamp = new THREE.Mesh(track(new THREE.SphereGeometry(0.24, 12, 10)), lampMat);
      lamp.position.y = WATER_Y + 3.2;
      lampGlow.position.y = WATER_Y + 3.2;
      lighthouse.add(rock, towerW, band, cap, lamp, lampGlow);
      lighthouse.position.set(landX0 - 15, 0, -11);
      scene.add(lighthouse);
    }
    // The lamp's sweeping beam: an open cone, brightest at the lamp, soft at its edges.
    const lhBeamU = { uColor: { value: new THREE.Color() }, uAmt: { value: 0.3 } };
    const lhBeamMat = themeBlend(track(new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: lhBeamU,
      vertexShader: /* glsl */`
        varying float vAlong; varying vec3 vNv; varying vec3 vVp;
        void main(){
          vAlong = position.x / 26.0;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vVp = mv.xyz; vNv = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform float uAmt; uniform float uNormalMix;
        varying float vAlong; varying vec3 vNv; varying vec3 vVp;
        void main(){
          float rim = abs(dot(normalize(vNv), normalize(-vVp)));
          float a = pow(1.0 - clamp(vAlong, 0.0, 1.0), 1.7) * smoothstep(0.0, 0.04, vAlong) * pow(rim, 1.6) * uAmt;
          gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));
          #include <colorspace_fragment>
          ${PREMUL_OUT}
        }`,
    })));
    const lhBeamGeo = track(new THREE.ConeGeometry(2.4, 26, 28, 1, true));
    lhBeamGeo.translate(0, -13, 0);
    lhBeamGeo.rotateZ(Math.PI / 2);
    const lhBeam = new THREE.Group();
    const lhBeamMesh = new THREE.Mesh(lhBeamGeo, lhBeamMat);
    lhBeamMesh.rotation.z = -0.06;
    lhBeamMesh.renderOrder = 2;
    lhBeam.add(lhBeamMesh);
    lhBeam.position.y = WATER_Y + 3.2;
    lighthouse.add(lhBeam);
    const BEAM_REST = -0.55; // a still frame points the beam across the harbour toward the viewer's right

    // ---------- a small flock of crows on a looped path over the harbour ----------
    const BIRDS = 7;
    const birdU = { uColor: { value: new THREE.Color() }, uTime: { value: 0 } };
    const birdGeo = track(new THREE.BufferGeometry());
    {
      // One bird facing +x: a slim body and two wings whose tips (aTip = 1) flap in the shader.
      const P = [
        0.32, 0, 0, -0.22, 0.02, 0.07, -0.22, 0.02, -0.07,
        0.12, 0, 0.02, -0.12, 0, 0.04, -0.06, 0.06, 0.62,
        0.12, 0, -0.02, -0.12, 0, -0.04, -0.06, 0.06, -0.62,
      ];
      const T = [0, 0, 0, 0, 0, 1, 0, 0, 1];
      birdGeo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      birdGeo.setAttribute('aTip', new THREE.Float32BufferAttribute(T, 1));
      const ph = new THREE.InstancedBufferAttribute(new Float32Array(BIRDS), 1);
      for (let i = 0; i < BIRDS; i++) ph.setX(i, i * 1.7);
      birdGeo.setAttribute('aPhase', ph);
    }
    const birdMat = track(new THREE.ShaderMaterial({
      side: THREE.DoubleSide, transparent: true, depthWrite: false,
      uniforms: birdU,
      vertexShader: /* glsl */`
        attribute float aTip; attribute float aPhase; uniform float uTime;
        void main(){
          vec3 p = position;
          float flap = sin(uTime * 7.5 + aPhase);
          p.y += aTip * (0.28 * flap + 0.1);
          p.z *= 1.0 - aTip * 0.12 * (flap * 0.5 + 0.5);
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `uniform vec3 uColor; void main(){ gl_FragColor = vec4(uColor, 0.92);
        #include <colorspace_fragment>
        }`,
    }));
    const birds = track(new THREE.InstancedMesh(birdGeo, birdMat, BIRDS));
    birds.frustumCulled = false;
    birds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(birds);
    const birdPath = { cx: 0, cy: 9, cz: -8, rx: 9, rz: 5 };
    const birdQ = new THREE.Quaternion();
    const birdE = new THREE.Euler();
    function placeBirds(time) {
      const { cx, cy, cz, rx, rz } = birdPath;
      for (let i = 0; i < BIRDS; i++) {
        // A loose skein: each bird trails the leader around a tilted figure-of-eight.
        const th = time * 0.16 - i * 0.16;
        const jx = Math.sin(i * 2.3) * 0.7;
        const jy = Math.sin(i * 1.7) * 0.5;
        const x = cx + rx * Math.cos(th) + jx;
        const z = cz + rz * Math.sin(2 * th) * 0.5 + Math.cos(i * 3.1) * 0.6;
        const y = cy + Math.sin(th * 1.3) * 0.8 + jy;
        const vx = -rx * Math.sin(th);
        const vz = rz * Math.cos(2 * th);
        const yaw = Math.atan2(-vz, vx);
        birdE.set(Math.cos(2 * th) * 0.25, yaw, 0, 'YXZ');
        birdQ.setFromEuler(birdE);
        dummy.position.set(x, y, z);
        dummy.quaternion.copy(birdQ);
        dummy.scale.setScalar(0.85 + (i % 3) * 0.1);
        dummy.updateMatrix();
        birds.setMatrixAt(i, dummy.matrix);
      }
      dummy.quaternion.identity();
      birds.instanceMatrix.needsUpdate = true;
    }

    // ---------- particles: the weather reads the data ----------
    // Embers rise from the ten busiest days; rain falls over the year's quiet weeks (the quieter, the heavier).
    let pSeed = 11;
    const prnd = () => { pSeed = (pSeed * 16807) % 2147483647; return pSeed / 2147483647; };
    const topIdx = days.filter((d) => model.topDates && model.topDates.has(d.date) && !d.sea && d.count > 0).map((d) => d.idx);
    const PER_TOP = 26;
    const EMBERS = topIdx.length * PER_TOP;
    const emberGeo = track(new THREE.BufferGeometry());
    const eSeed = new Float32Array(EMBERS * 4);
    const eBase = new Float32Array(EMBERS * 2);
    topIdx.forEach((idx, k) => {
      const d = days[idx];
      for (let j = 0; j < PER_TOP; j++) {
        const i = k * PER_TOP + j;
        eSeed.set([xOf(d.week) + (prnd() - 0.5) * 0.9, zOf(d.weekday) + (prnd() - 0.5) * 0.9, prnd(), 0.45 + prnd() * 0.75], i * 4);
        eBase.set([heightOf(d), idx], i * 2);
      }
    });
    emberGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(EMBERS * 3), 3));
    emberGeo.setAttribute('aSeed', new THREE.BufferAttribute(eSeed, 4));
    emberGeo.setAttribute('aBase', new THREE.BufferAttribute(eBase, 2));
    const emberMat = themeBlend(track(new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uPR: { value: 1 }, uColA: { value: new THREE.Color() }, uColB: { value: new THREE.Color() }, uOpacity: { value: 1 }, uReplay: { value: N } },
      vertexShader: `attribute vec4 aSeed; attribute vec2 aBase; uniform float uTime; uniform float uPR; uniform float uReplay; varying float vA; varying float vMix;
        void main(){
          float H = 6.5;
          float y = mod(aSeed.z * H + uTime * aSeed.w, H);
          vec3 p = vec3(aSeed.x + sin(uTime * 0.8 + aSeed.z * 31.0) * 0.35 * (0.3 + y / H), aBase.x + 0.15 + y, aSeed.y + cos(uTime * 0.6 + aSeed.z * 17.0) * 0.25 * (0.3 + y / H));
          vA = smoothstep(0.0, 0.5, y) * (1.0 - smoothstep(H * 0.4, H, y)) * (0.6 + 0.4 * sin(uTime * 6.0 + aSeed.z * 50.0)) * step(aBase.y, uReplay);
          vMix = fract(aSeed.z * 13.7);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp((2.2 + 2.6 * fract(aSeed.z * 7.3)) * uPR * (36.0 / max(-mv.z, 1.0)), 0.0, 48.0 * uPR);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform vec3 uColA; uniform vec3 uColB; uniform float uOpacity; uniform float uNormalMix; varying float vA; varying float vMix;
        void main(){ float d = length(gl_PointCoord - 0.5); float a = 1.0 - smoothstep(0.05, 0.5, d);
          gl_FragColor = vec4(mix(uColA, uColB, vMix), clamp(a * vA * uOpacity, 0.0, 1.0));
          #include <colorspace_fragment>
          ${PREMUL_OUT} }`,
    })));
    const embers = new THREE.Points(emberGeo, emberMat);
    embers.frustumCulled = false;
    scene.add(embers);

    const weekTotals = Array.isArray(model.weekTotals) ? model.weekTotals : [];
    const landWeeks = [];
    for (let w = landStartW; w < nWeeks; w++) if ((model.weeks?.[w] || []).some((d) => !d.sea)) landWeeks.push(w);
    const maxWeek = Math.max(1, ...landWeeks.map((w) => weekTotals[w] || 0));
    const DROPS_PER_WEEK = 30;
    const rainWeeks = [];
    for (const w of landWeeks) {
      const quiet = 1 - (weekTotals[w] || 0) / maxWeek;
      const n = Math.round(DROPS_PER_WEEK * quiet * quiet);
      for (let j = 0; j < n; j++) rainWeeks.push(w);
    }
    const DROPS = rainWeeks.length;
    const rainGeo = track(new THREE.BufferGeometry());
    const rSeed = new Float32Array(DROPS * 2 * 4);
    const rEnd = new Float32Array(DROPS * 2);
    const rWeek = new Float32Array(DROPS * 2);
    rainWeeks.forEach((w, i) => {
      const sd = [xOf(w) + (prnd() - 0.5) * 1.3 + 2.4, boardZ0 - 5 + prnd() * (boardZ1 - boardZ0 + 9), prnd(), 9 + prnd() * 5];
      rSeed.set(sd, i * 8);
      rSeed.set(sd, i * 8 + 4);
      rEnd[i * 2] = 0;
      rEnd[i * 2 + 1] = 1;
      rWeek[i * 2] = rWeek[i * 2 + 1] = w;
    });
    rainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DROPS * 2 * 3), 3));
    rainGeo.setAttribute('aSeed', new THREE.BufferAttribute(rSeed, 4));
    rainGeo.setAttribute('aEnd', new THREE.BufferAttribute(rEnd, 1));
    rainGeo.setAttribute('aWeek', new THREE.BufferAttribute(rWeek, 1));
    const rainMat = track(new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color() }, uOpacity: { value: 0.4 }, uReplayW: { value: nWeeks } },
      vertexShader: `attribute vec4 aSeed; attribute float aEnd; attribute float aWeek; uniform float uTime; uniform float uReplayW; varying float vA;
        void main(){
          float H = 15.0;
          float y = H - mod(aSeed.z * H + uTime * aSeed.w, H);
          vec3 dir = normalize(vec3(-0.22, -1.0, 0.05));
          vec3 p = vec3(aSeed.x - (H - y) * 0.22, y, aSeed.y);
          p -= dir * aEnd * 0.75;
          vA = smoothstep(0.0, 1.2, y) * (1.0 - smoothstep(H - 2.5, H, y)) * step(aWeek, uReplayW);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vA; void main(){ gl_FragColor = vec4(uColor, clamp(uOpacity * vA, 0.0, 1.0));
        #include <colorspace_fragment>
        }`,
    }));
    const rain = new THREE.LineSegments(rainGeo, rainMat);
    rain.frustumCulled = false;
    scene.add(rain);

    // ---------- post-processing ----------
    const rt = track(new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType,
      samples: renderer.capabilities.isWebGL2 ? 4 : 0,
    }));
    const composer = track(new EffectComposer(renderer, rt));
    track(composer.renderTarget1);
    track(composer.renderTarget2);
    composer.addPass(track(new RenderPass(scene, camera)));
    const bloom = track(new UnrealBloomPass(new THREE.Vector2(2, 2), 0.8, 0.32, 1.0));
    composer.addPass(bloom);
    composer.addPass(track(new OutputPass()));

    // ---------- camera + controls ----------
    const controls = track(new OrbitControls(camera, canvas));
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.6;
    controls.zoomSpeed = 0.8;
    controls.screenSpacePanning = true;
    const BASE_MIN_POLAR = THREE.MathUtils.degToRad(22);
    controls.minPolarAngle = BASE_MIN_POLAR;
    controls.maxPolarAngle = THREE.MathUtils.degToRad(84);
    controls.minAzimuthAngle = THREE.MathUtils.degToRad(-62);
    controls.maxAzimuthAngle = THREE.MathUtils.degToRad(62);
    controls.minDistance = 10;

    controls.enabled = interactive;
    canvas.style.pointerEvents = interactive ? 'auto' : 'none';

    const target0 = new THREE.Vector3(0, 1.6, 0.4);
    let dist0 = 50;
    let elev = ELEV;
    let narrow = false;
    let interacted = false;
    let camAnim = null;
    let cinT = 0;
    const CIN0 = -2;
    const MAP_FOV = 24;
    const lens = { fov: 46, shift: LENS_SHIFT };
    const frontLens = { fov: 46, shift: LENS_SHIFT };
    let seaW = 8;
    const defaultCamPos = () => new THREE.Vector3(target0.x, target0.y + Math.sin(elev) * dist0, target0.z + Math.cos(elev) * dist0);
    const cinPose = (s) => {
      const az = Math.sin(s * 0.6) * 0.55;
      const el = THREE.MathUtils.degToRad(24) + Math.sin(s * 0.43 + 1.2) * THREE.MathUtils.degToRad(10);
      const r = dist0 * (1.02 + 0.08 * Math.sin(s * 0.37));
      const pan = Math.sin(s * 0.23) * Math.min(6, (landX1 - landX0) * 0.15);
      return {
        pos: new THREE.Vector3(
          target0.x + pan + Math.sin(az) * Math.cos(el) * r,
          target0.y + Math.sin(el) * r,
          target0.z + Math.cos(az) * Math.cos(el) * r),
        tgt: new THREE.Vector3(target0.x + pan, 1.8 + Math.sin(s * 0.31) * 0.6, 0),
        ...frontLens,
      };
    };
    const mapPose = () => {
      const cx = (reefX0 + landX1) / 2;
      const cz = (boardZ0 + boardZ1) / 2 + 0.7;
      const hx = (landX1 - reefX0) / 2 + (narrow ? 0.6 : 1.6);
      const hz = (boardZ1 - boardZ0) / 2 + 2.2;
      const tanV = Math.tan(THREE.MathUtils.degToRad(MAP_FOV / 2));
      const tanH = tanV * (W / H);
      const d = Math.max(hx / Math.max(tanH, 0.01), hz / tanV) + 1;
      return { pos: new THREE.Vector3(cx, Math.max(d, 14), cz + 0.01), tgt: new THREE.Vector3(cx, 0, cz), fov: MAP_FOV, shift: 0 };
    };
    const isoPose = () => {
      const r = dist0 * (narrow ? 1.3 : 1.2);
      const tgt = new THREE.Vector3((landX0 + landX1) / 2 - seaW * 0.12, target0.y + 0.6, target0.z - 0.4);
      return {
        pos: new THREE.Vector3(
          tgt.x + Math.sin(ISO_AZ) * Math.cos(ISO_EL) * r,
          tgt.y + Math.sin(ISO_EL) * r,
          tgt.z + Math.cos(ISO_AZ) * Math.cos(ISO_EL) * r),
        tgt,
        fov: frontLens.fov,
        shift: 0.08,
      };
    };
    const presetPose = (name) => {
      if (name === 'map') return mapPose();
      if (name === 'isometric') return isoPose();
      if (name === 'cinematic') return cinPose(CIN0 + cinT * 0.14);
      return { pos: defaultCamPos(), tgt: target0.clone(), ...frontLens };
    };
    // Arrival start: low over the open water left of the island, the ship and lighthouse in the
    // foreground and the city of days rising across the harbour.
    const arrivalPose = () => {
      const tgt = new THREE.Vector3(landX0 + (landX1 - landX0) * (narrow ? 0.14 : 0.1), narrow ? 3 : 2.4, boardZ0 + 0.5);
      const pos = new THREE.Vector3(landX0 - seaW - (narrow ? 9 : 14), narrow ? 4.6 : 3.4, boardZ1 + (narrow ? 25 : 16));
      return { pos, tgt, fov: frontLens.fov, shift: 0.12 };
    };
    // A framing for a run of days: slightly from the left and above, wide enough for some context.
    const rangePose = (i0, i1) => {
      let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity; let hMax = 0;
      for (let i = Math.max(0, i0); i <= Math.min(N - 1, i1); i++) {
        const d = days[i];
        x0 = Math.min(x0, xOf(d.week) - CELL / 2);
        x1 = Math.max(x1, xOf(d.week) + CELL / 2);
        z0 = Math.min(z0, zOf(d.weekday) - CELL / 2);
        z1 = Math.max(z1, zOf(d.weekday) + CELL / 2);
        hMax = Math.max(hMax, heightOf(d));
      }
      if (!Number.isFinite(x0)) return presetPose('front');
      const fov = frontLens.fov;
      // The peak's flag stands about 3.5 above its roof; keep it in the frame too.
      const top = hMax + (peakIdx >= i0 && peakIdx <= i1 ? 3.6 : 0.6);
      const tgt = new THREE.Vector3((x0 + x1) / 2, Math.max(0.6, top * 0.45), (z0 + z1) / 2);
      // Context margin is fixed, so a month frames visibly wider than a week, and a week wider than a day.
      const halfW = (x1 - x0) / 2 + (narrow ? 2.2 : 3.4);
      const halfH = Math.max(top * 0.62 + 0.6, 2.6);
      const tanV = Math.tan(THREE.MathUtils.degToRad(fov / 2));
      const tanH = tanV * (W / H);
      // Each extra week column pulls the camera back, even when the height of the towers sets the fit.
      const d = Math.max(11, Math.max(halfW / Math.max(tanH, 0.05), halfH / tanV) * 1.12 + (z1 - z0) / 2 + 1.6 * Math.max(0, x1 - x0 - CELL));
      const az = THREE.MathUtils.degToRad(-14);
      const el = THREE.MathUtils.degToRad(narrow ? 30 : 26);
      const pos = new THREE.Vector3(
        tgt.x + Math.sin(az) * Math.cos(el) * d,
        tgt.y + Math.sin(el) * d,
        tgt.z + Math.cos(az) * Math.cos(el) * d);
      return { pos, tgt, fov, shift: 0 };
    };
    const setLens = (fov, shift) => {
      lens.fov = fov;
      lens.shift = shift;
      const fullH = H * (1 + shift);
      camera.fov = fov;
      camera.aspect = W / fullH;
      camera.setViewOffset(W, fullH, 0, 0, W, H);
      camera.updateProjectionMatrix();
    };
    // Every camera flight carries a resolver; ending or replacing a flight settles its promise.
    function endCamAnim() {
      const a = camAnim;
      camAnim = null;
      if (a && a.done) a.done();
    }
    const applyPose = (p) => {
      endCamAnim();
      setLens(p.fov, p.shift);
      camera.position.copy(p.pos);
      controls.target.copy(p.tgt);
      controls.update();
    };

    let W = 2;
    let H = 2;
    let dprCap = 1.5;
    let postOn = true;
    const fit = () => {
      const r = container.getBoundingClientRect();
      W = Math.max(2, Math.round(r.width));
      H = Math.max(2, Math.round(r.height));
      narrow = W < 720;
      elev = narrow ? ELEV * 1.45 : ELEV;
      // Phones frame the land plus a little sea; wider screens frame all weeks.
      const landW = landX1 - landX0;
      seaW = narrow ? 3.6 : Math.max(9, landW * 0.5);
      if (hasSea) seaW = Math.min(seaW, landX0 - reefX0);
      const x0 = landX0 - seaW;
      const x1 = landX1 + (narrow ? 0.5 : 1.4);
      const halfW = (x1 - x0) / 2;
      target0.x = (x0 + x1) / 2;
      frontLens.fov = W / H > 1.7 ? 46 : 50;
      const tanH = Math.tan(THREE.MathUtils.degToRad(frontLens.fov / 2)) * (W / (H * (1 + LENS_SHIFT)));
      dist0 = Math.max(narrow ? 16 : 20, halfW / tanH + 3);
      const pr = Math.min(window.devicePixelRatio || 1, dprCap);
      renderer.setPixelRatio(pr);
      renderer.setSize(W, H, false);
      composer.setPixelRatio(pr);
      composer.setSize(W, H);
      bloom.resolution.set(W, H);
      if (reflOn) reflRT.setSize(Math.max(2, Math.round(W * pr * 0.4)), Math.max(2, Math.round(H * pr * 0.4))); // soft anyway: rippled and faded
      const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
      fogU.uFogRes.value.copy(buf);
      emberMat.uniforms.uPR.value = pr;
      controls.maxDistance = Math.max(dist0 * 1.8, mapPose().pos.y * 1.15);
      placeSky();
      setShipPath(narrow);
      placeShip(t);
      lighthouse.position.set(landX0 - seaW * (narrow ? 1.25 : 0.88), 0, narrow ? -13 : -15);
      birdPath.cx = landX0 - seaW * 0.55;
      birdPath.cz = boardZ0 - 7;
      birdPath.rx = Math.max(4, seaW * 0.42);
      birdPath.cy = 8.5 + dist0 * 0.04;
      placeBirds(t);
      if (camAnim) {
        if (camAnim.toPreset) {
          const p = presetPose(preset);
          Object.assign(camAnim, { p1: p.pos, q1: p.tgt, f1: p.fov, s1: p.shift });
        }
      } else if (!interacted) applyPose(presetPose(preset));
      else setLens(lens.fov, lens.shift);
      controls.update();
      invalidate();
      requestRender();
    };

    // Put the sun and moon in the upper corners of the default view, whatever the aspect ratio.
    function placeSky() {
      const cam = camera.clone();
      const fullH = H * (1 + LENS_SHIFT);
      cam.fov = frontLens.fov;
      cam.aspect = W / fullH;
      cam.setViewOffset(W, fullH, 0, 0, W, H);
      cam.updateProjectionMatrix();
      cam.position.copy(defaultCamPos());
      cam.lookAt(target0);
      cam.updateMatrixWorld();
      const far = dist0 * 2.4;
      const at = (nx, ny) => {
        const v = new THREE.Vector3(nx, ny, 0.5).unproject(cam).sub(cam.position).normalize();
        return cam.position.clone().addScaledVector(v, far);
      };
      sun.position.copy(at(narrow ? -0.56 : -0.7, narrow ? 0.62 : 0.72));
      moon.position.copy(at(narrow ? 0.6 : 0.72, narrow ? 0.6 : 0.7));
      const s = dist0 * (narrow ? 0.045 : 0.05);
      sun.scale.setScalar(s * 1.55);
      moon.scale.setScalar(s * 0.92);
      clouds.forEach((c, i) => {
        const base = at((narrow ? 0.1 : 0.36) + i * (narrow ? 0.17 : 0.12), (narrow ? 0.66 : 0.8) - i * 0.09);
        c.userData.base = base;
        c.position.copy(base);
        const k = dist0 * (narrow ? 0.12 : 0.09) * c.userData.scale;
        c.scale.set(k * 2, k, 1);
      });
      // sun/moon direction for water highlights
      waterMat.uniforms.uSunDir.value.copy(sun.position).sub(target0).normalize();
      waterMat.uniforms.uMoonDir.value.copy(moon.position).sub(target0).normalize();
    }

    listen(controls, 'start', () => { interacted = true; endCamAnim(); if (preset === 'cinematic') preset = 'front'; });
    listen(controls, 'change', () => invalidate());

    // Zoom only with Ctrl/Cmd + wheel (or trackpad pinch) so page scrolling is never hijacked.
    // A plain wheel scrolls the page (OrbitControls only calls preventDefault while zoom is enabled),
    // and the hint toast appears at most once every few seconds.
    let toastTimer = 0;
    let toastAt = -Infinity;
    listen(container, 'wheel', (e) => {
      if (!interactive) return;
      const zoom = e.ctrlKey || e.metaKey;
      controls.enableZoom = zoom;
      const now = performance.now();
      if (!zoom && toast && now - toastAt > 5000) {
        toastAt = now;
        toast.textContent = 'Hold ⌘ or Ctrl and scroll to zoom';
        toast.classList.add('is-on');
        clearTimeout(toastTimer);
        toastTimer = later(() => toast.classList.remove('is-on'), 1600);
      }
    }, { capture: true, passive: true });
    listen(container, 'pointerdown', () => { controls.enableZoom = true; }, { capture: true });

    // ---------- picking ----------
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pick = (cx, cy) => {
      if (!N) return null;
      const r = canvas.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      for (const hit of raycaster.intersectObject(towers, false)) {
        if (hit.instanceId != null && hit.instanceId <= replayIdx) return hit.instanceId;
      }
      return null;
    };

    let hoverIdx = null;
    let pinnedIdx = null;
    let pendingMove = null;
    let down = null;
    let touchTipTimer = 0;
    listen(canvas, 'pointermove', (e) => {
      if (!interactive || e.pointerType === 'touch') return;
      pendingMove = { x: e.clientX, y: e.clientY, buttons: e.buttons };
    });
    listen(canvas, 'pointerleave', () => {
      pendingMove = null;
      if (hoverIdx != null) { applyHover(null); onHover(null); }
      canvas.classList.remove('is-hovering');
    });
    listen(canvas, 'pointerdown', (e) => {
      if (!interactive) return;
      down = { x: e.clientX, y: e.clientY, t: performance.now(), type: e.pointerType };
    });
    listen(canvas, 'pointerup', (e) => {
      if (!interactive || !down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 600;
      const type = down.type;
      down = null;
      if (moved > 7 || !quick) return;
      const idx = pick(e.clientX, e.clientY);
      if (idx == null) return;
      onPick(days[idx].date);
      if (type === 'touch') {
        applyHover(idx);
        onHover(days[idx].date, e.clientX, e.clientY - 18);
        clearTimeout(touchTipTimer);
        touchTipTimer = later(() => { applyHover(null); onHover(null); }, 2200);
      }
    });

    const processHover = () => {
      if (!pendingMove) return;
      const { x, y, buttons } = pendingMove;
      pendingMove = null;
      if (buttons) return; // dragging
      const idx = pick(x, y);
      canvas.classList.toggle('is-hovering', idx != null);
      if (idx !== hoverIdx) applyHover(idx);
      onHover(idx == null ? null : days[idx].date, x, y - 6);
    };

    // Hover lift: the hovered tower floats up on a spring while its neighbours dim (both eased).
    const springs = new Map(); // idx -> { x, v }
    let hoverAmt = 0;
    function applyHover(idx) {
      if (hoverIdx != null) towers.setColorAt(hoverIdx, shownColor(hoverIdx));
      hoverIdx = idx;
      if (idx != null && idx <= replayIdx) {
        tmpC.copy(baseColors[idx]).lerp(new THREE.Color(MODES[mode].clash), 0.38);
        if (mode === 'dark') tmpC.multiplyScalar(1.25);
        towers.setColorAt(idx, tmpC);
        const d = days[idx];
        towerU.uHover.value.x = xOf(d.week);
        towerU.uHover.value.y = zOf(d.weekday);
        towerU.uHoverId.value = idx;
        if (!springs.has(idx)) springs.set(idx, { x: lift[idx], v: 0 });
      }
      if (towers.instanceColor) towers.instanceColor.needsUpdate = true;
      if (reduced) stepHover(0);
      updateHoverBox();
      invalidate();
    }
    // Advances the springs; dt 0 settles them (reduced motion, captures).
    function stepHover(dt) {
      let moving = false;
      const want = hoverIdx != null && hoverIdx <= replayIdx ? 1 : 0;
      const prevAmt = hoverAmt;
      const nextAmt = dt > 0 ? hoverAmt + (want - hoverAmt) * Math.min(1, dt * 9) : want;
      hoverAmt = Math.abs(nextAmt - want) < 0.002 ? want : nextAmt;
      if (hoverAmt !== prevAmt) moving = true;
      towerU.uHover.value.z = hoverAmt;
      if (!hoverAmt && hoverIdx == null) towerU.uHoverId.value = -1;
      for (const [i, sp] of springs) {
        const target = i === hoverIdx && i <= replayIdx ? 1 : 0;
        if (dt > 0) {
          const k = 170;
          const c = 15;
          sp.v += (k * (target - sp.x) - c * sp.v) * dt;
          sp.x += sp.v * dt;
        }
        if (dt <= 0 || (Math.abs(target - sp.x) < 0.002 && Math.abs(sp.v) < 0.01)) { sp.x = target; sp.v = 0; }
        if (lift[i] !== sp.x) {
          lift[i] = sp.x;
          setTower(i, curH[i]);
          moving = true;
        }
        if (sp.x === target && !target) springs.delete(i);
      }
      if (moving) {
        towers.instanceMatrix.needsUpdate = true;
        updateHoverBox();
        updatePin();
      }
      return moving;
    }
    function updateHoverBox() {
      if (hoverIdx == null || hoverIdx > replayIdx) { hoverBox.visible = false; return; }
      const d = days[hoverIdx];
      hoverBox.visible = true;
      hoverBox.position.set(xOf(d.week), baseOf(d) - 0.02 + lift[hoverIdx] * LIFT_H, zOf(d.weekday));
      hoverBox.scale.set(FOOT + 0.08, Math.max(0.05, curH[hoverIdx]) + 0.05, FOOT + 0.08);
    }
    function updatePin() {
      if (pinnedIdx == null || pinnedIdx > replayIdx) { pinGroup.visible = false; return; }
      const d = days[pinnedIdx];
      pinGroup.visible = true;
      pinGroup.position.set(xOf(d.week), baseOf(d), zOf(d.weekday));
      beam.position.y = Math.max(0.05, curH[pinnedIdx]) + lift[pinnedIdx] * LIFT_H;
      ring.position.y = isSunken(d) ? WATER_Y - REEF_Y + 0.04 : 0.03;
    }

    // ---------- labels (HTML, projected) ----------
    const labels = [];
    const addLabel = (cls, html, pos, info = {}) => {
      if (!labelRoot) return null;
      const n = document.createElement('div');
      n.className = `mk ${cls} is-hidden`; // shown by the first layout pass, so nothing flashes in
      n.innerHTML = html;
      labelRoot.append(n);
      labelNodes.push(n);
      labels.push({ n, pos, below: cls.includes('mk--below'), ...info });
      return n;
    };
    const fmtJoin = (s) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${s}T00:00:00Z`));
    const firstLandIdx = days.findIndex((d) => !d.sea);
    if (hasSea && model.joined) addLabel('mk--sail', `<b>Set sail</b>${fmtJoin(model.joined)}`, new THREE.Vector3(shoreX + 0.25, 2.25, boardZ1 - 0.3), { from: firstLandIdx < 0 ? N : firstLandIdx, rank: -1 });
    if (peakDay) {
      const n = addLabel('mk--peak', `<b>Peak</b>${peakDay.count}`, new THREE.Vector3(xOf(peakDay.week), heightOf(peakDay) + 3.25, zOf(peakDay.weekday)), { from: peakIdx, rank: -2 });
      if (n) n.dataset.peak = '1';
    }
    const fmtNum = new Intl.NumberFormat('en-US');
    const firstActive = monthList.findIndex((m) => m.total > 0);
    monthList.forEach((m, k) => {
      let w0 = Infinity;
      let w1 = -Infinity;
      let i0 = Infinity;
      let seaOnly = true;
      for (const date of m.dates || []) {
        const d = byDate.get(date);
        if (!d) continue;
        w0 = Math.min(w0, d.week);
        w1 = Math.max(w1, d.week);
        i0 = Math.min(i0, d.idx);
        if (!d.sea) seaOnly = false;
      }
      if (!Number.isFinite(w0)) return;
      // The current month always has a pill, with "now" merged in, and wins every collision.
      const now = k === monthList.length - 1;
      addLabel(`mk--month mk--below${now ? ' mk--now' : ''}`, `<b>${m.label}</b>${fmtNum.format(m.total)}${now ? ' · now' : ''}`,
        new THREE.Vector3((xOf(w0) + xOf(w1)) / 2, -0.3, boardZ1 + 0.35),
        { from: i0, quiet: !now && (seaOnly || k < firstActive) && !(m.total > 0), rank: now ? -3 : 2 + k });
    });
    const v3 = new THREE.Vector3();
    const v3b = new THREE.Vector3();
    const camRight = new THREE.Vector3();
    const placed = [];
    // Screen-space discs of the sun and moon (the Peak label steps around them).
    const disks = [];
    const diskOf = (obj, r) => {
      v3b.copy(obj.position).project(camera);
      if (v3b.z > 1) return null;
      const cx = (v3b.x * 0.5 + 0.5) * W;
      const cy = (-v3b.y * 0.5 + 0.5) * H;
      v3b.copy(obj.position).addScaledVector(camRight, r * obj.scale.x).project(camera);
      return { cx, cy, r: Math.hypot((v3b.x * 0.5 + 0.5) * W - cx, (-v3b.y * 0.5 + 0.5) * H - cy) + 6 };
    };
    const hitsDisk = (b) => disks.some((c) => {
      const nx = Math.max(b.x0, Math.min(c.cx, b.x1));
      const ny = Math.max(b.y0, Math.min(c.cy, b.y1));
      return (nx - c.cx) ** 2 + (ny - c.cy) ** 2 < c.r * c.r;
    });
    const updateLabels = () => {
      placed.length = 0;
      disks.length = 0;
      camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
      for (const dk of [diskOf(sun, 1.3), diskOf(moon, 1.45)]) if (dk) disks.push(dk);
      const order = labels.slice().sort((a, b) => a.rank - b.rank);
      for (const l of order) {
        v3.copy(l.pos);
        if (l.n.dataset.peak && peakDay) v3.y = curH[peakIdx] + 3.9;
        v3.project(camera);
        let hidden = v3.z > 1 || v3.x < -1.05 || v3.x > 1.05 || v3.y < -1.05 || v3.y > 1.05;
        if (l.from != null && l.from > replayIdx) hidden = true;
        if (l.n.dataset.peak && peakDay && rise[peakIdx] < 0.6) hidden = true;
        if (l.quiet && preset !== 'map') hidden = true;
        if (l.rank === -1 && preset === 'map') hidden = true;
        if (!l.w || l.wAt !== W) { l.w = l.n.offsetWidth; l.h = l.n.offsetHeight; l.wAt = W; }
        const half = l.w / 2 + 6;
        let x = Math.max(half, Math.min(W - half, (v3.x * 0.5 + 0.5) * W));
        let y = (-v3.y * 0.5 + 0.5) * H;
        if (!hidden) {
          const hit = (b) => placed.some((o) => b.x0 < o.x1 && o.x0 < b.x1 && b.y0 < o.y1 && o.y0 < b.y1);
          const boxAt = (yy, xx = x) => (l.below
            ? { x0: xx - l.w / 2 - 4, x1: xx + l.w / 2 + 4, y0: yy, y1: yy + l.h + 8 }
            : { x0: xx - l.w / 2 - 4, x1: xx + l.w / 2 + 4, y0: yy - l.h - 2, y1: yy + 2 });
          let box = boxAt(y);
          if (hit(box) && l.below && preset === 'map') {
            const y2 = y + l.h + 10;
            if (!hit(boxAt(y2))) { y = y2; box = boxAt(y2); }
          }
          if (l.n.dataset.peak && (hit(box) || hitsDisk(box))) {
            // Peak: step aside (or lower, nearer its flag) until clear of the sun, moon and other labels.
            const side = l.w / 2 + 26;
            const tries = [[-side, 22], [side, 22], [0, 30], [-side, 0], [side, 0], [-side * 1.6, 40], [side * 1.6, 40], [0, -36], [0, 60]];
            for (const [dx, dy] of tries) {
              const xx = Math.max(half, Math.min(W - half, x + dx));
              const b = boxAt(y + dy, xx);
              if (!hit(b) && !hitsDisk(b)) { x = xx; y += dy; box = b; break; }
            }
          }
          if (hit(box) || (l.n.dataset.peak && hitsDisk(box))) hidden = true;
          else placed.push(box);
        }
        l.n.classList.toggle('is-hidden', hidden);
        l.n.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, ${l.below ? '6px' : '-100%'})`;
      }
    };

    // ---------- theme ----------
    const glitterGain = { value: 0.5 };
    function applyTheme() {
      const S = SURF[mode];
      const M = MODES[mode];
      const dark = mode === 'dark';
      // Sky and fog share these uniforms, so the horizon blends seamlessly.
      fogU.uSkyL.value.set(M.sky_left);
      fogU.uSkyR.value.set(M.sky_right);
      scene.fog.color.set(M.sky_left).lerp(new THREE.Color(M.sky_right), 0.5);
      skyU.uZenith.value = S.zenith;
      skyU.uStars.value = S.stars;

      hemi.color.set(S.hemiSky);
      hemi.groundColor.set(S.hemiGround);
      hemi.intensity = S.hemi;
      sunLight.color.set(S.sunColor);
      sunLight.intensity = S.sun;
      moonLight.color.set(S.moonColor);
      moonLight.intensity = S.moon;

      board.top.color.set(S.boardTop);
      board.side.color.set(S.boardSide);
      if (reefMat) reefMat.color.set(S.reef);
      rockMat.color.set(S.rock);
      districtMat.color.copy(hdr(S.district, dark ? 0.9 : 1));
      bridgeMat.color.copy(hdr(S.bridgeHot, dark ? 1.7 : 1.2));
      cityU.uCity.value.set(S.city);
      cityU.uPane.value.set(S.cityPane);
      cityU.uPaneAmt.value = S.cityPaneAmt;
      cityU.uLit.value.copy(hdr(S.cityLit, S.cityLitGain));
      cityU.uLitFrac.value = S.cityLitFrac;
      cityU.uHaze.value = S.cityHaze;
      cityGlow.material.color.copy(hdr(S.skylineGlow, dark ? 0.5 : 0.3));
      cityGlow.material.opacity = dark ? 0.5 : 0.3;
      lampMat.color.copy(hdr(S.lamp, dark ? 2.4 : 1.6));
      lampGlow.material.color.copy(hdr(S.lamp, dark ? 1.6 : 1));
      lampGlow.material.opacity = dark ? 0.85 : 0.55;
      lhBeamU.uColor.value.copy(hdr(S.beam, dark ? 1.3 : 1));
      lhBeamU.uAmt.value = S.beamGain;
      birdU.uColor.value.set(S.bird);
      contactU.uColor.value.set(S.contact);
      contactU.uAmt.value = S.contactAmt;

      for (let i = 0; i < N; i++) {
        baseColors[i] = colorFor(days[i]);
        blankColors[i] = days[i].sea ? baseColors[i] : new THREE.Color(POWER[mode][0]);
        towers.setColorAt(i, shownColor(i));
      }
      if (towers.instanceColor) towers.instanceColor.needsUpdate = true;
      if (hoverIdx != null) { const h = hoverIdx; hoverIdx = null; applyHover(h); }
      towerU.uDimTo.value.set(S.dimTo);
      towerU.uMatchGlow.value = S.matchGlow;
      towerU.uWinGlow.value = S.windowGlow;
      towerU.uWinPane.value = S.windowPane;
      towerU.uWinCol.value.copy(hdr(SURF.dark.lamp, 1.35));
      reflAmt.value = dark ? 0.42 : 0.32;

      const wu = waterMat.uniforms;
      wu.uShallowL.value.set(S.water.shallowL);
      wu.uDeepL.value.set(S.water.deepL);
      wu.uShallowR.value.set(S.water.shallowR);
      wu.uDeepR.value.set(S.water.deepR);
      wu.uFoam.value.set(S.water.foam);
      wu.uSunCol.value.copy(hdr(SH.sun_glow, dark ? 0.9 : 0.8));
      wu.uMoonCol.value.copy(hdr(AK.sharingan, dark ? 0.9 : 0.6));
      wu.uOpacity.value = dark ? 0.92 : 0.9;

      // Glows: additive and HDR in the dark; normal blending and deeper tones on the light page.
      normalMix.value = dark ? 0 : 1;
      const clash = M.clash;
      beaconMat.color.copy(hdr(SH.sun_glow, 4));
      if (beaconGlow) { beaconGlow.material.color.copy(hdr(SH.sun_gold, dark ? 2 : 1)); beaconGlow.material.opacity = dark ? 0.9 : 0.6; }
      if (beaconRing) beaconRing.material.color.copy(hdr(dark ? SH.sun_glow : SH.sun_gold, dark ? 2.2 : 1));
      hoverMat.color.copy(hdr(dark ? M.clash : SH.haki_black, dark ? 2.6 : 1));
      ringMat.color.copy(hdr(clash, dark ? 3 : 1.6));
      beamMat.uniforms.uColor.value.copy(hdr(clash, dark ? 1.6 : 1));
      beamMat.uniforms.uOpacity.value = dark ? 0.8 : 0.55;

      sunCoreMat.color.copy(dark ? hdr('#FFF4D6', 1.6) : hdr('#FFF3CC', 1.25));
      // Dark sky: additive, HDR glow. Light sky: normal blending in deeper golds, so the corona reads on cream.
      coronaMat.uniforms.uInner.value.copy(dark ? hdr('#FFF1C4', 1.0) : new THREE.Color('#FFD95A'));
      coronaMat.uniforms.uOuter.value.copy(dark ? hdr(SH.sun_gold, 0.8) : new THREE.Color('#F6A800'));
      coronaMat.uniforms.uOpacity.value = dark ? 0.45 : 1.8;
      sunInner.material.color.copy(dark ? hdr('#FFF6DE', 0.45) : new THREE.Color('#FFEFA8'));
      sunInner.material.opacity = 1;
      sunHalo.material.color.copy(dark ? hdr(SH.sun_glow, 0.32) : new THREE.Color('#FFC933'));
      sunHalo.material.opacity = dark ? 1 : 0.7;
      sunHaze.material.color.copy(dark ? hdr('#FF9F1C', 0.12) : new THREE.Color('#FFC94A'));
      sunHaze.material.opacity = dark ? 1 : 0.3;
      warmLight.color.set(dark ? '#FFB547' : '#FFD27A');
      warmLight.intensity = dark ? 26 : 12;
      wu.uGlitterCol.value.set(S.glitter);
      glitterGain.value = S.glitterGain;
      if (wakeMat) {
        wakeMat.uniforms.uColor.value.set(dark ? '#CFE6FF' : '#FFFFFF');
        wakeMat.uniforms.uOpacity.value = dark ? 0.55 : 0.85;
      }
      for (const p of pulses) p.material.color.copy(hdr(SH.sun_glow, dark ? 0.9 : 0.6));
      moonCoreMat.color.copy(hdr(dark ? '#FF4D5A' : AK.cloud_red, dark ? 1.5 : 1.15));
      moonHalo.material.color.copy(hdr(AK.sharingan, dark ? 1.2 : 1));
      moonHalo.material.opacity = dark ? 0.75 : 0.45;
      ripples.forEach((r, i) => {
        r.material.color.set(dark ? AK.rinnegan_light : AK.rinnegan);
        r.material.opacity = (dark ? 0.55 : 0.6) * (1 - i * 0.18);
      });
      if (markerU) {
        markerU.lanternMat.color.copy(hdr(SH.sun_glow, dark ? 3.5 : 2.2));
        markerU.lanternGlow.material.color.copy(hdr(SH.sun_gold, dark ? 1.8 : 1));
        markerU.lanternGlow.material.opacity = dark ? 0.9 : 0.6;
      }

      emberMat.uniforms.uColA.value.copy(hdr(S.ember[0], S.emberGain));
      emberMat.uniforms.uColB.value.copy(hdr(S.ember[1], S.emberGain));
      emberMat.uniforms.uOpacity.value = dark ? 0.8 : 0.6;
      rainMat.uniforms.uColor.value.set(S.rain);
      rainMat.uniforms.uOpacity.value = S.rainOpacity;
      bloom.strength = S.bloom;
      towerGlow.value = S.towerGlow;
      renderer.setClearColor(fogU.uSkyL.value);
      invalidate();
    }

    // ---------- day to night: every themed value cross-fades on the same scene ----------
    // Slots are discovered rather than listed: any colour or number that applyTheme changes is animated.
    const extraUniforms = [fogU.uSkyL, fogU.uSkyR, normalMix, glitterGain, reflAmt, towerGlow,
      ...Object.values(towerU), ...Object.values(skyU), ...Object.values(cityU), ...Object.values(lhBeamU),
      ...Object.values(birdU), ...Object.values(contactU)];
    const collectSlots = () => {
      const out = [];
      const seen = new Set();
      const add = (slot, key) => { if (key && !seen.has(key)) { seen.add(key); out.push(slot); } };
      const addU = (u) => {
        if (!u || seen.has(u)) return;
        if (u.value && u.value.isColor) add({ c: u.value }, u.value);
        else if (typeof u.value === 'number') add({ o: u, k: 'value' }, u);
      };
      for (const d of disposables) {
        if (!d || !d.isMaterial) continue;
        if (d.color) add({ c: d.color }, d.color);
        if (d.emissive) add({ c: d.emissive }, d.emissive);
        out.push({ o: d, k: 'opacity' });
        if (d.uniforms) for (const u of Object.values(d.uniforms)) addU(u);
      }
      for (const u of extraUniforms) addU(u);
      for (const l of [hemi, sunLight, moonLight, warmLight]) {
        add({ c: l.color }, l.color);
        if (l.groundColor) add({ c: l.groundColor }, l.groundColor);
        out.push({ o: l, k: 'intensity' });
      }
      out.push({ o: bloom, k: 'strength' });
      return out;
    };
    const readSlot = (s) => (s.c ? s.c.clone() : s.o[s.k]);
    const writeSlot = (s, v) => { if (s.c) s.c.copy(v); else s.o[s.k] = v; };
    let themeAnim = null;
    const duskC = new THREE.Color(DUSK);
    function finishTheme() {
      const a = themeAnim;
      if (!a) return;
      themeAnim = null;
      for (let j = 0; j < a.slots.length; j++) writeSlot(a.slots[j], a.to[j]);
      for (let i = 0; i < N; i++) { baseColors[i] = a.toBase[i]; blankColors[i] = a.toBlank[i]; }
      recolorTowers();
      invalidate();
    }
    function recolorTowers() {
      for (let i = 0; i < N; i++) towers.setColorAt(i, shownColor(i));
      if (towers.instanceColor) towers.instanceColor.needsUpdate = true;
      if (hoverIdx != null) { const h = hoverIdx; hoverIdx = null; applyHover(h); }
    }
    function startTheme(next, dur) {
      // A transition already running is re-targeted from wherever it is: its current values become the start.
      themeAnim = null;
      const slots = collectSlots();
      const from = slots.map(readSlot);
      const fromBase = baseColors.slice();
      const fromBlank = blankColors.slice();
      mode = next;
      applyTheme();
      const to = slots.map(readSlot);
      const keep = [];
      for (let j = 0; j < slots.length; j++) {
        const a = from[j];
        const b = to[j];
        if (a && a.isColor ? !a.equals(b) : a !== b) keep.push(j);
      }
      themeAnim = {
        t0: performance.now(), dur,
        slots: keep.map((j) => slots[j]), from: keep.map((j) => from[j]), to: keep.map((j) => to[j]),
        fromBase, toBase: baseColors.slice(), fromBlank, toBlank: blankColors.slice(),
      };
      for (let i = 0; i < N; i++) { baseColors[i] = fromBase[i].clone(); blankColors[i] = fromBlank[i].clone(); }
      stepTheme();
    }
    function stepTheme() {
      const a = themeAnim;
      if (!a) return false;
      const k = clamp01((performance.now() - a.t0) / a.dur);
      if (k >= 1) { finishTheme(); return true; }
      const e = easeInOut(k);
      for (let j = 0; j < a.slots.length; j++) {
        const s = a.slots[j];
        if (s.c) s.c.lerpColors(a.from[j], a.to[j], e);
        else s.o[s.k] = a.from[j] + (a.to[j] - a.from[j]) * e;
      }
      // The sky warms through dusk at the midpoint, then settles.
      const dusk = Math.sin(Math.PI * e);
      fogU.uSkyL.value.lerp(duskC, 0.32 * dusk);
      fogU.uSkyR.value.lerp(duskC, 0.16 * dusk);
      for (let i = 0; i < N; i++) {
        baseColors[i].lerpColors(a.fromBase[i], a.toBase[i], e);
        blankColors[i].lerpColors(a.fromBlank[i], a.toBlank[i], e);
      }
      recolorTowers();
      return true;
    }

    // Towers are static once risen: render the shadow map once instead of every frame.
    let shadowsFrozen = false;
    function freezeShadows() {
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = true;
      shadowsFrozen = true;
    }
    function thawShadows() {
      renderer.shadowMap.autoUpdate = true;
      shadowsFrozen = false;
    }

    // ---------- animation ----------
    let needsRender = true;
    let renderedFrames = 0;
    let ticks = 0;
    function invalidate() { needsRender = true; }
    const clock = new THREE.Clock();
    let t = 0; // animation time (frozen when motion is off)
    let visible = true;
    let onScreen = true;
    let replayIdx = N - 1;
    let replayFollow = false;
    const live = () => motion && !reduced;

    const animate = (dt) => {
      t += dt;
      wTime = t;
      waterMat.uniforms.uTime.value = t;
      beamMat.uniforms.uTime.value = t;
      emberMat.uniforms.uTime.value = t;
      rainMat.uniforms.uTime.value = t;
      coronaMat.uniforms.uTime.value = t;
      skyU.uTime.value = t;
      birdU.uTime.value = t;
      if (wakeMat) wakeMat.uniforms.uTime.value = t;
      lhBeam.rotation.y = BEAM_REST + t * 0.5;
      if (birds.visible) placeBirds(t);
      if (beaconRing) {
        const k = (t * 0.55 + 0.35) % 1;
        beaconRing.scale.setScalar(1 + k * 3.4);
        beaconRing.material.opacity = (1 - k) * (1 - k) * 0.95;
        beaconGlow.scale.setScalar(2.4 * (1 + 0.2 * Math.sin(t * 3.1)));
      }
      pulses.forEach((p) => {
        const k = (t * 0.32 + p.userData.phase) % 1;
        p.scale.setScalar(1.2 + k * 1.8);
        p.material.opacity = (1 - k) * 0.35;
      });
      ripples.forEach((r, i) => { r.scale.setScalar(1 + 0.04 * Math.sin(t * 0.9 - i * 0.7)); });
      clouds.forEach((c) => {
        if (!c.userData.base) return;
        c.position.copy(c.userData.base);
        c.position.x += Math.sin(t * 0.05 + c.userData.phase) * dist0 * 0.04;
        c.position.y += Math.sin(t * 0.13 + c.userData.phase) * 0.4;
      });
      if (flagCloth) {
        const p = flagCloth.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const x = flagBase[i * 3];
          const y = flagBase[i * 3 + 1];
          const k = x / 1.7;
          p.setZ(i, Math.sin(x * 3.2 - t * 5.2 + y * 0.8) * 0.16 * k + Math.sin(x * 6.0 - t * 7.0) * 0.04 * k);
        }
        p.needsUpdate = true;
        flagCloth.geometry.computeVertexNormals();
      }
      placeShip(t);
      if (shipFlag) {
        const p = shipFlag.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const x = shipFlagBase[i * 3];
          p.setZ(i, Math.sin(x * 9 - t * 8) * 0.05 * (x / 0.62));
        }
        p.needsUpdate = true;
      }
      if (pinGroup.visible) {
        const k = 1 + 0.08 * Math.sin(t * 3);
        ring.scale.set(k, k, 1);
      }
    };

    // The ship sails a slow loop over the open sea, riding and rocking on the swells.
    const shipPath = { cx: 0, cz: 0.4, rx: 3, rz: 2.4 };
    function setShipPath(phone) {
      // Phones frame only the last few sea weeks, so the ship keeps close to the coast there.
      shipPath.cx = phone ? landX0 - 1.2 : landX0 - seaW * 0.42;
      shipPath.cz = boardZ0 - 2.6;
      shipPath.rx = phone ? 1.2 : Math.max(1.5, seaW * 0.18);
      shipPath.rz = 0.9;
      if (!hasSea) { shipPath.cx = landX0 - (phone ? 3.4 : 5.5); shipPath.rx = 0.9; shipPath.rz = 0.7; }
    }
    const fwd = new THREE.Vector3();
    function placeShip(time) {
      const th = hasSea ? 0.9 - time * 0.04 : 2.2 + Math.sin(time * 0.07) * 0.35;
      const { cx, cz, rx, rz } = shipPath;
      const x = cx + rx * Math.cos(th);
      const z = cz + rz * Math.sin(th);
      const vx = rx * Math.sin(th);
      const vz = -rz * Math.cos(th);
      const yaw = Math.atan2(-vz, vx);
      fwd.set(Math.cos(yaw), 0, -Math.sin(yaw));
      const half = 1.1 * SHIP_SCALE;
      const hb = waveAt(x + fwd.x * half, z + fwd.z * half, wTime);
      const hs = waveAt(x - fwd.x * half, z - fwd.z * half, wTime);
      const hp = waveAt(x - fwd.z * 1.1, z + fwd.x * 1.1, wTime);
      const hq = waveAt(x + fwd.z * 1.1, z - fwd.x * 1.1, wTime);
      ship.position.set(x, WATER_Y + (hb + hs + hp + hq) / 4 + 0.04 * Math.sin(time * 1.7), z);
      ship.rotation.set(0, yaw, 0);
      shipBody.rotation.set(Math.atan2(hp - hq, 2.2) * 0.9 + Math.sin(time * 1.25) * 0.035, 0, Math.atan2(hb - hs, 2 * half) * 0.9 + Math.sin(time * 0.9) * 0.02);
      if (wake) {
        wake.position.set(x, WATER_Y, z);
        wake.rotation.set(0, yaw, 0);
      }
    }

    const sunNdc = new THREE.Vector3();
    function updateSunScreen() {
      sunNdc.copy(sun.position).project(camera);
      const inFront = sunNdc.z < 1;
      waterMat.uniforms.uSunX.value = sunNdc.x * 0.5 + 0.5;
      waterMat.uniforms.uGlitter.value = glitterGain.value * (inFront ? 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(sunNdc.x), Math.abs(sunNdc.y)), 1.0, 1.45) : 0);
    }

    let driftBlend = 0; // eases the sway in after a flight so it never jumps
    const drift = () => {
      // Gentle idle sway around the default front-on view.
      const az = Math.sin(t * 0.11) * 0.09 * driftBlend;
      const el = elev + Math.sin(t * 0.083) * 0.025 * driftBlend;
      camera.position.set(
        target0.x + Math.sin(az) * Math.cos(el) * dist0,
        target0.y + Math.sin(el) * dist0,
        target0.z + Math.cos(az) * Math.cos(el) * dist0,
      );
      controls.target.copy(target0);
    };

    const clampTarget = () => {
      const tg = controls.target;
      const lim = (nWeeks * CELL) / 2;
      tg.x = Math.max(-lim, Math.min(lim, tg.x));
      tg.y = Math.max(-1, Math.min(9, tg.y));
      tg.z = Math.max(-8, Math.min(8, tg.z));
    };

    // Parallax (setParallax): a small eased orbit around the target, applied only while rendering.
    const par = { x: 0, y: 0, tx: 0, ty: 0 };
    const parPos = new THREE.Vector3();
    const parQuat = new THREE.Quaternion();
    const parV = new THREE.Vector3();
    let readyResolve = null;
    const ready = new Promise((resolve) => { readyResolve = resolve; });
    const markReady = () => {
      const r = readyResolve;
      if (!r) return;
      readyResolve = null;
      // Resolve once the first frame has been presented (or shortly after, if frames are throttled).
      let done = false;
      const fire = () => { if (!done) { done = true; r(); } };
      requestAnimationFrame(fire);
      later(fire, 250);
    };
    const renderNow = () => {
      const reach = camera.position.distanceTo(controls.target);
      const parOn = Math.abs(par.x) + Math.abs(par.y) > 1e-5;
      if (parOn) {
        parPos.copy(camera.position);
        parQuat.copy(camera.quaternion);
        parV.set(1, 0, 0).applyQuaternion(camera.quaternion);
        camera.position.addScaledVector(parV, par.x * reach * 0.035);
        parV.set(0, 1, 0).applyQuaternion(parQuat);
        camera.position.addScaledVector(parV, -par.y * reach * 0.022);
        camera.lookAt(controls.target);
      }
      sun.quaternion.copy(camera.quaternion);
      moon.quaternion.copy(camera.quaternion);
      updateSunScreen();
      scene.fog.near = Math.max(dist0, reach) * 1.2;
      scene.fog.far = Math.max(dist0, reach) * 3.6;
      renderReflection();
      if (postOn) composer.render();
      else renderer.render(scene, camera);
      updateLabels();
      if (parOn) {
        camera.position.copy(parPos);
        camera.quaternion.copy(parQuat);
      }
      renderedFrames++;
      needsRender = false;
      if (renderedFrames === 1) markReady();
    };
    const requestRender = () => {
      if (raf || !visible || !onScreen || disposed) { invalidate(); return; }
      renderNow();
    };

    const revealExtras = () => {
      for (const tube of bridgeGroup.children) {
        const [a, b] = tube.userData.pair;
        tube.visible = b <= replayIdx && rise[a] > 0.97 && rise[b] > 0.97;
      }
      if (peakDay) {
        flag.visible = peakIdx <= replayIdx && rise[peakIdx] > 0.6;
        flag.position.y = curH[peakIdx];
      }
      if (markerU) markerU.marker.visible = firstLandIdx >= 0 && firstLandIdx <= replayIdx;
      updateHoverBox();
      updatePin();
    };

    const stepReplay = (dt) => {
      let moving = false;
      let recolor = false;
      const k = dt == null ? 1 : Math.min(1, dt * 7);
      for (let i = 0; i < N; i++) {
        const tgt = i <= replayIdx ? 1 : 0;
        if (colorRev[i] !== tgt) {
          colorRev[i] = tgt;
          towers.setColorAt(i, shownColor(i));
          recolor = true;
        }
        const d0 = rise[i];
        if (d0 === tgt) continue;
        const d1 = d0 + (tgt - d0) * k;
        rise[i] = Math.abs(tgt - d1) < 0.004 ? tgt : d1;
        const b = blankH(days[i]);
        setTower(i, b + (heightOf(days[i]) - b) * rise[i]);
        moving = true;
      }
      if (recolor) {
        if (towers.instanceColor) towers.instanceColor.needsUpdate = true;
        if (hoverIdx != null) { const h = hoverIdx; hoverIdx = null; applyHover(h); }
        needsRender = true;
      }
      if (moving) {
        towers.instanceMatrix.needsUpdate = true;
        if (shadowsFrozen) thawShadows();
        revealExtras();
        needsRender = true;
      } else if (!shadowsFrozen) freezeShadows();
      return moving;
    };
    const settleReplay = () => {
      if (stepReplay(null)) freezeShadows();
    };
    const settleCamera = () => {
      if (!camAnim) return;
      const a = camAnim;
      applyPose({ pos: a.p1, tgt: a.q1, fov: a.f1, shift: a.s1 });
    };
    // Fly the camera to a pose; resolves when it lands or when another flight replaces it.
    const flyPose = (p, dur = 900, extra = {}) => {
      if (reduced || !raf || !ticks || !(dur > 0)) { applyPose(p); return Promise.resolve(); }
      return new Promise((resolve) => {
        endCamAnim();
        camAnim = {
          t0: performance.now(), dur,
          p0: camera.position.clone(), p1: p.pos, q0: controls.target.clone(), q1: p.tgt,
          f0: lens.fov, f1: p.fov, s0: lens.shift, s1: p.shift, done: resolve, ...extra,
        };
      });
    };
    const ARRIVAL_POLAR = THREE.MathUtils.degToRad(89);
    const BASE_MAX_POLAR = THREE.MathUtils.degToRad(84);
    let arrival = 'pending';
    let arrivalPromise = null;

    const frame = () => {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      ticks++;
      tick(Math.min(0.05, clock.getDelta()));
    };
    const tick = (dt) => {
      processHover();
      stepReplay(dt);
      if (stepTheme()) needsRender = true;
      if (stepHover(dt)) needsRender = true;
      if (!reduced && (Math.abs(par.tx - par.x) > 1e-4 || Math.abs(par.ty - par.y) > 1e-4)) {
        const k = Math.min(1, dt * 4);
        par.x += (par.tx - par.x) * k;
        par.y += (par.ty - par.y) * k;
        if (Math.abs(par.tx - par.x) <= 1e-4) par.x = par.tx;
        if (Math.abs(par.ty - par.y) <= 1e-4) par.y = par.ty;
        needsRender = true;
      }
      driftBlend = camAnim || interacted || preset !== 'front' ? 0 : Math.min(1, driftBlend + dt / 2.5);
      if (live()) {
        animate(dt);
        needsRender = true;
        if (preset === 'cinematic' && !camAnim) {
          cinT += dt;
          const p = cinPose(CIN0 + cinT * 0.14);
          camera.position.copy(p.pos);
          controls.target.copy(p.tgt);
        } else if (preset === 'front' && !interacted && !camAnim && !replayFollow) drift();
      }
      if (camAnim) {
        const now = performance.now();
        // The arrival waits for its first frame to be on screen, then holds it for a beat.
        if (camAnim.t0 == null) camAnim.t0 = renderedFrames > 0 ? now + camAnim.hold : null;
        const k = camAnim.t0 == null ? 0 : clamp01((now - camAnim.t0) / camAnim.dur);
        const e = camAnim.arrival ? easeInOutSine(k) : easeInOut(k);
        camera.position.lerpVectors(camAnim.p0, camAnim.p1, e);
        if (camAnim.arrival) camera.position.y += Math.sin(Math.PI * e) * camAnim.arc;
        controls.target.lerpVectors(camAnim.q0, camAnim.q1, e);
        setLens(camAnim.f0 + (camAnim.f1 - camAnim.f0) * e, camAnim.s0 + (camAnim.s1 - camAnim.s0) * e);
        if (k >= 1) endCamAnim();
        needsRender = true;
      }
      if (replayFollow && live() && !interacted && preset !== 'map' && replayIdx >= 0 && replayIdx < N) {
        const d = days[replayIdx];
        const fx = Math.max(-(nWeeks * CELL) / 2, Math.min((nWeeks * CELL) / 2, xOf(d.week)));
        const lo = fx - dist0 * 0.18;
        const hi = fx + dist0 * 0.18;
        const want = Math.max(lo, Math.min(hi, controls.target.x));
        const dx = (want - controls.target.x) * Math.min(1, dt * 2.5);
        if (Math.abs(dx) > 1e-4) {
          controls.target.x += dx;
          camera.position.x += dx;
          needsRender = true;
        }
      }
      if (controls.update()) needsRender = true;
      clampTarget();
      if (!needsRender) return;
      renderNow();
    };

    const start = () => {
      if (raf || !visible || !onScreen || disposed) return;
      clock.getDelta();
      needsRender = true;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };

    const onVis = () => {
      visible = document.visibilityState === 'visible';
      if (visible) start();
      else stop();
    };
    listen(document, 'visibilitychange', onVis);
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        onScreen = entries[0].isIntersecting;
        if (onScreen) start();
        else stop();
      }, { rootMargin: '80px' });
      io.observe(container);
      observers.push(io);
    }
    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver(() => fit());
      ro.observe(container);
      observers.push(ro);
    } else {
      listen(window, 'resize', fit);
    }

    // Tiers drop reflections, birds and window lights first (window lights stay on phones: they
    // cost a few shader instructions and carry the night look).
    const resolveQuality = () => {
      if (quality === 'low') return { dpr: 1, shadow: 0, post: false, refl: false, birds: false, windows: false };
      if (quality === 'high') return { dpr: 2, shadow: 2048, post: true, refl: true, birds: true, windows: true };
      const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      return coarse
        ? { dpr: 1.75, shadow: 1024, post: false, refl: false, birds: false, windows: true }
        : { dpr: 1.5, shadow: 1024, post: true, refl: true, birds: true, windows: true };
    };
    let tier = null;
    const applyQuality = () => {
      const q = resolveQuality();
      tier = q;
      dprCap = q.dpr;
      postOn = q.post;
      reflOn = q.refl;
      birds.visible = q.birds;
      towerU.uWinOn.value = q.windows ? 1 : 0;
      renderer.shadowMap.enabled = q.shadow > 0;
      sunLight.castShadow = q.shadow > 0;
      if (q.shadow > 0 && sunLight.shadow.mapSize.x !== q.shadow) {
        sunLight.shadow.mapSize.set(q.shadow, q.shadow);
        if (sunLight.shadow.map) { sunLight.shadow.map.dispose(); sunLight.shadow.map = null; }
      }
      if (shadowsFrozen) renderer.shadowMap.needsUpdate = true;
      fit();
    };

    applyTheme();
    applyQuality();
    placeShip(0);
    if (!live()) {
      // Static frame: settle the scene once.
      animate(0);
    }
    revealExtras();
    freezeShadows();
    start();

    const vec = (v) => ({ x: v.x, y: v.y, z: v.z });
    const fin = (v, f = 0) => (Number.isFinite(Number(v)) ? Number(v) : f);
    const toPublic = (p) => ({ position: vec(p.pos), target: vec(p.tgt), fov: p.fov, shift: p.shift });
    const fromPublic = (pose) => {
      if (!pose || !pose.position || !pose.target) return null;
      const v = (o) => new THREE.Vector3(fin(o.x), fin(o.y), fin(o.z));
      return {
        pos: v(pose.position), tgt: v(pose.target),
        fov: Math.max(10, Math.min(80, fin(pose.fov, lens.fov))),
        shift: Math.max(0, Math.min(0.6, fin(pose.shift, pose.shift == null ? lens.shift : 0))),
      };
    };
    // Camera calls that leave the presets stop the idle sway and the cinematic orbit.
    const leavePreset = () => {
      interacted = true;
      if (preset === 'cinematic') preset = 'front';
    };
    let highlightCount = 0;
    const api = {
      ready,
      setHover(date) {
        const idx = idxOf(date);
        if (idx === hoverIdx) return;
        applyHover(idx);
        requestRender();
      },
      setSelection(date) {
        pinnedIdx = idxOf(date);
        updatePin();
        requestRender();
      },
      setFilter(f) {
        const filter = ['all', 'top', 'streak', 'weekdays', 'weekends'].includes(f) ? f : 'all';
        for (let i = 0; i < N; i++) {
          const d = days[i];
          if (filter === 'all') filterAttr.setX(i, 0);
          else if (matchesFilter(d, model, filter)) filterAttr.setX(i, 1);
          else filterAttr.setX(i, d.sea ? -0.35 : -1);
        }
        filterAttr.needsUpdate = true;
        requestRender();
      },
      setCameraPreset(name) {
        if (!['front', 'map', 'isometric', 'cinematic'].includes(name)) return;
        preset = name;
        interacted = false;
        controls.minPolarAngle = name === 'map' ? THREE.MathUtils.degToRad(0.5) : BASE_MIN_POLAR;
        controls.maxPolarAngle = THREE.MathUtils.degToRad(84);
        controls.minAzimuthAngle = THREE.MathUtils.degToRad(-62);
        controls.maxAzimuthAngle = THREE.MathUtils.degToRad(62);
        controls.minDistance = 10;
        controls.maxDistance = Math.max(dist0 * 1.8, mapPose().pos.y * 1.15);
        if (name === 'cinematic') cinT = 0;
        if (camAnim && camAnim.arrival) {
          // Mid-arrival, the dolly simply lands on the newly chosen preset.
          controls.maxPolarAngle = ARRIVAL_POLAR;
          const p = presetPose(name);
          Object.assign(camAnim, { p1: p.pos, q1: p.tgt, f1: p.fov, s1: p.shift });
        } else flyPose(presetPose(name), 900, { toPreset: true });
        requestRender();
      },
      setReplayProgress(p) {
        const v = Number.isFinite(Number(p)) ? clamp01(Number(p)) : 1;
        const following = replayFollow;
        replayIdx = replayAt(model, v).index;
        replayFollow = v < 1;
        emberMat.uniforms.uReplay.value = replayIdx;
        rainMat.uniforms.uReplayW.value = replayIdx >= 0 ? days[replayIdx].week : -1;
        if (!live() || !raf) settleReplay();
        revealExtras();
        if (following && !replayFollow && !interacted) flyPose(presetPose(preset), 900, { toPreset: true });
        requestRender();
      },
      setMotion(on) {
        motion = !!on;
        if (!live()) settleReplay();
        invalidate();
        requestRender();
      },
      setInteractive(on) {
        interactive = !!on;
        controls.enabled = interactive;
        canvas.style.pointerEvents = interactive ? 'auto' : 'none';
        if (!interactive) {
          pendingMove = null;
          down = null;
          if (hoverIdx != null) { applyHover(null); onHover(null); }
          canvas.classList.remove('is-hovering');
        }
        requestRender();
      },
      setQuality(mode2) {
        quality = ['auto', 'low', 'high'].includes(mode2) ? mode2 : 'auto';
        applyQuality();
      },
      setTheme(m, { animate = false } = {}) {
        const next = m === 'dark' ? 'dark' : 'light';
        if (animate && !reduced && raf && renderedFrames > 0) {
          if (next !== mode) startTheme(next, 1200);
        } else {
          finishTheme();
          mode = next;
          applyTheme();
        }
        requestRender();
      },
      skipArrival() {
        if (arrival === 'done' || arrival === 'skipped' || disposed) return;
        if (camAnim && camAnim.arrival) {
          // Mid-dolly: land on the current preset at once and settle the pending promise.
          const finish = camAnim.done;
          camAnim = null;
          applyPose(presetPose(preset));
          finish();
        }
        controls.maxPolarAngle = BASE_MAX_POLAR;
        arrival = 'skipped';
        if (!arrivalPromise) arrivalPromise = Promise.resolve();
        requestRender();
      },
      playArrival({ duration = 2500 } = {}) {
        if (arrivalPromise) return arrivalPromise;
        if (arrival !== 'pending' || disposed) return Promise.resolve();
        if (reduced) {
          arrival = 'skipped';
          arrivalPromise = Promise.resolve();
          return arrivalPromise;
        }
        const end = presetPose(preset);
        controls.maxPolarAngle = ARRIVAL_POLAR;
        applyPose(arrivalPose());
        arrival = 'playing';
        interacted = false;
        arrivalPromise = new Promise((resolve) => {
          camAnim = {
            t0: null, hold: renderedFrames > 0 ? 0 : 160, dur: Math.max(1, fin(duration, 2500)),
            arrival: true, toPreset: true, arc: Math.max(1.5, dist0 * 0.08),
            p0: camera.position.clone(), p1: end.pos, q0: controls.target.clone(), q1: end.tgt,
            f0: lens.fov, f1: end.fov, s0: lens.shift, s1: end.shift,
            done: () => {
              arrival = 'done';
              controls.maxPolarAngle = BASE_MAX_POLAR;
              resolve();
            },
          };
        });
        requestRender();
        return arrivalPromise;
      },
      flyTo(date, { duration = 1200 } = {}) {
        const idx = idxOf(date);
        if (idx == null) return Promise.resolve();
        leavePreset();
        return flyPose(rangePose(idx, idx), fin(duration, 1200));
      },
      getCameraPose() {
        return { position: vec(camera.position), target: vec(controls.target), fov: lens.fov, shift: lens.shift };
      },
      setCameraPose(pose, { duration = 0 } = {}) {
        const p = fromPublic(pose);
        if (!p) return Promise.resolve();
        leavePreset();
        const out = flyPose(p, fin(duration, 0));
        requestRender();
        return out;
      },
      poseForRange(startDate, endDate) {
        let a = idxOf(startDate);
        let b = idxOf(endDate == null ? startDate : endDate);
        if (a == null) a = b;
        if (b == null) b = a;
        if (a == null) return toPublic(presetPose('front'));
        return toPublic(rangePose(Math.min(a, b), Math.max(a, b)));
      },
      setHighlight(dates) {
        const list = Array.isArray(dates) ? dates : dates == null ? [] : [dates];
        const set = new Set();
        for (const v of list) { const i = idxOf(v); if (i != null) set.add(i); }
        highlightCount = set.size;
        for (let i = 0; i < N; i++) {
          if (!set.size) hlAttr.setX(i, 0);
          else if (set.has(i)) hlAttr.setX(i, 1);
          else hlAttr.setX(i, days[i].sea ? -0.35 : -1);
        }
        hlAttr.needsUpdate = true;
        invalidate();
        requestRender();
      },
      setParallax(dx, dy) {
        if (reduced) return;
        par.tx = Math.max(-1, Math.min(1, fin(dx)));
        par.ty = Math.max(-1, Math.min(1, fin(dy)));
        if (!raf) { par.x = par.tx; par.y = par.ty; requestRender(); }
      },
      setPinned(idx) { api.setSelection(typeof idx === 'number' ? (days[idx] && days[idx].date) : idx); },
      resetView() { api.setCameraPreset('front'); },
      capture() {
        if (disposed) return null;
        try {
          settleReplay();
          finishTheme();
          settleCamera();
          stepHover(0);
          renderNow();
          return canvas.toDataURL('image/png');
        } catch (e) {
          return null;
        }
      },
      getDiagnostics() {
        return {
          theme: mode, preset, quality, interactive, motion, reduced,
          post: postOn, dprCap, renderedFrames, days: N, weeks: nWeeks,
          visible, onScreen, replayIndex: replayIdx, disposed,
          camera: vec(camera.position), target: vec(controls.target), fov: camera.fov,
          arrival, highlightCount, themeTransition: !!themeAnim,
          reflections: reflOn, birds: !!(tier && tier.birds), windowLights: !!(tier && tier.windows),
        };
      },
      debugOrbit(azimuthDeg, elevationDeg) {
        endCamAnim();
        interacted = true;
        if (preset === 'cinematic') preset = 'front';
        controls.minAzimuthAngle = -Infinity;
        controls.maxAzimuthAngle = Infinity;
        controls.minPolarAngle = 0.01;
        controls.maxPolarAngle = Math.PI - 0.01;
        controls.minDistance = 1;
        controls.maxDistance = Infinity;
        setLens(frontLens.fov, frontLens.shift);
        const az = THREE.MathUtils.degToRad(Number(azimuthDeg) || 0);
        const el = THREE.MathUtils.degToRad(Number(elevationDeg) || 0);
        const tg = controls.target;
        camera.position.set(
          tg.x + Math.sin(az) * Math.cos(el) * dist0,
          tg.y + Math.sin(el) * dist0,
          tg.z + Math.cos(az) * Math.cos(el) * dist0);
        controls.update();
        renderNow();
      },
      debugPixels() {
        renderNow();
        const gl = renderer.getContext();
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        const w = Math.max(1, size.x | 0);
        const h = Math.max(1, size.y | 0);
        const px = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let sum = 0;
        let lit = 0;
        let n = 0;
        for (let i = 0; i < px.length; i += 32) {
          sum += px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
          if (px[i] + px[i + 1] + px[i + 2] > 24) lit++;
          n++;
        }
        return { width: w, height: h, mean: n ? sum / n : 0, litFraction: n ? lit / n : 0 };
      },
      dispose() {
        if (disposed) return;
        endCamAnim();
        if (readyResolve) { const r = readyResolve; readyResolve = null; r(); }
        disposeAll();
        scene.traverse((o) => {
          if (o.geometry) attempt(() => o.geometry.dispose());
          if (o.material) {
            for (const m of [].concat(o.material)) {
              if (m.map) attempt(() => m.map.dispose());
              attempt(() => m.dispose());
            }
          }
        });
        release();
      },
    };
    return api;
  } catch (e) {
    disposeAll();
    release();
    throw e;
  }
}

// ---------- original stylized motifs (canvas) ----------
function drawHatEmblem(g, cx, cy, s) {
  g.save();
  g.translate(cx, cy);
  g.scale(s, s);
  g.lineJoin = 'round';
  // brim
  g.fillStyle = '#E9C46A';
  g.strokeStyle = '#1B1B1F';
  g.lineWidth = 4;
  g.beginPath();
  g.ellipse(0, 18, 76, 20, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  // crown
  g.beginPath();
  g.moveTo(-40, 16);
  g.bezierCurveTo(-42, -38, 42, -38, 40, 16);
  g.closePath();
  g.fill();
  g.stroke();
  // band
  g.fillStyle = '#C1121F';
  g.beginPath();
  g.moveTo(-41, 2);
  g.bezierCurveTo(-20, 8, 20, 8, 41, 2);
  g.lineTo(40, 15);
  g.bezierCurveTo(20, 21, -20, 21, -40, 15);
  g.closePath();
  g.fill();
  g.stroke();
  // weave
  g.strokeStyle = 'rgba(27,27,31,.25)';
  g.lineWidth = 2;
  for (let i = -2; i <= 2; i++) {
    g.beginPath();
    g.moveTo(i * 14, -16);
    g.lineTo(i * 16, 0);
    g.stroke();
  }
  g.restore();
}

function drawCloud(g, cx, cy, s, fill, edge) {
  g.save();
  g.translate(cx, cy);
  g.scale(s, s);
  const puffs = [[-42, 6, 20], [-20, -10, 26], [10, -14, 28], [38, -2, 22], [52, 12, 15], [20, 12, 22], [-12, 14, 20], [-56, 16, 13]];
  const path = () => {
    g.beginPath();
    for (const [x, y, r] of puffs) { g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2); }
  };
  g.fillStyle = edge;
  g.save();
  g.lineWidth = 12;
  g.strokeStyle = edge;
  path();
  g.stroke();
  g.fill();
  g.restore();
  g.fillStyle = fill;
  path();
  g.fill();
  g.restore();
}
