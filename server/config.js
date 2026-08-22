function positiveIntegerFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export default {
  messagesToKeep: {
    maxCount: 100,
    ttl: 86400 * 3,
    pruneInterval: positiveIntegerFromEnv("MESSAGE_PRUNE_INTERVAL_SECONDS", 60),
  },
  uploads: {
    chunkSize: positiveIntegerFromEnv(
      "UPLOAD_CHUNK_SIZE_BYTES",
      4 * 1024 * 1024
    ),
    maxChunkSize: positiveIntegerFromEnv(
      "UPLOAD_MAX_CHUNK_SIZE_BYTES",
      16 * 1024 * 1024
    ),
    concurrency: positiveIntegerFromEnv("UPLOAD_CONCURRENCY", 3),
    decryptionConcurrency: positiveIntegerFromEnv(
      "UPLOAD_DECRYPTION_CONCURRENCY",
      2
    ),
    staleTtl: positiveIntegerFromEnv("UPLOAD_STALE_TTL_SECONDS", 86400 * 3),
    cleanupInterval: positiveIntegerFromEnv(
      "UPLOAD_CLEANUP_INTERVAL_SECONDS",
      60 * 60
    ),
    maxMetadataBytes: 64 * 1024,
  },
};
