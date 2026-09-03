const SESSION_VIEWPORT_CLASS = "session-viewport";

export function installSessionViewport(options = {}) {
  const windowTarget =
    options.windowTarget ??
    (typeof window === "undefined" ? undefined : window);
  const documentTarget =
    options.documentTarget ??
    (typeof document === "undefined" ? undefined : document);
  const root = options.root ?? documentTarget?.documentElement;
  const body = options.body ?? documentTarget?.body;

  if (!root || !body) {
    return () => {};
  }

  const rootHadClass = root.classList.contains(SESSION_VIEWPORT_CLASS);
  const bodyHadClass = body.classList.contains(SESSION_VIEWPORT_CLASS);

  root.classList.add(SESSION_VIEWPORT_CLASS);
  body.classList.add(SESSION_VIEWPORT_CLASS);
  windowTarget?.scrollTo?.(0, 0);

  return () => {
    if (!rootHadClass) {
      root.classList.remove(SESSION_VIEWPORT_CLASS);
    }
    if (!bodyHadClass) {
      body.classList.remove(SESSION_VIEWPORT_CLASS);
    }
  };
}
