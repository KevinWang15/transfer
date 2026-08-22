import express from "express";

import {
  UploadError,
  processOpaqueUploadRequest,
} from "../services/UploadService.js";
import { encryptUploadResponse } from "../utils/encryption.js";

async function sendEncryptedResponse(response, value) {
  response
    .status(200)
    .set({
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
    })
    .send(await encryptUploadResponse(value));
}

export default function createUploadRouter({ io }) {
  const router = express.Router();

  router.post("/", async (request, response) => {
    try {
      const result = await processOpaqueUploadRequest(request, { io });
      await sendEncryptedResponse(response, { ok: true, result });
    } catch (error) {
      if (!request.readableEnded && !request.destroyed) {
        request.resume();
      }
      const status = error instanceof UploadError ? error.status : 500;
      if (status >= 500) {
        console.error("upload request failed", error);
      }
      await sendEncryptedResponse(response, {
        ok: false,
        error: {
          status,
          code: error.code || "UPLOAD_FAILED",
          message: status >= 500 ? "Upload failed" : error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      });
    }
  });

  return router;
}
