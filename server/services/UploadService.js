import crypto from "crypto";
import fs from "fs";
import path from "path";
import { Transform } from "stream";
import { pipeline } from "stream/promises";
import * as uuid from "uuid";

import {
  UPLOAD_ENCRYPTION_OVERHEAD_BYTES,
  UPLOAD_ENVELOPE_HEADER_BYTES,
  UPLOAD_OPERATIONS,
  UPLOAD_PROTOCOL_VERSION,
  UPLOAD_REQUEST_ADDITIONAL_DATA,
} from "@transfer/api/consts/uploadProtocol.js";

import config from "../config.js";
import Message from "../models/message.js";
import { getRawDecryptionKey } from "../utils/decryption.js";
import MessageService, { listMessagesBySessionId } from "./MessageService.js";

const uploadRoot = path.resolve("data/upload-chunks");
const requestRoot = path.resolve("data/upload-requests");
const fileRoot = path.resolve("data/file-uploads");
const STAGING_PREFIX = ".upload-staging-";
const PROTOCOL_VERSION = UPLOAD_PROTOCOL_VERSION;
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
    fs.promises.mkdir(requestRoot, { recursive: true }),
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

function encodeUploadedChunkBitmap(uploadedChunks, totalChunks) {
  const bitmap = Buffer.alloc(Math.ceil(totalChunks / 8));
  for (const chunkIndex of uploadedChunks) {
    bitmap[chunkIndex >> 3] |= 1 << (chunkIndex & 7);
  }
  return bitmap.toString("base64");
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

    const uploadedChunks = await listUploadedChunks(
      metadata.uploadId,
      existing
    );
    return {
      success: true,
      completed: false,
      uploaded: encodeUploadedChunkBitmap(uploadedChunks, existing.totalChunks),
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

function byteLimitTransform(maximumBytes) {
  let received = 0;
  return new Transform({
    transform(chunk, encoding, callback) {
      received += chunk.length;
      if (received > maximumBytes) {
        callback(
          new UploadError(
            413,
            "OPAQUE_REQUEST_TOO_LARGE",
            "Encrypted request is too large"
          )
        );
        return;
      }
      callback(null, chunk);
    },
  });
}

async function receiveRequestToFile(request, destination, maximumBytes) {
  const contentLength = Number(request.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    request.resume();
    throw new UploadError(
      413,
      "OPAQUE_REQUEST_TOO_LARGE",
      "Encrypted request is too large"
    );
  }

  await pipeline(
    request,
    byteLimitTransform(maximumBytes),
    fs.createWriteStream(destination, { flags: "wx" })
  );
}

class UploadEnvelopeDecoder extends Transform {
  constructor() {
    super();
    this.prefix = [];
    this.prefixBytes = 0;
    this.header = null;
  }

  decodeHeader() {
    const prefix = Buffer.concat(this.prefix, this.prefixBytes);
    const headerBytes = prefix.readUInt32BE(0);
    if (headerBytes === 0 || headerBytes > UPLOAD_ENVELOPE_HEADER_BYTES - 4) {
      throw new UploadError(
        400,
        "INVALID_OPAQUE_REQUEST",
        "Encrypted request metadata is malformed"
      );
    }
    try {
      this.header = JSON.parse(
        prefix.subarray(4, 4 + headerBytes).toString("utf8")
      );
    } catch (error) {
      throw new UploadError(
        400,
        "INVALID_OPAQUE_REQUEST",
        "Encrypted request metadata is malformed"
      );
    }
    this.prefix = [];
  }

  _transform(chunk, encoding, callback) {
    try {
      if (this.header) {
        callback(null, chunk);
        return;
      }

      const needed = UPLOAD_ENVELOPE_HEADER_BYTES - this.prefixBytes;
      const prefixChunk = chunk.subarray(0, needed);
      this.prefix.push(prefixChunk);
      this.prefixBytes += prefixChunk.length;

      if (this.prefixBytes === UPLOAD_ENVELOPE_HEADER_BYTES) {
        this.decodeHeader();
        callback(null, chunk.subarray(prefixChunk.length));
        return;
      }
      callback();
    } catch (error) {
      callback(error);
    }
  }

  _flush(callback) {
    if (!this.header) {
      callback(
        new UploadError(
          400,
          "INVALID_OPAQUE_REQUEST",
          "Encrypted request is incomplete"
        )
      );
      return;
    }
    callback();
  }
}

async function decryptEnvelopeFile(encryptedFile, payloadFile) {
  const stat = await fs.promises.stat(encryptedFile);
  if (
    stat.size <
    UPLOAD_ENCRYPTION_OVERHEAD_BYTES + UPLOAD_ENVELOPE_HEADER_BYTES
  ) {
    throw new UploadError(
      400,
      "INVALID_OPAQUE_REQUEST",
      "Encrypted request is incomplete"
    );
  }

  const handle = await fs.promises.open(encryptedFile, "r");
  const iv = Buffer.alloc(16);
  const authenticationTag = Buffer.alloc(16);
  try {
    await handle.read(iv, 0, iv.length, 0);
    await handle.read(
      authenticationTag,
      0,
      authenticationTag.length,
      stat.size - authenticationTag.length
    );
  } finally {
    await handle.close();
  }

  const key = await getRawDecryptionKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(UPLOAD_REQUEST_ADDITIONAL_DATA));
  decipher.setAuthTag(authenticationTag);
  const envelope = new UploadEnvelopeDecoder();

  try {
    await pipeline(
      fs.createReadStream(encryptedFile, {
        start: iv.length,
        end: stat.size - authenticationTag.length - 1,
      }),
      decipher,
      envelope,
      fs.createWriteStream(payloadFile, { flags: "wx" })
    );
    return envelope.header;
  } catch (error) {
    await fs.promises.unlink(payloadFile).catch(() => {});
    if (error instanceof UploadError) {
      throw error;
    }
    throw new UploadError(
      400,
      "INVALID_OPAQUE_REQUEST",
      "Encrypted request authentication failed"
    );
  }
}

async function assertPaddedPayloadSize(payloadFile, expectedBytes) {
  const stat = await fs.promises.stat(payloadFile);
  if (stat.size !== expectedBytes) {
    throw new UploadError(
      400,
      "INVALID_OPAQUE_REQUEST",
      "Encrypted request has an unexpected size"
    );
  }
}

async function storeChunkFile(uploadId, chunkIndex, payloadFile) {
  assertUploadId(uploadId);
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0) {
    throw new UploadError(400, "INVALID_CHUNK_INDEX", "Invalid chunk index");
  }

  return withActiveUpload(uploadId, async () => {
    const manifest = await readManifest(uploadId);
    await assertPaddedPayloadSize(payloadFile, manifest.chunkSize);
    if (manifest.status === "completed") {
      return { success: true, completed: true, chunkIndex };
    }
    if (chunkIndex >= manifest.totalChunks) {
      throw new UploadError(400, "INVALID_CHUNK_INDEX", "Invalid chunk index");
    }

    const expectedPlaintextBytes = expectedChunkSize(manifest, chunkIndex);
    const destination = partPath(uploadId, chunkIndex);
    try {
      const stat = await fs.promises.stat(destination);
      if (stat.size === expectedPlaintextBytes) {
        await touchUpload(uploadId);
        return { success: true, chunkIndex, alreadyUploaded: true };
      }
      await fs.promises.unlink(destination);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    await fs.promises.truncate(payloadFile, expectedPlaintextBytes);
    try {
      await fs.promises.link(payloadFile, destination);
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
    await touchUpload(uploadId);
    return { success: true, chunkIndex };
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
        uploaded: encodeUploadedChunkBitmap(
          uploadedChunks,
          manifest.totalChunks
        ),
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
          size: manifest.size,
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

function validateOpaqueHeader(header) {
  if (
    !header ||
    typeof header !== "object" ||
    header.version !== PROTOCOL_VERSION ||
    !Object.values(UPLOAD_OPERATIONS).includes(header.operation)
  ) {
    throw new UploadError(
      400,
      "INVALID_OPAQUE_REQUEST",
      "Encrypted request metadata is invalid"
    );
  }
}

async function processOpaqueUploadRequest(request, context) {
  await ensureUploadDirectories();
  const token = uuid.v4();
  const encryptedFile = path.join(requestRoot, `${token}.encrypted`);
  const payloadFile = path.join(requestRoot, `${token}.payload`);
  const maximumRequestBytes =
    Math.max(config.uploads.chunkSize, config.uploads.maxChunkSize) +
    UPLOAD_ENVELOPE_HEADER_BYTES +
    UPLOAD_ENCRYPTION_OVERHEAD_BYTES;

  try {
    await receiveRequestToFile(request, encryptedFile, maximumRequestBytes);
    const header = await decryptions.run(() =>
      decryptEnvelopeFile(encryptedFile, payloadFile)
    );
    validateOpaqueHeader(header);

    switch (header.operation) {
      case UPLOAD_OPERATIONS.initialize:
        validateManifest(header);
        await assertPaddedPayloadSize(payloadFile, header.chunkSize);
        return await initializeUpload(header);
      case UPLOAD_OPERATIONS.chunk:
        return await storeChunkFile(
          header.uploadId,
          header.chunkIndex,
          payloadFile
        );
      case UPLOAD_OPERATIONS.finalize: {
        assertUploadId(header.uploadId);
        const manifest = await readManifest(header.uploadId);
        await assertPaddedPayloadSize(payloadFile, manifest.chunkSize);
        return await finalizeUpload(header.uploadId, header, context);
      }
      default:
        throw new UploadError(
          400,
          "INVALID_OPAQUE_REQUEST",
          "Encrypted request metadata is invalid"
        );
    }
  } finally {
    await Promise.all([
      fs.promises.unlink(encryptedFile).catch(() => {}),
      fs.promises.unlink(payloadFile).catch(() => {}),
    ]);
  }
}

async function cleanupStaleRequestFiles(cutoff) {
  const entries = await fs.promises.readdir(requestRoot, {
    withFileTypes: true,
  });
  let removedRequestFiles = 0;
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const file = path.join(requestRoot, entry.name);
    const stat = await fs.promises.stat(file);
    if (stat.mtimeMs < cutoff) {
      await fs.promises.unlink(file);
      removedRequestFiles += 1;
    }
  }
  return removedRequestFiles;
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

  const removedRequestFiles = await cleanupStaleRequestFiles(cutoff);
  return { removedUploads, removedStagingFiles, removedRequestFiles };
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
  UploadError,
  cleanupStaleUploads,
  processOpaqueUploadRequest,
  startPeriodicUploadCleanup,
};
