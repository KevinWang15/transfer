import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { Server as SocketIOServer } from "socket.io";
import {
  NEW_MESSAGE,
  POST_MESSAGE,
} from "@transfer/api/consts/socketEvents.js";

import "./database.js";
import Message from "./models/message.js";
import multer from "multer";
import MessageService, {
  clearMessagesBySessionId,
  listMessagesBySessionId,
  startPeriodicAutoPrune,
} from "./services/MessageService.js";
import * as http from "http";
import config from "./config.js";
import { decrypt } from "./utils/decryption.js";
import { encryptUploadResponse } from "./utils/encryption.js";
import createUploadRouter from "./routes/uploadRoutes.js";
import { startPeriodicUploadCleanup } from "./services/UploadService.js";
import { createTransferMcpHandler } from "./services/McpService.js";
import { previewableImageMimeType } from "../src/utils/filePreview.js";

const app = express();

const mcp = createTransferMcpHandler({ getIo: () => io });
app.all("/mcp", (req, res) => {
  if (req.headers.origin) {
    res.status(403).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Browser origins are not allowed" },
      id: null,
    });
    return;
  }
  void mcp.handle(req, res);
});

app.use(express.json());
app.use(cors());

app.get("/sessions/:id/history", async (req, res) => {
  res.send(await listMessagesBySessionId(req.params.id));
});

app.delete("/sessions/:id/history", async (req, res) => {
  await clearMessagesBySessionId(req.params.id);
  res.json({ success: true });
});

// Kept for clients using the original cleanup URL.
app.get("/sessions/:id/clear_messages", async (req, res) => {
  await clearMessagesBySessionId(req.params.id);
  res.json({ success: true });
});

app.get("/serverside-config", async (req, res) => {
  res
    .set({
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
    })
    .send(
      await encryptUploadResponse({
        ok: true,
        result: {
          messagesToKeep: config.messagesToKeep,
          uploads: {
            chunkSize: config.uploads.chunkSize,
            concurrency: config.uploads.concurrency,
            staleTtl: config.uploads.staleTtl,
          },
        },
      })
    );
});

app.post(
  "/file",
  multer({ dest: "data/file-uploads/" }).single("file"),
  async (req, res) => {
    if (req.file) {
      const newMessage = new Message({
        session_id: req.body.sessionId,
        data: {
          type: "file",
          filename: req.body.name || req.file.originalname,
          access_key: req.file.filename,
          size: req.file.size,
        },
        created_at: +new Date(),
      });

      const savedMessage = await MessageService.addMessage(newMessage, {
        sessionId: req.body.sessionId,
        io,
      });

      const downloadUrl = new URL(
        `/attachments/${encodeURIComponent(req.file.filename)}`,
        `${req.protocol}://${req.get("host")}`
      );
      downloadUrl.searchParams.set("fileName", newMessage.data.filename);

      res.json({
        success: true,
        url: downloadUrl.toString(),
        accessKey: req.file.filename,
        messageId: savedMessage.id,
      });
    } else {
      res.json({ success: false, message: "No file was uploaded." });
    }
  }
);

app.post("/text", multer({}).any(), async (req, res) => {
  const newMessage = new Message({
    session_id: req.body.sessionId,
    data: {
      type: "text",
      text: req.body.text,
    },
    created_at: +new Date(),
  });

  await MessageService.addMessage(newMessage, {
    sessionId: req.body.sessionId,
    io,
  });

  res.json({ success: true });
});

app.get("/attachments/:access_key", (req, res) => {
  const fileName =
    typeof req.query.fileName === "string" ? req.query.fileName : "attachment";
  const file = path.join("data/file-uploads", req.params.access_key);
  const imageContentType = previewableImageMimeType(fileName);

  if (!imageContentType || req.query.download === "1") {
    return res.download(file, fileName);
  }

  res.set({
    "Content-Type": imageContentType,
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff",
  });
  return res.sendFile(path.resolve(file));
});

const frontendRoot = fileURLToPath(
  path.join(path.dirname(import.meta.url), "frontend")
);
app.use(express.static(frontendRoot));
app.get("*", (req, res) => {
  res.sendFile(path.resolve(frontendRoot, "index.html"));
});

const httpServer = http.createServer(app);
httpServer.on("close", () => void mcp.close());

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.post("/t", async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const encryptedBuffer = Buffer.concat(chunks);

    const decrypted = await decrypt(encryptedBuffer);
    const clientId =
      typeof decrypted.clientId === "string" &&
      decrypted.clientId.length > 0 &&
      decrypted.clientId.length <= 128
        ? decrypted.clientId
        : null;

    const newMessage = new Message({
      session_id: decrypted.sessionId,
      client_id: clientId,
      data: {
        type: "text",
        text: decrypted.text,
      },
      created_at: decrypted.timestamp,
    });

    const savedMessage = await MessageService.addMessage(newMessage, {
      sessionId: decrypted.sessionId,
      io,
    });

    res.json({ success: true, messageId: savedMessage.id });
  } catch (error) {
    console.log(error);
    res.status(400).json({ error: "Decryption failed" });
  }
});

app.use("/u", createUploadRouter({ io }));

io.on("connection", (socket) => {
  const sessionId = getSessionIdFromSocketHandshake(socket);
  socket.join(sessionId);
});

startPeriodicAutoPrune();
startPeriodicUploadCleanup();

function getSessionIdFromSocketHandshake(socket) {
  return socket.handshake.headers["sessionid"];
}

const port = Number(process.env.PORT) || 6611;
httpServer.listen(port, () => {
  console.log(`server listening on port ${port}`);
});
