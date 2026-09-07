import assert from "node:assert/strict";
import test from "node:test";
import {
  createUploadDiagnostics,
  UPLOAD_DIAGNOSTICS_VERSION,
} from "../src/utils/uploadDiagnostics.js";

test("upload diagnostics retain no events unless explicitly enabled", () => {
  const diagnostics = createUploadDiagnostics();
  diagnostics.record("picker-open", { picker: 1 });
  assert.deepEqual(JSON.parse(diagnostics.getText()).events, []);
});

test("diagnostics preserve event order and relative timing with a fixed memory bound", () => {
  let time = 1000;
  const diagnostics = createUploadDiagnostics({
    enabled: true,
    now: () => time,
  });
  for (let index = 0; index < 205; index++) {
    time += 10;
    diagnostics.record("picker-event", { picker: index, fileCount: 0 });
  }
  const result = JSON.parse(diagnostics.getText());
  assert.equal(result.version, UPLOAD_DIAGNOSTICS_VERSION);
  assert.equal(result.events.length, 200);
  assert.equal(result.events[0].sequence, 6);
  assert.equal(result.events[0].ms, 60);
  assert.equal(result.events[199].sequence, 205);
});
