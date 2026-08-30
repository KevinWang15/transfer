import crypto from "crypto";
import fs from "fs";
import path from "path";

import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import * as z from "zod/v4";

import Message from "../models/message.js";
import MessageService, {
  clearMessagesBySessionId,
  listMessagesBySessionId,
} from "./MessageService.js";

const fileRoot = path.resolve("data/file-uploads");
const MAX_MCP_FILE_BYTES = 10 * 1024 * 1024;
const sessionIdSchema = z.string().min(1).max(2048);

function toolResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function attachmentUrl(origin, accessKey, filename) {
  const url = new URL(`/attachments/${encodeURIComponent(accessKey)}`, origin);
  url.searchParams.set("fileName", filename);
  return url.toString();
}

function serializeMessage(message, origin) {
  const data =
    typeof message.data === "string" ? JSON.parse(message.data) : message.data;
  if (data.type === "file") {
    data.url = attachmentUrl(origin, data.access_key, data.filename);
  }
  return {
    id: message.id,
    sessionId: message.session_id,
    createdAt: message.created_at,
    data,
  };
}

async function saveUploadedFile({ contentBase64, filename, sessionId, io }) {
  const contents = Buffer.from(contentBase64, "base64");
  if (contents.length > MAX_MCP_FILE_BYTES) {
    throw new Error(`File exceeds the ${MAX_MCP_FILE_BYTES} byte MCP limit`);
  }

  await fs.promises.mkdir(fileRoot, { recursive: true });
  const accessKey = crypto.randomUUID();
  const destination = path.join(fileRoot, accessKey);
  await fs.promises.writeFile(destination, contents, { flag: "wx" });

  try {
    const message = new Message({
      session_id: sessionId,
      data: {
        type: "file",
        filename,
        access_key: accessKey,
        size: contents.length,
      },
      created_at: Date.now(),
    });
    return await MessageService.addMessage(message, { sessionId, io });
  } catch (error) {
    await fs.promises.unlink(destination).catch(() => {});
    throw error;
  }
}

function createTransferMcpServer({ origin, io }) {
  const server = new McpServer({ name: "transfer", version: "0.1.0" });

  server.registerTool(
    "send_text",
    {
      title: "Send text",
      description: "Send a text message to a Transfer session.",
      inputSchema: z.object({
        sessionId: sessionIdSchema.describe("Transfer session ID"),
        text: z
          .string()
          .max(64 * 1024)
          .describe("Text message to send"),
      }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ sessionId, text }) => {
      const message = new Message({
        session_id: sessionId,
        data: { type: "text", text },
        created_at: Date.now(),
      });
      const saved = await MessageService.addMessage(message, { sessionId, io });
      return toolResult({ success: true, messageId: saved.id });
    }
  );

  server.registerTool(
    "upload_file",
    {
      title: "Upload file",
      description:
        "Upload a small file to a Transfer session from base64-encoded content. Files are limited to 10 MiB through MCP.",
      inputSchema: z.object({
        sessionId: sessionIdSchema.describe("Transfer session ID"),
        filename: z.string().min(1).max(1024),
        contentBase64: z
          .base64()
          .max(Math.ceil((MAX_MCP_FILE_BYTES * 4) / 3) + 4)
          .describe("Base64-encoded file contents"),
      }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ sessionId, filename, contentBase64 }) => {
      const saved = await saveUploadedFile({
        contentBase64,
        filename,
        sessionId,
        io,
      });
      return toolResult({
        success: true,
        messageId: saved.id,
        url: attachmentUrl(origin, saved.data.access_key, filename),
      });
    }
  );

  server.registerTool(
    "get_session_history",
    {
      title: "Get session history",
      description:
        "List the retained messages in a Transfer session. File messages include absolute download URLs.",
      inputSchema: z.object({
        sessionId: sessionIdSchema.describe("Transfer session ID"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ sessionId }) => {
      const messages = await listMessagesBySessionId(sessionId);
      return toolResult({
        sessionId,
        messages: messages.map((message) => serializeMessage(message, origin)),
      });
    }
  );

  server.registerTool(
    "clear_session",
    {
      title: "Clear session",
      description:
        "Permanently delete all retained messages and uploaded files in a Transfer session.",
      inputSchema: z.object({
        sessionId: sessionIdSchema.describe("Transfer session ID"),
      }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ sessionId }) => {
      await clearMessagesBySessionId(sessionId);
      return toolResult({ success: true, sessionId });
    }
  );

  return server;
}

function createTransferMcpHandler({ getIo }) {
  const handler = createMcpHandler(({ requestInfo }) =>
    createTransferMcpServer({
      origin: new URL(requestInfo.url).origin,
      io: getIo(),
    })
  );
  const nodeHandler = toNodeHandler(handler, {
    onerror: (error) => console.error("MCP request failed", error),
  });

  return {
    close: () => handler.close(),
    handle: (request, response) => nodeHandler(request, response),
  };
}

export { createTransferMcpHandler };
