(() => {
  'use strict';

  if (location.hostname === 'www.bilibilitoy.com' && location.pathname.startsWith('/toy/golden-hour/')) {
    bootGame();
    return;
  }

  const CHANNEL = 'solstice-tracer';
  const GAME_ORIGIN = 'https://www.bilibilitoy.com';
  const HEARTBEAT_MS = 500;

  let lastSentKey = '';
  let lastSentAt = 0;

  function findGameFrame() {
    for (const frame of document.querySelectorAll('iframe')) {
      if (frame.src.startsWith(`${GAME_ORIGIN}/toy/golden-hour/`)) {
        return frame;
      }
    }

    return null;
  }

  function themeColor(index = 0) {
    try {
      const color = window.SolsticeThemeColor?.(index);

      if (Array.isArray(color) && color.length >= 3) {
        return color.slice(0, 3).map((value) => Math.max(0, Math.min(255, Number(value) || 0)));
      }
    } catch {

    }

    return index === 1 ? [64, 39, 22] : [255, 154, 86];
  }

  function syncConfig() {
    const module = getMod('BulletTracers');

    if (!module) {
      return;
    }

    const now = performance.now();
    const color = themeColor(0);
    const config = {
      channel: CHANNEL,
      type: 'config',
      enabled: Boolean(module.on),
      color,
      color2: color.map((value) => Math.round(value * 0.25))
    };
    const key = JSON.stringify(config);

    if (key === lastSentKey && now - lastSentAt < HEARTBEAT_MS) {
      return;
    }

    const frame = findGameFrame();

    if (!frame?.contentWindow) {
      return;
    }

    frame.contentWindow.postMessage(config, GAME_ORIGIN);
    lastSentKey = key;
    lastSentAt = now;
  }

  register({
    name: 'BulletTracers',
    desc: 'Draws glowing bullet tracers from your head to the impact point.',
    cat: 'Visual',
    nm: { l: 'bullettracers', ls: 'bullet tracers', n: 'BulletTracers', ns: 'Bullet Tracers' },
    disp: '',
    settings: [],
    onRender: syncConfig,
    onEnable() {
      syncConfig();
    }
  });

  setInterval(syncConfig, 250);

  function bootGame() {
    let attempts = 0;

    function start() {
      const bridge = window.SolsticeGame;

      if (!bridge) {
        if (attempts++ < 100) {
          setTimeout(start, 25);
        }

        return;
      }

      installGame(bridge);
    }

    start();
  }

    function installGame(bridge) {
      let enabled = false;
      let color = [255, 154, 86];
      let color2 = [64, 39, 22];
      let scene = null;
      let geometry = null;
      let up = null;
      let tracers = [];

    function installScene() {
      const debug = bridge.getGH()?.debug;
      const next = debug?.gfx?.scene;

      if (!next || next === scene) {
        return;
      }

      scene = next;
    }

    function installGeometry() {
      const three = bridge.getGH()?.three;

      if (!three || geometry) {
        return;
      }

      up = new three.Vector3(0, 1, 0);
      geometry = new three.CylinderGeometry(1, 1, 1, 24, 1, false);
      geometry.translate(0, 0.5, 0);
    }

    function clear() {
      for (const tracer of tracers) {
        for (const mesh of tracer.meshes) {
          mesh.removeFromParent();
          mesh.material.dispose();
        }
      }

      tracers = [];
    }

    function spawn(origin, endpoint) {
      const three = bridge.getGH()?.three;

      if (!three || !scene || !geometry) {
        return;
      }

      const dx = endpoint.x - origin.x;
      const dy = endpoint.y - origin.y;
      const dz = endpoint.z - origin.z;
      const length = Math.hypot(dx, dy, dz);

      if (length < 0.05) {
        return;
      }

      const direction = new three.Vector3(dx / length, dy / length, dz / length);
      const quaternion = new three.Quaternion().setFromUnitVectors(up, direction);
      const material = new three.ShaderMaterial({
        uniforms: {
          uColorA: { value: new three.Color(color[0] / 255, color[1] / 255, color[2] / 255) },
          uColorB: { value: new three.Color(color2[0] / 255, color2[1] / 255, color2[2] / 255) },
          uOpacity: { value: 0.95 }
        },
        vertexShader: 'varying float vT; void main() { vT = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 uColorA; uniform vec3 uColorB; uniform float uOpacity; varying float vT; void main() { vec3 c = mix(uColorA, uColorB, clamp(vT, 0.0, 1.0)); gl_FragColor = vec4(c, uOpacity); }',
        transparent: true,
        blending: three.NormalBlending,
        depthWrite: false,
        toneMapped: false,
        side: three.DoubleSide
      });
      const mesh = new three.Mesh(geometry, material);

      mesh.position.copy(origin);
      mesh.quaternion.copy(quaternion);
      mesh.scale.set(0.016, length, 0.016);
      mesh.frustumCulled = false;
      mesh.renderOrder = 30;
      mesh.userData.maxOpacity = 0.95;
      scene.add(mesh);
      tracers.push({ meshes: [mesh], age: 0, hold: 3, fade: 1, life: 4 });
    }

    function rayAabbDistance(origin, direction, actor, maxDistance) {
      const body = actor.actor || actor;
      const parts = Array.isArray(body.hit)
        ? body.hit
        : Array.isArray(actor.hit) ? actor.hit : [];
      let best = maxDistance;

      for (const part of parts) {
        if (!part?.a || !part?.b) {
          continue;
        }

        const hit = bridge.rayAabb(
          origin.x, origin.y, origin.z,
          direction.x, direction.y, direction.z,
          Math.min(part.a.x, part.b.x),
          Math.min(part.a.y, part.b.y),
          Math.min(part.a.z, part.b.z),
          Math.max(part.a.x, part.b.x),
          Math.max(part.a.y, part.b.y),
          Math.max(part.a.z, part.b.z),
          best
        );

        if (hit !== null && hit < best) {
          best = hit;
        }
      }

      if (best === maxDistance) {
        const pos = body.pos || actor.pos;
        const height = Number(body.e?.h) > 0.2 ? Number(body.e.h) : 1.8;

        if (pos) {
          const hit = bridge.rayAabb(
            origin.x, origin.y, origin.z,
            direction.x, direction.y, direction.z,
            pos.x - 0.38, pos.y + 0.05, pos.z - 0.38,
            pos.x + 0.38, pos.y + height, pos.z + 0.38,
            best
          );

          if (hit !== null && hit < best) {
            best = hit;
          }
        }
      }

      return best;
    }

    function impactPoint(origin, direction, maxDistance) {
      let wall = maxDistance;
      const end = {
        x: origin.x + direction.x * maxDistance,
        y: origin.y + direction.y * maxDistance,
        z: origin.z + direction.z * maxDistance
      };

      if (!bridge.worldLineClear(origin, end)) {
        let low = 0;
        let high = maxDistance;

        for (let i = 0; i < 10; i += 1) {
          const mid = (low + high) * 0.5;
          const point = {
            x: origin.x + direction.x * mid,
            y: origin.y + direction.y * mid,
            z: origin.z + direction.z * mid
          };

          if (bridge.worldLineClear(origin, point)) {
            low = mid;
          } else {
            high = mid;
          }
        }

        wall = Math.max(0, low - 0.02);
      }

      let actorHit = wall;
      const context = bridge.getContext();

      if (context) {
        for (const actor of context.actors) {
          if (!actor || actor === context.player || actor.alive === false || actor.isK9) {
            continue;
          }

          const hit = rayAabbDistance(origin, direction, actor, actorHit);

          if (hit < actorHit) {
            actorHit = hit;
          }
        }
      }

      const distance = Math.min(wall, actorHit);
      return {
        x: origin.x + direction.x * distance,
        y: origin.y + direction.y * distance,
        z: origin.z + direction.z * distance
      };
    }

    function update(dt) {
      const step = Math.max(0, Math.min(Number(dt) || 0, 0.05));

      for (let i = tracers.length - 1; i >= 0; i -= 1) {
        const tracer = tracers[i];
        tracer.age += step;

        if (tracer.age >= tracer.life) {
          for (const mesh of tracer.meshes) {
            mesh.removeFromParent();
            mesh.material.dispose();
          }

          tracers.splice(i, 1);
          continue;
        }

        const fade = tracer.age <= tracer.hold
          ? 1
          : Math.max(0, 1 - (tracer.age - tracer.hold) / tracer.fade);

        for (const mesh of tracer.meshes) {
          mesh.material.uniforms.uOpacity.value = mesh.userData.maxOpacity * fade;
        }
      }
    }

    bridge.onConfig('solstice-tracer', (data) => {
      if (data.type !== 'config') {
        return;
      }

      enabled = Boolean(data.enabled);

      if (Array.isArray(data.color) && data.color.length >= 3) {
        color = data.color.slice(0, 3).map((value) => Math.max(0, Math.min(255, Number(value) || 0)));
      }

      if (Array.isArray(data.color2) && data.color2.length >= 3) {
        color2 = data.color2.slice(0, 3).map((value) => Math.max(0, Math.min(255, Number(value) || 0)));
      }

      if (!enabled) {
        clear();
      }
    });

    bridge.onCombatFire((actor, eye, direction) => {
      if (!enabled) {
        return null;
      }

      const context = bridge.getContext();

      if (!context || !context.player || actor !== context.player || !context.player.alive) {
        return null;
      }

      installScene();
      installGeometry();

      if (!scene || !geometry || !eye || !direction) {
        return null;
      }

      const origin = {
        x: eye.x,
        y: eye.y + 0.04,
        z: eye.z
      };
      const length = Math.hypot(direction.x, direction.y, direction.z);

      if (length < 1e-5) {
        return null;
      }

      const normalized = {
        x: direction.x / length,
        y: direction.y / length,
        z: direction.z / length
      };
      const endpoint = impactPoint(origin, normalized, 120);

      spawn(origin, endpoint);
      return null;
    }, 60);

    bridge.onBeforePlayerUpdate(update, 60);

    bridge.onReset(clear);
  }
})();
