import crypto from "crypto";

const IV_LENGTH = 16;
const ENCRYPTION_KEY = "fDfl4koWS3GR";
let keyPromise;
let rawKeyPromise;

function getDecryptionKey() {
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
        ["decrypt"]
      );
    })();
  }

  return keyPromise;
}

export function getRawDecryptionKey() {
  if (!rawKeyPromise) {
    rawKeyPromise = new Promise((resolve, reject) => {
      crypto.pbkdf2(
        ENCRYPTION_KEY,
        "salt",
        100000,
        32,
        "sha256",
        (error, key) => (error ? reject(error) : resolve(key))
      );
    });
  }
  return rawKeyPromise;
}

export async function decryptBytes(encryptedData, { additionalData } = {}) {
  if (encryptedData.byteLength < IV_LENGTH + 16) {
    throw new Error("Encrypted payload is too short");
  }

  const iv = encryptedData.subarray(0, IV_LENGTH);
  const data = encryptedData.subarray(IV_LENGTH);
  const key = await getDecryptionKey();
  const algorithm = { name: "AES-GCM", iv };

  if (additionalData !== undefined) {
    algorithm.additionalData =
      typeof additionalData === "string"
        ? Buffer.from(additionalData)
        : additionalData;
  }

  const decrypted = await crypto.subtle.decrypt(algorithm, key, data);
  return Buffer.from(decrypted);
}

export async function decrypt(encryptedData) {
  const decrypted = await decryptBytes(encryptedData);
  return JSON.parse(decrypted.toString("utf-8"));
}
