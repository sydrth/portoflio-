/* ============================================================
   curves.js — math-curve trail-follower engine
   ============================================================
   Direct adaptation of the rendering code from
   https://paidax01.github.io/math-curve-loaders/ — each curve's
   parametric `point(progress, detailScale, config)` function and
   trail/particle parameters are taken verbatim from the source
   HTML files Sid downloaded.

   What this file does:
     1. Defines per-curve configs (point fn + parameters)
     2. Builds an SVG inside each .curve element with:
        - a faint background "ghost" path (the static curve outline)
        - N circle particles that animate as a trail-follower
     3. Runs ONE shared rAF loop that advances every curve's
        timeline together (saves on rAF overhead vs. one loop each)

   Color is set via CSS — the SVG uses currentColor for both the
   path stroke and the particle fill. So the .curve element's
   `color` style controls everything.
*/
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /* --------------------------------------------------------
     Curve configs — values verbatim from gallery source.
     The point() function in each is identical to the source's
     `config.point(progress, detailScale, config)` function.
     -------------------------------------------------------- */
  const CURVE_CONFIGS = {
    'thinking-nine': {
      rotate: true,
      particleCount: 68,
      trailSpan: 0.39,
      durationMs: 4700,
      rotationDurationMs: 30000,
      pulseDurationMs: 4200,
      strokeWidth: 5.5,
      baseRadius: 7,
      detailAmplitude: 3,
      petalCount: 9,
      curveScale: 3.9,
      point(progress, detailScale, c) {
        const t = progress * Math.PI * 2;
        const petals = Math.round(c.petalCount);
        const x = c.baseRadius * Math.cos(t)
                - c.detailAmplitude * detailScale * Math.cos(petals * t);
        const y = c.baseRadius * Math.sin(t)
                - c.detailAmplitude * detailScale * Math.sin(petals * t);
        return { x: 50 + x * c.curveScale, y: 50 + y * c.curveScale };
      }
    },

    'rose-three': {
      rotate: true,
      particleCount: 76,
      trailSpan: 0.31,
      durationMs: 5300,
      rotationDurationMs: 28000,
      pulseDurationMs: 4400,
      strokeWidth: 4.6,
      roseA: 9.2,
      roseABoost: 0.6,
      roseBreathBase: 0.72,
      roseBreathBoost: 0.28,
      roseScale: 3.25,
      point(progress, detailScale, c) {
        const t = progress * Math.PI * 2;
        const a = c.roseA + detailScale * c.roseABoost;
        const r = a * (c.roseBreathBase + detailScale * c.roseBreathBoost) * Math.cos(3 * t);
        return {
          x: 50 + Math.cos(t) * r * c.roseScale,
          y: 50 + Math.sin(t) * r * c.roseScale
        };
      }
    },

    'spiral-search': {
      rotate: false,
      particleCount: 86,
      trailSpan: 0.28,
      durationMs: 7800,
      rotationDurationMs: 44000,
      pulseDurationMs: 6800,
      strokeWidth: 4.3,
      searchTurns: 4,
      searchBaseRadius: 8,
      searchRadiusAmp: 8.5,
      searchPulse: 2.4,
      searchScale: 1,
      point(progress, detailScale, c) {
        const t = progress * Math.PI * 2;
        const angle = t * c.searchTurns;
        const radius = c.searchBaseRadius
                     + (1 - Math.cos(t)) * (c.searchRadiusAmp + detailScale * c.searchPulse);
        return {
          x: 50 + Math.cos(angle) * radius * c.searchScale,
          y: 50 + Math.sin(angle) * radius * c.searchScale
        };
      }
    },

    'fourier-flow': {
      rotate: false,
      particleCount: 92,
      trailSpan: 0.31,
      durationMs: 8400,
      rotationDurationMs: 44000,
      pulseDurationMs: 6800,
      strokeWidth: 4.2,
      fourierX1: 17, fourierX3: 7.5, fourierX5: 3.2,
      fourierY1: 15, fourierY2: 8.2, fourierY4: 4.2,
      fourierMixBase: 1, fourierMixPulse: 0.16,
      point(progress, detailScale, c) {
        const t = progress * Math.PI * 2;
        const mix = c.fourierMixBase + detailScale * c.fourierMixPulse;
        const x = c.fourierX1 * Math.cos(t)
                + c.fourierX3 * Math.cos(3 * t + 0.6 * mix)
                + c.fourierX5 * Math.sin(5 * t - 0.4);
        const y = c.fourierY1 * Math.sin(t)
                + c.fourierY2 * Math.sin(2 * t + 0.25)
                - c.fourierY4 * Math.cos(4 * t - 0.5 * mix);
        return { x: 50 + x, y: 50 + y };
      }
    },

    /* Lemniscate Bloom — substituting for "Lissajous Drift" since the
       gallery source provided is the lemniscate variant. */
    'lemniscate-bloom': {
      rotate: false,
      particleCount: 70,
      trailSpan: 0.4,
      durationMs: 5600,
      rotationDurationMs: 34000,
      pulseDurationMs: 5000,
      strokeWidth: 4.8,
      lemniscateA: 20,
      lemniscateBoost: 7,
      point(progress, detailScale, c) {
        const t = progress * Math.PI * 2;
        const scale = c.lemniscateA + detailScale * c.lemniscateBoost;
        const denom = 1 + Math.sin(t) ** 2;
        return {
          x: 50 + (scale * Math.cos(t)) / denom,
          y: 50 + (scale * Math.sin(t) * Math.cos(t)) / denom
        };
      }
    }
  };

  /* --------------------------------------------------------
     Per-curve render state
     -------------------------------------------------------- */
  function buildCurve(host) {
    const kind = host.dataset.curve;
    const config = CURVE_CONFIGS[kind];
    if (!config) return null;

    // Build SVG with viewBox 0..100 (matches gallery source)
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.overflow = 'visible';

    // <g> wrapper — gets rotation applied each frame for "rotate: true" curves
    const group = document.createElementNS(SVG_NS, 'g');
    svg.appendChild(group);

    // Faint static path = the full curve outline. Scaffolding for the
    // trail to follow against — much like the gallery's `opacity="0.1"` path.
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-width', String(config.strokeWidth));
    path.setAttribute('opacity', '0.1');
    group.appendChild(path);

    // N particles — these draw the moving glowing trail
    const particles = [];
    for (let i = 0; i < config.particleCount; i++) {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('fill', 'currentColor');
      group.appendChild(c);
      particles.push(c);
    }

    host.appendChild(svg);

    return { config, group, path, particles };
  }

  function buildPath(curve, detailScale, steps = 240) {
    let d = '';
    for (let i = 0; i <= steps; i++) {
      const p = curve.config.point(i / steps, detailScale, curve.config);
      d += (i === 0 ? 'M' : 'L') + ' ' + p.x.toFixed(2) + ' ' + p.y.toFixed(2) + ' ';
    }
    return d;
  }

  function getDetailScale(time, config) {
    const pp = (time % config.pulseDurationMs) / config.pulseDurationMs;
    const angle = pp * Math.PI * 2;
    return 0.52 + ((Math.sin(angle + 0.55) + 1) / 2) * 0.48;
  }

  function getRotation(time, config) {
    if (!config.rotate) return 0;
    return -((time % config.rotationDurationMs) / config.rotationDurationMs) * 360;
  }

  function normalizeProgress(p) { return ((p % 1) + 1) % 1; }

  /* --------------------------------------------------------
     Public init: discover every .curve[data-curve=...] in DOM
     and start the shared rAF loop.
     -------------------------------------------------------- */
  function init() {
    const hosts = Array.from(document.querySelectorAll('.curve[data-curve]'));
    if (!hosts.length) return;

    const curves = hosts.map(buildCurve).filter(Boolean);
    if (!curves.length) return;

    // Respect reduced-motion: render the static outline only, no trail.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      curves.forEach(curve => {
        curve.path.setAttribute('d', buildPath(curve, 0.7));
        curve.path.setAttribute('opacity', '0.4');
      });
      return;
    }

    const startedAt = performance.now();

    function frame(now) {
      const time = now - startedAt;
      for (let i = 0; i < curves.length; i++) {
        const curve = curves[i];
        const { config, group, path, particles } = curve;
        const progress = (time % config.durationMs) / config.durationMs;
        const detailScale = getDetailScale(time, config);

        // Rotate + redraw the static outline (it morphs with detailScale)
        group.setAttribute('transform', 'rotate(' + getRotation(time, config) + ' 50 50)');
        path.setAttribute('d', buildPath(curve, detailScale));

        // Update each particle: position lags behind progress by tailOffset
        for (let p = 0; p < particles.length; p++) {
          const tailOffset = p / (config.particleCount - 1);
          const pt = config.point(
            normalizeProgress(progress - tailOffset * config.trailSpan),
            detailScale, config);
          const fade = Math.pow(1 - tailOffset, 0.56);
          const node = particles[p];
          node.setAttribute('cx', pt.x.toFixed(2));
          node.setAttribute('cy', pt.y.toFixed(2));
          node.setAttribute('r', (0.9 + fade * 2.7).toFixed(2));
          node.setAttribute('opacity', (0.04 + fade * 0.96).toFixed(3));
        }
      }
      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
