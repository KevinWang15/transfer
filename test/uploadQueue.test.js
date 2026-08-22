import assert from "node:assert/strict";
import test from "node:test";

import {
  createQueuedUploads,
  isActiveUpload,
  isSettledUpload,
  summarizeUploadQueue,
  UPLOAD_PHASES,
} from "../src/utils/uploadQueue.js";

test("multiple selected files become ordered queue entries", () => {
  const files = [
    { name: "first.bin", size: 100 },
    { name: "second.bin", size: 250 },
  ];
  let nextId = 0;
  const uploads = createQueuedUploads(files, () => `test-${++nextId}`);

  assert.deepEqual(
    uploads.map(({ id, filename, phase, totalBytes }) => ({
      id,
      filename,
      phase,
      totalBytes,
    })),
    [
      {
        id: "test-1",
        filename: "first.bin",
        phase: UPLOAD_PHASES.queued,
        totalBytes: 100,
      },
      {
        id: "test-2",
        filename: "second.bin",
        phase: UPLOAD_PHASES.queued,
        totalBytes: 250,
      },
    ]
  );
  assert.equal(uploads[0].file, files[0]);
});

test("queue summaries combine file state and byte-weighted progress", () => {
  const uploads = [
    {
      phase: UPLOAD_PHASES.complete,
      totalBytes: 100,
      uploadedBytes: 100,
    },
    {
      phase: UPLOAD_PHASES.uploading,
      totalBytes: 300,
      uploadedBytes: 150,
    },
    {
      phase: UPLOAD_PHASES.queued,
      totalBytes: 100,
      uploadedBytes: 0,
    },
    {
      phase: UPLOAD_PHASES.failed,
      totalBytes: 500,
      uploadedBytes: 50,
    },
  ];

  assert.deepEqual(summarizeUploadQueue(uploads), {
    totalFiles: 4,
    queuedCount: 1,
    activeCount: 1,
    completedCount: 1,
    failedCount: 1,
    totalBytes: 1000,
    uploadedBytes: 300,
    progress: 0.3,
  });
  assert.equal(isActiveUpload(uploads[1]), true);
  assert.equal(isSettledUpload(uploads[3]), true);
  assert.equal(isSettledUpload(uploads[2]), false);
});
