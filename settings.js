// Shared by content.js and popup.js: defaults, limits, presets, validation.
// Loaded as a plain script (content script list + <script> in popup.html).

const GPS = (() => {
  'use strict';

  const BG_MODES = ['solid', 'gradient', 'image', 'blur'];

  const DEFAULTS = {
    enabled: true,

    bgMode: 'solid',
    bgColor: '#2b2b2b',
    gradColor1: '#1f2933',
    gradColor2: '#000000',
    gradAngle: 160,
    bgImageUrl: '',
    blurAmount: 40,
    blurBrightness: 0.6,

    margin: 48,
    matWidth: 40,
    matColor: '#ffffff',
    frameWidth: 6,
    frameColor: '#111111',
    radius: 0,

    shadowX: 0,
    shadowY: 12,
    shadowBlur: 40,
    shadowSpread: 0,
    shadowColor: '#000000',
    shadowOpacity: 0.5,
  };

  // min / max / step for every numeric setting (used for clamping and by the popup sliders).
  const LIMITS = {
    gradAngle: [0, 360, 1],
    blurAmount: [0, 120, 1],
    blurBrightness: [0, 1.5, 0.05],
    margin: [0, 300, 1],
    matWidth: [0, 200, 1],
    frameWidth: [0, 100, 1],
    radius: [0, 100, 1],
    shadowX: [-200, 200, 1],
    shadowY: [-200, 200, 1],
    shadowBlur: [0, 300, 1],
    shadowSpread: [-100, 200, 1],
    shadowOpacity: [0, 1, 0.05],
  };

  const PRESETS = {
    gallery: {
      label: 'Gallery',
      values: {
        bgMode: 'solid', bgColor: '#2b2b2b',
        margin: 48, matWidth: 40, matColor: '#ffffff', frameWidth: 6, frameColor: '#111111', radius: 0,
        shadowX: 0, shadowY: 12, shadowBlur: 40, shadowSpread: 0, shadowColor: '#000000', shadowOpacity: 0.5,
      },
    },
    minimal: {
      label: 'Minimal',
      values: {
        bgMode: 'blur', blurAmount: 48, blurBrightness: 0.55,
        margin: 64, matWidth: 0, frameWidth: 0, radius: 10,
        shadowX: 0, shadowY: 30, shadowBlur: 90, shadowSpread: 0, shadowColor: '#000000', shadowOpacity: 0.75,
      },
    },
    classicGold: {
      label: 'Classic Gold',
      values: {
        bgMode: 'solid', bgColor: '#000000',
        margin: 40, matWidth: 48, matColor: '#f3ead3', frameWidth: 18, frameColor: '#b8912f', radius: 0,
        shadowX: 0, shadowY: 16, shadowBlur: 48, shadowSpread: 0, shadowColor: '#000000', shadowOpacity: 0.8,
      },
    },
  };

  const HEX = /^#[0-9a-f]{6}$/i;

  // Merge raw (possibly partial or corrupt) stored data over the defaults.
  function normalize(raw) {
    const out = { ...DEFAULTS };
    if (!raw || typeof raw !== 'object') return out;
    for (const key of Object.keys(DEFAULTS)) {
      const def = DEFAULTS[key];
      const val = raw[key];
      if (typeof def === 'number') {
        const n = Number(val);
        if (val !== '' && val != null && Number.isFinite(n)) {
          const [min, max] = LIMITS[key];
          out[key] = Math.min(max, Math.max(min, n));
        }
      } else if (typeof def === 'boolean') {
        if (typeof val === 'boolean') out[key] = val;
      } else if (typeof val === 'string') {
        if (key === 'bgMode') {
          if (BG_MODES.includes(val)) out[key] = val;
        } else if (HEX.test(def)) {
          if (HEX.test(val)) out[key] = val.toLowerCase();
        } else {
          out[key] = val.trim();
        }
      }
    }
    return out;
  }

  return { BG_MODES, DEFAULTS, LIMITS, PRESETS, normalize };
})();
