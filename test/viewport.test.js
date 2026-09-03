import assert from "node:assert/strict";
import test from "node:test";

import {
  installSessionViewport,
  resolveViewportHeight,
} from "../src/utils/viewport.js";

class EventTargetFake {
  listeners = new Map();

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  removeEventListener(name, listener) {
    if (this.listeners.get(name) === listener) {
      this.listeners.delete(name);
    }
  }

  dispatch(name) {
    this.listeners.get(name)?.();
  }
}

function elementFake() {
  const classes = new Set();
  const properties = new Map();
  return {
    classList: {
      add: (name) => classes.add(name),
      contains: (name) => classes.has(name),
      remove: (name) => classes.delete(name),
    },
    style: {
      getPropertyValue: (name) => properties.get(name) || "",
      removeProperty: (name) => properties.delete(name),
      setProperty: (name, value) => properties.set(name, value),
    },
  };
}

test("visual viewport height is preferred with an inner-height fallback", () => {
  assert.equal(
    resolveViewportHeight({ height: 640.5 }, { innerHeight: 700 }),
    640.5
  );
  assert.equal(resolveViewportHeight(null, { innerHeight: 700 }), 700);
  assert.equal(resolveViewportHeight({ height: 0 }, { innerHeight: 0 }), null);
});

test("session viewport tracks resizes and fully restores document state", () => {
  const root = elementFake();
  const body = elementFake();
  const visualViewport = new EventTargetFake();
  visualViewport.height = 700;
  const windowTarget = new EventTargetFake();
  windowTarget.innerHeight = 760;
  windowTarget.requestAnimationFrame = () => 12;
  let scrollPosition;
  windowTarget.scrollTo = (x, y) => {
    scrollPosition = [x, y];
  };
  let cancelledFrame;
  windowTarget.cancelAnimationFrame = (frame) => {
    cancelledFrame = frame;
  };

  const cleanup = installSessionViewport({
    body,
    root,
    visualViewport,
    windowTarget,
  });

  assert.equal(root.classList.contains("session-viewport"), true);
  assert.equal(body.classList.contains("session-viewport"), true);
  assert.deepEqual(scrollPosition, [0, 0]);
  assert.equal(
    root.style.getPropertyValue("--session-viewport-height"),
    "700px"
  );

  visualViewport.height = 430;
  visualViewport.dispatch("resize");
  assert.equal(
    root.style.getPropertyValue("--session-viewport-height"),
    "430px"
  );

  cleanup();
  assert.equal(root.classList.contains("session-viewport"), false);
  assert.equal(body.classList.contains("session-viewport"), false);
  assert.equal(root.style.getPropertyValue("--session-viewport-height"), "");
  assert.equal(visualViewport.listeners.has("resize"), false);
  assert.equal(windowTarget.listeners.has("resize"), false);
  assert.equal(windowTarget.listeners.has("pageshow"), false);
  assert.equal(cancelledFrame, 12);
});
