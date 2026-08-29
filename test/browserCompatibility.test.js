import assert from "node:assert/strict";
import test from "node:test";

import {
  hasNativeDialogSupport,
  readBlobAsArrayBuffer,
  settleAll,
} from "../src/utils/browserCompatibility.js";

test("legacy Blob data is read through FileReader", async () => {
  const expected = new Uint8Array([1, 2, 3]).buffer;
  class LegacyFileReader {
    readAsArrayBuffer(blob) {
      this.result = blob.result;
      this.onload();
    }
  }

  const actual = await readBlobAsArrayBuffer(
    { result: expected },
    LegacyFileReader
  );
  assert.equal(actual, expected);
});

test("native Blob arrayBuffer remains the preferred path", async () => {
  const expected = new Uint8Array([4, 5, 6]).buffer;
  let legacyReaderCreated = false;
  class LegacyFileReader {
    constructor() {
      legacyReaderCreated = true;
    }
  }

  const actual = await readBlobAsArrayBuffer(
    { arrayBuffer: async () => expected },
    LegacyFileReader
  );
  assert.equal(actual, expected);
  assert.equal(legacyReaderCreated, false);
});

test("settleAll records fulfilled and rejected promises without allSettled", async () => {
  const reason = new Error("failed");
  const results = await settleAll([
    Promise.resolve("ok"),
    Promise.reject(reason),
  ]);

  assert.deepEqual(results, [
    { status: "fulfilled", value: "ok" },
    { status: "rejected", reason },
  ]);
});

test("dialog feature detection rejects Firefox 66 style elements", () => {
  class LegacyDialog {}
  class NativeDialog {
    showModal() {}
  }

  assert.equal(hasNativeDialogSupport(LegacyDialog), false);
  assert.equal(hasNativeDialogSupport(NativeDialog), true);
});
