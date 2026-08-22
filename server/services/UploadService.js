import crypto from "crypto";
import fs from "fs";
import path from "path";
import { Transform } from "stream";
import { pipeline } from "stream/promises";
import * as uuid from "uuid";

import config from "../config.js";
import Message from "../models/message.js";
import { decryptBytes } from "../utils/decryption.js";
import MessageService, { listMessagesBySessionId } from "./MessageService.js";

const uploadRoot = path.resolve("data/upload-chunks");
const fileRoot = path.resolve("data/file-uploads");
const STAGING_PREFIX = ".upload-staging-";
const PROTOCOL_VERSION = 1;
const MAX_CHUNKS = 100000;
const activeUploads = new Map();
const initializations = new Map();
const finalizations = new Map();

class UploadError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "UploadError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

class Semaphore {
  constructor(limit) {
    this.limit = Math.max(1, limit);
    this.active = 0;
    this.waiters = [];
  }

  async run(operation) {
    if (this.active >= this.limit) {
      await new Promise((resolve) => this.waiters.push(resolve));
    }

    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}

const decryptions = new Semaphore(config.uploads.decryptionConcurrency);

await ensureUploadDirectories();

async function ensureUploadDirectories() {
  await Promise.all([
    fs.promises.mkdir(uploadRoot, { recursive: true }),
    fs.promises.mkdir(fileRoot, { recursive: true }),
  ]);
}

function uploadDirectory(uploadId) {
  assertUploadId(uploadId);
  return path.join(uploadRoot, uploadId);
}

function manifestPath(uploadId) {
  return path.join(uploadDirectory(uploadId), "manifest.json");
}

function partPath(uploadId, chunkIndex) {
  return path.join(uploadDirectory(uploadId), `${chunkIndex}.part`);
}

function chunkAdditionalData(uploadId, chunkIndex) {
  return `transfer-upload-v${PROTOCOL_VERSION}:${uploadId}:${chunkIndex}`;
}

function assertUploadId(uploadId) {
  if (!uuid.validate(uploadId)) {
    throw new UploadError(400, "INVALID_UPLOAD_ID", "Invalid upload ID");
  }
}

function validateManifest(metadata) {
  if (!metadata || metadata.version !== PROTOCOL_VERSION) {
    throw new UploadError(
      400,
      "UNSUPPORTED_UPLOAD_VERSION",
      "Unsupported upload protocol version"
    );
  }

  assertUploadId(metadata.uploadId);

  if (
    typeof metadata.sessionId !== "string" ||
    metadata.sessionId.length === 0 ||
    metadata.sessionId.length > 2048
  ) {
    throw new UploadError(400, "INVALID_SESSION", "Invalid session ID");
  }

  if (
    typeof metadata.filename !== "string" ||
    metadata.filename.length === 0 ||
    metadata.filename.length > 1024
  ) {
    throw new UploadError(400, "INVALID_FILENAME", "Invalid filename");
  }

  if (!Number.isSafeInteger(metadata.size) || metadata.size < 0) {
    throw new UploadError(400, "INVALID_FILE_SIZE", "Invalid file size");
  }

  const maxChunkSize = Math.max(
    config.uploads.chunkSize,
    config.uploads.maxChunkSize
  );
  if (
    !Number.isSafeInteger(metadata.chunkSize) ||
    metadata.chunkSize < 64 * 1024 ||
    metadata.chunkSize > maxChunkSize
  ) {
    throw new UploadError(400, "INVALID_CHUNK_SIZE", "Invalid chunk size");
  }

  const expectedChunks = Math.ceil(metadata.size / metadata.chunkSize);
  if (
    !Number.isSafeInteger(metadata.totalChunks) ||
    metadata.totalChunks !== expectedChunks ||
    metadata.totalChunks > MAX_CHUNKS
  ) {
    throw new UploadError(400, "INVALID_CHUNK_COUNT", "Invalid chunk count");
  }

  if (!Number.isFinite(metadata.timestamp)) {
    throw new UploadError(400, "INVALID_TIMESTAMP", "Invalid upload timestamp");
  }
}

function comparableManifest(metadata) {
  return {
    version: metadata.version,
    uploadId: metadata.uploadId,
    sessionId: metadata.sessionId,
    filename: metadata.filename,
    size: metadata.size,
    chunkSize: metadata.chunkSize,
    totalChunks: metadata.totalChunks,
    timestamp: metadata.timestamp,
    lastModified: metadata.lastModified || 0,
  };
}

function manifestsMatch(existing, requested) {
  return (
    JSON.stringify(comparableManifest(existing)) ===
    JSON.stringify(comparableManifest(requested))
  );
}

async function writeJsonAtomic(destination, value) {
  const temporary = `${destination}.${uuid.v4()}.tmp`;
  try {
    await fs.promises.writeFile(temporary, JSON.stringify(value), {
      encoding: "utf8",
      flag: "wx",
    });
    await fs.promises.rename(temporary, destination);
  } finally {
    await fs.promises.unlink(temporary).catch(() => {});
  }
}

async function readManifest(uploadId) {
  try {
    return JSON.parse(
      await fs.promises.readFile(manifestPath(uploadId), "utf8")
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new UploadError(404, "UPLOAD_NOT_FOUND", "Upload was not found");
    }
    throw error;
  }
}

async function touchUpload(uploadId) {
  const now = new Date();
  await fs.promises.utimes(uploadDirectory(uploadId), now, now);
}

async function withActiveUpload(uploadId, operation) {
  activeUploads.set(uploadId, (activeUploads.get(uploadId) || 0) + 1);
  try {
    return await operation();
  } finally {
    const remaining = (activeUploads.get(uploadId) || 1) - 1;
    if (remaining > 0) {
      activeUploads.set(uploadId, remaining);
    } else {
      activeUploads.delete(uploadId);
    }
  }
}

function expectedChunkSize(manifest, chunkIndex) {
  const start = chunkIndex * manifest.chunkSize;
  return Math.min(manifest.chunkSize, manifest.size - start);
}

async function listUploadedChunks(uploadId, manifest) {
  const entries = await fs.promises.readdir(uploadDirectory(uploadId), {
    withFileTypes: true,
  });
  const uploaded = [];

  for (const entry of entries) {
    const match = /^(\d+)\.part$/.exec(entry.name);
    if (!entry.isFile() || !match) {
      continue;
    }

    const chunkIndex = Number(match[1]);
    if (chunkIndex < 0 || chunkIndex >= manifest.totalChunks) {
      continue;
    }

    const stat = await fs.promises.stat(partPath(uploadId, chunkIndex));
    if (stat.size === expectedChunkSize(manifest, chunkIndex)) {
      uploaded.push(chunkIndex);
    }
  }

  return uploaded.sort((left, right) => left - right);
}

async function performInitialization(metadata) {
  const normalized = { ...comparableManifest(metadata), status: "uploading" };
  const directory = uploadDirectory(metadata.uploadId);

  return withActiveUpload(metadata.uploadId, async () => {
    let created = false;
    try {
      await fs.promises.mkdir(directory);
      created = true;
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }

    if (created) {
      try {
        await writeJsonAtomic(manifestPath(metadata.uploadId), normalized);
      } catch (error) {
        await fs.promises.rm(directory, { recursive: true, force: true });
        throw error;
      }
    }

    let existing;
    try {
      existing = await readManifest(metadata.uploadId);
    } catch (error) {
      if (!created && error.code === "UPLOAD_NOT_FOUND") {
        await fs.promises.rm(directory, { recursive: true, force: true });
        await fs.promises.mkdir(directory);
        await writeJsonAtomic(manifestPath(metadata.uploadId), normalized);
        existing = normalized;
      } else {
        throw error;
      }
    }

    if (!manifestsMatch(existing, normalized)) {
      throw new UploadError(
        409,
        "UPLOAD_METADATA_CONFLICT",
        "Upload ID is already associated with another file"
      );
    }

    await touchUpload(metadata.uploadId);
    if (existing.status === "completed") {
      return { success: true, completed: true, ...existing.result };
    }

    return {
      success: true,
      completed: false,
      uploadId: metadata.uploadId,
      uploadedChunks: await listUploadedChunks(metadata.uploadId, existing),
    };
  });
}

async function initializeUpload(metadata) {
  validateManifest(metadata);
  const uploadId = metadata.uploadId;
  if (initializations.has(uploadId)) {
    await initializations.get(uploadId);
    return performInitialization(metadata);
  }

  const initialization = performInitialization(metadata).finally(() =>
    initializations.delete(uploadId)
  );
  initializations.set(uploadId, initialization);
  return initialization;
}

function byteLimitTransform(expectedBytes) {
  let received = 0;
  return new Transform({
    transform(chunk, encoding, callback) {
      received += chunk.length;
      if (received > expectedBytes) {
        callback(
          new UploadError(
            413,
            "CHUNK_TOO_LARGE",
            "Encrypted chunk is too large"
          )
        );
        return;
      }
      callback(null, chunk);
    },
    flush(callback) {
      if (received !== expectedBytes) {
        callback(
          new UploadError(
            400,
            "INVALID_ENCRYPTED_CHUNK_SIZE",
            "Encrypted chunk has an unexpected size"
          )
        );
        return;
      }
      callback();
    },
  });
}

async function receiveRequestToFile(request, destination, expectedBytes) {
  const contentLength = Number(request.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength !== expectedBytes) {
    request.resume();
    throw new UploadError(
      400,
      "INVALID_ENCRYPTED_CHUNK_SIZE",
      "Encrypted chunk has an unexpected size"
    );
  }

  await pipeline(
    request,
    byteLimitTransform(expectedBytes),
    fs.createWriteStream(destination, { flags: "wx" })
  );
}

async function storeChunk(uploadId, chunkIndex, request) {
  assertUploadId(uploadId);
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0) {
    throw new UploadError(400, "INVALID_CHUNK_INDEX", "Invalid chunk index");
  }

  return withActiveUpload(uploadId, async () => {
    const manifest = await readManifest(uploadId);
    if (manifest.status === "completed") {
      request.resume();
      return { success: true, completed: true, chunkIndex };
    }
    if (chunkIndex >= manifest.totalChunks) {
      request.resume();
      throw new UploadError(400, "INVALID_CHUNK_INDEX", "Invalid chunk index");
    }

    const expectedPlaintextBytes = expectedChunkSize(manifest, chunkIndex);
    const destination = partPath(uploadId, chunkIndex);
    try {
      const stat = await fs.promises.stat(destination);
      if (stat.size === expectedPlaintextBytes) {
        request.resume();
        await touchUpload(uploadId);
        return { success: true, chunkIndex, alreadyUploaded: true };
      }
      await fs.promises.unlink(destination);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    const token = uuid.v4();
    const incoming = path.join(uploadDirectory(uploadId), `.incoming-${token}`);
    const decryptedTemporary = path.join(
      uploadDirectory(uploadId),
      `.decrypted-${token}`
    );

    try {
      await receiveRequestToFile(
        request,
        incoming,
        expectedPlaintextBytes + 32
      );
      await decryptions.run(async () => {
        const encrypted = await fs.promises.readFile(incoming);
        let decrypted;
        try {
          decrypted = await decryptBytes(encrypted, {
            additionalData: chunkAdditionalData(uploadId, chunkIndex),
          });
        } catch (error) {
          throw new UploadError(
            400,
            "CHUNK_DECRYPTION_FAILED",
            "Chunk authentication or decryption failed"
          );
        }

        if (decrypted.length !== expectedPlaintextBytes) {
          throw new UploadError(
            400,
            "INVALID_CHUNK_SIZE",
            "Decrypted chunk has an unexpected size"
          );
        }

        await fs.promises.writeFile(decryptedTemporary, decrypted, {
          flag: "wx",
        });
      });
      try {
        await fs.promises.link(decryptedTemporary, destination);
      } catch (error) {
        if (error.code !== "EEXIST") {
          throw error;
        }
      }
      await touchUpload(uploadId);
      return { success: true, chunkIndex };
    } finally {
      await Promise.all([
        fs.promises.unlink(incoming).catch(() => {}),
        fs.promises.unlink(decryptedTemporary).catch(() => {}),
      ]);
    }
  });
}

async function* streamParts(uploadId, manifest) {
  for (let index = 0; index < manifest.totalChunks; index += 1) {
    for await (const chunk of fs.createReadStream(partPath(uploadId, index))) {
      yield chunk;
    }
  }
}

async function removeTemporaryParts(uploadId) {
  const directory = uploadDirectory(uploadId);
  const entries = await fs.promises.readdir(directory);
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.endsWith(".part") ||
          entry.startsWith(".incoming-") ||
          entry.startsWith(".decrypted-")
      )
      .map((entry) =>
        fs.promises.unlink(path.join(directory, entry)).catch(() => {})
      )
  );
}

async function findCompletedMessage(manifest) {
  const messages = await listMessagesBySessionId(manifest.sessionId);
  for (const message of messages) {
    const data = JSON.parse(message.data);
    if (data.type === "file" && data.upload_id === manifest.uploadId) {
      try {
        const stat = await fs.promises.stat(
          path.join(fileRoot, data.access_key)
        );
        if (stat.size === manifest.size) {
          return {
            accessKey: data.access_key,
            messageId: message.id,
          };
        }
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    }
  }
  return null;
}

async function recordCompletedUpload(uploadId, manifest, result) {
  await writeJsonAtomic(manifestPath(uploadId), {
    ...manifest,
    status: "completed",
    completedAt: Date.now(),
    result,
  });
  await removeTemporaryParts(uploadId);
  await touchUpload(uploadId);
}

async function performFinalization(uploadId, payload, { io }) {
  return withActiveUpload(uploadId, async () => {
    const manifest = await readManifest(uploadId);
    if (manifest.status === "completed") {
      return { success: true, completed: true, ...manifest.result };
    }

    if (
      !payload ||
      payload.version !== PROTOCOL_VERSION ||
      payload.uploadId !== uploadId ||
      payload.sessionId !== manifest.sessionId
    ) {
      throw new UploadError(
        400,
        "INVALID_FINALIZATION",
        "Finalization metadata does not match the upload"
      );
    }

    const previouslyCompleted = await findCompletedMessage(manifest);
    if (previouslyCompleted) {
      await recordCompletedUpload(uploadId, manifest, previouslyCompleted);
      return { success: true, completed: true, ...previouslyCompleted };
    }

    const uploadedChunks = await listUploadedChunks(uploadId, manifest);
    if (uploadedChunks.length !== manifest.totalChunks) {
      throw new UploadError(409, "MISSING_CHUNKS", "Upload is not complete", {
        uploadedChunks,
      });
    }

    const accessKey = uploadId;
    const staging = path.join(
      fileRoot,
      `${STAGING_PREFIX}${uploadId}-${accessKey}`
    );
    const published = path.join(fileRoot, accessKey);
    let filePublished = false;
    let messageSaved = false;

    try {
      let publishedExists = false;
      try {
        const existing = await fs.promises.stat(published);
        if (existing.size === manifest.size) {
          publishedExists = true;
          filePublished = true;
        } else {
          await fs.promises.unlink(published);
        }
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }

      if (!publishedExists) {
        await pipeline(
          streamParts(uploadId, manifest),
          fs.createWriteStream(staging, { flags: "wx" })
        );
        const stat = await fs.promises.stat(staging);
        if (stat.size !== manifest.size) {
          throw new UploadError(
            500,
            "FINAL_SIZE_MISMATCH",
            "Final file size does not match the upload manifest"
          );
        }

        await fs.promises.rename(staging, published);
        filePublished = true;
      }

      const message = new Message({
        session_id: manifest.sessionId,
        data: {
          type: "file",
          filename: manifest.filename,
          access_key: accessKey,
          upload_id: uploadId,
        },
        created_at: manifest.timestamp,
      });
      await MessageService.addMessage(message, {
        sessionId: manifest.sessionId,
        io,
      });
      messageSaved = true;

      const result = { accessKey, messageId: message.id };
      await recordCompletedUpload(uploadId, manifest, result);

      return { success: true, completed: true, ...result };
    } catch (error) {
      await fs.promises.unlink(staging).catch(() => {});
      if (filePublished && !messageSaved) {
        await fs.promises.unlink(published).catch(() => {});
      }
      throw error;
    }
  });
}

async function finalizeUpload(uploadId, payload, context) {
  assertUploadId(uploadId);
  if (finalizations.has(uploadId)) {
    return finalizations.get(uploadId);
  }

  const finalization = performFinalization(uploadId, payload, context).finally(
    () => finalizations.delete(uploadId)
  );
  finalizations.set(uploadId, finalization);
  return finalization;
}

async function cleanupStaleUploads(now = Date.now()) {
  await ensureUploadDirectories();
  const cutoff = now - config.uploads.staleTtl * 1000;
  const entries = await fs.promises.readdir(uploadRoot, {
    withFileTypes: true,
  });
  let removedUploads = 0;

  for (const entry of entries) {
    if (!entry.isDirectory() || activeUploads.has(entry.name)) {
      continue;
    }
    const directory = path.join(uploadRoot, entry.name);
    const stat = await fs.promises.stat(directory);
    if (stat.mtimeMs < cutoff) {
      try {
        const manifest = await readManifest(entry.name);
        if (
          manifest.status !== "completed" &&
          !(await findCompletedMessage(manifest))
        ) {
          await fs.promises
            .unlink(path.join(fileRoot, entry.name))
            .catch(() => {});
        }
      } catch (error) {
        if (!(error instanceof UploadError)) {
          console.error("failed to inspect stale upload", entry.name, error);
        }
      }
      await fs.promises.rm(directory, { recursive: true, force: true });
      removedUploads += 1;
    }
  }

  const files = await fs.promises.readdir(fileRoot, { withFileTypes: true });
  let removedStagingFiles = 0;
  for (const entry of files) {
    if (!entry.isFile() || !entry.name.startsWith(STAGING_PREFIX)) {
      continue;
    }
    const file = path.join(fileRoot, entry.name);
    const stat = await fs.promises.stat(file);
    const uploadId = entry.name.slice(
      STAGING_PREFIX.length,
      STAGING_PREFIX.length + 36
    );
    if (stat.mtimeMs < cutoff && !activeUploads.has(uploadId)) {
      await fs.promises.unlink(file);
      removedStagingFiles += 1;
    }
  }

  return { removedUploads, removedStagingFiles };
}

function startPeriodicUploadCleanup() {
  let cleaning = false;
  const runCleanup = async () => {
    if (cleaning) {
      return;
    }
    cleaning = true;
    try {
      await cleanupStaleUploads();
    } catch (error) {
      console.error("failed to clean stale uploads", error);
    } finally {
      cleaning = false;
    }
  };

  void runCleanup();
  const timer = setInterval(runCleanup, config.uploads.cleanupInterval * 1000);
  timer.unref();
  return timer;
}

export {
  PROTOCOL_VERSION,
  UploadError,
  chunkAdditionalData,
  cleanupStaleUploads,
  finalizeUpload,
  initializeUpload,
  startPeriodicUploadCleanup,
  storeChunk,
};
