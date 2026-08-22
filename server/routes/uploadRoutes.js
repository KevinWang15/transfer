import express from "express";

import config from "../config.js";
import {
  UploadError,
  finalizeUpload,
  initializeUpload,
  storeChunk,
} from "../services/UploadService.js";
import { decrypt } from "../utils/decryption.js";

async function readEncryptedMetadata(request) {
  const maximum = config.uploads.maxMetadataBytes;
  const contentLength = Number(request.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > maximum) {
    request.resume();
    throw new UploadError(
      413,
      "METADATA_TOO_LARGE",
      "Encrypted upload metadata is too large"
    );
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maximum) {
      throw new UploadError(
        413,
        "METADATA_TOO_LARGE",
        "Encrypted upload metadata is too large"
      );
    }
    chunks.push(chunk);
  }

  try {
    return await decrypt(Buffer.concat(chunks, total));
  } catch (error) {
    throw new UploadError(
      400,
      "METADATA_DECRYPTION_FAILED",
      "Upload metadata authentication or decryption failed"
    );
  }
}

function sendUploadError(response, error) {
  const status = error instanceof UploadError ? error.status : 500;
  if (status >= 500) {
    console.error("upload request failed", error);
  }
  response.status(status).json({
    success: false,
    code: error.code || "UPLOAD_FAILED",
    error: status >= 500 ? "Upload failed" : error.message,
    ...(error.details ? { details: error.details } : {}),
  });
}

export default function createUploadRouter({ io }) {
  const router = express.Router();

  router.post("/init", async (request, response) => {
    try {
      response.json(
        await initializeUpload(await readEncryptedMetadata(request))
      );
    } catch (error) {
      sendUploadError(response, error);
    }
  });

  router.put("/:uploadId/:chunkIndex", async (request, response) => {
    try {
      const chunkIndex = Number(request.params.chunkIndex);
      response.json(
        await storeChunk(request.params.uploadId, chunkIndex, request)
      );
    } catch (error) {
      sendUploadError(response, error);
    }
  });

  router.post("/:uploadId/finalize", async (request, response) => {
    try {
      const metadata = await readEncryptedMetadata(request);
      response.json(
        await finalizeUpload(request.params.uploadId, metadata, { io })
      );
    } catch (error) {
      sendUploadError(response, error);
    }
  });

  return router;
}
