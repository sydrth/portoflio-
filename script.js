/* ==========================================================
   SYDRTH — scroll-driven stage controller
   ========================================================== */

gsap.registerPlugin(ScrollTrigger);

/* ---------- Asset protection (friction layer) ----------
   Block right-click context menu and drag-start on <img> and
   <video> elements only. Targeted (not site-wide) so legitimate
   right-click on links and text still works. This is a deterrent,
   NOT real protection — DevTools always wins. Pairs with the
   CSS rules in styles.css that disable user-select, drag, and the
   iOS long-press callout. */
(function protectMedia() {
  const block = (e) => { e.preventDefault(); return false; };
  document.addEventListener('contextmenu', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'IMG' || t.tagName === 'VIDEO')) {
      block(e);
    }
  });
  document.addEventListener('dragstart', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'IMG' || t.tagName === 'VIDEO')) {
      block(e);
    }
  });
})();

/* ---------- 0. Page loader / video readiness gate ----------
   Hide the loader and unlock scroll once the hero video is ready
   to scrub smoothly. "Ready" = first frame decoded AND ≥3 seconds
   of forward buffer, OR 8-second fallback timeout. The fallback
   matters for slow connections / cached states / errors — we never
   want the user stuck on the loader forever.

   Also: if the page restored at a non-zero scroll position (e.g.
   reload-while-mid-scroll), don't bother locking — the user is
   already past the stage and won't see the loader meaningfully. */
(function pageLoadGate() {
  const body = document.body;
  const video = document.getElementById('heroVideo');

  // Edge case: scroll already past zero-state? Just release.
  if (window.scrollY > 100) {
    body.classList.remove('is-loading');
    return;
  }

  // Minimum show duration so cached/instant-ready cases don't flash
  // the loader for 50ms (looks janky, like a glitch). 400ms reads
  // as "intentional brief moment of orientation."
  const startTime = performance.now();
  const MIN_SHOW_MS = 400;
  const MAX_WAIT_MS = 8000;
  let released = false;

  function release() {
    if (released) return;
    released = true;
    const elapsed = performance.now() - startTime;
    const remaining = Math.max(0, MIN_SHOW_MS - elapsed);
    setTimeout(() => {
      body.classList.remove('is-loading');
      // After the loader's transition finishes (matches CSS 0.5s),
      // refresh ScrollTrigger so any layout-dependent calculations
      // recompute against the now-unlocked body height.
      setTimeout(() => ScrollTrigger.refresh(), 550);
    }, remaining);
  }

  function checkReady() {
    if (!video) return release();          // no video element? release
    if (video.readyState < 2) return;      // need at least HAVE_CURRENT_DATA
    // Has the video buffered ≥3s of forward content?
    const buf = video.buffered;
    if (buf.length === 0) return;
    const bufferedEnd = buf.end(buf.length - 1);
    if (bufferedEnd >= 3 || bufferedEnd >= video.duration) release();
  }

  if (video) {
    video.addEventListener('loadeddata', checkReady);
    video.addEventListener('progress', checkReady);
    video.addEventListener('canplay', checkReady);
    video.addEventListener('error', release); // failure → release anyway
    // Already-cached video may have fired loadeddata before we attached
    if (video.readyState >= 2) checkReady();
  }

  // Hard ceiling — release no matter what after MAX_WAIT_MS
  setTimeout(release, MAX_WAIT_MS);
})();

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

/* ---------- 3. Reveal timelines (paused, played/reversed by phase) ----------

   IMPORTANT: every tween in tlA and tlB uses fromTo() with EXPLICIT start
   states, never bare .to(). Reason: when GSAP rewinds a timeline (via
   .progress(0) or .reverse()), bare .to() tweens restore "captured-on-
   first-play" values, which can drift if the captured snapshot was taken
   while a previous tween was still in flight. fromTo() locks the start
   state literally, so .progress(0) deterministically returns to a known
   baseline. This is the root fix for "fonts don't disappear at right
   stages and appear all at once" — the timeline's rewind state is now
   100% predictable regardless of how the user scrolls. */
const tlA = gsap.timeline({ paused: true });
tlA
  .fromTo(layerA,
    { opacity: 0 },
    { opacity: 1, duration: 0.5, ease: 'power2.out' }, 0)
  .fromTo(aWords,
    { y: '110%', opacity: 0 },                          // matches CSS initial
    { y: '0%', opacity: 1,
      duration: 0.9, stagger: 0.06, ease: 'power3.out' },
    0.05)
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
  .fromTo(bTitleWords,
    { y: '110%', opacity: 0 },
    { y: '0%', opacity: 1,
      duration: 0.9, stagger: 0.06, ease: 'power3.out' },
    0.1)
  .fromTo(bIntroWords,
    { y: '110%', opacity: 0 },
    { y: '0%', opacity: 1,
      duration: 0.7, stagger: 0.018, ease: 'power3.out' },
    0.45);

/* ---------- 4. Phase tracker — deterministic state, no race conditions ----------

   PRIOR ARCHITECTURE (v52 and earlier):
   - setPhase() called tlA.play() / tlA.reverse() / tlB.play() / tlB.reverse()
   - Each timeline takes ~0.9s of stagger to complete
   - On fast scroll-up, multiple play/reverse commands stack on top of each other
     before any complete, causing in-flight tweens to fight and leave the wrapper
     and word opacities in inconsistent states (Sid's "all fonts visible at once" bug)
   - In phase 4, gsap.set(layerA, opacity: 1-t) was also writing the wrapper
     opacity directly while tlA still controlled word opacities — two sources
     of truth for layer A's visibility, racing each other.

   NEW ARCHITECTURE:
   - Each timeline still defines the visual reveal (word stagger, fade-in).
   - Instead of play/reverse, we compute a "reveal progress" 0..1 for each
     layer as a pure function of overall scroll progress p, then write
     tlA.progress(value) / tlB.progress(value) every frame.
   - Timeline progress = pure function of scroll progress. No animation race,
     no in-flight tween conflicts. Fast scroll? State snaps to the right
     end-state immediately. Slow scroll? Timeline walks through stagger as p
     advances.
   - Layer A direct-opacity writes in phase 4 are GONE — phase 4 just reverses
     tlA's progress from 1 (start of P4) down to 0 (end of P4), giving the
     same visual fade-out but driven by a single source of truth. */
let lastPhase = -1;

/* Layer A reveal progress as fn of overall scroll progress.
   - 0 outside the visible window (phases 1, 2, 5, 6)
   - eases from 0 → 1 across phase 3 entry (P2_END..P3_END midpoint)
   - eases 1 → 0 across phase 4 (P3_END..P4_END) as we transition to layer B */
function layerAProgress(p) {
  if (p <= P2_END) return 0;                    // not yet visible
  if (p <= P3_END) {
    // Reveal during phase 3: ramps to 1 in the first ~60% of the hold
    const t = (p - P2_END) / (P3_END - P2_END);
    // Use only the first 0.6 of the hold for the reveal, stay at 1 after
    return Math.min(1, t / 0.6);
  }
  if (p <= P4_END) {
    // Phase 4: reverse to 0 across the full phase
    const t = (p - P3_END) / (P4_END - P3_END);
    return 1 - t;
  }
  return 0;                                      // phases 5, 6 — fully hidden
}

/* Layer B reveal progress.
   - 0 in phases 1-4
   - eases 0 → 1 across phase 5 entry (P4_END..first 60% of P5)
   - holds at 1 until end of P5
   - eases 1 → 0 across phase 6 (P5_END..1.0) as user scrolls toward Work */
function layerBProgress(p) {
  if (p <= P4_END) return 0;
  if (p <= P5_END) {
    const t = (p - P4_END) / (P5_END - P4_END);
    return Math.min(1, t / 0.6);                // reveal in first 60% of P5
  }
  // Phase 6: fade out
  const t = (p - P5_END) / (1 - P5_END);
  const eased = t * t * (3 - 2 * t);
  return Math.max(0, 1 - eased * 1.6);
}

function setPhase(p) {
  if (p === lastPhase) return;
  lastPhase = p;

  /* Stamp current phase on <body> so CSS can hook into it. Mobile uses
     this to hard-hide Layer A in phases 5/6 as a defensive belt-and-braces
     against any residual opacity drift; with the new deterministic
     architecture, drift shouldn't happen, but the CSS guard is harmless. */
  document.body.dataset.stagePhase = p;

  // Pill nav: hidden in phase 1 only
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

/* Throttle video.currentTime writes — HTML5 video coalesces rapid seek
   requests, and on fast scroll-up the playhead can get stuck on an old
   frame because new currentTime values are silently dropped while the
   video is still in a `seeking` state.

   THE BUG (Sid's "video stuck" report v53):
     The previous implementation deduped by comparing the requested t
     against video.currentTime. But video.currentTime LAGS during seeking
     — it reports the last *successfully landed* frame, not the last
     requested target. On fast scroll-up, here's what could go wrong:
       1. video at 7.0s. User flicks up. Frame requests t=4.0, write happens,
          video starts seeking 7.0 → 4.0.
       2. Mid-seek, video.currentTime still ≈ 7.0. User scrolls more,
          frame requests t=2.0. |7.0 - 2.0| > epsilon, write happens.
          New seek queued.
       3. Eventually the LAST seek wins, video lands at 2.0. Good.
     But occasionally — particularly on mobile Safari — the dedup gate
     catches a request that's close to video.currentTime (still lagging)
     even though the LAST APPLIED write was a different target. The new
     request gets dropped. Video stays at the wrong frame.

   THE FIX:
     Track the last *requested* time separately. Dedup against THAT.
     If user requests t=2.0 then t=2.01, dedup fires (good, no point
     re-issuing). If user requests t=2.0 then t=4.5 then t=2.0, the
     last write IS t=2.0 even if video.currentTime is mid-seek toward
     4.5 — third request reissues and the seek queue resolves correctly. */
const VIDEO_SEEK_EPSILON = 0.04;
let lastRequestedTime = -1;
function setVideoTime(t) {
  if (!video) return;
  if (Math.abs(lastRequestedTime - t) < VIDEO_SEEK_EPSILON) return;
  lastRequestedTime = t;
  // Defensive: if the video somehow started playing (browser autoplay
  // recovery, etc.), pause so seeks don't fight playback.
  if (!video.paused) video.pause();
  video.currentTime = t;
}

/* Resync watchdog — if the video's actual playhead has drifted far from
   what we last requested (e.g. a seek failed silently, or a paused/
   playing race left it at a stale frame), reissue the seek. Runs at a
   gentle cadence (250ms) so it doesn't add seek-storm pressure during
   active scrolling. */
setInterval(() => {
  if (!video || lastRequestedTime < 0) return;
  if (video.seeking) return;       // don't interrupt active seeks
  const drift = Math.abs(video.currentTime - lastRequestedTime);
  if (drift > 0.25) {
    // Significant drift while idle — playhead got stuck. Re-issue.
    if (!video.paused) video.pause();
    video.currentTime = lastRequestedTime;
  }
}, 250);

ScrollTrigger.create({
  trigger: stage,
  start: 'top top',
  end: 'bottom bottom',
  scrub: true,
  onUpdate: (self) => {
    const p = self.progress;
    updateWordmark(p);

    /* Toggle the hint based on current scroll position. */
    if (scrollHint) {
      if (p > SCROLL_HINT_FADE_AT) {
        scrollHint.classList.add('is-faded');
      } else {
        scrollHint.classList.remove('is-faded');
      }
    }

    /* ---- Drive layer reveal timelines deterministically by progress ----
       This replaces the prior play/reverse commands inside setPhase().
       Writing .progress() forces the timeline state to a definite point
       every frame, eliminating in-flight tween races on fast scroll. */
    tlA.progress(layerAProgress(p));
    tlB.progress(layerBProgress(p));

    /* ---- Phase-specific video + filter logic ---- */
    if (p <= P1_END) {
      // Phase 1: unblur, locked at currentTime 0
      const t = p / P1_END;
      const blur = 40 * (1 - t);
      const sat = 0.7 + (0.3 * t);
      const bright = 0.75 + (0.25 * t);
      const scale = 1.1 - (0.1 * t);
      video.style.filter = `blur(${blur}px) saturate(${sat}) brightness(${bright})`;
      video.style.transform = `scale(${scale})`;
      setVideoTime(0);
      gsap.set(stage, { opacity: 1 });
      setPhase(1);
    }
    else if (p <= P2_END) {
      // Phase 2: scrub 0 → VIDEO_PAUSE_AT
      const t = (p - P1_END) / (P2_END - P1_END);
      video.style.filter = 'blur(0px) saturate(1) brightness(1)';
      video.style.transform = 'scale(1)';
      setVideoTime(VIDEO_PAUSE_AT * t);
      gsap.set(stage, { opacity: 1 });
      setPhase(2);
    }
    else if (p <= P3_END) {
      // Phase 3: hold A
      video.style.filter = 'blur(0px) saturate(1) brightness(1)';
      video.style.transform = 'scale(1)';
      setVideoTime(VIDEO_PAUSE_AT);
      gsap.set(stage, { opacity: 1 });
      setPhase(3);
    }
    else if (p <= P4_END) {
      // Phase 4: scrub VIDEO_PAUSE_AT → VIDEO_END_AT.
      // Layer A fade-out is handled by layerAProgress() driving tlA.progress(),
      // not by direct gsap.set on layerA — that prior dual-source-of-truth
      // pattern is what caused the layered-text bug.
      video.style.filter = 'blur(0px) saturate(1) brightness(1)';
      video.style.transform = 'scale(1)';
      const t = (p - P3_END) / (P4_END - P3_END);
      setVideoTime(VIDEO_PAUSE_AT + ((VIDEO_END_AT - VIDEO_PAUSE_AT) * t));
      gsap.set(stage, { opacity: 1 });
      setPhase(4);
    }
    else if (p <= P5_END) {
      // Phase 5: hold B at end frame
      video.style.filter = 'blur(0px) saturate(1) brightness(1)';
      video.style.transform = 'scale(1) translateY(0)';
      setVideoTime(VIDEO_END_AT);
      gsap.set(stage, { opacity: 1 });
      setPhase(5);
    }
    else {
      // Phase 6: video stays at end, layer B fades via layerBProgress.
      video.style.filter = 'blur(0px) saturate(1) brightness(1)';
      video.style.transform = 'scale(1) translateY(0)';
      setVideoTime(VIDEO_END_AT);
      gsap.set(stage, { opacity: 1 });
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
