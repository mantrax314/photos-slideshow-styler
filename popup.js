(() => {
  'use strict';

  const { DEFAULTS, LIMITS, PRESETS, normalize } = GPS;
  const PERCENT = new Set(['blurBrightness', 'shadowOpacity', 'ambIntensity', 'ambSaturation']);
  const SAVE_DELAY = 150; // debounce slider drags; storage.sync has a write quota

  const inputs = [...document.querySelectorAll('[data-key]')];
  const status = document.getElementById('status');
  const stateText = document.getElementById('stateText');
  let settings = { ...DEFAULTS };
  let saveTimer = 0;
  let statusTimer = 0;

  for (const input of inputs) {
    const limits = LIMITS[input.dataset.key];
    if (input.type === 'range' && limits) {
      [input.min, input.max, input.step] = limits.map(String);
    }
  }

  function format(key, value) {
    if (typeof value === 'string') return value.toUpperCase();
    if (PERCENT.has(key)) return `${Math.round(value * 100)}%`;
    if (key === 'gradAngle') return `${value}°`;
    if (key === 'ambSpeed') return value > 0 ? `${value.toFixed(1)}×` : 'Off';
    return `${value}px`;
  }

  function showOutput(input) {
    if (input.type === 'range') {
      const [min, max] = LIMITS[input.dataset.key];
      input.style.setProperty('--fill', `${((settings[input.dataset.key] - min) / (max - min)) * 100}%`);
    }
    const out = input.nextElementSibling;
    if (out && out.tagName === 'OUTPUT') out.textContent = format(input.dataset.key, settings[input.dataset.key]);
  }

  function showModeRows() {
    for (const row of document.querySelectorAll('[data-modes]')) {
      row.hidden = !row.dataset.modes.split(' ').includes(settings.bgMode);
    }
    for (const row of document.querySelectorAll('[data-requires]')) {
      row.hidden = !settings[row.dataset.requires];
    }
  }

  function render() {
    for (const input of inputs) {
      const value = settings[input.dataset.key];
      if (input.type === 'checkbox') input.checked = value;
      else if (input.type === 'radio') input.checked = input.value === value;
      else input.value = String(value);
      showOutput(input);
    }
    showModeRows();
    showEnabled();
    refreshVisuals();
  }

  function showEnabled() {
    document.body.classList.toggle('disabled', !settings.enabled);
    stateText.textContent = settings.enabled ? 'On for Google Photos' : 'Paused';
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    chrome.storage.sync.set({ settings }, () => {
      const err = chrome.runtime.lastError;
      showStatus(err ? `Not saved: ${err.message}` : 'Saved', !!err);
    });
  }

  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY);
  }

  function readInput(input) {
    if (input.type === 'radio' && !input.checked) return;
    const key = input.dataset.key;
    const raw = input.type === 'checkbox' ? input.checked : input.value;
    settings = normalize({ ...settings, [key]: typeof DEFAULTS[key] === 'number' ? Number(raw) : raw });
    showOutput(input);
    if (key === 'bgMode' || key === 'ambEnabled') showModeRows();
    if (key === 'enabled') showEnabled();
    refreshVisuals();
  }

  for (const input of inputs) {
    input.addEventListener('input', () => { readInput(input); saveSoon(); });
    input.addEventListener('change', () => { readInput(input); save(); });
  }

  function applyPreset(values) {
    settings = normalize({ ...settings, ...values });
    render();
    save();
  }

  function showStatus(text, isError = false) {
    status.textContent = text;
    status.classList.toggle('error', isError);
    status.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => status.classList.remove('show'), isError ? 6000 : 1600);
  }

  // ---------- visual preview ----------
  // A scaled-down sketch of the slideshow: stage = screen, photo box = mat + frame + shadow.

  const REF_WIDTH = 1440; // screen width the preview stands in for
  const PHOTO_ASPECT = 3 / 2;

  function makeScene() {
    const scene = document.createElement('div');
    scene.className = 'scene';
    scene.innerHTML = '<div class="scene-bg"></div><div class="scene-glow"></div><div class="scene-photo"><div class="scene-img"></div></div>';
    return scene;
  }

  function rgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  function paintScene(scene, s) {
    const W = scene.clientWidth || 300;
    const H = scene.clientHeight || W * 9 / 16;
    const k = W / REF_WIDTH;
    const [bg, glow, photo] = scene.children;

    bg.className = 'scene-bg';
    bg.style.cssText = '';
    if (s.bgMode === 'gradient') {
      bg.style.background = `linear-gradient(${s.gradAngle}deg, ${s.gradColor1}, ${s.gradColor2})`;
    } else if (s.bgMode === 'blur') {
      bg.classList.add('blurred');
      bg.style.filter = `blur(${s.blurAmount * k}px) brightness(${s.blurBrightness})`;
    } else {
      bg.style.backgroundColor = s.bgColor;
      if (s.bgMode === 'image' && /^https:\/\//i.test(s.bgImageUrl)) {
        bg.style.backgroundImage = `url(${JSON.stringify(s.bgImageUrl)})`;
      }
    }

    const edge = (s.matWidth + s.frameWidth) * k;
    const availW = W - 2 * s.margin * k - 2 * edge;
    const availH = H - 2 * s.margin * k - 2 * edge;
    const imgW = Math.max(4, Math.min(availW, availH * PHOTO_ASPECT));
    const imgH = imgW / PHOTO_ASPECT;
    Object.assign(photo.style, {
      width: `${imgW}px`,
      height: `${imgH}px`,
      padding: `${s.matWidth * k}px`,
      background: s.matColor,
      border: `${s.frameWidth * k}px solid ${s.frameColor}`,
      borderRadius: `${s.radius * k}px`,
      boxShadow: `${s.shadowX * k}px ${s.shadowY * k}px ${s.shadowBlur * k}px ${s.shadowSpread * k}px ${rgba(s.shadowColor, s.shadowOpacity)}`,
    });
    photo.firstChild.style.borderRadius = `${Math.max(0, s.radius - s.matWidth - s.frameWidth) * k}px`;

    glow.hidden = !s.ambEnabled;
    if (s.ambEnabled) {
      const size = s.ambSize * k;
      Object.assign(glow.style, {
        width: `${imgW + 2 * edge + size}px`,
        height: `${imgH + 2 * edge + size}px`,
        opacity: String(s.ambIntensity),
        filter: `blur(${Math.max(2, size * 0.35)}px) saturate(${s.ambSaturation})`,
      });
      glow.style.setProperty('--glow-duration', `${10 / Math.max(0.1, s.ambSpeed)}s`);
      glow.style.setProperty('--glow-state', s.ambSpeed > 0 ? 'running' : 'paused');
    }
  }

  const previewScene = makeScene();
  document.getElementById('preview').append(previewScene);

  // Buttons whose preset values are shown as selected when they match the current settings.
  const presetButtons = new Map(); // button -> values

  function matches(values) {
    return Object.keys(values).every((key) => !(key in DEFAULTS) || normalize({ ...settings, [key]: values[key] })[key] === settings[key]);
  }

  function refreshVisuals() {
    paintScene(previewScene, settings);
    for (const [button, values] of presetButtons) {
      const on = matches(values);
      button.classList.toggle('active', on);
      button.setAttribute('aria-pressed', String(on));
    }
  }

  function makePresetButton(label, values) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset';
    const scene = makeScene();
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = label;
    button.append(scene, name);
    button.addEventListener('click', () => applyPreset(values));
    presetButtons.set(button, values);
    // Paint once attached so the thumbnail can measure itself.
    requestAnimationFrame(() => paintScene(scene, normalize({ ...DEFAULTS, ...values, enabled: true })));
    return button;
  }

  const presetBox = document.getElementById('presets');
  for (const preset of Object.values(PRESETS)) {
    presetBox.append(makePresetButton(preset.label, preset.values));
  }

  // ---------- custom presets ----------
  // Kept in storage.local: they stay on this browser and don't count against sync quota.

  const CUSTOM_KEY = 'customPresets';
  const customBox = document.getElementById('customPresets');
  const addButton = document.getElementById('addPreset');
  const presetForm = document.getElementById('presetForm');
  const presetName = document.getElementById('presetName');
  let customPresets = []; // [{ name, values }]

  function storeCustomPresets() {
    chrome.storage.local.set({ [CUSTOM_KEY]: customPresets }, () => {
      const err = chrome.runtime.lastError;
      if (err) showStatus(`Not saved: ${err.message}`, true);
    });
  }

  function renderCustomPresets() {
    for (const button of presetButtons.keys()) {
      if (customBox.contains(button)) presetButtons.delete(button);
    }
    customBox.replaceChildren();
    customBox.hidden = customPresets.length === 0;
    for (const preset of customPresets) {
      const chip = document.createElement('span');
      chip.className = 'chip';

      const apply = makePresetButton(preset.name, preset.values);
      apply.title = `Apply “${preset.name}”`;

      // Two clicks to delete: × turns into "Delete?" for a few seconds.
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove preset ${preset.name}`);
      let armTimer = 0;
      remove.addEventListener('click', () => {
        if (!chip.classList.contains('confirm')) {
          chip.classList.add('confirm');
          remove.textContent = 'Delete?';
          armTimer = setTimeout(() => {
            chip.classList.remove('confirm');
            remove.textContent = '×';
          }, 3000);
          return;
        }
        clearTimeout(armTimer);
        customPresets = customPresets.filter((p) => p !== preset);
        storeCustomPresets();
        renderCustomPresets();
        showStatus(`Removed “${preset.name}”`);
      });

      chip.append(apply, remove);
      customBox.append(chip);
    }
    refreshVisuals();
  }

  function toggleForm(open) {
    presetForm.hidden = !open;
    addButton.hidden = open;
    if (open) {
      presetName.value = '';
      presetName.focus();
    }
  }

  addButton.addEventListener('click', () => toggleForm(true));
  document.getElementById('presetCancel').addEventListener('click', () => toggleForm(false));
  presetName.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleForm(false); });

  presetForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = presetName.value.trim().slice(0, 24);
    if (!name) return;
    // Everything except the on/off switch, so applying a preset never turns the extension off.
    const { enabled, ...values } = normalize(settings);
    const existing = customPresets.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      existing.values = values;
    } else {
      customPresets.push({ name, values });
    }
    storeCustomPresets();
    renderCustomPresets();
    toggleForm(false);
    showStatus(existing ? `Updated “${existing.name}”` : `Saved preset “${name}”`);
  });

  chrome.storage.local.get({ [CUSTOM_KEY]: [] }, (result) => {
    const list = Array.isArray(result[CUSTOM_KEY]) ? result[CUSTOM_KEY] : [];
    customPresets = list.filter((p) => p && typeof p.name === 'string' && p.values && typeof p.values === 'object');
    renderCustomPresets();
  });

  document.getElementById('reset').addEventListener('click', () => {
    settings = { ...DEFAULTS };
    render();
    save();
  });

  // Flush a pending debounced write if the popup closes mid-drag.
  window.addEventListener('pagehide', () => { if (saveTimer) save(); });

  chrome.storage.sync.get({ settings: null }, (result) => {
    settings = normalize(result && result.settings);
    render();
  });
})();
