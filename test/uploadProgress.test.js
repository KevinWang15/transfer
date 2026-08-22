import assert from "node:assert/strict";
import test from "node:test";

import {
  UploadProgressTracker,
  formatBytes,
  formatDuration,
} from "../src/utils/uploadProgress.js";

function createTracker(totalBytes) {
  let now = 0;
  const snapshots = [];
  const tracker = new UploadProgressTracker(
    totalBytes,
    (snapshot) => snapshots.push(snapshot),
    {
      now: () => now,
      emitIntervalMs: 0,
      sampleIntervalMs: 0,
    }
  );

  return {
    tracker,
    snapshots,
    advance(milliseconds) {
      now += milliseconds;
    },
  };
}

test("logical upload progress never moves backwards when a chunk retries", () => {
  const { tracker, snapshots, advance } = createTracker(1000);
  tracker.preparing();
  tracker.start();

  advance(1000);
  tracker.update(0, 400, 400);
  advance(1000);
  tracker.update(0, 0, 400);
  advance(1000);
  tracker.update(0, 200, 600);
  advance(1000);
  tracker.update(500, 0, 900);

  const uploadedValues = snapshots.map((snapshot) => snapshot.uploadedBytes);
  assert.deepEqual(
    uploadedValues,
    [...uploadedValues].sort((a, b) => a - b)
  );
  assert.equal(snapshots.at(-2).uploadedBytes, 400);
  assert.equal(snapshots.at(-1).uploadedBytes, 500);
});

test("resumed bytes do not inflate speed and ETA", () => {
  const { tracker, snapshots, advance } = createTracker(1000);
  tracker.start(500);
  assert.equal(snapshots.at(-1).speedBytesPerSecond, 0);

  advance(1000);
  tracker.update(500, 100, 100);

  assert.equal(snapshots.at(-1).uploadedBytes, 600);
  assert.equal(snapshots.at(-1).speedBytesPerSecond, 100);
  assert.equal(snapshots.at(-1).etaSeconds, 4);
});

test("upload progress waits below 100 percent until finalization", () => {
  const { tracker, snapshots } = createTracker(1000);
  tracker.start();
  tracker.update(0, 1000, 1000);
  assert.equal(snapshots.at(-1).progress, 0.999);

  tracker.finalizing();
  assert.equal(snapshots.at(-1).phase, "finalizing");
  assert.equal(snapshots.at(-1).progress, 1);
  assert.equal(snapshots.at(-1).etaSeconds, null);
});

test("progress values have compact human-readable formatting", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1536), "1.50 KiB");
  assert.equal(formatBytes(12 * 1024 * 1024), "12.0 MiB");
  assert.equal(formatDuration(9.1), "10s");
  assert.equal(formatDuration(65), "1m 05s");
  assert.equal(formatDuration(3725), "1h 02m");
});
