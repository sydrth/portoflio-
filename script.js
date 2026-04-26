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
  video.pause();
  video.load();
}

/* Phase boundaries */
const P1_END = 0.18;
const P2_END = 0.38;
const P3_END = 0.55;
const P4_END = 0.80;
const P5_END = 0.92;   /* Hello-I-am-Siddharth holds till here */
/* 0.92-1.0 = phase 6: video slides UP off screen, revealing the
   work section gradient + curves underneath. */

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

ScrollTrigger.create({
  trigger: stage,
  start: 'top top',
  end: 'bottom bottom',
  scrub: true,
  onUpdate: (self) => {
    const p = self.progress;
    updateWordmark(p);

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
      setPhase(1);
    }
    else if (p <= P2_END) {
      // Phase 2: scrub 0 → 1.86
      const t = (p - P1_END) / (P2_END - P1_END);
      video.style.filter = 'blur(0px) saturate(1) brightness(1)';
      video.style.transform = 'scale(1)';
      video.currentTime = VIDEO_PAUSE_AT * t;
      setPhase(2);
    }
    else if (p <= P3_END) {
      // Phase 3: hold A
      video.style.filter = 'blur(0px) saturate(1) brightness(1)';
      video.style.transform = 'scale(1)';
      video.currentTime = VIDEO_PAUSE_AT;
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
      // Phase 6: video + Layer B slide UP off screen, revealing the
      // work section gradient + curves that have been beneath all along.
      // Stage's whole sticky frame is opacity-faded simultaneously so
      // any residual silhouette doesn't peek through.
      const t = (p - P5_END) / (1 - P5_END);
      const eased = t * t * (3 - 2 * t);          // smoothstep
      video.style.filter = 'blur(0px) saturate(1) brightness(1)';
      video.style.transform = `scale(1) translateY(${-100 * eased}%)`;
      video.currentTime = VIDEO_END_AT;
      gsap.set(layerA, { opacity: 0 });
      gsap.set(layerB, { y: -80 * eased, opacity: 1 - eased });
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

/* ---------- 7b. Work section backdrop activation ----------
   Toggle .is-active on .work so the fixed grid + glow fade in only
   while the user is actually inside the work section. */
const workSection = document.querySelector('.work');
if (workSection) {
  ScrollTrigger.create({
    trigger: workSection,
    start: 'top 90%',
    end: 'bottom 10%',
    onEnter: () => workSection.classList.add('is-active'),
    onEnterBack: () => workSection.classList.add('is-active'),
    onLeave: () => workSection.classList.remove('is-active'),
    onLeaveBack: () => workSection.classList.remove('is-active')
  });
}

/* ---------- 9. Pill-nav active section tracking ---------- */
const sections = [
  { id: 'stage', nav: 'intro' },
  { id: 'work', nav: 'work' }
  // Contact is reached via CTA button — no nav link to highlight.
];

function setActiveNav(navKey) {
  document.querySelectorAll('.pill-nav__link').forEach(link => {
    link.classList.toggle('is-active', link.dataset.nav === navKey);
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
