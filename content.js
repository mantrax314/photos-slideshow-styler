(() => {
  'use strict';

  // Logs detection changes with [GPS] and outlines the stage + current media box in magenta.
  const DEBUG = false;

  // Every Google Photos selector lives here. Class names are obfuscated and churn,
  // so only jsname attributes and aria-labels are used.
  // aria-labels are locale-dependent: add your UI language's label to exitLabels.
  const SELECTORS = {
    viewerRoot: 'div[jsname="xJzy8c"][data-media-key]',
    stage: 'div[jsname="r4rOcc"]',
    slide: 'c-wiz[jsname="oISvpc"][data-media-key]',
    ambientLayer: 'div[jsname="ls4dqb"]',
    ambientImg: 'img[jsname="VAJbob"]',
    mediaBox: 'div[jsname="ImB6xd"]',
    mediaInner: 'div[jsname="hPe5Dc"]',
    photo: 'img[jsname="uLHQEd"]',
    controlBar: 'div[jsname="ebixmb"]',
    exitLabels: ['Exit'],
  };

  const EXIT_BUTTON = SELECTORS.exitLabels
    .map((label) => label.replace(/["\\]/g, '\\$&'))
    .map((label) => `button[aria-label="${label}"],[role="button"][aria-label="${label}"]`)
    .join(',');

  const ACTIVE_CLASS = 'gps-active';
  // Our own markers. styles.css only targets these, never Google's markup.
  const ROLE = 'data-gps';
  const CURRENT = 'data-gps-current';
  const STATIC = 'data-gps-static';
  const DEBUG_ATTR = 'data-gps-debug';

  const log = (...args) => { if (DEBUG) console.log('[GPS]', ...args); };

  let settings = GPS.normalize(null);
  let active = null; // { root, stage } while a slideshow is showing
  let rafId = 0;
  let lastHref = location.href;
  let lastPhoto = null;

  // Ambient light: edge colors per photo URL -> [[r,g,b] x AMB_ZONES] | 'pending' | 'error'
  const AMB_ZONES = 16;
  const AMB_CACHE_MAX = 60;
  const ambCache = new Map();

  // Registered so colors/positions can transition and the flow phase can animate.
  // Also declared with @property in styles.css; whichever registers first wins.
  function registerAmbientProps() {
    if (!window.CSS || !CSS.registerProperty) return;
    const defs = [];
    for (let i = 0; i < AMB_ZONES; i++) {
      defs.push({ name: `--gps-amb-c${i}`, syntax: '<color>', inherits: true, initialValue: 'transparent' });
    }
    for (const n of ['l', 't', 'w', 'h']) {
      defs.push({ name: `--gps-amb-${n}`, syntax: '<length>', inherits: true, initialValue: '0px' });
    }
    defs.push({ name: '--gps-amb-phase', syntax: '<number>', inherits: false, initialValue: '0' });
    for (const def of defs) {
      try { CSS.registerProperty(def); } catch (err) { /* already registered */ }
    }
  }
  registerAmbientProps();

  // ---------- settings -> CSS variables ----------

  function hexToRgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  function cssUrl(url) {
    return `url("${url.replace(/["\\\n\r]/g, (c) => encodeURIComponent(c))}")`;
  }

  function applySettings() {
    const s = settings;
    const html = document.documentElement;
    const px = (n) => `${n}px`;
    const vars = {
      '--gps-bg-color': s.bgColor,
      '--gps-grad-1': s.gradColor1,
      '--gps-grad-2': s.gradColor2,
      '--gps-grad-angle': `${s.gradAngle}deg`,
      '--gps-bg-image': s.bgImageUrl ? cssUrl(s.bgImageUrl) : 'none',
      '--gps-bg-blur': px(s.blurAmount),
      '--gps-bg-brightness': String(s.blurBrightness),
      '--gps-margin': px(s.margin),
      '--gps-mat': px(s.matWidth),
      '--gps-mat-color': s.matColor,
      '--gps-frame': px(s.frameWidth),
      '--gps-frame-color': s.frameColor,
      '--gps-radius': px(s.radius),
      '--gps-shadow-x': px(s.shadowX),
      '--gps-shadow-y': px(s.shadowY),
      '--gps-shadow-blur': px(s.shadowBlur),
      '--gps-shadow-spread': px(s.shadowSpread),
      '--gps-shadow-color': hexToRgba(s.shadowColor, s.shadowOpacity),
      '--gps-amb-intensity': String(s.ambIntensity),
      '--gps-amb-size': px(s.ambSize),
      '--gps-amb-speed': String(Math.max(0.1, s.ambSpeed)),
    };
    setVars(vars);
    setAttr(html, 'data-gps-bg', s.bgMode);
    setAttr(html, 'data-gps-amb', s.ambEnabled ? (s.ambSpeed > 0 ? 'on' : 'still') : null);
    if (s.bgMode !== 'blur') lastPhoto = null;
    // Fit depends on margin/mat/frame, so force a recompute on existing boxes.
    schedule();
  }

  // ---------- DOM helpers ----------

  // Only write changed values: every write is a style mutation that re-triggers the observer.
  // Compare against what we wrote, since registered properties may read back normalized.
  const written = new Map();
  function setVars(vars) {
    const style = document.documentElement.style;
    for (const [name, value] of Object.entries(vars)) {
      if (written.get(name) === value && style.getPropertyValue(name) !== '') continue;
      style.setProperty(name, value);
      written.set(name, value);
    }
  }

  function setAttr(el, name, value) {
    if (value == null) {
      if (el.hasAttribute(name)) el.removeAttribute(name);
    } else if (el.getAttribute(name) !== value) {
      el.setAttribute(name, value);
    }
  }

  function isRendered(el) {
    return el.getClientRects().length > 0;
  }

  // ---------- detection ----------

  function findSlideshow() {
    for (const bar of document.querySelectorAll(SELECTORS.controlBar)) {
      const exit = bar.querySelector(EXIT_BUTTON);
      if (!exit || !isRendered(exit)) continue;
      const root = bar.closest(SELECTORS.viewerRoot);
      const stage = root && root.querySelector(SELECTORS.stage);
      if (stage) return { root, stage };
    }
    return null;
  }

  function untag(stage) {
    for (const el of stage.querySelectorAll(`[${ROLE}], [${DEBUG_ATTR}]`)) {
      el.removeAttribute(ROLE);
      el.removeAttribute(CURRENT);
      el.removeAttribute(DEBUG_ATTR);
      if (el.style.getPropertyValue('--gps-fit')) el.style.removeProperty('--gps-fit');
    }
    for (const name of [ROLE, STATIC, DEBUG_ATTR]) stage.removeAttribute(name);
  }

  function setActive(found) {
    const html = document.documentElement;
    const changed = (found && found.stage) !== (active && active.stage);
    if (changed) {
      if (active) untag(active.stage);
      stageResize.disconnect();
      active = found;
      lastPhoto = null;
      if (active) {
        stageResize.observe(active.stage);
        const pos = getComputedStyle(active.stage).position;
        setAttr(active.stage, STATIC, pos === 'static' ? '' : null);
      } else {
        html.style.removeProperty('--gps-photo');
      }
      log(active ? 'slideshow detected' : 'slideshow ended', active ? active.stage : '');
    }
    // Re-assert every pass in case the page rewrites <html>'s class list.
    if (html.classList.contains(ACTIVE_CLASS) !== !!active) {
      html.classList.toggle(ACTIVE_CLASS, !!active);
    }
  }

  // ---------- tagging, fit, photo ----------

  function tag(stage) {
    setAttr(stage, ROLE, 'stage');
    setAttr(stage, DEBUG_ATTR, DEBUG ? '' : null);
    for (const slide of stage.querySelectorAll(SELECTORS.slide)) {
      const isCurrent = slide.style.visibility !== 'hidden';
      setAttr(slide, ROLE, 'slide');
      setAttr(slide, CURRENT, isCurrent ? '' : null);
      for (const el of slide.querySelectorAll(`${SELECTORS.ambientLayer}, ${SELECTORS.ambientImg}`)) {
        setAttr(el, ROLE, 'ambient');
      }
      const box = slide.querySelector(SELECTORS.mediaBox);
      if (!box) continue;
      setAttr(box, ROLE, 'box');
      setAttr(box, DEBUG_ATTR, DEBUG && isCurrent ? '' : null);
      const inner = box.querySelector(SELECTORS.mediaInner);
      if (inner) setAttr(inner, ROLE, 'mat');
    }
  }

  function fit(stage) {
    // clientWidth/Height ignore transforms, unlike getBoundingClientRect.
    const stageW = stage.clientWidth;
    const stageH = stage.clientHeight;
    if (!stageW || !stageH) return;
    const total = settings.margin + settings.matWidth + settings.frameWidth;
    for (const box of stage.querySelectorAll(`[${ROLE}="box"]`)) {
      // Google's inline size is the "fit to viewport" size; offset* are the layout fallback.
      const boxW = parseFloat(box.style.width) || box.offsetWidth;
      const boxH = parseFloat(box.style.height) || box.offsetHeight;
      if (!boxW || !boxH) continue;
      let f = Math.min((stageW - 2 * total) / boxW, (stageH - 2 * total) / boxH, 1);
      f = Math.max(0.05, Math.round(f * 10000) / 10000);
      const value = String(f);
      // Only write on change: every write is a style mutation that re-triggers the observer.
      if (box.style.getPropertyValue('--gps-fit') !== value) box.style.setProperty('--gps-fit', value);
    }
  }

  // Videos hide the photo img; fall back to Google's ambient copy.
  function slidePhoto(slide) {
    for (const img of slide.querySelectorAll(`${SELECTORS.photo}, ${SELECTORS.ambientImg}`)) {
      const src = img.currentSrc || img.src;
      if (src) return src;
    }
    return '';
  }

  function updatePhoto(stage) {
    if (settings.bgMode !== 'blur') return;
    const slide = stage.querySelector(`[${ROLE}="slide"][${CURRENT}]`);
    if (!slide) return;
    const src = slidePhoto(slide);
    if (!src || src === lastPhoto) return;
    lastPhoto = src;
    document.documentElement.style.setProperty('--gps-photo', cssUrl(src));
    log('background photo', src);
  }

  // ---------- ambient light ----------

  function requestSample(src) {
    if (ambCache.has(src)) return;
    ambCache.set(src, 'pending');
    const fail = (why) => { ambCache.set(src, 'error'); log('ambient sample failed', why); };
    try {
      chrome.runtime.sendMessage({ type: 'gps-sample', url: src }, (res) => {
        if (chrome.runtime.lastError) return fail(chrome.runtime.lastError.message);
        if (!res || !Array.isArray(res.colors)) return fail(res && res.error);
        ambCache.delete(src); // re-insert so the Map stays in LRU-ish order
        ambCache.set(src, res.colors);
        while (ambCache.size > AMB_CACHE_MAX) ambCache.delete(ambCache.keys().next().value);
        schedule();
      });
    } catch (err) {
      fail(err); // extension reloaded while the page stayed open
    }
  }

  // Lamp-style color: boost saturation and keep lightness in a range that visibly glows.
  function lampColor([r, g, b], boost) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    const d = max - min;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    // Near-greys stay neutral instead of being pushed to a random hue.
    if (s > 0.06) s = Math.min(1, s * boost);
    l = Math.min(0.62, Math.max(0.3, l));
    return `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
  }

  // Layout offset of el inside ancestor, ignoring transforms (Google animates transform).
  function offsetWithin(el, ancestor) {
    let x = 0, y = 0, node = el;
    while (node && node !== ancestor) {
      x += node.offsetLeft;
      y += node.offsetTop;
      node = node.offsetParent;
    }
    if (node === ancestor) return { x, y };
    const a = ancestor.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left - a.left, y: r.top - a.top };
  }

  function updateAmbient(stage) {
    if (!settings.ambEnabled) return;
    // Pre-sample every slide (prev/current/next) so the next slide's colors are ready.
    let current = null;
    let currentOpacity = -1;
    for (const slide of stage.querySelectorAll(`[${ROLE}="slide"]`)) {
      const src = slidePhoto(slide);
      if (src) requestSample(src);
      if (!slide.hasAttribute(CURRENT)) continue;
      // During a crossfade two slides are visible: follow the more opaque one.
      const mat = slide.querySelector(`[${ROLE}="mat"]`);
      const opacity = mat ? parseFloat(getComputedStyle(mat).opacity) : 0;
      if (opacity > currentOpacity) { current = slide; currentOpacity = opacity; }
    }
    const box = current && current.querySelector(`[${ROLE}="box"]`);
    if (!box) return;

    // Outer edge of the frame, in stage coordinates.
    const fitValue = parseFloat(box.style.getPropertyValue('--gps-fit')) || 1;
    const boxW = parseFloat(box.style.width) || box.offsetWidth;
    const boxH = parseFloat(box.style.height) || box.offsetHeight;
    const { x, y } = offsetWithin(box, stage);
    const edge = settings.matWidth + settings.frameWidth;
    const w = boxW * fitValue + 2 * edge;
    const h = boxH * fitValue + 2 * edge;
    const vars = {
      '--gps-amb-l': `${Math.round(x + boxW / 2 - w / 2)}px`,
      '--gps-amb-t': `${Math.round(y + boxH / 2 - h / 2)}px`,
      '--gps-amb-w': `${Math.round(w)}px`,
      '--gps-amb-h': `${Math.round(h)}px`,
    };

    const colors = ambCache.get(slidePhoto(current));
    if (Array.isArray(colors)) {
      colors.slice(0, AMB_ZONES).forEach((rgb, i) => {
        vars[`--gps-amb-c${i}`] = lampColor(rgb, settings.ambSaturation);
      });
    }
    setVars(vars);
  }

  // ---------- main loop ----------

  function update() {
    rafId = 0;
    try {
      if (location.href !== lastHref) {
        lastHref = location.href;
        log('url changed', lastHref);
      }
      setActive(settings.enabled ? findSlideshow() : null);
      if (!active) return;
      tag(active.stage);
      fit(active.stage);
      updatePhoto(active.stage);
      updateAmbient(active.stage);
    } catch (err) {
      log('update failed', err);
    }
  }

  function schedule() {
    if (!rafId) rafId = requestAnimationFrame(update);
  }

  const stageResize = new ResizeObserver(schedule);

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    // src / data-media-key: Google may reuse a slide element for the next photo.
    attributeFilter: ['style', 'class', 'src', 'data-media-key'],
  });

  document.addEventListener('fullscreenchange', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('popstate', schedule);
  if (window.navigation) window.navigation.addEventListener('navigatesuccess', schedule);

  // ---------- storage ----------

  chrome.storage.sync.get({ settings: null }, (result) => {
    settings = GPS.normalize(result && result.settings);
    applySettings();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.settings) return;
    settings = GPS.normalize(changes.settings.newValue);
    applySettings();
  });

  applySettings();
})();
