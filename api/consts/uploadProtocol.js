export const UPLOAD_PROTOCOL_VERSION = 2;
export const UPLOAD_ENVELOPE_HEADER_BYTES = 16 * 1024;
export const UPLOAD_ENCRYPTION_OVERHEAD_BYTES = 32;
export const UPLOAD_RESPONSE_PLAINTEXT_BYTES = 32 * 1024;
export const UPLOAD_REQUEST_ADDITIONAL_DATA = "transfer-envelope-v2";
export const UPLOAD_RESPONSE_ADDITIONAL_DATA = "transfer-response-v2";

export const UPLOAD_OPERATIONS = Object.freeze({
  initialize: "initialize",
  chunk: "chunk",
  finalize: "finalize",
});
