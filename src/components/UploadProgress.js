import React from "react";
import { formatBytes, formatDuration } from "../utils/uploadProgress.js";
import "./UploadProgress.scss";

export default function UploadProgress({ upload }) {
  if (!upload) {
    return null;
  }

  const percent = Math.min(100, Math.max(0, upload.progress * 100));
  const batchLabel =
    upload.totalFiles > 1
      ? `File ${upload.fileIndex} of ${upload.totalFiles}`
      : null;
  const isPreparing = upload.phase === "preparing";
  const isFinalizing = upload.phase === "finalizing";

  return (
    <section
      className="upload-progress-panel"
      aria-label={`Uploading ${upload.filename}`}
      aria-live="polite"
    >
      <div className="upload-progress-heading">
        <div className="upload-progress-name" title={upload.filename}>
          {upload.filename}
          {batchLabel && (
            <span className="upload-progress-batch">{batchLabel}</span>
          )}
        </div>
        <div className="upload-progress-percent">{percent.toFixed(1)}%</div>
      </div>

      <div
        className="upload-progress-track"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Number(percent.toFixed(1))}
      >
        <div
          className="upload-progress-fill"
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="upload-progress-details">
        {isPreparing ? (
          <span>Preparing encrypted upload…</span>
        ) : (
          <>
            <span>
              <strong>Uploaded</strong> {formatBytes(upload.uploadedBytes)} /{" "}
              {formatBytes(upload.totalBytes)}
            </span>
            {isFinalizing ? (
              <span>Finalizing encrypted upload…</span>
            ) : (
              <>
                <span>
                  <strong>Speed</strong>{" "}
                  {upload.speedBytesPerSecond > 0
                    ? `${formatBytes(upload.speedBytesPerSecond)}/s`
                    : "Calculating…"}
                </span>
                <span>
                  <strong>ETA</strong>{" "}
                  {upload.etaSeconds === null
                    ? "—"
                    : formatDuration(upload.etaSeconds)}
                </span>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
