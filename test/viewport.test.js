import assert from "node:assert/strict";
import test from "node:test";

import { installSessionViewport } from "../src/utils/viewport.js";

function elementFake() {
  const classes = new Set();
  return {
    classList: {
      add: (name) => classes.add(name),
      contains: (name) => classes.has(name),
      remove: (name) => classes.delete(name),
    },
  };
}

test("session viewport locks scrolling and fully restores document state", () => {
  const root = elementFake();
  const body = elementFake();
  const windowTarget = {};
  let scrollPosition;
  windowTarget.scrollTo = (x, y) => {
    scrollPosition = [x, y];
  };

  const cleanup = installSessionViewport({
    body,
    root,
    windowTarget,
  });

  assert.equal(root.classList.contains("session-viewport"), true);
  assert.equal(body.classList.contains("session-viewport"), true);
  assert.deepEqual(scrollPosition, [0, 0]);

  cleanup();
  assert.equal(root.classList.contains("session-viewport"), false);
  assert.equal(body.classList.contains("session-viewport"), false);
});
