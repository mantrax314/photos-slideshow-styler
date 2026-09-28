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
      showStatus(err ? `Not saved: ${err.message}` : 'Saved', !!err);
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

  function applyPreset(values) {
    settings = normalize({ ...settings, ...values });
    render();
    save();
  }

  function showStatus(text, isError = false) {
    status.textContent = text;
    status.classList.toggle('error', isError);
  }

  const presetBox = document.getElementById('presets');
  for (const preset of Object.values(PRESETS)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = preset.label;
    button.addEventListener('click', () => applyPreset(preset.values));
    presetBox.append(button);
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
    customBox.replaceChildren();
    customBox.hidden = customPresets.length === 0;
    for (const preset of customPresets) {
      const chip = document.createElement('span');
      chip.className = 'chip';

      const apply = document.createElement('button');
      apply.type = 'button';
      apply.textContent = preset.name;
      apply.title = `Apply “${preset.name}”`;
      apply.addEventListener('click', () => applyPreset(preset.values));

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
