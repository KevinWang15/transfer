let nextUploadId = 0;

export const UPLOAD_PHASES = Object.freeze({
  queued: "queued",
  preparing: "preparing",
  uploading: "uploading",
  finalizing: "finalizing",
  complete: "complete",
  failed: "failed",
});

const activePhases = new Set([
  UPLOAD_PHASES.preparing,
  UPLOAD_PHASES.uploading,
  UPLOAD_PHASES.finalizing,
]);

export function isActiveUpload(upload) {
  return activePhases.has(upload?.phase);
}

export function isSettledUpload(upload) {
  return (
    upload?.phase === UPLOAD_PHASES.complete ||
    upload?.phase === UPLOAD_PHASES.failed
  );
}

export function createQueuedUploads(files, createId) {
  return Array.from(files || []).map((file) => ({
    id: createId ? createId(file) : `upload-${Date.now()}-${++nextUploadId}`,
    file,
    filename: file.name || "clipboard-image",
    phase: UPLOAD_PHASES.queued,
    uploadedBytes: 0,
    confirmedBytes: 0,
    totalBytes: Math.max(0, Number(file.size) || 0),
    progress: 0,
    speedBytesPerSecond: 0,
    etaSeconds: null,
    error: null,
  }));
}

export function summarizeUploadQueue(uploads) {
  const items = Array.from(uploads || []);
  const summary = {
    totalFiles: items.length,
    queuedCount: 0,
    activeCount: 0,
    completedCount: 0,
    failedCount: 0,
    totalBytes: 0,
    uploadedBytes: 0,
    progress: 0,
  };

  items.forEach((upload) => {
    const totalBytes = Math.max(0, Number(upload.totalBytes) || 0);
    const uploadedBytes =
      upload.phase === UPLOAD_PHASES.complete
        ? totalBytes
        : Math.min(totalBytes, Math.max(0, Number(upload.uploadedBytes) || 0));
    summary.totalBytes += totalBytes;
    summary.uploadedBytes += uploadedBytes;

    if (upload.phase === UPLOAD_PHASES.queued) {
      summary.queuedCount += 1;
    } else if (isActiveUpload(upload)) {
      summary.activeCount += 1;
    } else if (upload.phase === UPLOAD_PHASES.complete) {
      summary.completedCount += 1;
    } else if (upload.phase === UPLOAD_PHASES.failed) {
      summary.failedCount += 1;
    }
  });

  summary.progress = summary.totalBytes
    ? summary.uploadedBytes / summary.totalBytes
    : summary.totalFiles && summary.completedCount === summary.totalFiles
    ? 1
    : 0;
  return summary;
}
