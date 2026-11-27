(() => {
  'use strict';

  const PARENT_ORIGIN = 'https://www.bilibili.com';
  const CHANNEL = 'solstice-key';

  if (window.self === window.top) {
    return;
  }

  const seen = new WeakSet();

  function forward(event) {
    if (seen.has(event)) {
      return;
    }

    seen.add(event);

    if (event.key === 'Insert' || event.key === 'Escape') {
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

    if (event.repeat) {
      return;
    }

    try {
      window.parent.postMessage({
        channel: CHANNEL,
        type: 'down',
        code: event.code || event.key,
        key: event.key
      }, PARENT_ORIGIN);
    } catch {

    }
  }

  window.addEventListener('keydown', forward, true);
  document.addEventListener('keydown', forward, true);

})();
