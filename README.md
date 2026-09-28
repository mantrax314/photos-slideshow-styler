# Google Photos Slideshow Styler

Manifest V3 extension for Brave/Chrome that restyles the Google Photos slideshow: custom background, a mat and frame around each photo or video, and a drop shadow. It uses plain JS and needs no build step.

## Install

1. Open `brave://extensions` (or `chrome://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Open (or reload) a `https://photos.google.com/` tab. Content scripts don't run in tabs that were open before the extension loaded.

After changing any file, click the reload icon on the extension card, then reload the Photos tab.

## Use

Open a photo, then choose ⋮ → **Slideshow**. The styles apply while the slideshow is running and are removed when you exit. Click the toolbar icon to change settings. Changes apply to the running slideshow right away.

**Your own presets:** set things up the way you like, then click **+ Save current as preset** and give it a name. Saving under an existing name updates that preset. Click **×** and then **Delete?** to remove one. Custom presets are stored in `chrome.storage.local`, so they stay in this browser and don't sync. The on/off switch isn't saved in a preset.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest. Permissions: `storage`, plus host access to `*.googleusercontent.com` for ambient-light sampling. |
| `background.js` | Service worker that samples photo edge colors for the ambient light |
| `settings.js` | Defaults, limits, presets and validation, shared by the content script and the popup |
| `content.js` | Detection, tagging, fit calculation, settings → CSS variables. **All Google selectors are in `SELECTORS` at the top.** |
| `styles.css` | Every rule is scoped under `html.gps-active` and targets only our own `data-gps` markers |
| `popup.html/js/css` | Settings UI |

## How it works

- **Detection:** the slideshow counts as active when `div[jsname="ebixmb"]` contains a rendered Exit button. While it is active, `<html>` gets the `gps-active` class. A `MutationObserver` (throttled to one pass per animation frame), a `ResizeObserver` on the stage, and listeners for `fullscreenchange`, `resize` and navigation re-run the check.
- **Tagging:** `content.js` finds Google's elements through `SELECTORS` and marks them with `data-gps="stage|slide|ambient|box|mat"`. `styles.css` only targets these markers, so every selector that depends on Google's markup lives in one place.
- **Frame:** a layered `box-shadow` on `hPe5Dc` (mat, then frame, then drop shadow). Layout is untouched, and the frame fades with the photo during transitions.
- **Fit:** Google's inline `top/left/width/height/transform` are never changed. The media box gets the independent CSS `scale: var(--gps-fit)`, where
  `fit = min((stageW − 2·total) / boxW, (stageH − 2·total) / boxH, 1)` and `total = margin + mat + frame`.
  The frame and shadow sizes are divided by `--gps-fit` so they keep the pixel sizes you chose.
- **Blurred-photo background:** a `::before` on the stage uses the current slide's image URL (`--gps-photo`).
- **Ambient light** (Govee/Ambilight style; off by default, turn it on in the popup or with the *Ambilight* preset):
  - `background.js` fetches a small copy of each photo, then splits its edges into 16 zones (4 per side, clockwise). For each zone it takes a vibrancy-weighted average color. This runs in the worker because the page's content script can't read pixels of cross-origin images.
  - `content.js` makes each color more lamp-like: it boosts saturation and keeps lightness in a range that glows. It writes the colors, and the frame's outer rectangle, to `--gps-amb-*` variables. All three slides (previous, current and next) are sampled ahead of time, so the next colors are ready before the slide changes.
  - A `::after` on the stage, behind the slides, draws 16 radial-gradient lights around the frame. A registered `--gps-amb-phase` animation makes them drift along their edge and pulse in reach. A second animation makes the whole glow breathe. The colors and geometry are registered properties, so they cross-fade when the slide changes. Setting **Animation** to 0 (or turning on the OS "reduce motion" setting) keeps the lights still.

## Debug

Set `const DEBUG = true` in `content.js` and reload the extension. The console logs `[GPS] slideshow detected / ended / url changed / background photo`. The detected stage and the current media box get a magenta dashed outline.

## Troubleshooting (if nothing applies)

Check the selectors in this order in DevTools while a slideshow is running:

1. `document.querySelector('div[jsname="ebixmb"] button[aria-label="Exit"]')`: this drives detection. If your Google UI isn't in English, add your label to `SELECTORS.exitLabels`. If the control bar auto-hides with `display:none`, detection will drop out while it is hidden.
2. `div[jsname="xJzy8c"][data-media-key]`: the viewer root, found with `closest()` from the control bar.
3. `div[jsname="r4rOcc"]`: the stage.
4. `c-wiz[jsname="oISvpc"][data-media-key]` → `div[jsname="ImB6xd"]` → `div[jsname="hPe5Dc"]`: the slide, the media box and the frame target.
5. `div[jsname="ls4dqb"]` and `img[jsname="VAJbob"]`: Google's ambient background. If these stop matching, the Google background shows through.

In the console, `document.documentElement.classList.contains('gps-active')` tells you whether detection worked. `document.querySelectorAll('[data-gps]')` shows what got tagged.

## Known limits

- An **Image URL** background loads from the Photos page. If the page's CSP ever blocks that host, use a different host or the blurred-photo mode.
- Styling inside the YouTube video iframe isn't possible (it's cross-origin). The frame goes around it.
- Shrinking uses `scale`, which composes after Google's transition `transform`. Slide transitions therefore travel `fit` times their normal distance, which is usually unnoticeable.
