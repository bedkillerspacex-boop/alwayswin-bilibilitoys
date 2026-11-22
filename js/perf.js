/* ═══════════════════════════════════════════════════════════════════════════
   Solstice 性能核心

   · 光晕精灵缓存：把 ctx.shadowBlur 换成预烘焙的径向贴图，一次 drawImage
   · 自适应画质：按帧时间自动在 High / Balanced / Low 之间升降档
   · 主题色每帧缓存：themed() 打死不再每元素每帧 settings.find
   · DPR 上限：渣机自动降到 1.0，省掉 4 倍填充率
   ═══════════════════════════════════════════════════════════════════════════ */

const SolsticePerf = (() => {
  'use strict';

  const LEVELS = {
    2: { name: 'High', detail: 1.0, glow: true, dpr: 2.0, ghosts: 14 },
    1: { name: 'Balanced', detail: 0.75, glow: true, dpr: 1.5, ghosts: 8 },
    0: { name: 'Low', detail: 0.5, glow: false, dpr: 1.0, ghosts: 4 }
  };

  const state = {
    level: 2,
    auto: true,
    manual: 2,
    fps: 60,
    frameMs: 16.7,
    worstMs: 0,
    changedAt: 0,
    frames: 0,
    drawn: 0
  };

  const glowCache = new Map();
  const themeCache = new Map();
  let themeFrame = -1;

  function sprite(color, blur) {
    const r = Math.round(color[0]) + ',' + Math.round(color[1]) + ',' + Math.round(color[2]);
    const key = r + '|' + blur;
    let canvas = glowCache.get(key);

    if (canvas) {
      return canvas;
    }

    const radius = Math.max(4, blur * 2);
    const size = Math.ceil(radius * 2);
    canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const g = canvas.getContext('2d');
    const grd = g.createRadialGradient(radius, radius, 0, radius, radius, radius);
    grd.addColorStop(0, `rgba(${r},0.62)`);
    grd.addColorStop(0.45, `rgba(${r},0.30)`);
    grd.addColorStop(0.75, `rgba(${r},0.09)`);
    grd.addColorStop(1, `rgba(${r},0)`);
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);

    glowCache.set(key, canvas);

    if (glowCache.size > 96) {
      glowCache.delete(glowCache.keys().next().value);
    }

    return canvas;
  }

  const api = {
    get level() {
      return state.level;
    },
    get name() {
      return LEVELS[state.level].name;
    },
    get detail() {
      return LEVELS[state.level].detail;
    },
    get fps() {
      return Math.round(state.fps);
    },
    get frameMs() {
      return state.frameMs;
    },
    get dprCap() {
      const hud = window.SolsticeHudSettings;
      const cap = hud && hud.active && Number(hud.maxDpr) > 0 ? Number(hud.maxDpr) : 2;
      return Math.min(cap, LEVELS[state.level].dpr);
    },
    get glowEnabled() {
      return LEVELS[state.level].glow;
    },
    get ghostCount() {
      return Math.max(2, Math.round(LEVELS[state.level].ghosts * LEVELS[state.level].detail));
    },

    /* 自适应档位（Auto Quality 打开时生效） */
    setAuto(on) {
      const next = Boolean(on);

      if (state.auto === next) {
        return;
      }

      state.auto = next;
      state.changedAt = performance.now();

      if (!next) {
        state.level = state.manual;
        api.applyDpr();
      }
    },
    /* 手动指定档位：0 low / 1 balanced / 2 high */
    setLevel(level) {
      const next = Math.max(0, Math.min(2, Math.round(level)));
      state.manual = next;

      if (!state.auto && next !== state.level) {
        state.level = next;
        state.changedAt = performance.now();
        api.applyDpr();
      }
    },
    applyDpr() {
      if (typeof resize === 'function') {
        try {
          resize();
        } catch (e) {

        }
      }
    },

    /* 每帧由 main.js 调用 */
    tick(ts, dt) {
      state.frames += 1;

      if (!(dt > 0)) {
        return;
      }

      const ms = dt * 1000;
      state.frameMs = state.frameMs * 0.9 + ms * 0.1;
      state.fps = 1000 / Math.max(1, state.frameMs);

      if (!state.auto) {
        return;
      }

      const now = ts || performance.now();
      const cooldown = 1600;

      if (now - state.changedAt < cooldown) {
        return;
      }

      if (state.frameMs > 18.5 && state.level > 0) {
        state.level -= 1;
        state.changedAt = now;
        api.applyDpr();
      } else if (state.frameMs > 23 && state.level > 0) {
        state.level -= 1;
        state.changedAt = now;
        api.applyDpr();
      } else if (state.frameMs < 12 && state.level < 2 && now - state.changedAt > 6000) {
        state.level += 1;
        state.changedAt = now;
        api.applyDpr();
      }
    },

    /* 光晕：一次 drawImage，替代 ctx.shadowBlur 的软模糊 */
    glow(x, y, w, h, color, blur, alpha) {
      if (!LEVELS[state.level].glow || !(alpha > 0.004)) {
        return false;
      }

      const radius = Math.max(2, blur);
      const img = sprite(color, Math.round(radius));
      const pad = radius * 2;

      ctx.save();
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.drawImage(img, x - pad * 0.5, y - pad * 0.5, w + pad, h + pad);
      ctx.restore();
      return true;
    },

    /* 每帧一次：清掉上一帧的主题色缓存 */
    beginFrame() {
      if (themeFrame === state.frames) {
        return;
      }

      themeFrame = state.frames;
      themeCache.clear();
    },

    theme(index, compute) {
      const key = index | 0;
      let value = themeCache.get(key);

      if (value === undefined) {
        value = compute(key);
        themeCache.set(key, value);
      }

      return value;
    },

    reset() {
      glowCache.clear();
      themeCache.clear();
      state.level = state.auto ? 2 : state.manual;
      state.changedAt = performance.now();
    }
  };

  window.SolsticePerf = api;
  return api;
})();
