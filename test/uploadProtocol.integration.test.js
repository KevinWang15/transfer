import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { encrypt, encryptBytes } from "../src/utils/encryption.js";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const serverEntryPoint = path.join(repositoryRoot, "server/index.js");
const protocolVersion = 1;

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startServer(extraEnvironment = {}) {
  const workingDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "transfer-upload-test-")
  );
  await fs.mkdir(path.join(workingDirectory, "data"));
  const port = await unusedPort();
  const child = spawn(
    process.execPath,
    ["--max-old-space-size=96", serverEntryPoint],
    {
      cwd: workingDirectory,
      env: { ...process.env, PORT: String(port), ...extraEnvironment },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  let diagnostics = "";
  child.stdout.on("data", (chunk) => {
    diagnostics += chunk;
  });
  child.stderr.on("data", (chunk) => {
    diagnostics += chunk;
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Server did not start:\n${diagnostics}`)),
      15000
    );
    const poll = setInterval(() => {
      if (diagnostics.includes("server listening on port")) {
        clearInterval(poll);
        clearTimeout(timeout);
        resolve();
      }
    }, 20);
    child.once("exit", (code) => {
      clearInterval(poll);
      clearTimeout(timeout);
      reject(new Error(`Server exited with ${code}:\n${diagnostics}`));
    });
  });

  return {
    baseUrl: `http://127.0.0.1:${port}/`,
    child,
    diagnostics: () => diagnostics,
    workingDirectory,
    async close() {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await new Promise((resolve) => child.once("exit", resolve));
      }
      await fs.rm(workingDirectory, { recursive: true, force: true });
    },
  };
}

async function encryptedPost(baseUrl, endpoint, value) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: await encrypt(value),
  });
  const result = await response.json();
  return { response, result };
}

function additionalData(uploadId, chunkIndex) {
  return `transfer-upload-v${protocolVersion}:${uploadId}:${chunkIndex}`;
}

async function putChunk(baseUrl, uploadId, chunkIndex, plaintext) {
  const encrypted = await encryptBytes(plaintext, {
    additionalData: additionalData(uploadId, chunkIndex),
  });
  const response = await fetch(`${baseUrl}u/${uploadId}/${chunkIndex}`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: encrypted,
  });
  return { response, result: await response.json() };
}

async function runWorkers(values, concurrency, operation) {
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < values.length) {
        const index = next;
        next += 1;
        await operation(values[index]);
      }
    })
  );
}

test("large encrypted upload is parallel, resumable, bounded, and idempotent", async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const chunkSize = 1024 * 1024;
  const file = Buffer.allocUnsafe(24 * 1024 * 1024 + 173);
  for (let index = 0; index < file.length; index += 1) {
    file[index] = (index * 31 + 17) & 0xff;
  }

  const uploadId = crypto.randomUUID();
  const metadata = {
    version: protocolVersion,
    uploadId,
    sessionId: "integration-test-session",
    filename: "large-test.bin",
    size: file.length,
    chunkSize,
    totalChunks: Math.ceil(file.length / chunkSize),
    timestamp: Date.now(),
    lastModified: 123456789,
  };

  const initialized = await encryptedPost(server.baseUrl, "u/init", metadata);
  assert.equal(initialized.response.status, 200, server.diagnostics());
  assert.deepEqual(initialized.result.uploadedChunks, []);

  const firstChunk = file.subarray(0, chunkSize);
  const corrupted = await encryptBytes(firstChunk, {
    additionalData: additionalData(uploadId, 0),
  });
  corrupted[corrupted.length - 1] ^= 1;
  const rejected = await fetch(`${server.baseUrl}u/${uploadId}/0`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: corrupted,
  });
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).code, "CHUNK_DECRYPTION_FAILED");

  for (const chunkIndex of [4, 1, 0]) {
    const start = chunkIndex * chunkSize;
    const uploaded = await putChunk(
      server.baseUrl,
      uploadId,
      chunkIndex,
      file.subarray(start, Math.min(file.length, start + chunkSize))
    );
    assert.equal(uploaded.response.status, 200, server.diagnostics());
  }

  const resumed = await encryptedPost(server.baseUrl, "u/init", metadata);
  assert.equal(resumed.response.status, 200, server.diagnostics());
  assert.deepEqual(resumed.result.uploadedChunks, [0, 1, 4]);

  const remaining = Array.from(
    { length: metadata.totalChunks },
    (_, index) => index
  ).filter((index) => ![0, 1, 4].includes(index));
  await runWorkers(remaining.reverse(), 4, async (chunkIndex) => {
    const start = chunkIndex * chunkSize;
    const uploaded = await putChunk(
      server.baseUrl,
      uploadId,
      chunkIndex,
      file.subarray(start, Math.min(file.length, start + chunkSize))
    );
    assert.equal(uploaded.response.status, 200, server.diagnostics());
  });

  const duplicateChunk = await putChunk(
    server.baseUrl,
    uploadId,
    1,
    file.subarray(chunkSize, chunkSize * 2)
  );
  assert.equal(duplicateChunk.response.status, 200);
  assert.equal(duplicateChunk.result.alreadyUploaded, true);

  const finalization = {
    version: protocolVersion,
    uploadId,
    sessionId: metadata.sessionId,
  };
  const finalized = await encryptedPost(
    server.baseUrl,
    `u/${uploadId}/finalize`,
    finalization
  );
  assert.equal(finalized.response.status, 200, server.diagnostics());
  assert.equal(finalized.result.accessKey, uploadId);

  const downloadedResponse = await fetch(
    `${server.baseUrl}attachments/${finalized.result.accessKey}?fileName=test.bin`
  );
  assert.equal(downloadedResponse.status, 200);
  const downloaded = Buffer.from(await downloadedResponse.arrayBuffer());
  assert.equal(downloaded.length, file.length);
  assert.equal(
    crypto.createHash("sha256").update(downloaded).digest("hex"),
    crypto.createHash("sha256").update(file).digest("hex")
  );

  const finalizedAgain = await encryptedPost(
    server.baseUrl,
    `u/${uploadId}/finalize`,
    finalization
  );
  assert.equal(finalizedAgain.response.status, 200);
  assert.equal(finalizedAgain.result.messageId, finalized.result.messageId);

  const historyResponse = await fetch(
    `${server.baseUrl}sessions/${metadata.sessionId}/history`
  );
  const history = await historyResponse.json();
  assert.equal(history.length, 1);
  assert.equal(JSON.parse(history[0].data).upload_id, uploadId);

  const temporaryEntries = await fs.readdir(
    path.join(server.workingDirectory, "data/upload-chunks", uploadId)
  );
  assert.deepEqual(temporaryEntries, ["manifest.json"]);
});

test("stale incomplete chunks are removed from disk", async (t) => {
  const server = await startServer({
    UPLOAD_STALE_TTL_SECONDS: "1",
    UPLOAD_CLEANUP_INTERVAL_SECONDS: "1",
  });
  t.after(() => server.close());

  const uploadId = crypto.randomUUID();
  const metadata = {
    version: protocolVersion,
    uploadId,
    sessionId: "cleanup-test-session",
    filename: "abandoned.bin",
    size: 65536,
    chunkSize: 65536,
    totalChunks: 1,
    timestamp: Date.now(),
    lastModified: 0,
  };
  const initialized = await encryptedPost(server.baseUrl, "u/init", metadata);
  assert.equal(initialized.response.status, 200, server.diagnostics());

  const directory = path.join(
    server.workingDirectory,
    "data/upload-chunks",
    uploadId
  );
  const oldTime = new Date(Date.now() - 5000);
  await fs.utimes(directory, oldTime, oldTime);

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      await fs.access(directory);
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      if (error.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
  assert.fail("stale upload directory was not cleaned");
});
