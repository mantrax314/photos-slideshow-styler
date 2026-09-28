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
    };
    for (const [name, value] of Object.entries(vars)) {
      if (html.style.getPropertyValue(name) !== value) html.style.setProperty(name, value);
    }
    setAttr(html, 'data-gps-bg', s.bgMode);
    if (s.bgMode !== 'blur') lastPhoto = null;
    // Fit depends on margin/mat/frame, so force a recompute on existing boxes.
    schedule();
  }

  // ---------- DOM helpers ----------

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

  function updatePhoto(stage) {
    if (settings.bgMode !== 'blur') return;
    const slide = stage.querySelector(`[${ROLE}="slide"][${CURRENT}]`);
    if (!slide) return;
    // Videos hide the photo img; fall back to Google's ambient copy.
    let src = '';
    for (const img of slide.querySelectorAll(`${SELECTORS.photo}, ${SELECTORS.ambientImg}`)) {
      src = img.currentSrc || img.src;
      if (src) break;
    }
    if (!src || src === lastPhoto) return;
    lastPhoto = src;
    document.documentElement.style.setProperty('--gps-photo', cssUrl(src));
    log('background photo', src);
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
    attributeFilter: ['style', 'class'],
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
