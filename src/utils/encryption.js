const IV_LENGTH = 16;
const ENCRYPTION_KEY = "fDfl4koWS3GR";
const encoder = new TextEncoder();
let keyPromise;

function getEncryptionKey() {
  if (!keyPromise) {
    keyPromise = (async () => {
      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        encoder.encode(ENCRYPTION_KEY),
        "PBKDF2",
        false,
        ["deriveKey"]
      );

      return crypto.subtle.deriveKey(
        {
          name: "PBKDF2",
          salt: encoder.encode("salt"),
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

export async function encryptBytes(data, { additionalData } = {}) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await getEncryptionKey();
  const algorithm = { name: "AES-GCM", iv };

  if (additionalData !== undefined) {
    algorithm.additionalData =
      typeof additionalData === "string"
        ? encoder.encode(additionalData)
        : additionalData;
  }

  const encrypted = await crypto.subtle.encrypt(algorithm, key, data);
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  return combined;
}

export async function encrypt(data) {
  return encryptBytes(encoder.encode(JSON.stringify(data)));
}
