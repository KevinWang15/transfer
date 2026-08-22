import NProgress from "nprogress";
import {
  UPLOAD_OPERATIONS,
  UPLOAD_PROTOCOL_VERSION,
} from "@transfer/api/consts/uploadProtocol.js";

import { encrypt } from "../utils/encryption.js";
import {
  decodeUploadedChunkBitmap,
  decodeUploadResponse,
  encodeUploadRequest,
} from "../utils/uploadProtocol.js";

const API_BASE =
  window.location.origin === "http://localhost:3000"
    ? "http://localhost:6611/"
    : window.origin + "/";
const WEBSOCKET_BASE =
  window.location.origin === "http://localhost:3000"
    ? "http://localhost:6611/"
    : window.origin + `/`;

const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;
const MIN_CHUNK_SIZE = 64 * 1024;
const DEFAULT_CONCURRENCY = 3;
const MAX_CHUNK_RETRIES = 5;
const RESUME_STORAGE_PREFIX = "transfer.upload.v2.";
let serverConfigPromise;

class ApiError extends Error {
  constructor(message, { status = 0, code, details } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function apiFetch(path, options) {
  return window.fetch(`${API_BASE}${path}`, options);
}

async function responseJson(response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(result.error || `Request failed (${response.status})`, {
      status: response.status,
      code: result.code,
      details: result.details,
    });
  }
  return result;
}

function uploadApiError(error, fallbackStatus = 0) {
  return new ApiError(error?.message || "Encrypted upload request failed", {
    status: error?.status || fallbackStatus,
    code: error?.code,
    details: error?.details,
  });
}

async function encryptedUploadResponse(encryptedData, fallbackStatus = 0) {
  let response;
  try {
    response = await decodeUploadResponse(encryptedData);
  } catch (error) {
    throw new ApiError("Encrypted upload response could not be verified", {
      status: fallbackStatus,
      code: "INVALID_UPLOAD_RESPONSE",
    });
  }

  if (!response.ok) {
    throw uploadApiError(response.error, fallbackStatus);
  }
  return response.result;
}

async function encryptedPost(path, value) {
  const encrypted = await encrypt(value);
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: encrypted,
  });
  return responseJson(response);
}

function createUploadId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function resumeStorageKey(file, sessionId, name) {
  const descriptor = JSON.stringify([
    sessionId,
    name,
    file.size,
    file.lastModified || 0,
  ]);
  let hash = 2166136261;
  for (let index = 0; index < descriptor.length; index += 1) {
    hash ^= descriptor.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${RESUME_STORAGE_PREFIX}${(hash >>> 0).toString(16)}`;
}

function loadResumeRecord(key) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    return null;
  }
}

function saveResumeRecord(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Uploading can still proceed when browser storage is disabled.
  }
}

function clearResumeRecord(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    // Nothing else is required when browser storage is disabled.
  }
}

function chunkSizeAt(fileSize, chunkSize, chunkIndex) {
  return Math.min(chunkSize, fileSize - chunkIndex * chunkSize);
}

function paddedChunkSize(fileSize, configuredChunkSize) {
  const maximum = Math.max(MIN_CHUNK_SIZE, configuredChunkSize);
  if (fileSize >= maximum) {
    return maximum;
  }

  let size = MIN_CHUNK_SIZE;
  while (size < fileSize && size < maximum) {
    size *= 2;
  }
  return Math.min(size, maximum);
}

function uploadOpaqueBody(encrypted, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${API_BASE}u`);
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.responseType = "arraybuffer";
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded / event.total);
      }
    };
    request.onerror = () =>
      reject(new ApiError("Network error while uploading chunk"));
    request.onabort = () => reject(new ApiError("Chunk upload was cancelled"));
    request.onload = async () => {
      try {
        resolve(
          await encryptedUploadResponse(request.response, request.status)
        );
      } catch (error) {
        reject(error);
      }
    };
    request.send(encrypted);
  });
}

async function createOpaqueUploadBody(header, payload, paddedPayloadBytes) {
  return encodeUploadRequest(header, payload, paddedPayloadBytes);
}

function shouldRetry(error) {
  return (
    !error.status ||
    error.status === 408 ||
    error.status === 409 ||
    error.status === 425 ||
    error.status === 429 ||
    error.status >= 500
  );
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function uploadWithRetry(createEncryptedBody, onProgress) {
  let lastError;
  for (let attempt = 0; attempt < MAX_CHUNK_RETRIES; attempt += 1) {
    try {
      onProgress(0);
      return await uploadOpaqueBody(await createEncryptedBody(), onProgress);
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error) || attempt === MAX_CHUNK_RETRIES - 1) {
        throw error;
      }
      const backoff = Math.min(8000, 500 * 2 ** attempt);
      await wait(backoff + Math.random() * 250);
    }
  }
  throw lastError;
}

function newResumeRecord(file, { name, sessionId, chunkSize }) {
  return {
    version: UPLOAD_PROTOCOL_VERSION,
    uploadId: createUploadId(),
    sessionId,
    filename: name,
    size: file.size,
    chunkSize,
    totalChunks: Math.ceil(file.size / chunkSize),
    timestamp: Date.now(),
    lastModified: file.lastModified || 0,
  };
}

function validResumeRecord(record, file, { name, sessionId }) {
  return (
    record &&
    record.version === UPLOAD_PROTOCOL_VERSION &&
    typeof record.uploadId === "string" &&
    record.sessionId === sessionId &&
    record.filename === name &&
    record.size === file.size &&
    Number.isSafeInteger(record.chunkSize) &&
    record.chunkSize >= 64 * 1024 &&
    record.totalChunks === Math.ceil(file.size / record.chunkSize) &&
    record.lastModified === (file.lastModified || 0)
  );
}

export default class ApiClient {
  static async loadSessionHistory(sessionId) {
    const response = await apiFetch(`sessions/${sessionId}/history`);
    return (await responseJson(response)).map((item) => ({
      ...item,
      data: JSON.parse(item.data),
    }));
  }

  static async getServerSideConfig() {
    if (!serverConfigPromise) {
      serverConfigPromise = apiFetch("serverside-config")
        .then(async (response) =>
          encryptedUploadResponse(await response.arrayBuffer(), response.status)
        )
        .catch((error) => {
          serverConfigPromise = null;
          throw error;
        });
    }
    return serverConfigPromise;
  }

  static async uploadAttachment(file, { name, sessionId }) {
    const serverConfig = await ApiClient.getServerSideConfig();
    const configuredChunkSize =
      serverConfig.uploads?.chunkSize || DEFAULT_CHUNK_SIZE;
    const selectedChunkSize = paddedChunkSize(file.size, configuredChunkSize);
    const concurrency = Math.max(
      1,
      Math.min(8, serverConfig.uploads?.concurrency || DEFAULT_CONCURRENCY)
    );
    const storageKey = resumeStorageKey(file, sessionId, name);
    let record = loadResumeRecord(storageKey);
    if (!validResumeRecord(record, file, { name, sessionId })) {
      record = newResumeRecord(file, {
        name,
        sessionId,
        chunkSize: selectedChunkSize,
      });
      saveResumeRecord(storageKey, record);
    }

    NProgress.start();
    try {
      let initialized;
      try {
        initialized = await uploadWithRetry(
          () =>
            createOpaqueUploadBody(
              { ...record, operation: UPLOAD_OPERATIONS.initialize },
              null,
              record.chunkSize
            ),
          () => {}
        );
      } catch (error) {
        if (
          error.code !== "UPLOAD_METADATA_CONFLICT" &&
          error.code !== "INVALID_CHUNK_SIZE"
        ) {
          throw error;
        }
        record = newResumeRecord(file, {
          name,
          sessionId,
          chunkSize: selectedChunkSize,
        });
        saveResumeRecord(storageKey, record);
        initialized = await uploadWithRetry(
          () =>
            createOpaqueUploadBody(
              { ...record, operation: UPLOAD_OPERATIONS.initialize },
              null,
              record.chunkSize
            ),
          () => {}
        );
      }

      if (initialized.completed) {
        clearResumeRecord(storageKey);
        return initialized;
      }

      const uploaded = decodeUploadedChunkBitmap(
        initialized.uploaded,
        record.totalChunks
      );
      const pending = [];
      let completedBytes = 0;
      for (let index = 0; index < record.totalChunks; index += 1) {
        if (uploaded.has(index)) {
          completedBytes += chunkSizeAt(file.size, record.chunkSize, index);
        } else {
          pending.push(index);
        }
      }

      const partialBytes = new Map();
      const updateProgress = () => {
        const inFlightBytes = Array.from(partialBytes.values()).reduce(
          (total, value) => total + value,
          0
        );
        const progress = file.size
          ? (completedBytes + inFlightBytes) / file.size
          : 1;
        NProgress.set(Math.min(0.99, progress));
      };
      updateProgress();

      let nextPending = 0;
      let uploadStopped = false;
      const worker = async () => {
        try {
          while (!uploadStopped && nextPending < pending.length) {
            const pendingIndex = nextPending;
            nextPending += 1;
            const chunkIndex = pending[pendingIndex];
            const start = chunkIndex * record.chunkSize;
            const end = Math.min(file.size, start + record.chunkSize);
            const plaintextBytes = end - start;
            const plaintext = await file.slice(start, end).arrayBuffer();
            await uploadWithRetry(
              () =>
                createOpaqueUploadBody(
                  {
                    version: UPLOAD_PROTOCOL_VERSION,
                    operation: UPLOAD_OPERATIONS.chunk,
                    uploadId: record.uploadId,
                    chunkIndex,
                  },
                  plaintext,
                  record.chunkSize
                ),
              (fraction) => {
                partialBytes.set(chunkIndex, plaintextBytes * fraction);
                updateProgress();
              }
            );
            partialBytes.delete(chunkIndex);
            completedBytes += plaintextBytes;
            updateProgress();
          }
        } catch (error) {
          uploadStopped = true;
          throw error;
        }
      };

      const workerResults = await Promise.allSettled(
        Array.from({ length: Math.min(concurrency, pending.length) }, () =>
          worker()
        )
      );
      const failedWorker = workerResults.find(
        (result) => result.status === "rejected"
      );
      if (failedWorker) {
        throw failedWorker.reason;
      }

      const result = await uploadWithRetry(
        () =>
          createOpaqueUploadBody(
            {
              version: UPLOAD_PROTOCOL_VERSION,
              operation: UPLOAD_OPERATIONS.finalize,
              uploadId: record.uploadId,
              sessionId,
            },
            null,
            record.chunkSize
          ),
        () => {}
      );
      clearResumeRecord(storageKey);
      return result;
    } finally {
      NProgress.done();
    }
  }

  static async deleteEverythingInSession(id) {
    const response = await apiFetch(`sessions/${id}/clear_messages`);
    return responseJson(response);
  }

  static async sendText(text, { sessionId }) {
    return encryptedPost("t", {
      text,
      sessionId,
      timestamp: Date.now(),
    });
  }
}

export { API_BASE, WEBSOCKET_BASE };
