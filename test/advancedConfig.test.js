import assert from "node:assert/strict";
import test from "node:test";
import {
  ADVANCED_CONFIG_STORAGE_KEY,
  loadAdvancedConfig,
  normalizeFileReadHost,
  saveAdvancedConfig,
} from "../src/utils/advancedConfig.js";

test("file-read hosts accept hostnames, ports, and HTTP(S) origins", () => {
  for (const [input, expected] of [
    ["", ""],
    ["  ", ""],
    [" files.example.com/ ", "files.example.com"],
    ["files.example.com:443", "files.example.com:443"],
    ["http://localhost:8090/", "http://localhost:8090"],
    ["https://FILES.example.com/", "https://files.example.com"],
    ["[::1]:8090", "[::1]:8090"],
  ])
    assert.equal(normalizeFileReadHost(input), expected);
});

test("file-read hosts reject non-HTTP URLs and non-host URL components", () => {
  for (const value of [
    "ftp://files.example.com",
    "javascript:alert(1)",
    "//files.example.com",
    "https://user:password@files.example.com",
    "https://files.example.com/path",
    "files.example.com?query=1",
    "files.example.com#fragment",
    "files.example.com:99999",
    "not a host",
    "https://files.example.com\\path",
  ])
    assert.throws(() => normalizeFileReadHost(value), Error, value);
});

test("advanced configuration is off by default and saved separately for each session", (t) => {
  const values = new Map();
  const previous = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  });

  assert.deepEqual(loadAdvancedConfig("a"), { fileReadHost: "" });
  saveAdvancedConfig("a", { fileReadHost: "https://read.example.com" });
  saveAdvancedConfig("b", { fileReadHost: "localhost:8090" });
  assert.deepEqual(JSON.parse(values.get(ADVANCED_CONFIG_STORAGE_KEY)), {
    a: { fileReadHost: "https://read.example.com" },
    b: { fileReadHost: "localhost:8090" },
  });
  assert.deepEqual(loadAdvancedConfig("a"), {
    fileReadHost: "https://read.example.com",
  });
  saveAdvancedConfig("a", { fileReadHost: "" });
  assert.deepEqual(loadAdvancedConfig("a"), { fileReadHost: "" });
  assert.deepEqual(loadAdvancedConfig("b"), { fileReadHost: "localhost:8090" });

  values.set(ADVANCED_CONFIG_STORAGE_KEY, "invalid JSON");
  assert.deepEqual(loadAdvancedConfig("a"), { fileReadHost: "" });
  saveAdvancedConfig("a", { fileReadHost: "files.example.com" });
  assert.equal(loadAdvancedConfig("a").fileReadHost, "files.example.com");

  globalThis.window.localStorage.setItem = () => {
    throw new Error("Storage unavailable");
  };
  assert.throws(
    () => saveAdvancedConfig("a", { fileReadHost: "" }),
    /Storage unavailable/
  );
  globalThis.window.localStorage.getItem = () => {
    throw new Error("Storage unavailable");
  };
  assert.deepEqual(loadAdvancedConfig("a"), { fileReadHost: "" });
});
