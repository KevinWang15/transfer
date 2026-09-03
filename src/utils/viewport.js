const SESSION_VIEWPORT_CLASS = "session-viewport";
const SESSION_VIEWPORT_HEIGHT = "--session-viewport-height";

export function resolveViewportHeight(visualViewport, windowTarget) {
  const visualHeight = Number(visualViewport?.height);
  if (Number.isFinite(visualHeight) && visualHeight > 0) {
    return visualHeight;
  }

  const innerHeight = Number(windowTarget?.innerHeight);
  return Number.isFinite(innerHeight) && innerHeight > 0 ? innerHeight : null;
}

export function installSessionViewport(options = {}) {
  const windowTarget =
    options.windowTarget ??
    (typeof window === "undefined" ? undefined : window);
  const documentTarget =
    options.documentTarget ??
    (typeof document === "undefined" ? undefined : document);
  const root = options.root ?? documentTarget?.documentElement;
  const body = options.body ?? documentTarget?.body;
  const visualViewport = options.visualViewport ?? windowTarget?.visualViewport;

  if (!root || !body) {
    return () => {};
  }

  const rootHadClass = root.classList.contains(SESSION_VIEWPORT_CLASS);
  const bodyHadClass = body.classList.contains(SESSION_VIEWPORT_CLASS);
  const previousHeight = root.style.getPropertyValue(SESSION_VIEWPORT_HEIGHT);

  root.classList.add(SESSION_VIEWPORT_CLASS);
  body.classList.add(SESSION_VIEWPORT_CLASS);
  windowTarget?.scrollTo?.(0, 0);

  const update = () => {
    const height = resolveViewportHeight(visualViewport, windowTarget);
    if (height !== null) {
      root.style.setProperty(SESSION_VIEWPORT_HEIGHT, `${height}px`);
    }
  };

  update();
  visualViewport?.addEventListener?.("resize", update);
  windowTarget?.addEventListener?.("resize", update);
  windowTarget?.addEventListener?.("pageshow", update);
  const animationFrame = windowTarget?.requestAnimationFrame?.(update);

  return () => {
    visualViewport?.removeEventListener?.("resize", update);
    windowTarget?.removeEventListener?.("resize", update);
    windowTarget?.removeEventListener?.("pageshow", update);
    if (animationFrame !== undefined) {
      windowTarget?.cancelAnimationFrame?.(animationFrame);
    }

    if (previousHeight) {
      root.style.setProperty(SESSION_VIEWPORT_HEIGHT, previousHeight);
    } else {
      root.style.removeProperty(SESSION_VIEWPORT_HEIGHT);
    }
    if (!rootHadClass) {
      root.classList.remove(SESSION_VIEWPORT_CLASS);
    }
    if (!bodyHadClass) {
      body.classList.remove(SESSION_VIEWPORT_CLASS);
    }
  };
}
