export const ADVANCED_CONFIG_STORAGE_KEY = "transfer.advanced-config";

export function normalizeFileReadHost(value) {
  const host = String(value || "").trim();
  if (!host) return "";
  const hasProtocol = host.includes("://");
  const authority = hasProtocol ? host.slice(host.indexOf("://") + 3) : host;
  let url;
  try {
    url = new URL(hasProtocol ? host : `https://${host}`);
  } catch {
    throw new Error(
      "Enter a hostname or an HTTP(S) origin, such as https://files.example.com."
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    authority.replace(/\/$/, "").includes("/") ||
    /[\\\s?#]/.test(host)
  ) {
    throw new Error(
      "Use only a hostname and optional port, or an HTTP(S) origin, without a path, query, or credentials."
    );
  }
  return hasProtocol ? url.origin : host.replace(/\/$/, "");
}

function readConfigs(storage) {
  const configs = JSON.parse(
    storage.getItem(ADVANCED_CONFIG_STORAGE_KEY) || "{}"
  );
  return configs && typeof configs === "object" && !Array.isArray(configs)
    ? configs
    : {};
}

export function loadAdvancedConfig(sessionId) {
  try {
    const configs = readConfigs(window.localStorage);
    const config = Object.prototype.hasOwnProperty.call(configs, sessionId)
      ? configs[sessionId]
      : null;
    return { fileReadHost: normalizeFileReadHost(config?.fileReadHost) };
  } catch {
    return { fileReadHost: "" };
  }
}

export function saveAdvancedConfig(sessionId, config) {
  let configs;
  try {
    configs = readConfigs(window.localStorage);
  } catch {
    configs = {};
  }
  window.localStorage.setItem(
    ADVANCED_CONFIG_STORAGE_KEY,
    JSON.stringify({
      ...configs,
      [sessionId]: { fileReadHost: normalizeFileReadHost(config.fileReadHost) },
    })
  );
}
