(() => {
  'use strict';

  if (window.__solsticeNativeGuard) {
    return;
  }

  const nativeToString = Function.prototype.toString;
  const nativeOwnNames = Object.getOwnPropertyNames;

  const guardedToString = function toString() {
    try {
      const names = nativeOwnNames(this);

      for (const name of names) {
        if (name.startsWith('__solstice')) {
          return 'function () { [native code] }';
        }
      }
    } catch {

    }

    return nativeToString.call(this);
  };

  Object.defineProperty(guardedToString, '__solsticeNativeGuard', { value: true });

  try {
    Function.prototype.toString = guardedToString;
  } catch {
    return;
  }

  Object.defineProperty(window, '__solsticeNativeGuard', { value: true });

  function installOnFiredGuard() {
    const xz = window.XZ;

    if (!xz || xz.__solsticeOnFiredGuard || typeof xz.onFired !== 'function') {
      return;
    }

    const base = xz.onFired;
    const wrappers = [base];

    try {
      Object.defineProperty(window, '__solsticeOnFiredBase', {
        configurable: true,
        value: base
      });
    } catch {

    }
    let dispatching = false;
    let stack = [];

    function dispatch(...args) {
      if (dispatching) {
        const previous = stack.pop();

        if (previous) {
          return previous.apply(this, args);
        }

        return base.apply(this, args);
      }

      dispatching = true;
      stack = wrappers.slice(0, -1);

      try {
        return wrappers[wrappers.length - 1].apply(this, args);
      } finally {
        dispatching = false;
        stack = [];
      }
    }

    const stable = new Proxy(dispatch, {
      apply(target, thisArg, args) {
        return dispatch.apply(thisArg, args);
      },
      get(target, property, receiver) {
        if (typeof property === 'string' && property.startsWith('__solstice')) {
          return wrappers.some((wrapper) => wrapper && wrapper[property]);
        }

        return Reflect.get(target, property, receiver);
      }
    });

    try {
      Object.defineProperty(xz, 'onFired', {
        configurable: true,
        get() {
          return stable;
        },
        set(wrapper) {
          if (typeof wrapper === 'function' && !wrappers.includes(wrapper)) {
            wrappers.push(wrapper);
          }
        }
      });

      xz.__solsticeOnFiredGuard = true;
    } catch {

    }
  }

  installOnFiredGuard();
  setInterval(installOnFiredGuard, 50);
})();
