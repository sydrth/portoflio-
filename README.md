# sydrth — portfolio

Scroll-driven cinematic portfolio for Siddharth. Vanilla HTML/CSS/JS + GSAP (bundled locally).

## Run it

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`.

---

## Architecture

One sticky `<section class="stage">` (500vh). Scroll progress (0 → 1) drives 5 phases:

| Progress | Phase | What happens |
|---|---|---|
| 0.00 → 0.18 | **1** Unblur | Video at frame 0; blur clears 40px → 0px |
| 0.18 → 0.38 | **2** Scrub | Video scrubs 0 → 1.86s |
| 0.38 → 0.55 | **3** Hold A | "Human-first. AI-second." + Lead UX Designer glass card |
| 0.55 → 0.80 | **4** Scrub | Video scrubs 1.86s → 7.0s (per spec) |
| 0.80 → 1.00 | **5** Hold B | "Hello, I am Siddharth." + intro paragraph |

After phase 4, the `sydrth*.` wordmark scales down to a compact size — small detail that signals "we're past the intro now."

## Fonts

The mock specifies **Canela** (display serif) and **Google Sans** (UI/body). Neither is freely available for embedding:

- **Canela** — Commercial Type, paid license. The build uses **Fraunces** as the closest free stand-in. When you license Canela, swap once: in `styles.css`, change `--serif: 'Fraunces'` to `--serif: 'Canela'` and add the font-face declarations.
- **Google Sans** — Google-internal-only; not available outside `*.google.com` domains. The build uses **Inter** as a near-identical stand-in. Same one-line swap when you have access via your work tools.

The CSS uses `--serif` and `--sans` variables everywhere, so the swap is genuinely a one-line change at the top of `styles.css`.

## Hero video

`assets/hero.mp4` (4.1MB, keyframe-every-frame for smooth scrubbing). To regenerate from a new source:

```bash
ffmpeg -i input.mp4 -c:v libx264 -preset slow -crf 23 \
       -g 1 -keyint_min 1 -sc_threshold 0 \
       -pix_fmt yuv420p -movflags +faststart -an \
       assets/hero.mp4
```

The `-g 1` flag is critical for jitter-free scroll-scrubbing.

## Tuning knobs (top of `script.js`)

```js
const P1_END = 0.18;        // when blur finishes clearing
const P2_END = 0.38;        // when first scrub completes
const P3_END = 0.55;        // when Hold A ends
const P4_END = 0.80;        // when second scrub completes
const VIDEO_PAUSE_AT = 1.86;  // first hold timestamp
const VIDEO_END_AT   = 7.00;  // where scrubbing stops (per spec)
```

## What to swap when ready

- **Brand mark** — `assets/sydrth-logo.png` (RGBA, white-on-transparent). The wordmark is now an image, sized by height in CSS (`.wordmark__img`) — width follows the asset's aspect ratio. To swap, replace the PNG and the `<img>` in `index.html` will pick it up. The `<a id="wordmark">` wrapper still owns the scale transform driven by JS.
- **Hero copy A** — `<h1 class="hero-a__title">Human-first.<br><em>AI-second.</em></h1>`
- **Glass card** — `<div class="glass-card">` block
- **Hero copy B** — `<h1 class="hero-b__title">` and `<p class="hero-b__intro">`
- **Case studies** — three `<article class="case">` blocks
- **Footer** — bottom of HTML

## Frosted glass card spec

The "LEAD UX DESIGNER / AT GOOGLE." card uses `backdrop-filter: blur(32px) saturate(1.2)`. Browser support note: Safari and Chrome support this fully; older Firefox does not — it falls back to the semi-transparent background which still reads acceptably.
