(() => {
  'use strict';

  const PARENT_ORIGIN = 'https://www.bilibili.com';
  const CHANNEL = 'solstice-key';

  if (window.self === window.top) {
    return;
  }

  const seen = new WeakSet();

  function forwardKey(type, event) {
    if (seen.has(event)) {
      return;
    }

    seen.add(event);

    if (type === 'down' && (event.key === 'Insert' || event.key === 'Escape')) {
      try {
        window.parent.postMessage({
          channel: CHANNEL,
          type: 'key',
          key: event.key,
          keyCode: event.keyCode
        }, PARENT_ORIGIN);
      } catch {

      }

      return;
    }

    if (type === 'down' && event.repeat) {
      return;
    }

    try {
      window.parent.postMessage({
        channel: CHANNEL,
        type,
        code: event.code || event.key,
        key: event.key,
        ctrl: Boolean(event.ctrlKey),
        alt: Boolean(event.altKey),
        shift: Boolean(event.shiftKey),
        meta: Boolean(event.metaKey)
      }, PARENT_ORIGIN);
    } catch {

    }
  }

  function forwardMouse(type, event) {
    if (event.button !== 1 && event.button !== 3 && event.button !== 4) {
      return;
    }

    const code = event.button === 1 ? 'Mouse3' : event.button === 3 ? 'Mouse4' : 'Mouse5';
    try {
      window.parent.postMessage({
        channel: CHANNEL,
        type,
        code,
        key: code,
        ctrl: Boolean(event.ctrlKey),
        alt: Boolean(event.altKey),
        shift: Boolean(event.shiftKey),
        meta: Boolean(event.metaKey)
      }, PARENT_ORIGIN);
    } catch {

    }
  }

  const onDown = (e) => forwardKey('down', e);
  const onUp = (e) => forwardKey('up', e);
  const onMouseDown = (e) => forwardMouse('down', e);
  const onMouseUp = (e) => forwardMouse('up', e);

  window.addEventListener('keydown', onDown, true);
  document.addEventListener('keydown', onDown, true);
  window.addEventListener('keyup', onUp, true);
  document.addEventListener('keyup', onUp, true);
  window.addEventListener('mousedown', onMouseDown, true);
  window.addEventListener('mouseup', onMouseUp, true);

})();
