// Samples the edge colors of a slideshow photo for the ambient light.
// Runs here because the content script can't read pixels of the cross-origin
// googleusercontent.com images; the extension's host permission can.

const GRID = 64;          // photo is downscaled to GRID x GRID before sampling
const ZONES_PER_EDGE = 4; // 16 zones, clockwise from the top-left
const BAND = 0.2;         // how deep into the photo each edge band reaches

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'gps-sample' || typeof msg.url !== 'string') return false;
  sample(msg.url).then(
    (colors) => sendResponse({ colors }),
    (err) => sendResponse({ error: String(err && err.message || err) }),
  );
  return true; // async response
});

// Google image URLs carry their size as "=w1173-h1084…": ask for a tiny copy first.
function smallVariant(url) {
  const small = url.replace(/=w\d+-h\d+/, `=w${GRID * 2}-h${GRID * 2}`);
  return small !== url ? small : null;
}

// Photo URLs are usually capability URLs, so try without cookies first
// (Brave blocks third-party cookies, and credentialed requests fail CORS on wildcard hosts).
// Name the host in errors: a "Failed to fetch" usually means it's missing from host_permissions.
function withHost(err, url) {
  let host = 'data';
  try { host = new URL(url).host || host; } catch (e) { /* keep default */ }
  return new Error(`${err && err.message || err} (${host})`);
}

async function fetchBlob(url) {
  let lastErr;
  for (const credentials of ['omit', 'include']) {
    try {
      const res = await fetch(url, { credentials });
      if (res.ok) return res.blob();
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function sample(url) {
  if (!/^(https:|data:)/.test(url)) throw new Error(`unsupported url ${url.slice(0, 20)}`);
  let blob;
  const small = smallVariant(url);
  try {
    blob = await fetchBlob(small || url);
  } catch (err) {
    if (!small) throw withHost(err, url);
    try {
      blob = await fetchBlob(url);
    } catch (err2) {
      throw withHost(err2, url);
    }
  }

  const bitmap = await createImageBitmap(blob, {
    resizeWidth: GRID, resizeHeight: GRID, resizeQuality: 'medium',
  });
  const canvas = new OffscreenCanvas(GRID, GRID);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, GRID, GRID);

  const depth = Math.max(1, Math.round(GRID * BAND));
  const seg = GRID / ZONES_PER_EDGE;
  const zones = [];
  // Clockwise: top (left→right), right (top→bottom), bottom (right→left), left (bottom→top).
  for (let k = 0; k < ZONES_PER_EDGE; k++) zones.push([k * seg, 0, seg, depth]);
  for (let k = 0; k < ZONES_PER_EDGE; k++) zones.push([GRID - depth, k * seg, depth, seg]);
  for (let k = ZONES_PER_EDGE - 1; k >= 0; k--) zones.push([k * seg, GRID - depth, seg, depth]);
  for (let k = ZONES_PER_EDGE - 1; k >= 0; k--) zones.push([0, k * seg, depth, seg]);

  return zones.map(([x0, y0, w, h]) => average(data, x0, y0, w, h));
}

// Vibrancy-weighted average, so a few saturated pixels beat a muddy mean
// (like a lamp picking up the colour you actually notice).
function average(data, x0, y0, w, h) {
  let r = 0, g = 0, b = 0, total = 0;
  for (let y = Math.floor(y0); y < Math.min(GRID, y0 + h); y++) {
    for (let x = Math.floor(x0); x < Math.min(GRID, x0 + w); x++) {
      const i = (y * GRID + x) * 4;
      const pr = data[i], pg = data[i + 1], pb = data[i + 2];
      const max = Math.max(pr, pg, pb), min = Math.min(pr, pg, pb);
      const sat = max ? (max - min) / max : 0;
      const weight = 0.15 + sat * sat * 4 * (max / 255);
      r += pr * weight; g += pg * weight; b += pb * weight; total += weight;
    }
  }
  return total ? [r / total, g / total, b / total].map(Math.round) : [0, 0, 0];
}
