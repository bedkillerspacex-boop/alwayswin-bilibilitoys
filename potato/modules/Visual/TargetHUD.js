let targetHudData = null;
let targetHudLastData = null;
let targetHudAt = 0;
const targetHudHeads = new Map();
let targetHudPlaceholder = null;
let targetHudBackdropElement = null;
let targetHudLastId = '';
let targetHudCalcHealth = 20;
let targetHudCalcId = '';
let targetHudSimHealth = 20;
let targetHudSimLastHurt = false;
let targetHudSimDamageId = 0;
let targetHudSimLastAbsorption = 0;
let targetHudSimHealAt = 0;
let targetHudWasShowing = false;

if (HUD_LAYOUT.TargetHUD && HUD_LAYOUT.TargetHUD.x === 500 && HUD_LAYOUT.TargetHUD.y === 500) {
  HUD_LAYOUT.TargetHUD.x = 380;
  HUD_LAYOUT.TargetHUD.y = 463;
  hudSave();
}

function targetHudPlaceholderImage() {
  if (!targetHudPlaceholder) {
    const source = document.documentElement?.getAttribute('data-solstice-notch');
    if (!source) return null;
    targetHudPlaceholder = new Image();
    targetHudPlaceholder.src = source;
  }

  return targetHudPlaceholder.complete && targetHudPlaceholder.naturalWidth ? targetHudPlaceholder : null;
}

function targetHudImage(data) {
  const placeholder = targetHudPlaceholderImage();
  if (!data?.headKey) return placeholder;

  if (data.head) {
    let image = targetHudHeads.get(data.headKey);

    if (!image) {
      image = new Image();
      image.src = data.head;
      targetHudHeads.set(data.headKey, image);
    }

    return image.complete && image.naturalWidth ? image : placeholder;
  }

  const cached = targetHudHeads.get(data.headKey);
  return cached && cached.complete && cached.naturalWidth ? cached : placeholder;
}

function targetHudRound(x, y, w, h, r) {
  r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function targetHudBarPath(x, y, w, h, r, roundRight) {
  if (roundRight) {
    targetHudRound(x, y, w, h, r);
    return;
  }

  r = Math.max(0, Math.min(r, h / 2, w));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function targetHudBackdrop(x, y, w, h, alpha) {
  if (!targetHudBackdropElement) {
    const element = document.createElement('div');
    element.id = 'solstice-targethud-backdrop';
    element.style.cssText = [
      'position:absolute',
      'pointer-events:none',
      'backdrop-filter:blur(7px)',
      '-webkit-backdrop-filter:blur(7px)',
      'box-sizing:border-box'
    ].join(';');
    const host = document.getElementById('solstice-root') || document.documentElement;
    const canvas = document.getElementById('hud');
    host.insertBefore(element, canvas || null);
    targetHudBackdropElement = element;
  }

  const element = targetHudBackdropElement;
  element.style.display = 'block';
  element.style.left = (x * K) + 'px';
  element.style.top = (y * K) + 'px';
  element.style.width = (w * K) + 'px';
  element.style.height = (h * K) + 'px';
  element.style.borderRadius = (20 * K * alpha) + 'px';
  element.style.boxShadow = '0 0 ' + (34 * K * alpha) + 'px rgba(0, 0, 0, ' + alpha + ')';
  element.style.opacity = alpha;
  element.style.backdropFilter = 'blur(' + (7 * K) + 'px)';
  element.style.webkitBackdropFilter = 'blur(' + (7 * K) + 'px)';
}

function targetHudHideBackdrop() {
  if (targetHudBackdropElement) {
    targetHudBackdropElement.style.display = 'none';
  }
}

function targetHudPanel(x, y, w, h, alpha) {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, ' + alpha + ')';
  ctx.shadowBlur = 34 * alpha;
  targetHudRound(x, y, w, h, 20 * alpha);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.01)';
  ctx.fill();
  ctx.restore();
}

function targetHudHead(image, x, y, size, alpha, hurt) {
  ctx.save();
  targetHudRound(x, y, size, size, 10 * alpha);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = alpha;

  if (!image) {
    ctx.restore();
    return;
  }

  ctx.drawImage(image, x, y, size, size);
  ctx.globalAlpha = 1;

  if (hurt > 0.001) {
    const tint = Math.round(255 * (1 - hurt));
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(255, ${tint}, ${tint})`;
    ctx.fillRect(x, y, size, size);
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.restore();
}

function drawTargetHud(dt) {
  const module = getMod('TargetHUD');

  if (!module || !module.on) {
    targetHudHideBackdrop();
    return;
  }

  const data = targetHudData;
  const fresh = Boolean(data && performance.now() - targetHudAt < 800);
  const showing = fresh && data.hasTarget;
  const rising = showing && !targetHudWasShowing;
  targetHudWasShowing = showing;
  const anim = module.__hudAnim = lerp(module.__hudAnim || 0, showing ? 1 : 0, Math.min(1, dt * 10));

  if (anim < 0.01) {
    targetHudHideBackdrop();
    return;
  }

  if (!module.__hudLayout) {
    module.__hudLayout = hudElement('TargetHUD', 380, 463, 240, 74);
  }

  const layout = module.__hudLayout;
  hudSetSize('TargetHUD', 240, 74);

  ctx.save();
  ctx.scale(K, K);

  if (data?.hasTarget) {
    targetHudLastData = data;
  }

  const display = targetHudLastData || {
    id: '',
    name: 'Target',
    health: 20,
    maxHealth: 20,
    absorption: 0,
    hurtTime: 0,
    status: 'Winning',
    headKey: ''
  };

  const maxHealth = Math.max(0.01, Number(display.maxHealth) || 20);

  if ((display.id && display.id !== targetHudLastId) || rising) {
    const seed = display.healthKnown ? (Number(display.health) || maxHealth) : maxHealth;

    targetHudLastId = display.id;
    targetHudCalcId = display.id;
    targetHudSimHealth = seed;
    targetHudCalcHealth = seed;
    module.__hudHealth = seed;
    module.__hudAbsorption = Number(display.absorption) || 0;
    module.__hudHurt = 0;
    module.__hudLastHurt = 0;
    targetHudSimLastHurt = (Number(display.hurtTime) || 0) > 0;
    targetHudSimDamageId = 0;
    targetHudSimHealAt = performance.now();
  }

  const healthCalculation = Boolean(module.settings.find((s) => s.n === 'Health Calculation')?.v);

  if (healthCalculation && !display.healthKnown) {
    const now = performance.now();
    const hurtNow = (Number(display.hurtTime) || 0) > 0;
    const damageId = Number(display.damageId) || 0;

    if (hurtNow && !targetHudSimLastHurt) {
      let damage = 0;

      if (damageId && damageId !== targetHudSimDamageId) {
        damage = Number(display.lastDamage) || 0;
        targetHudSimDamageId = damageId;
      }

      if (damage <= 0) {
        damage = 1;
      }

      targetHudSimHealth = Math.max(0, targetHudSimHealth - damage);
    }

    targetHudSimLastHurt = hurtNow;

    if (now - targetHudSimHealAt >= 4000) {
      targetHudSimHealth = Math.min(maxHealth, targetHudSimHealth + 1);
      targetHudSimHealAt = now;
    }

    const actual = Number(display.health);

    if (Number.isFinite(actual) && actual < targetHudSimHealth) {
      targetHudSimHealth = actual;
    }

    targetHudCalcHealth = targetHudSimHealth;
  } else {
    const actual = Number(display.health) || 0;
    targetHudSimHealth = actual;
    targetHudSimLastHurt = (Number(display.hurtTime) || 0) > 0;
    targetHudCalcHealth = actual;
  }
  const health = clamp(targetHudCalcHealth, 0, maxHealth);
  const localHealth = Number(display.localHealth);
  const status = Number.isFinite(localHealth)
    ? (localHealth >= health ? 'Winning' : 'Losing')
    : (display.status || 'Winning');
  const absorption = clamp(Number(display.absorption) || 0, 0, 20);
  const hurtTarget = clamp((Number(display.hurtTime) || 0) / 10, 0, 1);
  const hurtLerped = lerp(module.__hudLastHurt ?? hurtTarget, hurtTarget, Math.min(1, dt));

  module.__hudLastHurt = hurtTarget;
  module.__hudHealth = lerp(module.__hudHealth ?? health, health, Math.min(1, dt * 10));
  module.__hudAbsorption = lerp(module.__hudAbsorption ?? absorption, absorption, Math.min(1, dt * 10));
  module.__hudHurt = lerp(module.__hudHurt || 0, hurtLerped, Math.min(1, dt * 20));

  const a = anim;
  const boxWidth = 240 * a;
  const boxHeight = 74 * a;
  const centerX = layout.x + layout.w / 2;
  const centerY = layout.y + layout.h / 2;
  const boxX = centerX - boxWidth / 2;
  const boxY = centerY - boxHeight / 2;
  const pad = 12.5;
  const headSize = 55 * a;
  const headX = boxX + pad * a;
  const headY = boxY - 2 + pad * a;
  const hurt = module.__hudHurt;
  const shrunk = lerp(headSize, 40 * a, hurt);
  const headDrawX = headX + (headSize - shrunk) / 2;
  const headDrawY = headY + (headSize - shrunk) / 2;
  const fontSize = Math.max(1, Number(module.settings.find((s) => s.n === 'Font Size')?.v) || 20) * a;
  const barStartX = boxX + headSize + pad * 2 * a;
  const barEndX = boxX + boxWidth - pad * a;
  const barY = boxY + boxHeight - (pad + 2) * a - 10 * a;
  const barHeight = 15 * a;
  const nameX = headX + headSize + pad * a;
  const nameY = boxY + 2 - fontSize / 2 + 15 * a;
  const statusY = Math.max(
    nameY,
    Math.min(nameY + 20 * a, barY - 18 * a - 2)
  );
  const clipRight = boxX + boxWidth - pad * a;

  targetHudBackdrop(boxX, boxY, boxWidth, boxHeight, a);
  targetHudHead(targetHudImage(display), headDrawX, headDrawY, shrunk, a, hurt);

  ctx.save();
  ctx.beginPath();
  ctx.rect(nameX - 2, nameY - 6, clipRight - (nameX - 2), barY + 24 - nameY);
  ctx.clip();
  ctx.globalAlpha = a;
  setFont(fontSize, true);
  ctx.fillStyle = 'rgb(89, 89, 89)';
  ctx.fillText(display.name || 'Target', nameX + 1, nameY + 1);
  ctx.fillStyle = 'rgb(255, 255, 255)';
  ctx.fillText(display.name || 'Target', nameX, nameY);
  setFont(Math.max(1, 18 * a), true);
  ctx.fillStyle = 'rgb(64, 64, 64)';
  ctx.fillText(status, nameX + 1, statusY + 1);
  ctx.fillStyle = 'rgb(255, 255, 255)';
  ctx.fillText(status, nameX, statusY);
  ctx.restore();

  ctx.save();
  targetHudRound(barStartX, barY, barEndX - barStartX, barHeight, 10 * a);
  ctx.fillStyle = `rgba(100, 100, 100, ${170 / 255 * a})`;
  ctx.fill();
  ctx.restore();

  const startColor = themed(0);
  const endColor = themed((barEndX - barStartX) * 2);
  const gradient = ctx.createLinearGradient(barStartX, 0, barEndX, 0);

  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const color = lerpC(startColor, endColor, t);
    gradient.addColorStop(t, rgb(color, a));
  }

  const healthPerc = clamp((module.__hudHealth || 0) / maxHealth, 0, 1);
  const healthWidth = (barEndX - barStartX) * healthPerc;

  if (healthPerc > 0.01) {
    targetHudBarPath(barStartX, barY, Math.max(healthWidth, 2), barHeight, 10 * a, healthPerc > 0.98);
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  const absorptionPerc = clamp((module.__hudAbsorption || 0) / 20, 0, 1);
  const absorptionWidth = (barEndX - barStartX) * absorptionPerc;

  if (absorptionPerc > 0.01) {
    targetHudBarPath(barStartX, barY, Math.max(absorptionWidth, 2), barHeight, 10 * a, absorptionPerc > 0.98);
    ctx.fillStyle = `rgba(244, 204, 0, ${a})`;
    ctx.fill();
  }

  ctx.restore();
}

window.addEventListener('message', (event) => {
  if (event.origin !== 'https://www.bilibilitoy.com') {
    return;
  }

  const data = event.data;

  if (!data || data.channel !== 'solstice-targethud' || data.type !== 'state') {
    return;
  }

  targetHudData = data;
  targetHudAt = performance.now();
});

register({
  name: 'TargetHUD',
  desc: 'Shows target information',
  cat: 'Visual',
  nm: { l: 'targethud', ls: 'target hud', n: 'TargetHUD', ns: 'Target HUD' },
  disp: 'Style',
  settings: [
    { t: 'e', n: 'Style', d: 'The style of the target HUD', v: 0, vals: ['Solstice'] },
    { t: 'n', n: 'X Offset', d: 'The X offset of the target HUD', v: 100, min: -400, max: 400, step: 1 },
    { t: 'n', n: 'Y Offset', d: 'The Y offset of the target HUD', v: 100, min: -400, max: 400, step: 1 },
    { t: 'n', n: 'Font Size', d: 'The size of the font', v: 20, min: 1, max: 40, step: 1 },
    { t: 'b', n: 'Health Calculation', d: 'Calculate health', v: 0 }
  ],
  renderOrder: 1,
  onRender: drawTargetHud,
  onEnable() {}
});
