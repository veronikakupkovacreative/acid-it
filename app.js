const canvas = document.getElementById("previewCanvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

const sourceCanvas = document.createElement("canvas");
const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });

let prepared = null;
let sourceImageData = null;

const state = {
  preset: 0,
  zoom: 1,
  showOriginal: false,
  sourceReady: false,
  imageName: "acid-it-demo",
  controls: {
    intensity: 100,
    contrast: 45,
    grain: 58,
    posterize: 6,
    saturation: 86,
    blend: 14,
    threshold: 0,
    chromaticOffset: 0,
    gradientSmoothness: 28,
    bleedAmount: 50,
    textureStrength: 50,
    displacement: 0,
  },
  motion: {
    enable: false,
    pingPong: false,
    speed: 45,
    flowAmount: 55,
    pulseIntensity: 0,
    glitchFreq: 0,
    loopSec: 6
  },
  options: {
    dither: true,
    detail: true,
    bleed: true,
    invert: false,
    refTexture: false,
    facePreserve: false,
    monoBase: false,
    transparent: false,
  },
};

const builtInPresets = [
  { name: "Acid Cyan", caption: "MAGENTA / BLACK", colors: ["#020204", "#0055ff", "#00f0ff", "#ff008f", "#fff36a"], preview: "./assets/presets/acid-cyan.jpg" },
  { name: "Toxic Blue", caption: "HOT PINK / ORANGE", colors: ["#02040c", "#0040ff", "#00c8ff", "#ff0a9b", "#ff5c00", "#ffe900"], preview: "./assets/presets/toxic-blue.jpg" },
  { name: "Neon Green", caption: "PURPLE / YELLOW", colors: ["#020202", "#301077", "#7a00ff", "#00ff75", "#fff000"], preview: "./assets/presets/neon-green.jpg" },
  { name: "Electric Blue", caption: "RED / CYAN", colors: ["#010104", "#003cff", "#00e5ff", "#ff123f", "#ff6a00"], preview: "./assets/presets/electric-blue.jpg" },
  { name: "Dirty Chrome", caption: "ACID PINK / TURQUOISE", colors: ["#050505", "#5d656b", "#00c4d8", "#ff1493", "#f5f0d8"], preview: "./assets/presets/dirty-chrome.jpg" },
  { name: "Infrared", caption: "HEATMAP", colors: ["#02110d", "#9a001f", "#ff183f", "#ff6b00", "#ffd400", "#fff2b6"], preview: "./assets/presets/infrared.jpg" },
  { name: "Cyberpunk", caption: "BRUISE", colors: ["#050017", "#15106e", "#0068ff", "#7a18ff", "#ff0aa8", "#ff4d1d"], preview: "./assets/presets/cyberpunk.jpg" },
  { name: "Liquid LSD", caption: "POSTER", colors: ["#030303", "#1736ff", "#00f0c8", "#ff00c8", "#ff4d00", "#fff200"], preview: "./assets/presets/liquid-lsd.jpg" },
];

const GRADIENT_LUT_SIZE = 1024;
const presetStopsCache = new WeakMap();
const gradientLutCache = new WeakMap();

let importedGradients = [];
let savedAcidPresets = loadSavedAcidPresets();
let presets = [];
refreshPresetCollection();

const sliderDefs = [
  ["intensity", "Intensity", 0, 100],
  ["contrast", "Contrast", -30, 80],
  ["grain", "Grain / Noise", 0, 100],
  ["posterize", "Posterize", 2, 12],
  ["saturation", "Saturation", 0, 140],
  ["blend", "Blend Original", 0, 100],
  ["threshold", "Threshold", 0, 100],
  ["chromaticOffset", "Chrom. Offset", 0, 100],
  ["gradientSmoothness", "Smoothness", 0, 100],
  ["bleedAmount", "Bleed Amount", 0, 100],
  ["textureStrength", "Texture Str.", 0, 100],
  ["displacement", "Displacement", 0, 100],
];

const motionSliderDefs = [
  ["speed", "Flow Speed", 0, 200],
  ["flowAmount", "Liquid Drift", 0, 100],
  ["pulseIntensity", "Pulse", 0, 100],
  ["glitchFreq", "Glitch", 0, 100],
  ["loopSec", "Loop Duration (s)", 1, 10]
];

const presetList = document.getElementById("presetList");
const sliders = document.getElementById("sliders");
const motionSliders = document.getElementById("motionSliders");
const fileInput = document.getElementById("fileInput");
const grdInput = document.getElementById("grdInput");
const dropZone = document.getElementById("dropZone");
const dropHint = document.getElementById("dropHint");
const toggleBtn = document.getElementById("toggleBtn");
const gradientImportStatus = document.getElementById("gradientImportStatus");

let animFrameId = null;
let animStartTime = 0;
let mediaRecorder = null;

function clamp(value, min = 0, max = 255) { return Math.max(min, Math.min(max, value)); }

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
}

function mix(a, b, t) { return a + (b - a) * t; }

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function random2(x, y, seed = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function wrapCoord(value, max) {
  return ((value % max) + max) % max;
}

function sampleField(field, x, y, width, height) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = x - x0;
  const ty = y - y0;

  const ix0 = wrapCoord(x0, width);
  const ix1 = wrapCoord(x1, width);
  const iy0 = wrapCoord(y0, height);
  const iy1 = wrapCoord(y1, height);

  const a = field[iy0 * width + ix0];
  const b = field[iy0 * width + ix1];
  const c = field[iy1 * width + ix0];
  const d = field[iy1 * width + ix1];

  return mix(mix(a, b, tx), mix(c, d, tx), ty);
}

function getMotionCycleMs() {
  const speed = Math.max(0, state.motion.speed);
  const baseMs = state.motion.loopSec * 1000;
  if (speed <= 0) return baseMs * (state.motion.pingPong ? 2 : 1);
  return baseMs * (100 / speed) * (state.motion.pingPong ? 2 : 1);
}

function refreshPresetCollection() {
  builtInPresets.forEach((preset) => { preset.source = "builtin"; });
  presets = [...builtInPresets, ...savedAcidPresets, ...importedGradients];
  if (state.preset >= presets.length) state.preset = 0;
}

function loadSavedAcidPresets() {
  try {
    const raw = localStorage.getItem("acidItSavedGradients");
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(normalizeImportedPreset).filter(Boolean) : [];
  } catch (error) {
    return [];
  }
}

function persistSavedAcidPresets() {
  try {
    localStorage.setItem("acidItSavedGradients", JSON.stringify(savedAcidPresets));
  } catch (error) {
    setGradientStatus("Saved presets are available for this session only.");
  }
}

function setGradientStatus(message) {
  if (gradientImportStatus) gradientImportStatus.textContent = message;
}

function rgbToHex(rgb) {
  return `#${rgb.slice(0, 3).map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

function rgbToCss(rgb, alpha = 1) {
  const r = clamp(Math.round(rgb[0]), 0, 255);
  const g = clamp(Math.round(rgb[1]), 0, 255);
  const b = clamp(Math.round(rgb[2]), 0, 255);
  const a = clamp(alpha, 0, 1);
  return a >= 0.999 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

function getPresetStops(preset) {
  if (preset && typeof preset === "object") {
    const cached = presetStopsCache.get(preset);
    if (cached) return cached;
  }

  let stops;
  if (preset && Array.isArray(preset.stops) && preset.stops.length) {
    stops = preset.stops
      .map((stop) => ({
        position: clamp(Number(stop.position), 0, 1),
        color: Array.isArray(stop.color) ? stop.color.slice(0, 3).map((value) => clamp(Number(value), 0, 255)) : [0, 0, 0],
        alpha: Number.isFinite(stop.alpha) ? clamp(stop.alpha, 0, 1) : 1,
        midpoint: Number.isFinite(stop.midpoint) ? clamp(stop.midpoint, 0.01, 0.99) : 0.5,
      }))
      .sort((a, b) => a.position - b.position);
  } else {
    const colors = (preset?.colors || ["#000000", "#ffffff"]).map(hexToRgb);
    const max = Math.max(1, colors.length - 1);
    stops = colors.map((color, index) => ({
      position: index / max,
      color,
      alpha: 1,
      midpoint: 0.5,
    }));
  }

  if (preset && typeof preset === "object") presetStopsCache.set(preset, stops);
  return stops;
}

function sampleOpacityStops(value, stops) {
  if (!stops || stops.length === 0) return 1;
  const sorted = stops.slice().sort((a, b) => a.position - b.position);
  const v = clamp(value, 0, 1);
  if (v <= sorted[0].position) return sorted[0].alpha;
  if (v >= sorted[sorted.length - 1].position) return sorted[sorted.length - 1].alpha;

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const left = sorted[i];
    const right = sorted[i + 1];
    if (v >= left.position && v <= right.position) {
      const span = Math.max(0.00001, right.position - left.position);
      const midpoint = clamp(right.midpoint ?? left.midpoint ?? 0.5, 0.01, 0.99);
      let t = (v - left.position) / span;
      t = t < midpoint ? (0.5 * t) / midpoint : 0.5 + (0.5 * (t - midpoint)) / (1 - midpoint);
      return mix(left.alpha, right.alpha, smoothstep(0, 1, t));
    }
  }

  return 1;
}

function sampleGradientDirect(value, preset) {
  const stops = getPresetStops(preset);
  const v = clamp(value, 0, 1);
  if (v <= stops[0].position) return [...stops[0].color, stops[0].alpha];
  if (v >= stops[stops.length - 1].position) return [...stops[stops.length - 1].color, stops[stops.length - 1].alpha];

  for (let i = 0; i < stops.length - 1; i += 1) {
    const left = stops[i];
    const right = stops[i + 1];
    if (v >= left.position && v <= right.position) {
      const span = Math.max(0.00001, right.position - left.position);
      const midpoint = clamp(right.midpoint ?? left.midpoint ?? 0.5, 0.01, 0.99);
      let t = (v - left.position) / span;
      t = t < midpoint ? (0.5 * t) / midpoint : 0.5 + (0.5 * (t - midpoint)) / (1 - midpoint);
      t = smoothstep(0, 1, t);
      return [
        mix(left.color[0], right.color[0], t),
        mix(left.color[1], right.color[1], t),
        mix(left.color[2], right.color[2], t),
        mix(left.alpha, right.alpha, t),
      ];
    }
  }

  const last = stops[stops.length - 1];
  return [...last.color, last.alpha];
}

function getGradientLut(preset) {
  if (!preset || typeof preset !== "object") return null;
  const cached = gradientLutCache.get(preset);
  if (cached) return cached;

  const data = new Float32Array(GRADIENT_LUT_SIZE * 4);
  for (let i = 0; i < GRADIENT_LUT_SIZE; i += 1) {
    const color = sampleGradientDirect(i / (GRADIENT_LUT_SIZE - 1), preset);
    const offset = i * 4;
    data[offset] = color[0];
    data[offset + 1] = color[1];
    data[offset + 2] = color[2];
    data[offset + 3] = color[3] ?? 1;
  }

  const lut = { data, size: GRADIENT_LUT_SIZE };
  gradientLutCache.set(preset, lut);
  return lut;
}

function sampleGradient(value, preset) {
  const lut = getGradientLut(preset);
  const scaled = clamp(value, 0, 1) * (lut.size - 1);
  const index = Math.min(lut.size - 2, Math.floor(scaled));
  const t = scaled - index;
  const offset = index * 4;
  return [
    mix(lut.data[offset], lut.data[offset + 4], t),
    mix(lut.data[offset + 1], lut.data[offset + 5], t),
    mix(lut.data[offset + 2], lut.data[offset + 6], t),
    mix(lut.data[offset + 3], lut.data[offset + 7], t),
  ];
}

function buildPresetPreview(preset) {
  if (preset.preview) return `url("${preset.preview}")`;
  const stops = getPresetStops(preset);
  const previewStops = stops.length > 14
    ? Array.from({ length: 14 }, (_, index) => {
      const color = sampleGradientDirect(index / 13, preset);
      return { position: index / 13, color, alpha: color[3] ?? 1 };
    })
    : stops;
  return `linear-gradient(90deg, ${previewStops.map((stop) => `${rgbToCss(stop.color, stop.alpha)} ${Math.round(stop.position * 100)}%`).join(", ")})`;
}

function normalizeImportedPreset(preset) {
  if (!preset || !Array.isArray(preset.stops) || preset.stops.length < 2) return null;
  const stops = getPresetStops(preset);
  const opacityStops = Array.isArray(preset.opacityStops)
    ? preset.opacityStops.map((stop) => ({
      position: clamp(Number(stop.position), 0, 1),
      alpha: clamp(Number(stop.alpha), 0, 1),
      midpoint: Number.isFinite(stop.midpoint) ? clamp(stop.midpoint, 0.01, 0.99) : 0.5,
    })).sort((a, b) => a.position - b.position)
    : [];

  return {
    id: preset.id || `gradient-${Date.now()}-${Math.round(Math.random() * 100000)}`,
    source: preset.source || "imported",
    name: String(preset.name || "Imported Gradient").trim() || "Imported Gradient",
    caption: preset.caption || (preset.source === "saved" ? "ACID PRESET" : "PHOTOSHOP .GRD"),
    stops,
    opacityStops,
    colors: stops.map((stop) => rgbToHex(stop.color)),
  };
}

function applySaturation(rgb, amount) {
  const sat = amount / 100;
  const lum = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return [mix(lum, rgb[0], sat), mix(lum, rgb[1], sat), mix(lum, rgb[2], sat)];
}

class GrdReader {
  constructor(buffer) {
    this.view = new DataView(buffer);
    this.offset = 0;
  }

  ensure(bytes) {
    if (this.offset + bytes > this.view.byteLength) throw new Error("Unexpected end of GRD file.");
  }

  readUint8() { this.ensure(1); const value = this.view.getUint8(this.offset); this.offset += 1; return value; }
  readInt16() { this.ensure(2); const value = this.view.getInt16(this.offset, false); this.offset += 2; return value; }
  readUint16() { this.ensure(2); const value = this.view.getUint16(this.offset, false); this.offset += 2; return value; }
  readInt32() { this.ensure(4); const value = this.view.getInt32(this.offset, false); this.offset += 4; return value; }
  readUint32() { this.ensure(4); const value = this.view.getUint32(this.offset, false); this.offset += 4; return value; }
  readFloat64() { this.ensure(8); const value = this.view.getFloat64(this.offset, false); this.offset += 8; return value; }

  readAscii(length) {
    this.ensure(length);
    let text = "";
    for (let i = 0; i < length; i += 1) text += String.fromCharCode(this.readUint8());
    return text;
  }

  readPascalString() {
    const length = this.readUint8();
    return this.readAscii(length).replace(/\0+$/g, "");
  }

  readUnicodeString() {
    const length = this.readUint32();
    if (!length) return "";
    this.ensure(length * 2);
    let text = "";
    for (let i = 0; i < length; i += 1) {
      const code = this.readUint16();
      if (code !== 0) text += String.fromCharCode(code);
    }
    return text;
  }

  readId() {
    const length = this.readUint32();
    return length === 0 ? this.readAscii(4) : this.readAscii(length);
  }
}

function hsvToRgb(hue, saturation, brightness) {
  const h = ((hue % 360) + 360) % 360;
  const s = clamp(saturation / 100, 0, 1);
  const v = clamp(brightness / 100, 0, 1);
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rgb = [0, 0, 0];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgb.map((channel) => (channel + m) * 255);
}

function cmykToRgb(cyan, magenta, yellow, black) {
  const c = clamp(cyan / 100, 0, 1);
  const m = clamp(magenta / 100, 0, 1);
  const y = clamp(yellow / 100, 0, 1);
  const k = clamp(black / 100, 0, 1);
  return [255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k)];
}

function labToRgb(l, a, b) {
  let y = (l + 16) / 116;
  let x = a / 500 + y;
  let z = y - b / 200;
  const pivot = (value) => {
    const cube = value * value * value;
    return cube > 0.008856 ? cube : (value - 16 / 116) / 7.787;
  };
  x = 95.047 * pivot(x);
  y = 100.0 * pivot(y);
  z = 108.883 * pivot(z);

  x /= 100; y /= 100; z /= 100;
  let r = x * 3.2406 + y * -1.5372 + z * -0.4986;
  let g = x * -0.9689 + y * 1.8758 + z * 0.0415;
  let bl = x * 0.0557 + y * -0.2040 + z * 1.0570;
  const gamma = (value) => value > 0.0031308 ? 1.055 * Math.pow(value, 1 / 2.4) - 0.055 : value * 12.92;
  return [gamma(r) * 255, gamma(g) * 255, gamma(bl) * 255].map((value) => clamp(value, 0, 255));
}

function normalizeColorValue(value) {
  return value > 255 ? value / 257 : value;
}

function colorFromModel(model, values) {
  if (model === 0) return [normalizeColorValue(values[0]), normalizeColorValue(values[1]), normalizeColorValue(values[2])];
  if (model === 1) return hsvToRgb(values[0] / 182.04, values[1] / 655.35, values[2] / 655.35);
  if (model === 2) return cmykToRgb(values[0] / 655.35, values[1] / 655.35, values[2] / 655.35, values[3] / 655.35);
  if (model === 7) return labToRgb(values[0] / 100, values[1] / 256 - 128, values[2] / 256 - 128);
  if (model === 8) {
    const gray = 255 - normalizeColorValue(values[0]);
    return [gray, gray, gray];
  }
  return [0, 0, 0];
}

function descriptorNumber(value, fallback = 0) {
  if (typeof value === "number") return value;
  if (value && typeof value.value === "number") return value.value;
  return fallback;
}

function descriptorEntry(source, keys) {
  if (!source) return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
  }

  const trimmedKeys = keys.map((key) => key.trim());
  const match = Object.keys(source).find((key) => trimmedKeys.includes(key.trim()));
  return match ? source[match] : undefined;
}

function descriptorChannel(source, keys, fallback = 0) {
  return descriptorNumber(descriptorEntry(source, keys), fallback);
}

function parseDescriptorValue(reader, type) {
  switch (type) {
    case "Objc":
    case "GlbO":
      return parseDescriptor(reader);
    case "VlLs": {
      const count = reader.readUint32();
      const items = [];
      for (let i = 0; i < count; i += 1) items.push(parseDescriptorValue(reader, reader.readAscii(4)));
      return items;
    }
    case "doub":
      return reader.readFloat64();
    case "UntF":
      return { unit: reader.readAscii(4), value: reader.readFloat64() };
    case "TEXT":
      return reader.readUnicodeString();
    case "enum":
      return { type: reader.readId(), value: reader.readId() };
    case "long":
      return reader.readInt32();
    case "comp":
      return Number(reader.readUint32()) * 4294967296 + reader.readUint32();
    case "bool":
      return reader.readUint8() !== 0;
    case "type":
    case "GlbC":
      return { name: reader.readUnicodeString(), classId: reader.readId() };
    case "tdta": {
      const length = reader.readUint32();
      const start = reader.offset;
      reader.offset += length;
      return { rawStart: start, length };
    }
    case "alis": {
      const length = reader.readUint32();
      reader.offset += length;
      return "";
    }
    case "obj ":
      return parseReference(reader);
    default:
      throw new Error(`Unsupported Photoshop descriptor type: ${type}`);
  }
}

function parseReference(reader) {
  const count = reader.readUint32();
  const refs = [];
  for (let i = 0; i < count; i += 1) {
    const type = reader.readAscii(4);
    if (type === "prop") refs.push({ type, name: reader.readUnicodeString(), classId: reader.readId(), keyId: reader.readId() });
    else if (type === "Clss") refs.push({ type, name: reader.readUnicodeString(), classId: reader.readId() });
    else if (type === "Enmr") refs.push({ type, name: reader.readUnicodeString(), classId: reader.readId(), enumType: reader.readId(), enumValue: reader.readId() });
    else if (type === "rele") refs.push({ type, name: reader.readUnicodeString(), classId: reader.readId(), value: reader.readInt32() });
    else if (type === "Idnt" || type === "indx") refs.push({ type, value: reader.readInt32() });
    else if (type === "name") refs.push({ type, name: reader.readUnicodeString(), classId: reader.readId(), value: reader.readUnicodeString() });
    else throw new Error(`Unsupported Photoshop reference type: ${type}`);
  }
  return refs;
}

function parseDescriptor(reader) {
  const descriptor = { _name: reader.readUnicodeString(), _classId: reader.readId() };
  const count = reader.readUint32();
  for (let i = 0; i < count; i += 1) {
    const key = reader.readId();
    const type = reader.readAscii(4);
    descriptor[key] = parseDescriptorValue(reader, type);
  }
  return descriptor;
}

function colorFromDescriptor(color) {
  if (!color) return [0, 0, 0];
  const type = color._classId;
  if (type === "RGBC") {
    return [
      descriptorChannel(color, ["Rd  ", "Rd ", "Rd"]),
      descriptorChannel(color, ["Grn ", "Grn"]),
      descriptorChannel(color, ["Bl  ", "Bl ", "Bl"]),
    ];
  }
  if (type === "HSBC") return hsvToRgb(descriptorChannel(color, ["H   ", "H ", "H"]), descriptorChannel(color, ["Strt"]), descriptorChannel(color, ["Brgh"]));
  if (type === "CMYC") return cmykToRgb(descriptorChannel(color, ["Cyn ", "Cyn"]), descriptorChannel(color, ["Mgnt"]), descriptorChannel(color, ["Ylw ", "Ylw"]), descriptorChannel(color, ["Blck"]));
  if (type === "LbCl") return labToRgb(descriptorChannel(color, ["Lmnc"]), descriptorChannel(color, ["A   ", "A ", "A"]), descriptorChannel(color, ["B   ", "B ", "B"]));
  if (type === "Grsc") {
    const gray = descriptorChannel(color, ["Gry ", "Gry"]) * 2.55;
    return [gray, gray, gray];
  }
  return [0, 0, 0];
}

function parseGradientVersion3(reader, fileName) {
  const count = reader.readUint16();
  const gradients = [];
  for (let i = 0; i < count; i += 1) {
    const name = reader.readPascalString() || `${fileName} ${i + 1}`;
    const colorStopCount = reader.readUint16();
    const stops = [];
    for (let j = 0; j < colorStopCount; j += 1) {
      const position = clamp(reader.readInt32() / 4096, 0, 1);
      const midpoint = clamp(reader.readInt32() / 100, 0.01, 0.99);
      const model = reader.readUint16();
      const values = [reader.readUint16(), reader.readUint16(), reader.readUint16(), reader.readUint16()];
      const colorType = reader.readUint16();
      let color = colorFromModel(model, values);
      if (colorType === 1) color = [0, 0, 0];
      if (colorType === 2) color = [255, 255, 255];
      stops.push({ position, midpoint, color, alpha: 1 });
    }

    const transparencyStopCount = reader.readUint16();
    const opacityStops = [];
    for (let j = 0; j < transparencyStopCount; j += 1) {
      opacityStops.push({
        position: clamp(reader.readInt32() / 4096, 0, 1),
        midpoint: clamp(reader.readInt32() / 100, 0.01, 0.99),
        alpha: clamp(reader.readUint16() / 255, 0, 1),
      });
    }

    reader.offset += 6;
    stops.forEach((stop) => { stop.alpha = sampleOpacityStops(stop.position, opacityStops); });
    gradients.push(normalizeImportedPreset({ name, source: "imported", caption: "PHOTOSHOP .GRD", stops, opacityStops }));
  }
  return gradients.filter(Boolean);
}

function parseGradientVersion5(reader, fileName) {
  const descriptorVersion = reader.readUint32();
  if (descriptorVersion !== 16) throw new Error("Unsupported Photoshop GRD descriptor version.");
  const descriptor = parseDescriptor(reader);
  const list = Array.isArray(descriptor.GrdL) ? descriptor.GrdL : [];
  const gradients = [];

  list.forEach((entry, index) => {
    const gradient = entry.Grad || entry;
    const type = gradient.GrdF?.value || "CstS";
    if (type !== "CstS" || !Array.isArray(gradient.Clrs)) return;
    const opacityStops = Array.isArray(gradient.Trns)
      ? gradient.Trns.map((stop) => ({
        position: clamp(descriptorNumber(stop.Lctn) / 4096, 0, 1),
        midpoint: clamp(descriptorNumber(stop.Mdpn, 50) / 100, 0.01, 0.99),
        alpha: clamp(descriptorNumber(stop.Opct, 100) / 100, 0, 1),
      }))
      : [];

    const stops = gradient.Clrs.map((stop) => {
      const typeValue = stop.Type?.value;
      let color = colorFromDescriptor(stop["Clr "]);
      if (typeValue === "FrgC") color = [0, 0, 0];
      if (typeValue === "BckC") color = [255, 255, 255];
      const position = clamp(descriptorNumber(stop.Lctn) / 4096, 0, 1);
      return {
        position,
        midpoint: clamp(descriptorNumber(stop.Mdpn, 50) / 100, 0.01, 0.99),
        color,
        alpha: sampleOpacityStops(position, opacityStops),
      };
    });

    gradients.push(normalizeImportedPreset({
      name: gradient["Nm "] || entry["Nm "] || `${fileName} ${index + 1}`,
      source: "imported",
      caption: "PHOTOSHOP .GRD",
      stops,
      opacityStops,
    }));
  });

  return gradients.filter(Boolean);
}

function parsePhotoshopGrd(buffer, fileName = "Imported") {
  const reader = new GrdReader(buffer);
  const signature = reader.readAscii(4);
  if (signature !== "8BGR") throw new Error("This is not a Photoshop gradient preset file.");
  const version = reader.readUint16();
  if (version === 3) return parseGradientVersion3(reader, fileName);
  if (version === 5) return parseGradientVersion5(reader, fileName);
  throw new Error(`Unsupported GRD version ${version}.`);
}

function fitCanvasToSource(width, height, resolutionMultiplier = 1) {
  const maxSide = 1000 * resolutionMultiplier;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  sourceCanvas.width = canvas.width;
  sourceCanvas.height = canvas.height;
}

function drawImageCover(context, image, width, height) {
  const ratio = Math.min(width / image.width, height / image.height);
  const w = image.width * ratio;
  const h = image.height * ratio;
  const x = (width - w) / 2;
  const y = (height - h) / 2;
  context.clearRect(0, 0, width, height);
  context.drawImage(image, x, y, w, h);
}

function prepareSource() {
  const { width, height } = canvas;
  sourceImageData = sourceCtx.getImageData(0, 0, width, height);
  const pixels = width * height;
  const lum = new Float32Array(pixels);
  const flow = new Float32Array(pixels);
  const grain = new Float32Array(pixels);
  const offsetX = new Int16Array(pixels);
  const offsetY = new Int16Array(pixels);
  const source = sourceImageData.data;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const i = p * 4;
      lum[p] = (source[i] * 0.2126 + source[i + 1] * 0.7152 + source[i + 2] * 0.0722) / 255;
      const coarse = random2(x >> 5, y >> 5, 21);
      const mid = random2(x >> 3, y >> 3, 12);
      const wave = Math.sin(x * 0.013 + y * 0.005 + coarse * 6.283) * 0.5 + Math.sin(x * 0.004 - y * 0.011 + mid * 6.283) * 0.5;
      flow[p] = wave * 0.62 + (coarse - 0.5) * 0.45 + (mid - 0.5) * 0.22;
      grain[p] = random2(x, y, 99) - 0.5;
      offsetX[p] = Math.round(flow[p] * 22 + Math.sin(y * 0.017) * 7);
      offsetY[p] = Math.round(flow[p] * 17 + Math.cos(x * 0.013) * 5);
    }
  }
  prepared = { width, height, lum, flow, grain, offsetX, offsetY };
}

let originalImageElement = null;

function makeDemoImage() {
  const img = new Image();
  img.crossOrigin = "Anonymous";
  img.onload = () => {
    originalImageElement = img;
    fitCanvasToSource(img.width, img.height, 1);
    drawImageCover(sourceCtx, img, sourceCanvas.width, sourceCanvas.height);
    state.sourceReady = true;
    prepareSource();
    dropHint.classList.add("is-hidden"); dropHint.hidden = true;
    doRender(performance.now(), false);
  };
  img.onerror = () => {
    // Fallback to old procedural drawing if image not found
    fitCanvasToSource(1000, 1000);
    const gradient = sourceCtx.createLinearGradient(0, 0, 1000, 1000);
    gradient.addColorStop(0, "#101010"); gradient.addColorStop(0.36, "#7d7d7d");
    gradient.addColorStop(0.62, "#d7d7d7"); gradient.addColorStop(1, "#222222");
    sourceCtx.fillStyle = gradient; sourceCtx.fillRect(0, 0, 1000, 1000);
    sourceCtx.fillStyle = "#050505"; sourceCtx.fillRect(0, 0, 1000, 1000);

    const face = sourceCtx.createRadialGradient(760, 620, 90, 760, 650, 470);
    face.addColorStop(0, "#eeeeee"); face.addColorStop(0.45, "#a6a6a6");
    face.addColorStop(0.72, "#383838"); face.addColorStop(1, "#050505");
    sourceCtx.fillStyle = face;
    sourceCtx.beginPath(); sourceCtx.ellipse(760, 655, 335, 455, -0.08, 0, Math.PI * 2); sourceCtx.fill();

    const imgData = sourceCtx.getImageData(0, 0, 1000, 1000);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const px = (i / 4) % 1000; const py = Math.floor(i / 4 / 1000);
      const n = (random2(px, py, 44) - 0.5) * 46;
      data[i] = clamp(data[i] + n); data[i + 1] = clamp(data[i + 1] + n); data[i + 2] = clamp(data[i + 2] + n);
    }
    sourceCtx.putImageData(imgData, 0, 0);
    state.sourceReady = true; prepareSource(); 
    doRender(0, false);
  };
  img.src = "./Metallic Hand Close-Up (1)-acid.png";
}

function loadFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  state.imageName = file.name.replace(/\.[^/.]+$/, "") || "acid-it-export";
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      originalImageElement = image;
      fitCanvasToSource(image.width, image.height, 1);
      drawImageCover(sourceCtx, image, sourceCanvas.width, sourceCanvas.height);
      state.sourceReady = true; prepareSource();
      dropHint.classList.add("is-hidden"); dropHint.hidden = true;
      doRender(performance.now(), false);
    };
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function doRender(now = 0, isExport = false) {
  if (!state.sourceReady || !prepared || !sourceImageData) return;
  if (state.showOriginal) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(sourceCanvas, 0, 0);
    return;
  }

  const { width, height } = canvas;
  const out = ctx.createImageData(width, height);
  const srcData = sourceImageData.data;
  const data = out.data;
  const currentPreset = presets[state.preset] || presets[0];
  const gradientLut = getGradientLut(currentPreset);
  const gradientData = gradientLut.data;
  const gradientMaxIndex = gradientLut.size - 1;

  const intensity = state.controls.intensity / 100;
  const contrast = state.controls.contrast;
  const grain = state.controls.grain / 100;
  const posterSteps = state.controls.posterize;
  const blendOriginal = state.controls.blend / 100;
  const saturationAmount = state.controls.saturation / 100;

  const threshold = state.controls.threshold / 100;
  const baseChromOffset = Math.round(state.controls.chromaticOffset * (width / 1500));
  const smoothness = state.controls.gradientSmoothness / 100;
  const bleedAmt = state.controls.bleedAmount / 50;
  const texStrength = state.controls.textureStrength / 50;
  const dispAmt = state.controls.displacement / 100;

  const bleedPower = state.options.bleed ? (0.1 + intensity * 0.12) * bleedAmt : 0;
  const ditherPower = state.options.dither ? 0.055 : 0;

  // MOTION CALCULATIONS
  let progress = 0, angle = 0, textureOffsetX = 0, textureOffsetY = 0, pulse = 0;
  let glitchActive = false;
  
  if (state.motion.enable) {
     const speed = Math.max(0, state.motion.speed);
     const elapsed = (now - animStartTime) / 1000;
     if (speed > 0) {
        const loopDur = state.motion.loopSec * (100 / speed);
        let t = elapsed % (state.motion.pingPong ? loopDur * 2 : loopDur);
        
        if (state.motion.pingPong && t > loopDur) {
           progress = 1.0 - ((t - loopDur) / loopDur);
        } else {
           progress = t / loopDur;
        }
     }

     angle = progress * Math.PI * 2;
     
     const flowScale = state.motion.flowAmount / 100;
     const travel = Math.max(width, height) * (0.1 + flowScale * 0.22) * flowScale;
     textureOffsetX = Math.cos(angle) * travel;
     textureOffsetY = Math.sin(angle) * travel * 0.72;

     pulse = Math.sin(angle * 2) * (state.motion.pulseIntensity / 100);

     const gFreq = state.motion.glitchFreq;
     if (gFreq > 0) {
        const glitchHash = Math.sin(progress * 100) * 100;
        if (glitchHash > (100 - gFreq * 0.5) && Math.random() > 0.5) {
            glitchActive = true;
        }
     }
  }

  const finalChromOffset = baseChromOffset + (glitchActive ? Math.random() * 40 * (state.motion.glitchFreq / 50) : (pulse > 0 ? pulse * 10 : 0));

  const step = 1;

  for (let y = 0; y < height; y += step) {
    // Scane-line glitch
    let lineGlitchX = 0;
    if (glitchActive && y % 10 < 2) lineGlitchX = (Math.random() - 0.5) * 40 * (state.motion.glitchFreq / 50);

    for (let x = 0; x < width; x += step) {
      const p = y * width + x; 
      const i = p * 4;

      let faceMask = 1.0;
      if (state.options.facePreserve) {
        const dx = (x - width * 0.5) / (width * 0.5);
        const dy = (y - height * 0.5) / (height * 0.5);
        const dist = Math.sqrt(dx * dx + dy * dy);
        faceMask = smoothstep(0.15, 0.5, dist);
      }

      let sx = Math.round(clamp(x + lineGlitchX, 0, width - 1)); 
      let sy = y;
      
      if (dispAmt > 0) {
        const localDisp = dispAmt * faceMask;
        sx = clamp(Math.round(sx + prepared.offsetX[p] * localDisp * 4), 0, width - 1);
        sy = clamp(Math.round(sy + prepared.offsetY[p] * localDisp * 4), 0, height - 1);
      }
      
      const dp = sy * width + sx;
      const originalLum = prepared.lum[dp];

      const localBleed = bleedPower * faceMask;
      const cx = clamp(Math.round(sx + prepared.offsetX[dp] * localBleed), 0, width - 1);
      const cy = clamp(Math.round(sy + prepared.offsetY[dp] * localBleed), 0, height - 1);
      let lum = mix(originalLum, prepared.lum[cy * width + cx], localBleed);
      lum = (lum - 0.5) * (1 + contrast / 54) + 0.5;

      const localTexStrength = texStrength * faceMask;
      let activeFlow = state.options.refTexture ? prepared.flow[dp] : Math.sin(x*0.015 + y*0.015)*0.3;
      if (state.motion.enable && state.motion.flowAmount > 0) {
        const flowScale = state.motion.flowAmount / 100;
        const liquidWarp = flowScale * 28;
        const warpX = Math.sin((x + textureOffsetY) * 0.018 + angle) * liquidWarp + prepared.offsetX[p] * flowScale * 0.9;
        const warpY = Math.cos((y - textureOffsetX) * 0.015 - angle * 0.7) * liquidWarp + prepared.offsetY[p] * flowScale * 0.9;
        const movingFlow = sampleField(prepared.flow, x + textureOffsetX + warpX, y + textureOffsetY + warpY, width, height);
        const counterFlow = sampleField(prepared.flow, x - textureOffsetX * 0.42 + warpY, y - textureOffsetY * 0.42 + warpX, width, height);
        activeFlow = mix(movingFlow, counterFlow, 0.32);
      }
      lum += activeFlow * 0.09 * intensity * localTexStrength;

      if (pulse !== 0) lum = clamp(lum + pulse * 0.15 * lum, 0, 1);

      if (threshold > 0) {
        const edge0 = Math.max(0, 0.5 - (1 - threshold) * 0.5);
        const edge1 = Math.min(1, 0.5 + (1 - threshold) * 0.5);
        lum = smoothstep(edge0, edge1, lum);
      }

      if (state.options.dither) {
        lum += (((x & 1) + ((y & 1) << 1)) / 4 - 0.375) * ditherPower;
      }

      lum = clamp(lum, 0, 1);
      if (state.options.invert) lum = 1.0 - lum;

      const posterized = Math.round(lum * (posterSteps - 1)) / (posterSteps - 1);
      lum = mix(posterized, lum, smoothness);

      const gradientIndex = clamp(lum, 0, 1) * gradientMaxIndex;
      const gradientBase = Math.min(gradientMaxIndex - 1, Math.floor(gradientIndex));
      const gradientT = gradientIndex - gradientBase;
      const gradientOffset = gradientBase * 4;
      let mappedR = mix(gradientData[gradientOffset], gradientData[gradientOffset + 4], gradientT);
      let mappedG = mix(gradientData[gradientOffset + 1], gradientData[gradientOffset + 5], gradientT);
      let mappedB = mix(gradientData[gradientOffset + 2], gradientData[gradientOffset + 6], gradientT);
      const gradientAlpha = mix(gradientData[gradientOffset + 3], gradientData[gradientOffset + 7], gradientT);

      const mappedLum = mappedR * 0.2126 + mappedG * 0.7152 + mappedB * 0.0722;
      mappedR = mix(mappedLum, mappedR, saturationAmount);
      mappedG = mix(mappedLum, mappedG, saturationAmount);
      mappedB = mix(mappedLum, mappedB, saturationAmount);

      if (state.options.detail) {
        const detail = (originalLum - 0.5) * 42;
        mappedR += detail; mappedG += detail; mappedB += detail;
      }

      const activeGrain = state.options.refTexture ? prepared.grain[dp] : prepared.grain[p];
      const noise = activeGrain * 80 * grain * localTexStrength;
      const halftone = state.options.dither ? Math.sin(x * 0.46 + y * 0.18) * Math.sin(y * 0.42) * 20 * grain : 0;

      mappedR = clamp(mappedR + noise + halftone);
      mappedG = clamp(mappedG + noise + halftone);
      mappedB = clamp(mappedB + noise + halftone);

      if (gradientAlpha < 0.999) {
        mappedR = mix(srcData[i], mappedR, gradientAlpha);
        mappedG = mix(srcData[i + 1], mappedG, gradientAlpha);
        mappedB = mix(srcData[i + 2], mappedB, gradientAlpha);
      }

      if (state.options.monoBase) {
        const gray = originalLum * 255;
        mappedR = clamp(255 - ((255 - gray) * (255 - mappedR)) / 255);
        mappedG = clamp(255 - ((255 - gray) * (255 - mappedG)) / 255);
        mappedB = clamp(255 - ((255 - gray) * (255 - mappedB)) / 255);
      }

      const alpha = state.options.transparent ? clamp(smoothstep(0.02, 0.2, originalLum) * 255 * gradientAlpha) : srcData[i + 3];

      // WRITE PIXELS (apply stepping for performance)
      data[i] = mappedR; data[i + 1] = mappedG; data[i + 2] = mappedB; data[i + 3] = alpha;
      if (step === 2) {
         if (x + 1 < width) {
            const i2 = i + 4;
            data[i2] = mappedR; data[i2+1] = mappedG; data[i2+2] = mappedB; data[i2+3] = alpha;
         }
         if (y + 1 < height) {
            const i3 = i + width * 4;
            data[i3] = mappedR; data[i3+1] = mappedG; data[i3+2] = mappedB; data[i3+3] = alpha;
            if (x + 1 < width) {
               const i4 = i3 + 4;
               data[i4] = mappedR; data[i4+1] = mappedG; data[i4+2] = mappedB; data[i4+3] = alpha;
            }
         }
      }
    }
  }

  // Chromatic Offset Post-Process
  const mappedData = finalChromOffset > 0 ? new Uint8ClampedArray(data) : data;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const p = y * width + x; const i = p * 4;
      let mR = mappedData[i], mG = mappedData[i + 1], mB = mappedData[i + 2], alpha = mappedData[i + 3];

      if (finalChromOffset > 0) {
        const off = Math.round(finalChromOffset);
        const rx = clamp(x - off, 0, width - 1); const ry = clamp(y - Math.floor(off*0.5), 0, height - 1);
        const bx = clamp(x + off, 0, width - 1); const by = clamp(y + Math.floor(off*0.5), 0, height - 1);
        mR = mappedData[(ry * width + rx) * 4];
        mB = mappedData[(by * width + bx) * 4 + 2];
      }

      const r = srcData[i], g = srcData[i + 1], b = srcData[i + 2];
      
      const rF = clamp(mix(r, mix(r, mR, intensity), 1 - blendOriginal));
      const gF = clamp(mix(g, mix(g, mG, intensity), 1 - blendOriginal));
      const bF = clamp(mix(b, mix(b, mB, intensity), 1 - blendOriginal));

      data[i] = rF; data[i + 1] = gF; data[i + 2] = bF; data[i + 3] = alpha;
      if (step === 2) {
         if (x + 1 < width) {
            const i2 = i + 4;
            data[i2] = rF; data[i2+1] = gF; data[i2+2] = bF; data[i2+3] = alpha;
         }
         if (y + 1 < height) {
            const i3 = i + width * 4;
            data[i3] = rF; data[i3+1] = gF; data[i3+2] = bF; data[i3+3] = alpha;
            if (x + 1 < width) {
               const i4 = i3 + 4;
               data[i4] = rF; data[i4+1] = gF; data[i4+2] = bF; data[i4+3] = alpha;
            }
         }
      }
    }
  }
  ctx.putImageData(out, 0, 0);
}

function animLoop(now) {
  if (state.motion.enable) {
    doRender(now, false);
    animFrameId = requestAnimationFrame(animLoop);
  }
}

// UI LOGIC
function buildPresets() {
  presetList.innerHTML = "";
  const fragment = document.createDocumentFragment();
  let previousGroup = "";
  presets.forEach((preset, index) => {
    const group = preset.source === "saved" ? "Saved ACID Presets" : preset.source === "imported" ? "Imported Gradients" : "Built-in Acid Presets";
    if (group !== previousGroup) {
      const label = document.createElement("div");
      label.className = "preset-group-label";
      label.textContent = group;
      fragment.append(label);
      previousGroup = group;
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `preset-button preset-${preset.source || "builtin"}${index === state.preset ? " is-active" : ""}`;
    btn.style.setProperty("--preset-image", buildPresetPreview(preset));
    const badge = preset.source === "imported" ? "GRD" : preset.source === "saved" ? "ACID" : "";
    btn.innerHTML = `<span class="preset-swatch"></span><span class="preset-copy"><strong>${preset.name}</strong><span>${preset.caption}</span></span><span class="preset-badge">${badge}</span>`;
    btn.addEventListener("click", () => {
      state.preset = index;
      document.querySelectorAll(".preset-button").forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      doRender(performance.now(), false);
    });
    fragment.append(btn);
  });
  presetList.append(fragment);
}

function buildSliders() {
  sliders.innerHTML = "";
  sliderDefs.forEach(([key, label, min, max]) => {
    const row = document.createElement("div"); row.className = "slider-row";
    row.innerHTML = `<div class="slider-label"><span>${label}</span><output>${state.controls[key]}</output></div><input type="range" min="${min}" max="${max}" value="${state.controls[key]}" />`;
    const input = row.querySelector("input"); const output = row.querySelector("output");
    input.addEventListener("input", () => {
      state.controls[key] = Number(input.value);
      output.textContent = input.value;
      doRender(performance.now(), false);
    });
    sliders.append(row);
  });

  const motionSlidersEl = document.getElementById("motionSliders");
  motionSlidersEl.innerHTML = "";
  motionSliderDefs.forEach(([key, label, min, max]) => {
    const row = document.createElement("div"); row.className = "slider-row";
    row.innerHTML = `<div class="slider-label"><span>${label}</span><output>${state.motion[key]}</output></div><input type="range" min="${min}" max="${max}" value="${state.motion[key]}" />`;
    const input = row.querySelector("input"); const output = row.querySelector("output");
    input.addEventListener("input", () => {
      state.motion[key] = Number(input.value);
      output.textContent = input.value;
      if(!state.motion.enable) doRender(performance.now(), false);
    });
    motionSlidersEl.append(row);
  });
}

function updatePresetsAndRender(nextPresetIndex = state.preset) {
  refreshPresetCollection();
  state.preset = clamp(nextPresetIndex, 0, Math.max(0, presets.length - 1));
  buildPresets();
  doRender(performance.now(), false);
}

function handleGrdImport(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".grd")) {
    setGradientStatus("Choose a Photoshop .GRD gradient preset file.");
    return;
  }

  setGradientStatus(`Reading ${file.name}...`);
  const reader = new FileReader();
  reader.onload = () => {
    const importStart = performance.now();
    try {
      const fileLabel = file.name.replace(/\.grd$/i, "");
      const gradients = parsePhotoshopGrd(reader.result, fileLabel);
      if (!gradients.length) throw new Error("No custom gradients were found in this GRD.");
      setGradientStatus(`Parsed ${gradients.length} gradient${gradients.length === 1 ? "" : "s"}. Building fast previews...`);
      requestAnimationFrame(() => {
        const startIndex = builtInPresets.length + savedAcidPresets.length + importedGradients.length;
        importedGradients = importedGradients.concat(gradients);
        updatePresetsAndRender(startIndex);
        const elapsed = Math.max(1, Math.round(performance.now() - importStart));
        setGradientStatus(`Imported ${gradients.length} gradient${gradients.length === 1 ? "" : "s"} from ${file.name} in ${elapsed} ms.`);
      });
    } catch (error) {
      setGradientStatus(error.message || "The .GRD file could not be parsed.");
    } finally {
      grdInput.value = "";
    }
  };
  reader.onerror = () => setGradientStatus("The .GRD file could not be read.");
  reader.readAsArrayBuffer(file);
}

function clearImportedGradients() {
  importedGradients = [];
  updatePresetsAndRender(Math.min(state.preset, builtInPresets.length + savedAcidPresets.length - 1));
  setGradientStatus("Imported gradients cleared. Saved ACID presets remain available.");
}

function saveCurrentAsAcidPreset() {
  const current = presets[state.preset];
  if (!current) return;
  const copy = normalizeImportedPreset({
    ...current,
    id: `saved-${Date.now()}`,
    source: "saved",
    name: `${current.name} ACID`,
    caption: "ACID PRESET",
    stops: getPresetStops(current),
    opacityStops: current.opacityStops || [],
  });
  if (!copy) {
    setGradientStatus("Current preset cannot be saved.");
    return;
  }

  savedAcidPresets.push(copy);
  persistSavedAcidPresets();
  const nextIndex = builtInPresets.length + savedAcidPresets.length - 1;
  updatePresetsAndRender(nextIndex);
  setGradientStatus(`Saved ${copy.name} as an ACID preset.`);
}

// Independent toggle for sections within panels (so multiple can be open in left panel)
document.querySelectorAll('.section-header').forEach(header => {
  header.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    const currentSection = header.closest('.section');
    const parentPanel = currentSection.closest('.panel');
    
    // For right panel, close other sections to have only one open at a time
    if (parentPanel.classList.contains('panel-right')) {
      parentPanel.querySelectorAll('.section').forEach(sec => {
        if (sec !== currentSection) sec.classList.add('collapsed');
      });
    }
    
    currentSection.classList.toggle('collapsed');
  });
});

// Panel toggle button
toggleBtn.addEventListener('click', () => {
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('hidden'));
});

// Resets
document.getElementById('resetInput').addEventListener('click', () => {
  state.sourceReady = false;
  prepared = null;
  sourceImageData = null;
  originalImageElement = null;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  document.getElementById('dropHint').classList.remove('is-hidden');
  document.getElementById('dropHint').hidden = false;
  document.getElementById('fileInput').value = "";
});

document.getElementById('resetPresets').addEventListener('click', () => {
  state.preset = 0;
  document.querySelectorAll('.preset-button').forEach((b, i) => b.classList.toggle('is-active', i === 0));
  doRender(performance.now(), false);
});

document.getElementById('resetAdjustments').addEventListener('click', () => {
  state.controls = { intensity: 100, contrast: 45, grain: 58, posterize: 6, saturation: 86, blend: 14, threshold: 0, chromaticOffset: 0, gradientSmoothness: 28, bleedAmount: 50, textureStrength: 50, displacement: 0 };
  buildSliders();
  doRender(performance.now(), false);
});

document.getElementById('resetMotion').addEventListener('click', () => {
  state.motion = { enable: false, pingPong: false, speed: 45, flowAmount: 55, pulseIntensity: 0, glitchFreq: 0, loopSec: 6 };
  document.getElementById('animEnableControl').checked = false;
  document.getElementById('pingPongControl').checked = false;
  cancelAnimationFrame(animFrameId);
  buildSliders();
  doRender(performance.now(), false);
});

document.getElementById('resetOptions').addEventListener('click', () => {
  state.options = { dither: true, detail: true, bleed: true, invert: false, refTexture: false, facePreserve: false, monoBase: false, transparent: false };
  document.getElementById("ditherControl").checked = true; document.getElementById("detailControl").checked = true; document.getElementById("bleedControl").checked = true;
  document.getElementById("invertControl").checked = false; document.getElementById("refTextureControl").checked = false; document.getElementById("facePreserveControl").checked = false; document.getElementById("monoBaseControl").checked = false; document.getElementById("transparentControl").checked = false;
  doRender(performance.now(), false);
});

function setZoom(val) {
  state.zoom = clamp(val, 0.2, 2.0);
  const size = `${100 * state.zoom}%`;
  canvas.style.width = size; canvas.style.height = size;
  zoomLabel.textContent = state.zoom === 1 ? "FIT" : `${Math.round(state.zoom * 100)}%`;
}

function handleExport() {
   const format = document.getElementById('exportFormat').value;
   const resScale = parseInt(document.getElementById('exportResolution').value) || 1;
   const btn = document.getElementById('downloadButton');
   const statusDot = document.getElementById('exportStatusDot');
   const statusText = document.getElementById('exportStatusText');

   // Apply resolution
   if(originalImageElement && resScale > 1) {
       fitCanvasToSource(originalImageElement.width, originalImageElement.height, resScale);
       drawImageCover(sourceCtx, originalImageElement, sourceCanvas.width, sourceCanvas.height);
       prepareSource();
   }

   if(format === 'png') {
       doRender(performance.now(), true);
       const link = document.createElement("a"); 
       link.download = `${state.imageName}-acid.png`; 
       link.href = canvas.toDataURL("image/png"); 
       link.click();
       
       // revert res if needed
       if(originalImageElement && resScale > 1) {
           fitCanvasToSource(originalImageElement.width, originalImageElement.height, 1);
           drawImageCover(sourceCtx, originalImageElement, sourceCanvas.width, sourceCanvas.height);
           prepareSource();
           doRender(performance.now(), false);
       }
   } else {
       // Video Export
       if(resScale > 1) {
           alert("High-Res video rendering in browser might drop frames or be slower than real-time. Consider 1x for smoother loops.");
       }
       
       const mime = (format === 'mp4') ? 'video/mp4' : 'video/webm';
       let options = { mimeType: mime };
       if (!MediaRecorder.isTypeSupported(mime)) {
           options = { mimeType: 'video/webm' }; // Fallback to webm or default
           if (format === 'gif') {
               alert("Native GIF export requires an external library. Recording as a WebM loop instead.");
           }
       }

       // We capture exactly 30fps
       const stream = canvas.captureStream(30);
       let recorder;
       try {
           recorder = new MediaRecorder(stream, options);
       } catch(e) {
           recorder = new MediaRecorder(stream);
       }

       const chunks = [];
       recorder.ondataavailable = e => { if(e.data.size) chunks.push(e.data); };
       recorder.onstop = () => {
           const blob = new Blob(chunks, { type: recorder.mimeType });
           const url = URL.createObjectURL(blob);
           const a = document.createElement('a'); a.href = url;
           let ext = 'webm';
           if (recorder.mimeType.includes('mp4')) ext = 'mp4';
           else if (format === 'gif') ext = 'webm'; // Fallback
           a.download = `${state.imageName}-loop.${ext}`;
           a.click();

           btn.classList.remove('is-recording');
           statusDot.classList.remove('recording');
           statusText.textContent = "READY TO EXPORT";
           
           // revert res if needed
           if(originalImageElement && resScale > 1) {
               fitCanvasToSource(originalImageElement.width, originalImageElement.height, 1);
               drawImageCover(sourceCtx, originalImageElement, sourceCanvas.width, sourceCanvas.height);
               prepareSource();
           }
           // Resume visual loop
           if(state.motion.enable) animLoop(performance.now());
       };

       btn.classList.add('is-recording');
       statusDot.classList.add('recording');
       statusText.textContent = "RECORDING LOOP...";

       // Restart animation specifically for this recording
       cancelAnimationFrame(animFrameId);
       animStartTime = performance.now();
       animLoop(animStartTime);
       recorder.start();

       const loopTimeMs = getMotionCycleMs();
       setTimeout(() => {
           recorder.stop();
           cancelAnimationFrame(animFrameId);
       }, loopTimeMs);
   }
}

function wireEvents() {
  fileInput.addEventListener("change", e => loadFile(e.target.files[0]));
  grdInput.addEventListener("change", e => handleGrdImport(e.target.files[0]));
  ["dragenter", "dragover", "dragleave", "drop"].forEach(t => {
    window.addEventListener(t, e => {
      e.preventDefault();
      if(t === 'dragenter' || t === 'dragover') dropZone.classList.add("dragging");
      else dropZone.classList.remove("dragging");
    });
  });
  window.addEventListener("drop", e => {
    const file = e.dataTransfer.files[0];
    if (file?.name?.toLowerCase().endsWith(".grd")) handleGrdImport(file);
    else loadFile(file);
  });
  
  document.getElementById("downloadButton").addEventListener("click", handleExport);
  document.getElementById("clearImportedGradients").addEventListener("click", clearImportedGradients);
  document.getElementById("clearImportedGradientsAction").addEventListener("click", clearImportedGradients);
  document.getElementById("saveAcidPreset").addEventListener("click", saveCurrentAsAcidPreset);
  
  // Canvas zoom/view
  document.getElementById("zoomOut").addEventListener("click", () => setZoom(state.zoom - 0.1));
  document.getElementById("zoomIn").addEventListener("click", () => setZoom(state.zoom + 0.1));
  document.getElementById("actualButton").addEventListener("click", () => setZoom(1.0));
  document.getElementById("fitButton").addEventListener("click", () => setZoom(1.0));
  
  document.getElementById("beforeButton").addEventListener("pointerdown", () => { state.showOriginal = true; doRender(performance.now(), false); });
  document.getElementById("beforeButton").addEventListener("pointerup", () => { state.showOriginal = false; doRender(performance.now(), false); });
  document.getElementById("beforeButton").addEventListener("pointerleave", () => { state.showOriginal = false; doRender(performance.now(), false); });
  document.getElementById("originalToggle").addEventListener("change", e => { state.showOriginal = e.target.checked; doRender(performance.now(), false); });

  // Options Map
  const optMap = { ditherControl: "dither", detailControl: "detail", bleedControl: "bleed", invertControl: "invert", refTextureControl: "refTexture", facePreserveControl: "facePreserve", monoBaseControl: "monoBase", transparentControl: "transparent" };
  for (const [id, key] of Object.entries(optMap)) {
    document.getElementById(id).addEventListener("change", e => { state.options[key] = e.target.checked; doRender(performance.now(), false); });
  }

  // Motion map
  document.getElementById('animEnableControl').addEventListener('change', e => {
     state.motion.enable = e.target.checked;
     if(state.motion.enable) {
         animStartTime = performance.now();
         animLoop(animStartTime);
     } else {
         cancelAnimationFrame(animFrameId);
         doRender(performance.now(), false);
     }
  });
  document.getElementById('pingPongControl').addEventListener('change', e => {
     state.motion.pingPong = e.target.checked;
     if(!state.motion.enable) doRender(performance.now(), false);
  });
}

buildPresets(); buildSliders(); wireEvents(); makeDemoImage();
