/* ═══════════════════════════════════════════════════════════════════════════
   ClickGui — Fatality 风格（移植自 github.com/BanCN-Re/FatalityClickGui）

   配色 / 尺寸直接取自 FaTheme.java：
     WINDOW #151515 · HEADER #1C1C1C · GROUP #1C1C1C · FIELD #161616
     ACCENT #FF615A · LABEL #E4E4E4 · MUTED #666666
     窗口 744x540 · HEADER 40 · FOOTER 22 · SIDEBAR 98 · ROW_H 25.5
     FIELD 72x19 · CHECK 10.5 · CHIP 17.5x9 · MIN_COL 188
   布局用参考里的三列瀑布流，左侧分类栏 + 底部工具条。
   ═══════════════════════════════════════════════════════════════════════════ */

const FT = {
  W: 744, H: 540, RADIUS: 4, HEADER: 40, FOOTER: 22, SIDEBAR: 98,
  PAD: 10, COL_GAP: 13.5, GROUP_GAP: 16, GROUP_R: 3.5,
  TITLE_H: 15, GROUP_BOTTOM: 10,
  ROW_H: 25.5, ROW_PAD: 15, FIELD_W: 72, FIELD_H: 19, SLIDER_H: 13, FIELD_R: 2.5,
  CHECK: 10.5, CHIP_W: 17.5, CHIP_H: 9, MIN_COL: 188
};

const FTC = {
  window:[21,21,21], headerTop:[25,25,25], header:[28,28,28], footer:[28,28,28], divider:[17,17,17],
  group:[28,28,28], groupBorder:[34,34,34], field:[22,22,22], fieldHover:[25,25,25], tabActive:[34,34,34],
  logo:[242,240,245], title:[237,237,237], label:[228,228,228], labelHover:[244,244,244], muted:[102,102,102],
  fieldText:[104,104,104], fieldTextHover:[149,149,149],
  tabText:[102,102,102], tabTextHover:[154,154,154], tabTextActive:[234,234,234],
  icon:[106,106,106], iconHover:[210,210,210], iconFaint:[68,68,68], tick:[246,246,246], chevron:[202,202,202],
  accent:[255,97,90], accentDim:[138,58,54], sideText:[102,102,102], sideTextEnabled:[156,156,156], sideTextActive:[237,237,237]
};

const FT_ICONS = { Combat: 'c', Movement: 'f', Visual: 'd', Player: 'e', Misc: 'a' };

const FT_STATE = {
  cat: 0,
  scroll: 0,
  scrollEase: 0,
  style: 0,
  anim: new Map(),
  drag: null,
  lastContent: 0,
  ready: false
};

function ftAnim(key, target, dt, speed) {
  const current = FT_STATE.anim.has(key) ? FT_STATE.anim.get(key) : 0;
  const next = animate(target, current, clamp(dt * (speed || 14), 0, 1));
  FT_STATE.anim.set(key, next);
  return next;
}

function ftFit(text, px, bold, max) {
  let str = String(text || '');

  if (tw(str, px, bold) <= max) {
    return str;
  }

  while (str.length > 1 && tw(`${str}...`, px, bold) > max) {
    str = str.slice(0, -1);
  }

  return `${str}...`;
}

/* 模块在 Fatality 面板里显示的行（第一个是 Visible，做成标题栏上的眼睛） */
function ftRows(mod) {
  return mod.settings.filter((setting, index) => index > 0 && setting.vis);
}

/* 眼睛图标：直接画，别指望图标字体里有对应字形 */
function ftEye(x, y, open, color, alpha) {
  ctx.save();
  ctx.strokeStyle = rgb(color, alpha);
  ctx.fillStyle = rgb(color, alpha);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + 3.4);
  ctx.quadraticCurveTo(x + 4, y - 0.6, x + 8, y + 3.4);
  ctx.quadraticCurveTo(x + 4, y + 7.4, x, y + 3.4);
  ctx.closePath();
  if (open) {
    ctx.fill();
    ctx.fillStyle = rgb([20, 20, 20], alpha);
    ctx.beginPath();
    ctx.arc(x + 4, y + 3.4, 1.2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 0.6, y + 6.6);
    ctx.lineTo(x + 7.4, y + 0.6);
    ctx.stroke();
  }
  ctx.restore();
}

/* 下拉箭头 */
function ftChevron(x, y, color, alpha) {
  ctx.save();
  ctx.strokeStyle = rgb(color, alpha);
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 2.4, y + 2.4);
  ctx.lineTo(x + 4.8, y);
  ctx.stroke();
  ctx.restore();
}

function ftCardHeight(mod) {
  return FT.TITLE_H + ftRows(mod).length * FT.ROW_H + FT.GROUP_BOTTOM;
}

/* ── 绘制 ──────────────────────────────────────────────────────────────── */

function drawFatalityClickGui(a, dt) {
  const cg = getMod('ClickGui');

  if (!cg) {
    return;
  }

  const styleSetting = cg.settings.find((s) => s.n === 'Style');
  const styleName = styleSetting ? (styleSetting.vals[styleSetting.v] || 'Sol') : 'Sol';
  const targetStyle = styleName === 'Fatality' ? 1 : 0;
  const blend = ftAnim('__style', targetStyle, dt, 16);

  if (targetStyle === 0 && blend < 0.02) {
    FT_STATE.ready = false;
    FT_STATE.scroll = 0;
    FT_STATE.scrollEase = 0;
    return;
  }

  /* 窗口尺寸与缩放：744x540 的设计尺寸按屏幕缩放，最大 1:1 */
  let s = Math.min((W * 0.90) / FT.W, (H * 0.82) / FT.H, 1.5);
  s = Math.max(0.35, s);

  const winW = FT.W * s;
  const winH = FT.H * s;
  const ox = Math.round((W - winW) / 2);
  const oy = Math.round((H - winH) / 2);
  const alpha = a * blend;

  if (alpha <= 0.005) {
    return;
  }

  const gmx = (S.mx - ox) / s;
  const gmy = (S.my - oy) / s;
  const hits = (x, y, w, h) => gmx >= x && gmx <= x + w && gmy >= y && gmy <= y + h;

  /* 给预览/测试用的几何信息 */
  FT_STATE.dbg = { ox, oy, s, sliders: [] };

  if (!S.down[0]) {
    FT_STATE.drag = null;
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(ox, oy);
  ctx.scale(s, s);

  const X = 0;
  const Y = 0;

  /* 廉价投影：两层递减圆角矩形，不用 shadowBlur（软件光栅下太贵） */
  for (let i = 2; i >= 1; i -= 1) {
    fillRR(X - i * 2, Y - i * 2, FT.W + i * 4, FT.H + i * 4, FT.RADIUS + i * 2, [0, 0, 0], 0.06, CORNER_TOP | CORNER_BOTTOM);
  }

  fillRR(X, Y, FT.W, FT.H, FT.RADIUS, FTC.window, 1, CORNER_TOP | CORNER_BOTTOM);

  /* ── header ── */
  fillRR(X, Y, FT.W, FT.HEADER, FT.RADIUS, FTC.header, 1, CORNER_TOP);
  fillRR(X, Y, FT.W, 1, 0, FTC.headerTop, 1, 0);

  setFont(17, true);
  text(FT.PAD + 2, Y + 11, 'solstice', FTC.logo, 1, false, true, 17);

  setFont(9.5, false);
  const tag = 'FATALITY STYLE';
  const tagW = tw(tag, 9.5, false);
  fillRR(FT.PAD + 2 + tw('solstice', 17, true) + 8, Y + 15, tagW + 10, 13, 2, FTC.accentDim, 0.9, 0);
  text(FT.PAD + 2 + tw('solstice', 17, true) + 13, Y + 17.5, tag, [255, 220, 216], 0.95, false, false, 9.5);

  const cfg = window.SolsticeConfig;
  const cfgName = cfg && typeof cfg.active === 'function' ? cfg.active() : 'Default';
  setFont(10, false);
  const cfgLabel = `config: ${cfgName}`;
  const cfgW = tw(cfgLabel, 10, false);
  text(FT.W - FT.PAD - cfgW, Y + 16, cfgLabel, FTC.muted, 0.95, false, false, 10);

  /* ── sidebar ── */
  const sideY = FT.HEADER;
  const sideH = FT.H - FT.HEADER - FT.FOOTER;
  fillRR(X + FT.SIDEBAR - 1, sideY, 1, sideH, 0, FTC.divider, 1, 0);

  for (let i = 0; i < CATS.length; i += 1) {
    const tabY = sideY + 8 + i * 26;
    const tabActive = FT_STATE.cat === i;
    const hover = hits(4, tabY, FT.SIDEBAR - 8, 24);
    const act = ftAnim(`tab${i}`, tabActive ? 1 : 0, dt, 18);

    if (tabActive) {
      fillRR(4, tabY, FT.SIDEBAR - 8, 24, 3, FTC.tabActive, 1, 0);
      fillRR(4, tabY + 5, 2, 14, 1, FTC.accent, 1, 0);
    } else if (hover) {
      fillRR(4, tabY, FT.SIDEBAR - 8, 24, 3, FTC.field, 0.7, 0);
    }

    const iconColor = lerpC(FTC.icon, FTC.accent, act);
    const labelColor = lerpC(hover ? FTC.tabTextHover : FTC.tabText, FTC.tabTextActive, act);

    text(11, tabY + 4, FT_ICONS[CATS[i]] || 'B', iconColor, 1, false, false, 13, true);
    text(26, tabY + 5, CATS[i], labelColor, 1, false, tabActive, 11);

    if (S.clicked[0] && hover) {
      FT_STATE.cat = i;
      FT_STATE.scroll = 0;
    }
  }

  /* 侧栏底部：启用计数 */
  const onCount = MODS.filter((m) => m.on).length;
  setFont(9, false);
  text(11, Y + FT.H - FT.FOOTER - 46, `${onCount} active`, FTC.sideTextEnabled, 0.9, false, false, 9);
  text(11, Y + FT.H - FT.FOOTER - 32, `${MODS.length} modules`, FTC.sideText, 0.85, false, false, 9);
  text(11, Y + FT.H - FT.FOOTER - 18, 'beta', FTC.accent, 0.85, false, true, 9);

  /* ── content ── */
  const contentX = FT.SIDEBAR + FT.PAD;
  const contentW = FT.W - FT.SIDEBAR - FT.PAD * 2;
  const contentTop = sideY + FT.PAD;
  const contentH = sideH - FT.PAD * 2;

  const mods = BY_CAT[FT_STATE.cat] || [];
  const cols = Math.max(1, Math.floor((contentW + FT.COL_GAP) / (FT.MIN_COL + FT.COL_GAP)));
  const colW = (contentW - (cols - 1) * FT.COL_GAP) / cols;
  const colHeights = new Array(cols).fill(0);
  const cards = [];

  for (const mod of mods) {
    const h = ftCardHeight(mod);
    let col = 0;

    for (let i = 1; i < cols; i += 1) {
      if (colHeights[i] < colHeights[col] - 0.5) {
        col = i;
      }
    }

    cards.push({ mod, x: contentX + col * (colW + FT.COL_GAP), y: contentTop + colHeights[col], w: colW, h });
    colHeights[col] += h + FT.GROUP_GAP;
  }

  const totalH = Math.max(...colHeights, contentH);
  const maxScroll = Math.max(0, totalH - contentH);

  if (S.wheel !== 0 && gmx > contentX - 4 && gmy > contentTop - 4 && gmy < contentTop + contentH + 4) {
    FT_STATE.scroll += S.wheel * 34;
    S.wheel = 0;
  }

  if (gmy > contentTop - 4 && gmy < contentTop + contentH + 4 && gmx > contentX - 4) {
    const barW = 3;
    const barX = FT.W - 5;
    const barH = Math.max(24, contentH * (contentH / totalH));
    const barY = contentTop + (contentH - barH) * (maxScroll > 0 ? clamp(FT_STATE.scroll / maxScroll, 0, 1) : 0);
    fillRR(barX, contentTop, barW, contentH, 1.5, [255, 255, 255], 0.04, 0);
    fillRR(barX, barY, barW, barH, 1.5, [255, 255, 255], 0.12, 0);
  }

  FT_STATE.scroll = clamp(FT_STATE.scroll, -20, maxScroll + 20);
  FT_STATE.scrollEase = animate(clamp(FT_STATE.scroll, 0, maxScroll), FT_STATE.scrollEase, clamp(dt * 14, 0, 1));

  ctx.save();
  ctx.beginPath();
  ctx.rect(contentX - 2, contentTop - 2, contentW + 8, contentH + 4);
  ctx.clip();

  for (const card of cards) {
    const y = card.y - FT_STATE.scrollEase;
    if (y > contentTop + contentH + 30 || y + card.h < contentTop - 30) {
      continue;
    }
    drawFtCard(card, y, dt, gmx, gmy);
  }

  ctx.restore();

  /* ── footer ── */
  const footY = FT.H - FT.FOOTER;
  fillRR(X, footY, FT.W, FT.FOOTER, 0, FTC.footer, 1, 0);
  fillRR(X, footY, FT.W, 1, 0, FTC.divider, 1, 0);

  setFont(9, false);
  text(FT.PAD + 2, footY + 7, 'INSERT toggle  ·  RMB bind  ·  wheel scroll', FTC.muted, 0.9, false, false, 9);
  const footRight = `${CATS[FT_STATE.cat]} · ${mods.length}`;
  text(FT.W - FT.PAD - tw(footRight, 9, false), footY + 7, footRight, FTC.sideText, 0.9, false, false, 9);

  /* ── 颜色选择器沿用 Sol 的 ── */
  if (typeof drawPicker === 'function') {
    drawPicker(1, dt);
  }

  ctx.restore();

  FT_STATE.ready = true;
}

function drawFtCard(card, y, dt, gmx, gmy) {
  const mod = card.mod;
  const x = card.x;
  const w = card.w;
  const hoverCard = gmx >= x && gmx <= x + w && gmy >= y && gmy <= y + card.h;
  const onAnim = ftAnim(`on_${mod.name}`, mod.on ? 1 : 0, dt, 16);

  fillRR(x, y, w, card.h, FT.GROUP_R, FTC.group, 1, 0);
  fillRR(x, y, w, 1, 0, FTC.groupBorder, hoverCard ? 0.9 : 0.5, 0);

  /* 标题栏：名字 + 眼睛 + 开关 chip */
  const nameX = x + 9;
  const nameY = y + 3;
  const eyeX = x + w - 52;
  const chipX = x + w - 30;
  const chipY = y + 3;

  setFont(11, true);
  const label = modName ? modName(mod) : mod.name;
  text(nameX, nameY, ftFit(label, 11, true, w - 70), mod.on ? FTC.title : lerpC(FTC.label, FTC.title, 0.35), 1, false, true, 11);

  /* 眼睛（Visible） */
  const vis = mod.settings[0];
  let handled = false;
  if (vis) {
    const eyeHover = gmx >= eyeX - 3 && gmx <= eyeX + 11 && gmy >= y + 1 && gmy <= y + 13;
    ftEye(eyeX, y + 1, Boolean(vis.v), eyeHover ? FTC.iconHover : (vis.v ? FTC.icon : FTC.iconFaint), 1);

    if (S.clicked[0] && eyeHover) {
      vis.v = vis.v ? 0 : 1;
      handled = true;
    }
  }

  /* 开关 chip */
  const chipFill = lerpC(FTC.field, FTC.accent, onAnim);
  fillRR(chipX, chipY, FT.CHIP_W, FT.CHIP_H, FT.CHIP_H / 2, chipFill, 1, 0);
  const knobX = lerp(chipX + 1.2, chipX + FT.CHIP_W - FT.CHIP_H + 1.2, onAnim);
  fillRR(knobX, chipY + 1.2, FT.CHIP_H - 2.4, FT.CHIP_H - 2.4, FT.CHIP_H / 2, [246, 246, 246], 1, 0);

  /* 行 */
  const rows = ftRows(mod);
  let rowY = y + FT.TITLE_H + 2;

  for (const setting of rows) {
    drawFtRow(mod, setting, x, rowY, w, dt, gmx, gmy);
    rowY += FT.ROW_H;
  }

  const inTitle = gmy >= y - 1 && gmy <= y + FT.TITLE_H + 2;

  if (!handled && hoverCard && inTitle) {
    if (S.isTouch) {
      if (S.touchTap && mod.name !== 'ClickGui') {
        setModuleOn(mod, !mod.on);
      } else if (S.touchLongPress) {
        window.SolsticeMobile?.toggleShortcut?.(mod);
      }
    } else if (S.clicked[0] && mod.name !== 'ClickGui') {
      setModuleOn(mod, !mod.on);
    } else if (S.clicked[1]) {
      if (S.isMobile) {
        window.SolsticeMobile?.toggleShortcut?.(mod);
      } else {
        S.binding = mod;
      }
    }
  }
}

function drawFtRow(mod, setting, x, y, w, dt, gmx, gmy) {
  const padX = 9;
  const hover = gmx >= x && gmx <= x + w && gmy >= y && gmy <= y + FT.ROW_H;
  const labelX = x + padX;
  const rightX = x + w - padX;
  const labelW = w - padX * 2 - 76;

  if (hover) {
    fillRR(x, y, w, FT.ROW_H - 1, 0, [255, 255, 255], 0.022, 0);
  }

  setFont(10, false);
  text(labelX, y + 8, ftFit(setting.n, 10, false, labelW), hover ? FTC.labelHover : FTC.label, 0.92, false, false, 10);

  /* ── 布尔 ── */
  if (setting.t === 'b') {
    const box = FT.CHECK;
    const bx = rightX - box;
    const by = y + (FT.ROW_H - box) / 2 - 0.5;
    const tick = ftAnim(`chk_${mod.name}_${setting.n}`, setting.v ? 1 : 0, dt, 18);

    fillRR(bx, by, box, box, 2, setting.v ? FTC.accent : FTC.field, 1, 0);
    if (!setting.v) {
      ctx.strokeStyle = rgb([70, 70, 70], 0.9);
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, box - 1, box - 1);
    }

    if (tick > 0.02) {
      const cx = bx + box / 2;
      const cy = by + box / 2;
      ctx.save();
      ctx.strokeStyle = rgb(FTC.tick, tick);
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - 2.6 * tick, cy + 0.2);
      ctx.lineTo(cx - 0.6 * tick, cy + 2.4 * tick);
      ctx.lineTo(cx + 2.8 * tick, cy - 2.6 * tick);
      ctx.stroke();
      ctx.restore();
    }

    if (hover && S.clicked[0]) setting.v = setting.v ? 0 : 1;
    return;
  }

  /* ── 数字 ── */
  if (setting.t === 'n') {
    const trackX = rightX - FT.FIELD_W;
    const trackW = FT.FIELD_W;
    const trackY = y + FT.ROW_H / 2 - FT.SLIDER_H / 2 + 2;
    const span = Math.max(0.0001, setting.max - setting.min);
    const pct = clamp((setting.v - setting.min) / span, 0, 1);

    fillRR(trackX, trackY, trackW, FT.SLIDER_H, 2, FTC.field, 1, 0);
    fillRR(trackX, trackY, Math.max(2, trackW * pct), FT.SLIDER_H, 2, FTC.accentDim, 0.85, 0);
    fillRR(trackX + Math.max(0, trackW * pct - 1.5), trackY - 1, 3, FT.SLIDER_H + 2, 1.5, FTC.accent, 1, 0);

    setFont(9, false);
    const value = setting.step >= 1 ? String(Math.round(setting.v)) : setting.v.toFixed(2);
    const valueW = tw(value, 9, false);
    const handleX = trackX + Math.max(0, trackW * pct - 1.5);
    let valueX = trackX + trackW - 4 - valueW;

    if (Math.abs(valueX + valueW / 2 - handleX) < valueW / 2 + 4) {
      valueX = trackX + 4;
    }

    text(valueX, trackY + 2.5, value, FTC.fieldText, 1, false, false, 9);

    if (FT_STATE.dbg) {
      FT_STATE.dbg.sliders.push({ key: `${mod.name}.${setting.n}`, x: trackX, y: trackY, w: trackW, setting });
    }

    const onTrack = gmx >= trackX - 2 && gmx <= trackX + trackW + 2 &&
      gmy >= trackY - 3 && gmy <= trackY + FT.SLIDER_H + 3;

    if (S.clicked[0] && onTrack) {
      FT_STATE.drag = setting;
    }

    if (FT_STATE.drag === setting && S.down[0]) {
      const nx = clamp((gmx - trackX) / trackW, 0, 1);
      setting.v = Math.round((setting.min + nx * span) / setting.step) * setting.step;
      setting.v = clamp(setting.v, setting.min, setting.max);
    }

    if (hover && S.wheel !== 0) {
      setting.v = clamp(setting.v + S.wheel * setting.step, setting.min, setting.max);
      S.wheel = 0;
    }

    return;
  }

  /* ── 枚举 ── */
  if (setting.t === 'e') {
    const fw = FT.FIELD_W;
    const fx = rightX - fw;
    const fy = y + (FT.ROW_H - FT.FIELD_H) / 2;
    const value = setting.vals[setting.v] || '';

    fillRR(fx, fy, fw, FT.FIELD_H, FT.FIELD_R, hover ? FTC.fieldHover : FTC.field, 1, 0);
    setFont(9, false);
    text(fx + 5, fy + 5, ftFit(value, 9, false, fw - 16), hover ? FTC.fieldTextHover : FTC.fieldText, 1, false, false, 9);
    ftChevron(fx + fw - 11, fy + 7.5, FTC.chevron, hover ? 0.9 : 0.6);

    if (hover && S.clicked[0]) setting.v = (setting.v + 1) % setting.vals.length;
    if (hover && S.clicked[1]) setting.v = (setting.v - 1 + setting.vals.length) % setting.vals.length;
    return;
  }

  /* ── 颜色 ── */
  if (setting.t === 'c') {
    const sw = 26;
    const sx = rightX - sw;
    const sy = y + (FT.ROW_H - 12) / 2;
    const value = Array.isArray(setting.v) ? setting.v : [255, 255, 255, 255];

    fillRR(sx, sy, sw, 12, 2, [value[0], value[1], value[2]], 1, 0);
    ctx.strokeStyle = rgb([60, 60, 60], hover ? 1 : 0.7);
    ctx.lineWidth = 1;
    ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, 11);

    if (hover && S.clicked[0]) {
      const [h0, s0, v0] = rgb2hsv(value[0], value[1], value[2]);
      S.picker = { st: h0, s: s0, v: v0, target: setting, justOpened: true };
    }
    return;
  }
}
