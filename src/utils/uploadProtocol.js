import {
  UPLOAD_ENVELOPE_HEADER_BYTES,
  UPLOAD_REQUEST_ADDITIONAL_DATA,
  UPLOAD_RESPONSE_ADDITIONAL_DATA,
  UPLOAD_RESPONSE_PLAINTEXT_BYTES,
} from "@transfer/api/consts/uploadProtocol.js";

import { decryptBytes, encryptBytes } from "./encryption.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function encodeUploadRequest(header, payload, paddedPayloadBytes) {
  const headerBytes = encoder.encode(JSON.stringify(header));
  if (headerBytes.byteLength > UPLOAD_ENVELOPE_HEADER_BYTES - 4) {
    throw new Error("Encrypted upload metadata is too large");
  }

  const payloadBytes = payload
    ? payload instanceof Uint8Array
      ? payload
      : new Uint8Array(payload)
    : new Uint8Array();
  if (payloadBytes.byteLength > paddedPayloadBytes) {
    throw new Error("Upload payload exceeds its padded size");
  }

  const framed = new Uint8Array(
    UPLOAD_ENVELOPE_HEADER_BYTES + paddedPayloadBytes
  );
  new DataView(framed.buffer).setUint32(0, headerBytes.byteLength);
  framed.set(headerBytes, 4);
  framed.set(payloadBytes, UPLOAD_ENVELOPE_HEADER_BYTES);

  return encryptBytes(framed, {
    additionalData: UPLOAD_REQUEST_ADDITIONAL_DATA,
  });
}

export async function decodeUploadResponse(encryptedData) {
  const decrypted = new Uint8Array(
    await decryptBytes(encryptedData, {
      additionalData: UPLOAD_RESPONSE_ADDITIONAL_DATA,
    })
  );
  if (decrypted.byteLength !== UPLOAD_RESPONSE_PLAINTEXT_BYTES) {
    throw new Error("Encrypted upload response has an unexpected size");
  }

  const jsonBytes = new DataView(
    decrypted.buffer,
    decrypted.byteOffset,
    decrypted.byteLength
  ).getUint32(0);
  if (jsonBytes > decrypted.byteLength - 4) {
    throw new Error("Encrypted upload response is malformed");
  }

  return JSON.parse(decoder.decode(decrypted.subarray(4, 4 + jsonBytes)));
}

export function decodeUploadedChunkBitmap(encoded, totalChunks) {
  if (!encoded) {
    return new Set();
  }

  const binary = atob(encoded);
  const uploaded = new Set();
  for (let index = 0; index < totalChunks; index += 1) {
    const byte = binary.charCodeAt(index >> 3);
    if (byte & (1 << (index & 7))) {
      uploaded.add(index);
    }
  }
  return uploaded;
}
