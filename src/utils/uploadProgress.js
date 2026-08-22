const DEFAULT_EMIT_INTERVAL_MS = 100;
const DEFAULT_SAMPLE_INTERVAL_MS = 200;
const DEFAULT_SAMPLE_WINDOW_MS = 5000;

function defaultNow() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export class UploadProgressTracker {
  constructor(
    totalBytes,
    onProgress = () => {},
    {
      now = defaultNow,
      emitIntervalMs = DEFAULT_EMIT_INTERVAL_MS,
      sampleIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS,
      sampleWindowMs = DEFAULT_SAMPLE_WINDOW_MS,
    } = {}
  ) {
    this.totalBytes = Math.max(0, Number(totalBytes) || 0);
    this.onProgress = onProgress;
    this.now = now;
    this.emitIntervalMs = emitIntervalMs;
    this.sampleIntervalMs = sampleIntervalMs;
    this.sampleWindowMs = sampleWindowMs;
    this.phase = "preparing";
    this.uploadedBytes = 0;
    this.confirmedBytes = 0;
    this.transmittedBytes = 0;
    this.speedBytesPerSecond = 0;
    this.samples = [];
    this.lastEmitTime = Number.NEGATIVE_INFINITY;
  }

  preparing() {
    this.phase = "preparing";
    this.emit(true);
  }

  start(confirmedBytes = 0) {
    const now = this.now();
    this.phase = "uploading";
    this.confirmedBytes = clamp(confirmedBytes, 0, this.totalBytes);
    this.uploadedBytes = Math.max(this.uploadedBytes, this.confirmedBytes);
    this.samples = [{ time: now, bytes: this.transmittedBytes }];
    this.speedBytesPerSecond = 0;
    this.emit(true, now);
  }

  update(confirmedBytes, inFlightBytes, transmittedBytes) {
    const now = this.now();
    this.phase = "uploading";
    this.confirmedBytes = clamp(confirmedBytes, 0, this.totalBytes);
    this.transmittedBytes = Math.max(
      this.transmittedBytes,
      Number(transmittedBytes) || 0
    );

    const logicalUploaded = clamp(
      this.confirmedBytes + Math.max(0, Number(inFlightBytes) || 0),
      0,
      this.totalBytes
    );
    this.uploadedBytes = Math.max(this.uploadedBytes, logicalUploaded);
    this.recordSpeedSample(now);
    this.emit(false, now);
  }

  finalizing() {
    this.phase = "finalizing";
    this.confirmedBytes = this.totalBytes;
    this.uploadedBytes = this.totalBytes;
    this.emit(true);
  }

  complete() {
    this.phase = "complete";
    this.confirmedBytes = this.totalBytes;
    this.uploadedBytes = this.totalBytes;
    this.emit(true);
  }

  failed() {
    this.phase = "failed";
    this.emit(true);
  }

  recordSpeedSample(now) {
    const lastSample = this.samples[this.samples.length - 1];
    if (!lastSample || now - lastSample.time >= this.sampleIntervalMs) {
      this.samples.push({ time: now, bytes: this.transmittedBytes });
    }

    while (
      this.samples.length > 2 &&
      this.samples[1].time < now - this.sampleWindowMs
    ) {
      this.samples.shift();
    }

    if (this.samples.length < 2) {
      this.speedBytesPerSecond = 0;
      return;
    }

    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const elapsedSeconds = (last.time - first.time) / 1000;
    this.speedBytesPerSecond =
      elapsedSeconds > 0
        ? Math.max(0, (last.bytes - first.bytes) / elapsedSeconds)
        : 0;
  }

  emit(force, now = this.now()) {
    if (!force && now - this.lastEmitTime < this.emitIntervalMs) {
      return;
    }

    this.lastEmitTime = now;
    const uploading = this.phase === "uploading";
    const rawProgress = this.totalBytes
      ? this.uploadedBytes / this.totalBytes
      : 1;
    const progress = uploading ? Math.min(0.999, rawProgress) : rawProgress;
    const remainingBytes = Math.max(0, this.totalBytes - this.uploadedBytes);
    const etaSeconds =
      uploading && this.speedBytesPerSecond > 0
        ? remainingBytes / this.speedBytesPerSecond
        : null;

    try {
      this.onProgress({
        phase: this.phase,
        uploadedBytes: this.uploadedBytes,
        confirmedBytes: this.confirmedBytes,
        totalBytes: this.totalBytes,
        progress: clamp(progress, 0, 1),
        speedBytesPerSecond: this.speedBytesPerSecond,
        etaSeconds:
          etaSeconds === null || !Number.isFinite(etaSeconds)
            ? null
            : etaSeconds,
      });
    } catch (error) {
      // A rendering callback must never interrupt an upload.
    }
  }
}

export function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) {
    return `${Math.round(value)} B`;
  }

  const units = ["KiB", "MiB", "GiB", "TiB"];
  const exponent = Math.min(
    units.length,
    Math.floor(Math.log(value) / Math.log(1024))
  );
  const scaled = value / 1024 ** exponent;
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toFixed(digits)} ${units[exponent - 1]}`;
}

export function formatDuration(seconds) {
  const totalSeconds = Math.max(0, Math.ceil(Number(seconds) || 0));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  if (hours) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
}
