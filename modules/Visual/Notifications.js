(() => {
  'use strict';

  const notifications = [];
  let joined = false;

  function setting(name, fallback) {
    const module = getMod('Notifications');
    const value = module?.settings.find((entry) => entry.n === name);
    return value ? value.v : fallback;
  }

  function add(message, duration = 3) {
    const module = getMod('Notifications');

    if (!module?.on) {
      return;
    }

    notifications.push({
      message,
      time: 0,
      duration: Math.max(0.5, duration),
      anim: 0
    });

    if (setting('Limit notifications', false)) {
      const max = Math.max(1, Math.round(Number(setting('Max notifications', 6)) || 6));

      if (notifications.length > max) {
        notifications.splice(0, notifications.length - max);
      }
    }
  }

  document.addEventListener('solstice:module-toggle', (event) => {
    const detail = event.detail;

    if (!detail?.name) {
      return;
    }

    if (detail.name === 'Notifications') {
      if (!detail.enabled) {
        notifications.length = 0;
      }

      return;
    }

    if (!setting('Show on toggle', true)) {
      return;
    }

    add(`${detail.name} was ${detail.enabled ? 'enabled' : 'disabled'}`, 3);
  });

  document.addEventListener('solstice:anticheat-flag', (event) => {
    const message = event.detail?.message;

    if (message) {
      add(String(message), 7);
    }
  });

  function draw(dt) {
    const module = getMod('Notifications');

    if (!module?.on) {
      return;
    }

    if (!joined) {
      joined = true;

      if (setting('Show on join', true)) {
        const gameLabel = window.SolsticeGameId === 'potatoepic' ? 'POTATO EPIC' : 'GOLDEN HOUR';
        add(`Connected to ${gameLabel}`, 6);
      }
    }

    for (const notification of notifications) {
      notification.time += dt;
      const target = notification.time < notification.duration ? 1 : 0;
      notification.anim += (target - notification.anim) * Math.min(1, dt * 9);
    }

    for (let index = notifications.length - 1; index >= 0; index -= 1) {
      if (notifications[index].time > notifications[index].duration + 1) {
        notifications.splice(index, 1);
      }
    }

    const limit = setting('Limit notifications', false);
    const max = Math.max(1, Math.round(Number(setting('Max notifications', 6)) || 6));
    const visible = limit ? notifications.slice(-max) : notifications;

    if (visible.length === 0) {
      return;
    }

    ctx.save();
    ctx.scale(K, K);
    const AW = W / K;
    const AH = H / K;
    let y = AH - 10;

    for (let index = visible.length - 1; index >= 0; index -= 1) {
      const notification = visible[index];
      const anim = clamp(notification.anim, 0, 1);

      if (anim <= 0.01) {
        continue;
      }

      const fontSize = 20;
      setFont(fontSize, false);
      const metrics = ctx.measureText(notification.message);
      const textHeight = Math.max(
        fontSize,
        Math.ceil((metrics.actualBoundingBoxAscent || fontSize) + (metrics.actualBoundingBoxDescent || 0))
      );
      const boxWidth = Math.max(200, tw(notification.message, fontSize, false) + 50);
      const boxHeight = textHeight + 30;
      const bodyHeight = boxHeight - 10;
      const x = lerp(AW + boxWidth, AW - 10 - boxWidth, anim);
      const progress = clamp(notification.time / notification.duration, 0, 1);
      const progressWidth = Math.min(boxWidth, boxWidth * progress + 6);

      y -= boxHeight * anim;
      const color = themed(y * 2);

      fillRR(x, y, boxWidth, bodyHeight, 5, [0, 0, 0], 0.7 * anim, CORNER_TOP | CORNER_BOTTOM);

      const perfN = window.SolsticePerf;
      if (perfN) perfN.glow(x, y, progressWidth, bodyHeight, color, 22, 0.55 * anim);
      fillRR(x, y, progressWidth, bodyHeight, 5, color, 0.7 * anim, CORNER_TOP | CORNER_BOTTOM);

      ctx.save();
      setFont(fontSize, false);
      ctx.textBaseline = 'top';
      ctx.fillStyle = rgb([255, 255, 255], anim);
      ctx.fillText(notification.message, x + 10, y + 10);
      ctx.restore();
    }

    ctx.restore();
  }

  register({
    name: 'Notifications',
    desc: 'Shows notifications on module toggle and other events',
    cat: 'Visual',
    nm: { l: 'notifications', ls: 'notifications', n: 'Notifications', ns: 'Notifications' },
    disp: 'Style',
    settings: [
      { t: 'e', n: 'Style', d: 'The style of the notifications', v: 0, vals: ['Solaris'] },
      { t: 'b', n: 'Show on toggle', d: 'Show a notification when a module is toggled', v: 1 },
      { t: 'b', n: 'Show on join', d: 'Show a notification when you join a server', v: 1 },
      { t: 'b', n: 'Limit notifications', d: 'Limit the number of notifications shown at one time', v: 0 },
      { t: 'n', n: 'Max notifications', d: 'The maximum number of notifications shown at one time', v: 6, min: 1, max: 25, step: 1 }
    ],
    renderOrder: 2,
    onRender: draw,
    defaultOn: true,
    onEnable() {}
  });
})();
