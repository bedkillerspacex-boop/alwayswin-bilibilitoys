/* ═══════════════════════════════════════════════════════════════════════════
   Fatality — CS2-style injection splash ("FATALITY" slam)

   Timeline mirrored from the open-source reference implementation
   github.com/addosama/FatalWidgets  →  class InjectAnimation (fatalui_test.cpp)

     t 0.00 ─ black scrim fades in (0x88000000, 0.3s out-cubic)  [0.3s]
     t 0.00 ─ "F" rises from below into the screen centre        [1.0s, out-cubic]
     t 1.00 ─ "F" slides from the centre to the word's left edge [1.0s, out-cubic]
     t 1.25 ─ "ATALITY" fades + rises by half a line height       [1.0s, out-cubic]
     t 2.25 ─ full word held
     t 3.25 ─ finished → scrim fades out                          [0.3s]
     t 3.55 ─ done (optionally opens the ClickGui)

   Text colour is a horizontal gradient #FF8080 → #CC3333 across the word box.
   ═══════════════════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  /* ── reference timeline (seconds, 1.0 = default speed) ───────────── */

  const REF = {
    L_DUR: 2.0,      /* F tween: 0 → 2 (stage 1 0..1 = rise, stage 2 1..2 = slide) */
    R_START: 1.25,   /* ATALITY starts once the F tween passes 1.25 */
    R_DUR: 2.0,      /* ATALITY tween: 0 → 2 */
    FADE: 0.3        /* scrim fade in / out */
  };

  const R_END = REF.R_START + REF.R_DUR;        /* 3.25 — tween finished */
  const TOTAL = R_END + REF.FADE;               /* 3.55 — fully faded out */
  const SCRIM = 0x88 / 255;                     /* 0x88000000 */

  const MAX_WORD = 22;

  /* ── easings (out-cubic everywhere, like iam_ease_out_cubic) ─────── */

  const outCubic = (p) => 1 - Math.pow(1 - p, 3);
  const outQuart = (p) => 1 - Math.pow(1 - p, 4);
  const outSine = (p) => Math.sin((p * Math.PI) / 2);
  const smoothStep = (p) => p * p * (3 - 2 * p);

  /* ── state ───────────────────────────────────────────────────────── */

  const F = {
    active: false,
    t: 0,                 /* reference seconds */
    word: 'FATALITY',
    autoAsked: false,
    autoWait: 0,
    autoElapsed: 0,
    fontsReady: false,
    wroteBlur: false,
    slammed: false,
    stripes: null,
    grain: null,
    ac: null,
    hooked: false
  };

  /* ── settings ────────────────────────────────────────────────────── */

  function setting(name) {
    const mod = getMod('Fatality');
    return mod ? mod.settings.find((entry) => entry.n === name) : null;
  }

  function num(name, fallback) {
    const s = setting(name);
    const v = s ? Number(s.v) : NaN;
    return Number.isFinite(v) ? v : fallback;
  }

  function bool(name, fallback) {
    const s = setting(name);
    return s ? Boolean(s.v) : fallback;
  }

  function enumValue(name, fallback) {
    const s = setting(name);
    if (!s || !Array.isArray(s.vals)) return fallback;
    return s.vals[s.v] || fallback;
  }

  function color(name, fallback) {
    const s = setting(name);
    const v = s && Array.isArray(s.v) ? s.v : fallback;
    return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0];
  }

  /* ── blur bridge (same element the ClickGui blurs) ───────────────── */

  function blurElement() {
    return bgImg || document.getElementById('bg');
  }

  function applyBlur(px) {
    const el = blurElement();
    if (!el) return;
    if (px > 0.05) {
      el.style.filter = `blur(${px.toFixed(2)}px)`;
      F.wroteBlur = true;
    } else if (F.wroteBlur) {
      el.style.filter = '';
      F.wroteBlur = false;
    }
  }

  /* ── synthesized audio (no assets) ───────────────────────────────── */

  function audio() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      if (!F.ac) F.ac = new Ctx();
      if (F.ac.state === 'suspended') F.ac.resume().catch(() => {});
      return F.ac;
    } catch (e) {
      return null;
    }
  }

  function playRiser() {
    if (!bool('Sound', false)) return;
    const a = audio();
    if (!a) return;
    try {
      const now = a.currentTime;
      const osc = a.createOscillator();
      const gain = a.createGain();
      const filter = a.createBiquadFilter();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(58, now);
      osc.frequency.exponentialRampToValueAtTime(190, now + 1.0);
      filter.type = 'lowpass';
      filter.Q.value = 6;
      filter.frequency.setValueAtTime(260, now);
      filter.frequency.exponentialRampToValueAtTime(3600, now + 1.0);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.8);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.3);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(a.destination);
      osc.start(now);
      osc.stop(now + 1.35);
    } catch (e) {}
  }

  function playSlam() {
    if (!bool('Sound', false)) return;
    const a = audio();
    if (!a) return;
    try {
      const now = a.currentTime;
      const body = a.createOscillator();
      const bodyGain = a.createGain();
      body.type = 'sine';
      body.frequency.setValueAtTime(150, now);
      body.frequency.exponentialRampToValueAtTime(38, now + 0.4);
      bodyGain.gain.setValueAtTime(0.3, now);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
      body.connect(bodyGain);
      bodyGain.connect(a.destination);
      body.start(now);
      body.stop(now + 0.55);

      const len = Math.max(1, Math.floor(a.sampleRate * 0.2));
      const buffer = a.createBuffer(1, len, a.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i += 1) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      }
      const noise = a.createBufferSource();
      noise.buffer = buffer;
      const hp = a.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1200;
      const noiseGain = a.createGain();
      noiseGain.gain.value = 0.14;
      noise.connect(hp);
      hp.connect(noiseGain);
      noiseGain.connect(a.destination);
      noise.start(now);
    } catch (e) {}
  }

  /* ── patterns ────────────────────────────────────────────────────── */

  function stripePattern() {
    if (F.stripes) return F.stripes;
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 4;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0.62)';
    g.fillRect(0, 0, 4, 1);
    F.stripes = ctx.createPattern(c, 'repeat');
    return F.stripes;
  }

  function grainPattern() {
    if (F.grain) return F.grain;
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d');
    const img = g.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 190 + Math.random() * 65;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = Math.random() < 0.34 ? 46 : 0;
    }
    g.putImageData(img, 0, 0);
    F.grain = ctx.createPattern(c, 'repeat');
    return F.grain;
  }

  /* ── layout ──────────────────────────────────────────────────────── */

  function fontSpec(size) {
    return `700 ${size}px "${uiFont()}", system-ui, sans-serif`;
  }

  function layoutWord(word) {
    const AW = W / K;
    const AH = H / K;
    const head = word.slice(0, 1);
    const tail = word.slice(1);
    const probe = 128;

    ctx.save();
    ctx.font = fontSpec(probe);
    const probeWidth = ctx.measureText(word).width || 1;
    ctx.restore();

    const ratio = probeWidth / probe;
    let size = Math.min(AH * 0.22, (AW * 0.62) / Math.max(0.001, ratio));
    size = Math.max(18, Math.round(size * 10) / 10);

    ctx.save();
    ctx.font = fontSpec(size);
    const wHead = ctx.measureText(head).width;
    const wTail = ctx.measureText(tail).width;
    const capH = ctx.measureText('H').actualBoundingBoxAscent || size * 0.72;
    ctx.restore();

    const width = wHead + wTail;

    return {
      size,
      capH,
      lineH: size * 1.15,
      head,
      tail,
      wHead,
      wTail,
      width,
      left: (AW - width) / 2,
      cy: AH * 0.5,
      AW,
      AH
    };
  }

  /* ── text drawing: horizontal gradient, reference vertex colours ─── */

  /* Paints the glyph run at full opacity into `g`.
     `x`/`y` are world coordinates, y = middle baseline. */
  function paintRun(g, text, x, y, L, cLeft, cRight, gradOffset) {
    if (!text) return;

    g.save();
    g.font = fontSpec(L.size);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.lineJoin = 'round';
    g.miterLimit = 2;
    g.lineWidth = L.size * 0.072;

    const span = Math.max(1, L.width);
    let cx = x;

    for (const ch of text) {
      const w = g.measureText(ch).width;
      const lx = gradOffset + (cx - x);      /* glyph left edge in word space */
      const rx = lx + w;
      const a = lerpC(cLeft, cRight, clamp(lx / span, 0, 1));
      const b = lerpC(cLeft, cRight, clamp(rx / span, 0, 1));

      const grad = g.createLinearGradient(cx, y, cx + Math.max(0.001, w), y);
      grad.addColorStop(0, rgb(a, 1));
      grad.addColorStop(1, rgb(b, 1));

      g.fillStyle = grad;
      g.strokeStyle = grad;
      g.fillText(ch, cx, y);
      g.strokeText(ch, cx, y);

      cx += w;
    }

    g.restore();
  }

  const spriteCache = new Map();

  function buildSprite(text, L, cLeft, cRight, gradOffset) {
    const T = Math.max(0.5, K * (DPR || 1));
    const pad = L.size * 0.3;

    ctx.save();
    ctx.font = fontSpec(L.size);
    const textW = ctx.measureText(text).width;
    ctx.restore();

    const wWorld = Math.max(1, textW + pad * 2);
    const hWorld = Math.max(1, L.lineH + pad * 2);

    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(wWorld * T));
    cv.height = Math.max(1, Math.ceil(hWorld * T));

    const g = cv.getContext('2d');
    g.scale(T, T);
    g.translate(pad, pad + L.lineH / 2);
    paintRun(g, text, 0, 0, L, cLeft, cRight, gradOffset);

    return { cv, pad, wWorld, hWorld, T };
  }

  function drawRun(text, x, y, alpha, L, cLeft, cRight) {
    if (alpha <= 0.004 || !text) return;

    const gradOffset = x - L.left;

    if (alpha >= 0.995) {
      paintRun(ctx, text, x, y, L, cLeft, cRight, gradOffset);
      return;
    }

    const T = Math.max(0.5, K * (DPR || 1));
    const key = `${text}|${L.size.toFixed(1)}|${Math.round(gradOffset)}|${cLeft}|${cRight}|${T.toFixed(2)}`;

    let sprite = spriteCache.get(key);
    if (!sprite) {
      sprite = buildSprite(text, L, cLeft, cRight, gradOffset);
      spriteCache.set(key, sprite);
      if (spriteCache.size > 48) spriteCache.delete(spriteCache.keys().next().value);
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(
      sprite.cv,
      x - sprite.pad,
      y - L.lineH / 2 - sprite.pad,
      sprite.wWorld,
      sprite.hWorld
    );
    ctx.restore();
  }

  /* ── chromatic glitch (reference DrawFatalTitle) ─────────────────── */

  const GLITCH_A = [
    [0, 0],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1]
  ];
  const GLITCH_B = [
    [0, 0],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1]
  ];

  function drawGlitch(word, x, y, alpha, L) {
    const cycle = (performance.now() / 1000) % 1;
    const segFloat = cycle * 4;
    let seg = Math.floor(segFloat);
    if (seg >= 4) seg = 3;
    const localT = smoothStep(clamp(segFloat - seg, 0, 1));
    const off = Math.max(1, L.size * 0.022);

    const ax = lerp(GLITCH_A[seg][0], GLITCH_A[seg + 1][0], localT) * off;
    const ay = lerp(GLITCH_A[seg][1], GLITCH_A[seg + 1][1], localT) * off;
    const bx = lerp(GLITCH_B[seg][0], GLITCH_B[seg + 1][0], localT) * -off;
    const by = lerp(GLITCH_B[seg][1], GLITCH_B[seg + 1][1], localT) * -off;

    drawRun(word, x + ax, y + ay, alpha, L, [255, 40, 40], [200, 20, 30]);
    drawRun(word, x + bx, y + by, alpha, L, [40, 120, 255], [30, 60, 200]);
  }

  /* ── skull props ─────────────────────────────────────────────────── */

  function drawSkull(cx, cy, r, alpha) {
    if (alpha <= 0.01 || r < 1) return;
    ctx.save();

    ctx.fillStyle = `rgba(246,246,248,${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy - r * 0.06);
    ctx.arc(cx, cy - r * 0.06, r, Math.PI, 0, false);
    ctx.lineTo(cx + r * 0.60, cy + r * 0.52);
    ctx.quadraticCurveTo(cx, cy + r * 0.80, cx - r * 0.60, cy + r * 0.52);
    ctx.closePath();
    ctx.fill();

    ctx.fillRect(cx - r * 0.42, cy + r * 0.50, r * 0.84, r * 0.32);

    ctx.fillStyle = `rgba(10,10,14,${(0.94 * alpha).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.40, cy - r * 0.02, r * 0.27, r * 0.33, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + r * 0.40, cy - r * 0.02, r * 0.27, r * 0.33, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx, cy + r * 0.20);
    ctx.lineTo(cx + r * 0.13, cy + r * 0.40);
    ctx.lineTo(cx - r * 0.13, cy + r * 0.40);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = `rgba(10,10,14,${(0.7 * alpha).toFixed(3)})`;
    ctx.lineWidth = Math.max(1, r * 0.07);
    for (let i = -1; i <= 1; i += 1) {
      const tx = cx + i * r * 0.26;
      ctx.beginPath();
      ctx.moveTo(tx, cy + r * 0.53);
      ctx.lineTo(tx, cy + r * 0.80);
      ctx.stroke();
    }

    ctx.restore();
  }

  /* ── loading bar (optional) ──────────────────────────────────────── */

  function loadCurve(p) {
    if (p < 0.14) return outCubic(p / 0.14) * 0.30;
    if (p < 0.50) return 0.30 + outSine((p - 0.14) / 0.36) * 0.26;
    if (p < 0.63) return 0.56 + ((p - 0.50) / 0.13) * 0.02;
    return 0.58 + outQuart(clamp((p - 0.63) / 0.37, 0, 1)) * 0.42;
  }

  function phaseLabel(p) {
    if (p < 0.15) return 'ALLOCATING';
    if (p < 0.33) return 'MAPPING MODULES';
    if (p < 0.55) return 'LOADING CONFIG';
    if (p < 0.73) return 'RESOLVING SIGNATURES';
    if (p < 0.995) return 'FINALIZING';
    return 'READY';
  }

  function spacedWidth(str, px, spacing) {
    ctx.save();
    ctx.font = fontSpec(px);
    let w = 0;
    for (const ch of str) w += ctx.measureText(ch).width + spacing;
    ctx.restore();
    return Math.max(0, w - spacing);
  }

  function spacedText(str, x, y, px, col, alpha, spacing) {
    if (alpha <= 0.004) return 0;
    ctx.save();
    ctx.font = fontSpec(px);
    ctx.textBaseline = 'top';
    ctx.fillStyle = rgb(col, alpha);
    let cx = x;
    for (const ch of str) {
      ctx.fillText(ch, cx, y);
      cx += ctx.measureText(ch).width + spacing;
    }
    ctx.restore();
    return cx - spacing - x;
  }

  function drawProgress(tt, L, alpha, col) {
    if (alpha <= 0.02) return;

    const AW = L.AW;
    const barW = Math.min(AW * 0.36, 460);
    const bx = AW / 2 - barW / 2;
    const labelY = L.cy + L.capH / 2 + Math.max(26, L.size * 0.30);
    const barY = labelY + 20;

    const p = clamp(loadCurve(clamp((tt - 0.12) / Math.max(0.001, R_END - 0.12), 0, 1)), 0, 1);
    const aText = clamp((tt - 0.2) / 0.26, 0, 1) * alpha;
    const px = 11;

    spacedText('INITIALIZING  //  ' + phaseLabel(p), bx, labelY, px, [235, 235, 240], 0.62 * aText, 1.6);

    const pct = `${Math.round(p * 100)}%`;
    const pw = spacedWidth(pct, px, 1.6);
    spacedText(pct, bx + barW - pw, labelY, px, col, 0.95 * aText, 1.6);

    fillRR(bx, barY, barW, 2.5, 0, [255, 255, 255], 0.12 * aText, 0);

    const fw = Math.max(0.001, barW * p);
    const perfSp = window.SolsticePerf;
    if (perfSp) {
      perfSp.glow(bx, barY - 4, fw, 10.5, col, 12, 0.8 * aText);
      fillRR(bx, barY, fw, 2.5, 0, col, 0.95 * aText, 0);
    } else {
      ctx.save();
      ctx.shadowColor = rgb(col, 0.85 * aText);
      ctx.shadowBlur = 14;
      fillRR(bx, barY, fw, 2.5, 0, col, 0.95 * aText, 0);
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = rgb([255, 255, 255], 0.9 * aText);
    ctx.beginPath();
    ctx.arc(bx + fw, barY + 1.25, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* ── controls ────────────────────────────────────────────────────── */

  function start(word, force) {
    const mod = getMod('Fatality');
    if (!force && mod && !mod.on) return;

    const custom = typeof word === 'string' && word.trim()
      ? word.trim().toUpperCase()
      : enumValue('Word', 'FATALITY').toUpperCase();

    F.word = (custom || 'FATALITY').slice(0, MAX_WORD);
    F.t = 0;
    F.active = true;
    F.slammed = false;

    playRiser();
  }

  function finish() {
    F.active = false;
    F.t = 0;
    applyBlur(0);

    if (bool('Open Gui', true) && !S.open) {
      document.dispatchEvent(new CustomEvent('solstice:ui:open'));
    }
  }

  /* ── draw ────────────────────────────────────────────────────────── */

  function drawSplash(dt) {
    const mod = getMod('Fatality');
    if (!mod) return;

    if (!F.hooked) {
      F.hooked = true;
      try {
        const attach = () => {
          if (window.Solstice) window.Solstice.playFatality = (word) => start(word, true);
        };
        attach();
        setTimeout(attach, 0);
      } catch (e) {}
    }

    if (mod.on && !F.autoAsked && bool('Play on inject', true)) {
      F.autoAsked = true;
      F.autoWait = 0.45;
    }

    if (F.autoWait > 0) {
      F.autoWait -= dt;
      F.autoElapsed += dt;
      if (F.autoWait <= 0) {
        if (F.fontsReady || F.autoElapsed > 2.5 || !document.fonts) start();
        else F.autoWait = 0.1;
      }
    }

    if (!F.active) return;

    const speed = clamp(num('Speed', 1), 0.25, 3);
    const tt = F.t;

    const dimMax = clamp(num('Dim', SCRIM), 0, 0.95);
    const blurMax = clamp(num('Blur Strength', 14), 0, 40);
    const glitchOn = bool('Glitch', false);
    const scanOn = bool('Scanlines', false);
    const progOn = bool('Progress', false);
    const skullOn = bool('Skulls', false);

    /* scrim alpha: out-cubic in, out-cubic out (reference: 0x88000000) */
    const scrim = tt < R_END
      ? outCubic(clamp(tt / REF.FADE, 0, 1))
      : 1 - outCubic(clamp((tt - R_END) / REF.FADE, 0, 1));

    applyBlur(blurMax * scrim);

    const L = layoutWord(F.word);
    const cLeft = color('Color Left', [255, 128, 128]);
    const cRight = color('Color Right', [204, 51, 51]);

    ctx.save();
    ctx.scale(K, K);

    /* black scrim */
    ctx.fillStyle = `rgba(0,0,0,${(dimMax * scrim).toFixed(3)})`;
    ctx.fillRect(0, 0, L.AW, L.AH);

    /* grain */
    if (bool('Grain', false) && scrim > 0.02) {
      ctx.save();
      ctx.globalAlpha = 0.3 * scrim;
      ctx.fillStyle = grainPattern();
      ctx.fillRect(0, 0, L.AW, L.AH);
      ctx.restore();
    }

    /* scanlines */
    if (scanOn) {
      ctx.save();
      ctx.globalAlpha = 0.32 * scrim;
      ctx.fillStyle = stripePattern();
      ctx.fillRect(0, 0, L.AW, L.AH);
      ctx.restore();
    }

    /* ── the F ── */
    const animL = clamp(tt, 0, 2);   /* tween value: 0→2 over REF.L_DUR seconds */
    const xStage1 = (L.AW - L.wHead) / 2;
    let xHead;
    let yHead;
    let aHead;

    if (animL <= 1) {
      const e = outCubic(animL);
      xHead = xStage1;
      yHead = L.cy + (1 - e) * L.lineH;
      aHead = e;
    } else {
      const e = outCubic(animL - 1);
      xHead = L.left + (1 - e) * (xStage1 - L.left);
      yHead = L.cy;
      aHead = 1;
    }

    /* ── ATALITY ── */
    let xTail = L.left + L.wHead;
    let yTail = L.cy;
    let aTail = 0;

    if (tt >= REF.R_START) {
      if (!F.slammed) {
        F.slammed = true;
        playSlam();
      }
      const animR = clamp((tt - REF.R_START) / REF.R_DUR, 0, 2);
      const e = animR < 1 ? outCubic(animR) : 1;
      aTail = clamp(e, 0, 1);
      yTail = L.cy + (1 - aTail) * (L.lineH / 2);
    }

    /* chromatic glitch copies (drawn under the main text) */
    if (glitchOn) {
      const gAlpha = 0.85 * scrim;
      if (aHead > 0.01) drawGlitch(L.head, xHead, yHead, gAlpha * aHead, L);
      if (aTail > 0.01) drawGlitch(L.tail, xTail, yTail, gAlpha * aTail, L);
    }

    /* main word */
    if (aHead > 0.004) drawRun(L.head, xHead, yHead, aHead * scrim, L, cLeft, cRight);
    if (aTail > 0.004) drawRun(L.tail, xTail, yTail, aTail * scrim, L, cLeft, cRight);

    /* optional loading bar */
    if (progOn) drawProgress(tt, L, scrim, cRight);

    /* optional skull row, pops once the word is complete */
    if (skullOn && tt >= REF.R_START + 1) {
      const r = clamp(L.size * 0.20, 10, 44);
      const gap = r * 2.9;
      const y = L.AH * 0.87;
      for (let i = 0; i < 3; i += 1) {
        const k = clamp((tt - (REF.R_START + 1) - i * 0.09) / 0.26, 0, 1);
        if (k <= 0) continue;
        const e = 1 + 2.6 * Math.pow(k - 1, 3) + 1.6 * Math.pow(k - 1, 2);
        drawSkull(
          L.AW / 2 + (i - 1) * gap,
          y + (1 - e) * r * 1.4,
          r * Math.max(0.01, e),
          scrim * clamp(k * 1.6, 0, 1)
        );
      }
    }

    ctx.restore();

    F.t += dt * speed;
    if (F.t >= TOTAL) finish();
  }

  /* ── registry ────────────────────────────────────────────────────── */

  window.solsticeSplash = (word) => start(word, true);

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      F.fontsReady = true;
    }).catch(() => {
      F.fontsReady = true;
    });
  } else {
    F.fontsReady = true;
  }

  register({
    name: 'Fatality',
    desc: 'Plays the injection splash animation.',
    cat: 'Visual',
    nm: { l: 'fatality', ls: 'fatality', n: 'Fatality', ns: 'Fatality' },
    disp: '',
    settings: [
      { t: 'b', n: 'Play on inject', d: 'Plays the splash when the interface loads.', v: 1 },
      { t: 'b', n: 'Open Gui', d: 'Opens the ClickGui when the splash ends.', v: 1 },
      { t: 'e', n: 'Word', d: 'The word shown in the splash.', v: 0, vals: ['FATALITY', 'SOLSTICE', 'GOLDEN HOUR', 'BRUTAL', 'PERFECT'] },
      { t: 'n', n: 'Speed', d: 'The playback speed of the splash.', v: 1.0, min: 0.25, max: 3.0, step: 0.05 },
      { t: 'n', n: 'Blur Strength', d: 'The blur applied to the game during the splash.', v: 14.0, min: 0.0, max: 40.0, step: 0.5 },
      { t: 'n', n: 'Dim', d: 'The darkening applied to the game.', v: 0.53, min: 0.0, max: 0.95, step: 0.01 },
      { t: 'c', n: 'Color Left', d: 'The left color of the splash text.', v: [255, 128, 128, 255] },
      { t: 'c', n: 'Color Right', d: 'The right color of the splash text.', v: [204, 51, 51, 255] },
      { t: 'b', n: 'Glitch', d: 'Red and blue offset copies like the title glitch.', v: 0 },
      { t: 'b', n: 'Scanlines', d: 'Overlays scanlines on the splash.', v: 0 },
      { t: 'b', n: 'Grain', d: 'Overlays film grain on the splash.', v: 0 },
      { t: 'b', n: 'Progress', d: 'Shows a loading bar with status text.', v: 0 },
      { t: 'b', n: 'Skulls', d: 'Shows the skull row under the word.', v: 0 },
      { t: 'b', n: 'Sound', d: 'Plays a synthesized riser and impact.', v: 0 }
    ],
    renderOrder: 60,
    onRender: drawSplash,
    defaultOn: true,
    onInit(m) {
      if (m.settings[0]) m.settings[0].v = 0;
    },
    onEnable() {
      if (F.active) return;
      if (F.autoWait > 0) return;
      start(null, true);
    }
  });
})();
