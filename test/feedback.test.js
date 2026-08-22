import assert from "node:assert/strict";
import test from "node:test";

import {
  showDialog,
  showToast,
  subscribeToFeedback,
} from "../src/utils/feedback.js";

test("toast feedback is normalized and published to the host", () => {
  const events = [];
  const unsubscribe = subscribeToFeedback((event) => events.push(event));
  const id = showToast("Copied", {
    tone: "success",
    duration: 250,
  });
  unsubscribe();

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "toast");
  assert.deepEqual(events[0].toast, {
    id,
    message: "Copied",
    title: undefined,
    tone: "success",
    duration: 1000,
  });
});

test("dialog feedback resolves with the host result", async () => {
  let publishedDialog;
  const unsubscribe = subscribeToFeedback((event) => {
    publishedDialog = event.dialog;
  });
  const resultPromise = showDialog({ title: "Continue?" });
  publishedDialog.resolve({ isConfirmed: true, value: "approved" });
  unsubscribe();

  assert.deepEqual(await resultPromise, {
    isConfirmed: true,
    value: "approved",
  });
});
