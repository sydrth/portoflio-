/* ==========================================================
   SYDRTH — scroll-driven stage controller
   ========================================================== */

gsap.registerPlugin(ScrollTrigger);

/* ---------- 1. Split text helpers ---------- */
function splitWords(el) {
  const html = el.innerHTML;
  const lines = html.split(/<br\s*\/?>/i);
  const wrappedLines = lines.map(line => {
    const parts = line.split(/(<em>[^<]*<\/em>)/gi);
    return parts.map(part => {
      if (!part.trim()) return part;
      if (/^<em>/i.test(part)) {
        const inner = part.replace(/<\/?em>/gi, '');
        return wrapText(inner, true);
      }
      return wrapText(part, false);
    }).join('');
  });
  el.innerHTML = wrappedLines.join('<br>');
}

function wrapText(text, isItalic) {
  const tokens = text.split(/(\s+|&nbsp;)/);
  return tokens.map(token => {
    if (!token) return '';
    if (/^\s+$/.test(token) || token === '&nbsp;') return token;
    const tag = isItalic ? 'em' : 'span';
    return `<span class="word"><span class="word-inner"><${tag}>${token}</${tag}></span></span>`;
  }).join('');
}

document.querySelectorAll('[data-split="words"]').forEach(splitWords);

/* ---------- 2. Stage refs ---------- */
const stage = document.querySelector('.stage');
const video = document.getElementById('heroVideo');
const layerA = document.querySelector('.stage__layer--a');     // Human-first / AI-second
const layerB = document.querySelector('.stage__layer--b');     // Hello, I am Siddharth
const glassCard = document.querySelector('.glass-card');
const wordmark = document.getElementById('wordmark');
const pillNav = document.getElementById('pillNav');            // hidden during phase 1

if (video) {
  video.muted = true;          // ensure muted so play() doesn't get blocked
  video.pause();
  video.load();
  // Force frame buffering — load() alone doesn't always trigger frame
  // decoding on file:// protocol or under strict autoplay policies.
  // play()/pause() forces the browser to actually buffer frames.
  video.play().then(() => {
    video.pause();
    video.currentTime = 0;
  }).catch(() => {
    // Autoplay blocked — that's fine, the CSS background-image poster
    // shows in the meantime, and frames will load on first scroll.
  });
}

/* Phase boundaries (as fraction of total stage scroll, 0..1).
   Stage is 650vh tall, so 1% ≈ 6.5vh of scroll.

   Reweighted from the original 500vh balance after Sid flagged both
   held text frames as transitioning too fast:
     - P3 (Hold A "Human-first. AI-second.") was 17% = 85vh; now 22%
       = 143vh, giving the held frame ~70% more dwell.
     - P5 (Hold B "Hello, I am Siddharth") was 12% = 60vh; now 20%
       = 130vh, more than doubling its dwell — this was the worst
       case Sid called out.
     - P1 unblur, P2 video-scrub-to-1.86s, P4 video-scrub-to-7s, and
       P6 fade-out get roughly the same vh budget as before, just
       expressed as smaller % of the now-longer stage. */
const P1_END = 0.14;   /* unblur */
const P2_END = 0.30;   /* video scrubs to 1.86s */
const P3_END = 0.52;   /* Hold A — "Human-first. AI-second." */
const P4_END = 0.72;   /* video scrubs to 7s, layer A fades out */
const P5_END = 0.92;   /* Hold B — "Hello, I am Siddharth" */
/* 0.92-1.0 = phase 6: layer B fades out, video stays put. */

/* Per spec: video ends at 7.0s (not the full 8s) */
const VIDEO_PAUSE_AT = 1.86;
const VIDEO_END_AT   = 7.00;

const aWords = layerA ? layerA.querySelectorAll('.hero-a__title .word-inner') : [];
const bTitleWords = layerB ? layerB.querySelectorAll('.hero-b__title .word-inner') : [];
const bIntroWords = layerB ? layerB.querySelectorAll('.hero-b__intro .word-inner') : [];

/* ---------- 3. Reveal timelines (paused, played/reversed by phase) ---------- */
const tlA = gsap.timeline({ paused: true });
tlA
  .to(layerA, { opacity: 1, duration: 0.5, ease: 'power2.out' }, 0)
  .to(aWords, {
    y: '0%', opacity: 1,
    duration: 0.9, stagger: 0.06, ease: 'power3.out'
  }, 0.05)
  .fromTo(glassCard,
    { opacity: 0, y: 24, scale: 0.96 },
    { opacity: 1, y: 0, scale: 1, duration: 0.8, ease: 'power3.out' },
    0.35
  );

const tlB = gsap.timeline({ paused: true });
tlB
  .fromTo(layerB,
    { opacity: 0, y: 16 },
    { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }, 0)
  .to(bTitleWords, {
    y: '0%', opacity: 1,
    duration: 0.9, stagger: 0.06, ease: 'power3.out'
  }, 0.1)
  .to(bIntroWords, {
    y: '0%', opacity: 1,
    duration: 0.7, stagger: 0.018, ease: 'power3.out'
  }, 0.45);

/* ---------- 4. Phase tracker ---------- */
let lastPhase = -1;
function setPhase(p) {
  if (p === lastPhase) return;
  lastPhase = p;

  /* Stamp current phase on <body> so CSS can hook into it. Used by
     the mobile breakpoint to hard-hide Layer A in phases 5 and 6,
     where GSAP's opacity tween was unreliable (layer A would stay
     at opacity 1 even though phase logic set it to 0, causing both
     "Human-first." and "Hello, I am Siddharth" to render at once). */
  document.body.dataset.stagePhase = p;

  // Layer A visible during phase 3 only
  if (p === 3) tlA.play();
  else if (p < 3) tlA.reverse();

  // Layer B visible during phase 5 AND phase 6 (slides up with video in 6)
  if (p === 5 || p === 6) tlB.play();
  else tlB.reverse();

  // Pill nav: hidden in phase 1 (zero-state blur — only the wordmark
  // should read), revealed once the video clears and phases begin.
  if (pillNav) {
    if (p === 1) pillNav.classList.add('is-hidden');
    else pillNav.classList.remove('is-hidden');
  }
}

/* Wordmark scales smoothly during phase 4 (1.0 → 0.42),
   stays at full size in phases 1-3, locked small in phase 5 */
const WORDMARK_MIN_SCALE = 0.42;
function updateWordmark(p) {
  let scale;
  if (p <= P3_END) scale = 1;
  else if (p <= P4_END) {
    const t = (p - P3_END) / (P4_END - P3_END);
    const eased = 1 - Math.pow(1 - t, 3);
    scale = 1 - (1 - WORDMARK_MIN_SCALE) * eased;
  }
  else scale = WORDMARK_MIN_SCALE;
  wordmark.style.setProperty('--wordmark-scale', scale);
}

/* ---------- 5. Main scroll handler ---------- */
let videoDuration = VIDEO_END_AT;  // we cap at 7s anyway

/* Scroll affordance — visible during the zero-state, fades on first
   scroll past a small threshold. Per Sid's update: it should also
   REAPPEAR if the user scrolls back to the very top, so we removed
   the previous one-shot latch and now toggle .is-faded purely as a
   function of current stage scroll progress. */
const scrollHint = document.getElementById('scrollHint');
const SCROLL_HINT_FADE_AT = 0.01;  /* 1% of stage scroll */

ScrollTrigger.create({
  trigger: stage,
  start: 'top top',
  end: 'bottom bottom',
  scrub: true,
  onUpdate: (self) => {
    const p = self.progress;
    updateWordmark(p);

    /* Toggle the hint based on current scroll position. When the user
       drops back below the threshold, the hint reappears — useful if
       someone scrolls back up to the zero state. */
    if (scrollHint) {
      if (p > SCROLL_HINT_FADE_AT) {
        scrollHint.classList.add('is-faded');
      } else {
        scrollHint.classList.remove('is-faded');
      }
    }

    if (p <= P1_END) {
      // Phase 1: unblur, locked at 0
      const t = p / P1_END;
      const blur = 40 * (1 - t);
      const sat = 0.7 + (0.3 * t);
      const bright = 0.75 + (0.25 * t);
      const scale = 1.1 - (0.1 * t);
      video.style.filter = `blur(${blur}px) saturate(${sat}) brightness(${bright})`;
      video.style.transform = `scale(${scale})`;
      video.currentTime = 0;
      gsap.set(stage, { opacity: 1 });
      setPhase(1);
    }
    else if (p <= P2_END) {
      // Phase 2: scrub 0 → 1.86
      const t = (p - P1_END) / (P2_END - P1_END);
      video.style.filter = 'blur(0px) saturate(1) brightness(1)';
      video.style.transform = 'scale(1)';
      video.currentTime = VIDEO_PAUSE_AT * t;
      gsap.set(stage, { opacity: 1 });
      setPhase(2);
    }
    else if (p <= P3_END) {
      // Phase 3: hold A
      video.style.filter = 'blur(0px) saturate(1) brightness(1)';
      video.style.transform = 'scale(1)';
      video.currentTime = VIDEO_PAUSE_AT;
      gsap.set(stage, { opacity: 1 });
      setPhase(3);
    }
    else if (p <= P4_END) {
      // Phase 4: scrub 1.86 → 7.0 (per spec, end at 7s not 8s)
      video.style.filter = 'blur(0px) saturate(1) brightness(1)';
      video.style.transform = 'scale(1)';
      const t = (p - P3_END) / (P4_END - P3_END);
      video.currentTime = VIDEO_PAUSE_AT + ((VIDEO_END_AT - VIDEO_PAUSE_AT) * t);
      // Fade A out manually so it doesn't clash with B
      gsap.set(layerA, { opacity: 1 - t });
      gsap.set(stage, { opacity: 1 });
      setPhase(4);
    }
    else if (p <= P5_END) {
      // Phase 5: hold B at 7s
      video.style.filter = 'blur(0px) saturate(1) brightness(1)';
      video.style.transform = 'scale(1) translateY(0)';
      video.currentTime = VIDEO_END_AT;
      gsap.set(layerA, { opacity: 0 });
      gsap.set(stage, { opacity: 1 });
      setPhase(5);
    }
    else {
      // Phase 6: video stays put, ONLY the "Hello, I am Siddharth" text
      // fades out. Per Sid's spec: the video should not be touched. The
      // navy strip that appeared between intro and work section is fixed
      // by the .work__glow gradient layer being always painted at z-index
      // 0 — there's no longer any moment where solid navy shows alone.
      const t = (p - P5_END) / (1 - P5_END);
      const eased = t * t * (3 - 2 * t);
      // Reset video filter/transform to clean state (no blur, no slide)
      video.style.filter = 'blur(0px) saturate(1) brightness(1)';
      video.style.transform = 'scale(1) translateY(0)';
      video.currentTime = VIDEO_END_AT;
      gsap.set(layerA, { opacity: 0 });
      // Text fades out as the user scrolls
      gsap.set(layerB, { opacity: Math.max(0, 1 - eased * 1.6), y: 0 });
      // Stage stays fully opaque — video remains visible
      gsap.set(stage, { opacity: 1 });
      // Reset stage backgroundColor in case a previous turn's code set it
      stage.style.backgroundColor = '';
      setPhase(6);
    }
  }
});

if (video) {
  video.addEventListener('loadedmetadata', () => ScrollTrigger.refresh());
}

/* ---------- 6. Other scroll-reveals (work intro, cases, footer) ---------- */
document.querySelectorAll('[data-split="words"]').forEach(block => {
  if (block.closest('.stage')) return;
  const words = block.querySelectorAll('.word-inner');
  if (!words.length) return;
  gsap.to(words, {
    y: '0%', opacity: 1,
    duration: 0.8, stagger: 0.035, ease: 'power3.out',
    scrollTrigger: {
      trigger: block,
      start: 'top 85%',
      toggleActions: 'play none none reverse'
    }
  });
});

/* ---------- 7. Chapter cards: 3D tilt entry + cursor-tracked spotlight ----------
   Each chapter card enters with a perspective tilt that flattens as it
   reaches the viewport — feels like the card is being pulled forward
   through space. Then on hover, a soft spotlight follows the cursor. */

document.querySelectorAll('.chapter').forEach((chapterEl) => {
  const card = chapterEl.querySelector('.chapter__card');
  if (!card) return;

  // 3D tilt entry — card starts angled away from the viewer + offset down,
  // animates to flat as the section enters
  gsap.fromTo(card,
    {
      y: 120,
      opacity: 0,
      rotateX: 18,
      scale: 0.92,
      transformOrigin: 'center top'
    },
    {
      y: 0,
      opacity: 1,
      rotateX: 0,
      scale: 1,
      duration: 1.2,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: chapterEl,
        start: 'top 78%',
        toggleActions: 'play none none reverse'
      }
    }
  );

  // Cursor-tracked spotlight — updates the CSS vars that drive the
  // ::before radial gradient. Throttled via rAF.
  let rafId = 0;
  let pendingX = 0, pendingY = 0;
  function applyMouse() {
    card.style.setProperty('--mx', pendingX + 'px');
    card.style.setProperty('--my', pendingY + 'px');
    rafId = 0;
  }
  card.addEventListener('mousemove', (e) => {
    const rect = card.getBoundingClientRect();
    pendingX = e.clientX - rect.left;
    pendingY = e.clientY - rect.top;
    if (!rafId) rafId = requestAnimationFrame(applyMouse);
  });
});

/* ---------- 7b. Work section activation + intro chrome hide ----------
   Toggle `.is-active` on .work (already used for backdrop fade-in) and
   `.is-hidden` on the wordmark when the user scrolls past the stage.
   Also manages the curves visibility window — curves are POSITION FIXED
   and appear briefly only while user is on My Work; they fizzle out
   the moment user scrolls toward chapter 1.
   Implemented with a direct scroll listener (not ScrollTrigger) because
   ScrollTrigger's computed positions for these elements were unreliable
   when the layout includes scroll-snap-mandatory + sticky scrub. The
   live offsetTop+offsetHeight is always correct. */
const workSection = document.querySelector('.work');
const stageEl = document.querySelector('.stage');
const workScrollHint = document.getElementById('workScrollHint');
if (workSection && stageEl) {
  let lastInside = null;
  let lastNearMyWork = null;
  let curvesOnTimer = null;
  function syncIntroChrome() {
    const stageBottom = stageEl.offsetTop + stageEl.offsetHeight;
    const vh = window.innerHeight;

    // Work section "active" — past stage by half a viewport
    const inside = window.scrollY >= stageBottom - vh * 0.5;
    if (inside !== lastInside) {
      lastInside = inside;
      workSection.classList.toggle('is-active', inside);
      if (wordmark) wordmark.classList.toggle('is-hidden', inside);
    }

    // Curves window — only visible while user is around My Work.
    // Lower bound: stage_bottom - 0.3vh (user has crossed into work)
    // Upper bound: stage_bottom + 0.6vh (still on My Work, not Ch1)
    const nearMyWork = window.scrollY >= stageBottom - vh * 0.3
                    && window.scrollY <= stageBottom + vh * 0.6;
    if (nearMyWork !== lastNearMyWork) {
      lastNearMyWork = nearMyWork;
      // Clear any pending timer
      if (curvesOnTimer) { clearTimeout(curvesOnTimer); curvesOnTimer = null; }
      if (nearMyWork) {
        // 700ms delay after landing — gives My Work title room to settle
        // before the curves come in. Forward scroll feels like: arrive,
        // beat, curves drift in.
        curvesOnTimer = setTimeout(() => {
          document.body.classList.add('is-curves-on');
        }, 700);
      } else {
        // Off immediately when user starts scrolling away — curves
        // fizzle out (CSS opacity transition) so chapter 1 emerges clean.
        document.body.classList.remove('is-curves-on');
      }
    }

    // Work-section scroll hint: visible when user has just arrived on
    // My Work (within ~0.3vh of section top), fades as they continue
    // scrolling toward chapter 1. Like the stage hint, it REAPPEARS
    // when the user scrolls back into the early window — symmetric
    // with the stage hint's bidirectional behavior.
    if (workScrollHint) {
      const workHintVisible =
        window.scrollY >= stageBottom - vh * 0.2 &&
        window.scrollY <= stageBottom + vh * 0.25;
      workScrollHint.classList.toggle('is-faded', !workHintVisible);
    }
  }
  window.addEventListener('scroll', syncIntroChrome, { passive: true });
  window.addEventListener('resize', syncIntroChrome);
  syncIntroChrome();
}

/* ---------- 9. Pill-nav active section tracking ---------- */
const sections = [
  { id: 'stage',   nav: 'intro' },
  { id: 'work',    nav: 'work' },
  // Contact: neither pill represents this section (the contact CTA on
  // the right is a separate button). When the user scrolls into the
  // footer, we clear ALL pill highlights so it doesn't look like Work
  // is still selected. Passing null tells setActiveNav to deactivate
  // every pill.
  { id: 'contact', nav: null }
];

function setActiveNav(navKey) {
  document.querySelectorAll('.pill-nav__link').forEach(link => {
    link.classList.toggle('is-active', navKey !== null && link.dataset.nav === navKey);
  });
}

sections.forEach(({ id, nav }) => {
  const el = document.getElementById(id);
  if (!el) return;
  ScrollTrigger.create({
    trigger: el,
    start: 'top 50%',
    end: 'bottom 50%',
    onEnter: () => setActiveNav(nav),
    onEnterBack: () => setActiveNav(nav)
  });
});

window.addEventListener('load', () => ScrollTrigger.refresh());
