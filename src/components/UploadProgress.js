import React from "react";
import { IonIcon } from "@ionic/react";
import {
  checkmarkCircleOutline,
  cloudUploadOutline,
} from "ionicons/icons/index.js";
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
  const isComplete = upload.phase === "complete";

  return (
    <section
      className="upload-progress-panel"
      aria-label={`Uploading ${upload.filename}`}
    >
      <div className="upload-progress-icon" aria-hidden="true">
        <IonIcon
          icon={isComplete ? checkmarkCircleOutline : cloudUploadOutline}
        />
      </div>

      <div className="upload-progress-content">
        <div className="upload-progress-heading">
          <div className="upload-progress-title">
            <span className="upload-progress-phase">
              {isPreparing
                ? "Preparing upload"
                : isFinalizing
                ? "Finishing upload"
                : isComplete
                ? "Upload complete"
                : "Uploading"}
            </span>
            <div className="upload-progress-name" title={upload.filename}>
              {upload.filename}
              {batchLabel && (
                <span className="upload-progress-batch">{batchLabel}</span>
              )}
            </div>
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
            <span>Encrypting and preparing chunks…</span>
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
    </section>
  );
}
