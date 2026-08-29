import React from "react";
import { IonIcon } from "@ionic/react";
import {
  alertCircleOutline,
  checkmarkCircleOutline,
  closeOutline,
  cloudUploadOutline,
  documentOutline,
  refreshOutline,
  timeOutline,
} from "ionicons/icons/index.js";
import { formatBytes, formatDuration } from "../utils/uploadProgress.js";
import {
  isActiveUpload,
  summarizeUploadQueue,
  UPLOAD_PHASES,
} from "../utils/uploadQueue.js";
import "./UploadProgress.scss";

const phaseLabels = {
  [UPLOAD_PHASES.queued]: "Waiting",
  [UPLOAD_PHASES.preparing]: "Preparing",
  [UPLOAD_PHASES.uploading]: "Uploading",
  [UPLOAD_PHASES.finalizing]: "Verifying",
  [UPLOAD_PHASES.complete]: "Uploaded",
  [UPLOAD_PHASES.failed]: "Failed",
};

function uploadIcon(upload) {
  if (upload.phase === UPLOAD_PHASES.complete) {
    return checkmarkCircleOutline;
  }
  if (upload.phase === UPLOAD_PHASES.failed) {
    return alertCircleOutline;
  }
  if (upload.phase === UPLOAD_PHASES.queued) {
    return timeOutline;
  }
  return documentOutline;
}

function CurrentUpload({ upload, position, totalFiles }) {
  const percent = Math.min(100, Math.max(0, upload.progress * 100));
  const isPreparing = upload.phase === UPLOAD_PHASES.preparing;
  const isFinalizing = upload.phase === UPLOAD_PHASES.finalizing;
  const isQueued = upload.phase === UPLOAD_PHASES.queued;

  return (
    <div className="upload-current">
      <div className="upload-current-heading">
        <div>
          <span className="upload-current-phase">
            {isQueued
              ? "Next upload"
              : isPreparing
              ? "Encrypting and preparing"
              : isFinalizing
              ? "Finalizing upload"
              : `File ${position} of ${totalFiles}`}
          </span>
          <strong title={upload.filename}>{upload.filename}</strong>
        </div>
        <span>{percent.toFixed(1)}%</span>
      </div>

      <div
        className="upload-current-track"
        role="progressbar"
        aria-label={`${upload.filename} upload progress`}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Number(percent.toFixed(1))}
      >
        <span style={{ width: `${percent}%` }} />
      </div>

      <div className="upload-current-details">
        {isPreparing ? (
          <span>Encrypting and preparing chunks…</span>
        ) : isQueued ? (
          <span>Waiting for the previous file to finish…</span>
        ) : (
          <>
            <span>
              {formatBytes(upload.uploadedBytes)} of{" "}
              {formatBytes(upload.totalBytes)}
            </span>
            {isFinalizing ? (
              <span>Verifying transfer…</span>
            ) : (
              <>
                <span>
                  {upload.speedBytesPerSecond > 0
                    ? `${formatBytes(upload.speedBytesPerSecond)}/s`
                    : "Calculating speed…"}
                </span>
                <span>
                  ETA{" "}
                  {upload.etaSeconds === null
                    ? "—"
                    : formatDuration(upload.etaSeconds)}
                </span>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function QueueItem({ upload, onRemove, onRetry }) {
  return (
    <li className={`upload-queue-item phase-${upload.phase}`}>
      <span className="upload-queue-item-icon" aria-hidden="true">
        <IonIcon icon={uploadIcon(upload)} />
      </span>
      <span className="upload-queue-item-copy">
        <strong title={upload.filename}>{upload.filename}</strong>
        <span>
          {formatBytes(upload.totalBytes)} · {phaseLabels[upload.phase]}
        </span>
      </span>
      {upload.phase === UPLOAD_PHASES.queued && (
        <button
          type="button"
          onClick={() => onRemove(upload.id)}
          aria-label={`Remove ${upload.filename} from upload queue`}
          title="Remove from queue"
        >
          <IonIcon icon={closeOutline} />
        </button>
      )}
      {upload.phase === UPLOAD_PHASES.failed && (
        <button
          type="button"
          className="upload-retry"
          onClick={() => onRetry(upload.id)}
          aria-label={`Retry uploading ${upload.filename}`}
          title={upload.error || "Retry upload"}
        >
          <IonIcon icon={refreshOutline} />
          Retry
        </button>
      )}
    </li>
  );
}

export default function UploadProgress({
  uploads,
  onDismiss,
  onRemove,
  onRetry,
}) {
  if (!uploads?.length) {
    return null;
  }

  const summary = summarizeUploadQueue(uploads);
  const activeUpload =
    uploads.find(isActiveUpload) ||
    uploads.find((upload) => upload.phase === UPLOAD_PHASES.queued);
  const activePosition = activeUpload
    ? uploads.findIndex((upload) => upload.id === activeUpload.id) + 1
    : 0;
  const queueItems = activeUpload
    ? uploads.filter((upload) => upload.id !== activeUpload.id)
    : uploads;
  const isBusy = Boolean(summary.activeCount || summary.queuedCount);
  const overallPercent = Math.min(100, Math.max(0, summary.progress * 100));
  const headline = isBusy
    ? summary.totalFiles === 1
      ? "Upload in progress"
      : `${summary.totalFiles} files in this upload`
    : summary.failedCount
    ? "Some uploads failed"
    : "Uploads complete";
  const statusText = isBusy
    ? `${summary.completedCount} complete · ${summary.queuedCount} waiting${
        summary.failedCount ? ` · ${summary.failedCount} failed` : ""
      }`
    : summary.failedCount
    ? `${summary.completedCount} uploaded · ${summary.failedCount} failed`
    : `${summary.completedCount} of ${summary.totalFiles} uploaded`;

  return (
    <section className="upload-progress-panel" aria-label="Upload queue">
      <div className="upload-progress-header">
        <span
          className={`upload-progress-icon ${
            summary.failedCount ? "has-failure" : ""
          }`}
          aria-hidden="true"
        >
          <IonIcon
            icon={
              summary.failedCount
                ? alertCircleOutline
                : isBusy
                ? cloudUploadOutline
                : checkmarkCircleOutline
            }
          />
        </span>
        <span className="upload-progress-heading">
          <span>Upload queue</span>
          <strong>{headline}</strong>
          <small>{statusText}</small>
        </span>
        <span className="upload-progress-overall">
          <strong>{overallPercent.toFixed(0)}%</strong>
          {!isBusy && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss upload queue"
            >
              <IonIcon icon={closeOutline} />
            </button>
          )}
        </span>
      </div>

      <div
        className="upload-overall-track"
        role="progressbar"
        aria-label="Overall upload progress"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Number(overallPercent.toFixed(0))}
      >
        <span style={{ width: `${overallPercent}%` }} />
      </div>
      <div className="upload-overall-bytes">
        <span>{formatBytes(summary.uploadedBytes)} transferred</span>
        <span>{formatBytes(summary.totalBytes)} total</span>
      </div>

      {activeUpload && (
        <CurrentUpload
          upload={activeUpload}
          position={activePosition}
          totalFiles={summary.totalFiles}
        />
      )}

      {queueItems.length > 0 && (
        <ul className="upload-queue-list" aria-label="Files in upload queue">
          {queueItems.map((upload) => (
            <QueueItem
              upload={upload}
              key={upload.id}
              onRemove={onRemove}
              onRetry={onRetry}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
