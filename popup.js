(() => {
  'use strict';

  const { DEFAULTS, LIMITS, PRESETS, normalize } = GPS;
  const PERCENT = new Set(['blurBrightness', 'shadowOpacity', 'ambIntensity', 'ambSaturation']);
  const SAVE_DELAY = 150; // debounce slider drags; storage.sync has a write quota

  const inputs = [...document.querySelectorAll('[data-key]')];
  const status = document.getElementById('status');
  let settings = { ...DEFAULTS };
  let saveTimer = 0;

  for (const input of inputs) {
    const limits = LIMITS[input.dataset.key];
    if (input.type === 'range' && limits) {
      [input.min, input.max, input.step] = limits.map(String);
    }
  }

  function format(key, value) {
    if (PERCENT.has(key)) return `${Math.round(value * 100)}%`;
    if (key === 'gradAngle') return `${value}°`;
    if (key === 'ambSpeed') return value > 0 ? `${value.toFixed(1)}×` : 'Off';
    return `${value}px`;
  }

  function showOutput(input) {
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
      else input.value = String(value);
      showOutput(input);
    }
    showModeRows();
    document.body.classList.toggle('disabled', !settings.enabled);
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    chrome.storage.sync.set({ settings }, () => {
      const err = chrome.runtime.lastError;
      status.textContent = err ? `Not saved: ${err.message}` : 'Saved';
      status.classList.toggle('error', !!err);
    });
  }

  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY);
  }

  function readInput(input) {
    const key = input.dataset.key;
    const raw = input.type === 'checkbox' ? input.checked : input.value;
    settings = normalize({ ...settings, [key]: typeof DEFAULTS[key] === 'number' ? Number(raw) : raw });
    showOutput(input);
    if (key === 'bgMode' || key === 'ambEnabled') showModeRows();
    if (key === 'enabled') document.body.classList.toggle('disabled', !settings.enabled);
  }

  for (const input of inputs) {
    input.addEventListener('input', () => { readInput(input); saveSoon(); });
    input.addEventListener('change', () => { readInput(input); save(); });
  }

  const presetBox = document.getElementById('presets');
  for (const preset of Object.values(PRESETS)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = preset.label;
    button.addEventListener('click', () => {
      settings = normalize({ ...settings, ...preset.values });
      render();
      save();
    });
    presetBox.append(button);
  }

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
