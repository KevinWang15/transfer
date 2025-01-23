import crypto from 'crypto';

const IV_LENGTH = 16;
const ENCRYPTION_KEY = "fDfl4koWS3GR";

export async function decrypt(encryptedData) {
    const iv = encryptedData.slice(0, IV_LENGTH);
    const data = encryptedData.slice(IV_LENGTH);

    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        Buffer.from(ENCRYPTION_KEY),
        'PBKDF2',
        false,
        ['deriveKey']
    );

    const key = await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: Buffer.from('salt'),
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
    );

    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        data
    );

    return JSON.parse(Buffer.from(decrypted).toString('utf-8'));
}
