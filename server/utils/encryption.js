import crypto from "crypto";

import {
  UPLOAD_RESPONSE_ADDITIONAL_DATA,
  UPLOAD_RESPONSE_PLAINTEXT_BYTES,
} from "@transfer/api/consts/uploadProtocol.js";

const IV_LENGTH = 16;
const ENCRYPTION_KEY = "fDfl4koWS3GR";
let keyPromise;

function getEncryptionKey() {
  if (!keyPromise) {
    keyPromise = (async () => {
      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        Buffer.from(ENCRYPTION_KEY),
        "PBKDF2",
        false,
        ["deriveKey"]
      );

      return crypto.subtle.deriveKey(
        {
          name: "PBKDF2",
          salt: Buffer.from("salt"),
          iterations: 100000,
          hash: "SHA-256",
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt"]
      );
    })();
  }

  return keyPromise;
}

async function encryptBytes(data, { additionalData } = {}) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = await getEncryptionKey();
  const algorithm = { name: "AES-GCM", iv };

  if (additionalData !== undefined) {
    algorithm.additionalData = Buffer.from(additionalData);
  }

  const encrypted = await crypto.subtle.encrypt(algorithm, key, data);
  return Buffer.concat([iv, Buffer.from(encrypted)]);
}

export async function encryptUploadResponse(value) {
  const json = Buffer.from(JSON.stringify(value));
  if (json.length > UPLOAD_RESPONSE_PLAINTEXT_BYTES - 4) {
    throw new Error("Encrypted upload response is too large");
  }

  const padded = Buffer.alloc(UPLOAD_RESPONSE_PLAINTEXT_BYTES);
  padded.writeUInt32BE(json.length, 0);
  json.copy(padded, 4);
  return encryptBytes(padded, {
    additionalData: UPLOAD_RESPONSE_ADDITIONAL_DATA,
  });
}
