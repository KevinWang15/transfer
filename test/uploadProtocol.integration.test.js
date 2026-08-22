import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  UPLOAD_ENCRYPTION_OVERHEAD_BYTES,
  UPLOAD_ENVELOPE_HEADER_BYTES,
  UPLOAD_OPERATIONS,
  UPLOAD_PROTOCOL_VERSION,
  UPLOAD_RESPONSE_PLAINTEXT_BYTES,
} from "@transfer/api/consts/uploadProtocol.js";
import {
  decodeUploadedChunkBitmap,
  decodeUploadResponse,
  encodeUploadRequest,
} from "../src/utils/uploadProtocol.js";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const serverEntryPoint = path.join(repositoryRoot, "server/index.js");
const protocolVersion = UPLOAD_PROTOCOL_VERSION;

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
    if (process.env.DEBUG_UPLOAD_TEST) {
      process.stderr.write(chunk);
    }
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

async function opaquePost(baseUrl, header, payload, paddedPayloadBytes) {
  const body = await encodeUploadRequest(header, payload, paddedPayloadBytes);
  const response = await fetch(`${baseUrl}u`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body,
  });
  const encryptedResponse = await response.arrayBuffer();
  const packet = await decodeUploadResponse(encryptedResponse);
  return { body, response, packet, result: packet.result };
}

async function postChunk(
  baseUrl,
  uploadId,
  chunkIndex,
  plaintext,
  paddedPayloadBytes
) {
  return opaquePost(
    baseUrl,
    {
      version: protocolVersion,
      operation: UPLOAD_OPERATIONS.chunk,
      uploadId,
      chunkIndex,
    },
    plaintext,
    paddedPayloadBytes
  );
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

  const configResponse = await fetch(`${server.baseUrl}serverside-config`);
  const encryptedConfig = Buffer.from(await configResponse.arrayBuffer());
  assert.equal(
    encryptedConfig.length,
    UPLOAD_RESPONSE_PLAINTEXT_BYTES + UPLOAD_ENCRYPTION_OVERHEAD_BYTES
  );
  assert.equal(encryptedConfig.includes(Buffer.from("uploads")), false);
  const configPacket = await decodeUploadResponse(encryptedConfig);
  assert.equal(configPacket.ok, true);
  assert.equal(configPacket.result.uploads.concurrency, 3);

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

  const initialized = await opaquePost(
    server.baseUrl,
    { ...metadata, operation: UPLOAD_OPERATIONS.initialize },
    null,
    chunkSize
  );
  assert.equal(initialized.response.status, 200, server.diagnostics());
  assert.equal(initialized.packet.ok, true);
  assert.deepEqual(
    [
      ...decodeUploadedChunkBitmap(
        initialized.result.uploaded,
        metadata.totalChunks
      ),
    ],
    []
  );
  const opaqueRequestBytes =
    UPLOAD_ENVELOPE_HEADER_BYTES + chunkSize + UPLOAD_ENCRYPTION_OVERHEAD_BYTES;
  assert.equal(initialized.body.byteLength, opaqueRequestBytes);
  assert.equal(
    Buffer.from(initialized.body).includes(Buffer.from(uploadId)),
    false
  );
  assert.equal(
    Buffer.from(initialized.body).includes(Buffer.from(metadata.filename)),
    false
  );
  assert.equal(
    Buffer.from(initialized.body).includes(
      Buffer.from(UPLOAD_OPERATIONS.initialize)
    ),
    false
  );
  const independentlyEncrypted = await encodeUploadRequest(
    { ...metadata, operation: UPLOAD_OPERATIONS.initialize },
    null,
    chunkSize
  );
  assert.notDeepEqual(
    Buffer.from(independentlyEncrypted.subarray(0, 16)),
    Buffer.from(initialized.body.subarray(0, 16))
  );
  assert.equal(
    Number(initialized.response.headers.get("content-length")),
    UPLOAD_RESPONSE_PLAINTEXT_BYTES + UPLOAD_ENCRYPTION_OVERHEAD_BYTES
  );

  const firstChunk = file.subarray(0, chunkSize);
  const corrupted = await encodeUploadRequest(
    {
      version: protocolVersion,
      operation: UPLOAD_OPERATIONS.chunk,
      uploadId,
      chunkIndex: 0,
    },
    firstChunk,
    chunkSize
  );
  corrupted[corrupted.length - 1] ^= 1;
  const rejected = await fetch(`${server.baseUrl}u`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: corrupted,
  });
  assert.equal(rejected.status, 200);
  const rejectedPacket = await decodeUploadResponse(
    await rejected.arrayBuffer()
  );
  assert.equal(rejectedPacket.ok, false);
  assert.equal(rejectedPacket.error.code, "INVALID_OPAQUE_REQUEST");

  for (const chunkIndex of [4, 1, 0]) {
    const start = chunkIndex * chunkSize;
    const uploaded = await postChunk(
      server.baseUrl,
      uploadId,
      chunkIndex,
      file.subarray(start, Math.min(file.length, start + chunkSize)),
      chunkSize
    );
    assert.equal(uploaded.response.status, 200, server.diagnostics());
    assert.equal(uploaded.packet.ok, true, server.diagnostics());
    assert.equal(uploaded.body.byteLength, opaqueRequestBytes);
  }

  const resumed = await opaquePost(
    server.baseUrl,
    { ...metadata, operation: UPLOAD_OPERATIONS.initialize },
    null,
    chunkSize
  );
  assert.equal(resumed.response.status, 200, server.diagnostics());
  assert.deepEqual(
    [
      ...decodeUploadedChunkBitmap(
        resumed.result.uploaded,
        metadata.totalChunks
      ),
    ],
    [0, 1, 4]
  );

  const remaining = Array.from(
    { length: metadata.totalChunks },
    (_, index) => index
  ).filter((index) => ![0, 1, 4].includes(index));
  await runWorkers(remaining.reverse(), 4, async (chunkIndex) => {
    const start = chunkIndex * chunkSize;
    const uploaded = await postChunk(
      server.baseUrl,
      uploadId,
      chunkIndex,
      file.subarray(start, Math.min(file.length, start + chunkSize)),
      chunkSize
    );
    assert.equal(uploaded.response.status, 200, server.diagnostics());
    assert.equal(uploaded.packet.ok, true, server.diagnostics());
    assert.equal(uploaded.body.byteLength, opaqueRequestBytes);
  });

  const duplicateChunk = await postChunk(
    server.baseUrl,
    uploadId,
    1,
    file.subarray(chunkSize, chunkSize * 2),
    chunkSize
  );
  assert.equal(duplicateChunk.response.status, 200);
  assert.equal(duplicateChunk.result.alreadyUploaded, true);

  const finalization = {
    version: protocolVersion,
    operation: UPLOAD_OPERATIONS.finalize,
    uploadId,
    sessionId: metadata.sessionId,
  };
  const finalized = await opaquePost(
    server.baseUrl,
    finalization,
    null,
    chunkSize
  );
  assert.equal(finalized.response.status, 200, server.diagnostics());
  assert.equal(finalized.packet.ok, true, server.diagnostics());
  assert.equal(finalized.body.byteLength, opaqueRequestBytes);
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

  const finalizedAgain = await opaquePost(
    server.baseUrl,
    finalization,
    null,
    chunkSize
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

test("stale incomplete uploads and request files are removed", async (t) => {
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
  const initialized = await opaquePost(
    server.baseUrl,
    { ...metadata, operation: UPLOAD_OPERATIONS.initialize },
    null,
    metadata.chunkSize
  );
  assert.equal(initialized.response.status, 200, server.diagnostics());
  assert.equal(initialized.packet.ok, true, server.diagnostics());

  const directory = path.join(
    server.workingDirectory,
    "data/upload-chunks",
    uploadId
  );
  const abandonedRequest = path.join(
    server.workingDirectory,
    "data/upload-requests",
    "abandoned.encrypted"
  );
  await fs.writeFile(abandonedRequest, Buffer.alloc(1024));
  const oldTime = new Date(Date.now() - 5000);
  await fs.utimes(directory, oldTime, oldTime);
  await fs.utimes(abandonedRequest, oldTime, oldTime);

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      await fs.access(directory);
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      if (error.code === "ENOENT") {
        await assert.rejects(fs.access(abandonedRequest), {
          code: "ENOENT",
        });
        return;
      }
      throw error;
    }
  }
  assert.fail("stale upload directory was not cleaned");
});
